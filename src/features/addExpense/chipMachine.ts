/**
 * The category chip on Add expense (design.md "Categories", "Model refinement", "Chip state machine"), as a pure
 * reducer plus a small controller that owns the 500 ms pause and the model requests. Pure: no React, no timers of
 * its own (the controller takes a scheduler), so the whole contract, including the races, runs under Vitest.
 *
 * The chip holds `{ category, source }` with `source ∈ keyword | model | user`:
 * - A user tap sets `source = user`, cancels any in-flight model request and drops any reply that arrives
 *   afterwards. Later title edits do not re-infer. `user` is sticky until the sheet is dismissed.
 * - While `source` is `keyword` or `model`, every keystroke runs keyword inference (applied immediately, `source`
 *   becomes `keyword`) and, after a 500 ms pause, the controller issues a fresh model request.
 * - Each model request carries the exact title it was asked about. A reply is applied only if that title still
 *   matches the field and `source` is not `user`; otherwise it is discarded. A model result can be refined by a
 *   later model result, but never overwrite a tap.
 * - Save freezes the chip: the event carries whatever it shows, and nothing changes it afterwards, the sparkle
 *   included.
 * - The sparkle (AddExpenseStates, "Category chip"): while `source` is `model` (the model's pick, not yet touched)
 *   the chip carries it (`tagged`, derived from `source` as `carriesSparkle` states it, never timed), so a choice
 *   the user did not make is never invisible. Picking a category takes it away (`source = user`; the UI fades it
 *   out), and so does a keystroke, which puts the keyword guess back. A keyword-inferred chip and a chip the user
 *   chose never carry it. When the model changes the chip, `swaps` counts up so the UI animates the swap.
 *
 * Replies and taps are both handled on the JavaScript thread in arrival order, so a tap is never lost.
 * `src/state/categories.ts` states the same rules as plain functions over `{ category, source }`.
 */
import type { Category } from '@even/core';

import { guessCategory, inferCategory } from '@/state/categories';

export type ChipSource = 'keyword' | 'model' | 'user';

export interface ChipState {
  category: Category;
  source: ChipSource;
  /** Save was tapped: nothing changes the chip any more. */
  frozen: boolean;
  /** Counts the model's changes to the chip; the UI animates each one. */
  swaps: number;
  /** The chip carries the sparkle: `source` is `model` (`carriesSparkle`). Derived, never timed; Save keeps it. */
  tagged: boolean;
}

export type ChipEvent =
  /** A keystroke: the title field now reads `title`. */
  | { type: 'title'; title: string }
  /** A model reply for `askedTitle`, arriving while the field reads `currentTitle`. */
  | { type: 'reply'; askedTitle: string; currentTitle: string; category: Category | null }
  /** A tap on a category in the picker. */
  | { type: 'tap'; category: Category }
  /** Save. */
  | { type: 'freeze' };

/** A fresh sheet infers from the title; an edited expense starts from its saved category, as the user's choice. */
export function initialChipState(title: string, saved?: Category): ChipState {
  return saved === undefined
    ? { category: inferCategory(title), source: 'keyword', frozen: false, swaps: 0, tagged: false }
    : { category: saved, source: 'user', frozen: false, swaps: 0, tagged: false };
}

export function chipReducer(state: ChipState, event: ChipEvent): ChipState {
  if (state.frozen) return state;
  switch (event.type) {
    case 'title': {
      if (state.source === 'user') return state;
      const category = inferCategory(event.title);
      return category === state.category && state.source === 'keyword'
        ? state
        : { ...state, category, source: 'keyword', tagged: false };
    }
    case 'reply': {
      if (event.category === null) return state;
      if (state.source === 'user' || event.askedTitle !== event.currentTitle) return state;
      const changed = event.category !== state.category;
      // The model agrees with the chip: no swap, but the chip is the model's pick now and carries the sparkle.
      if (!changed) {
        return state.source === 'model' ? state : { ...state, source: 'model', tagged: true };
      }
      return {
        ...state,
        category: event.category,
        source: 'model',
        swaps: state.swaps + 1,
        tagged: true,
      };
    }
    case 'tap':
      return state.source === 'user' && state.category === event.category
        ? state
        : { ...state, category: event.category, source: 'user', tagged: false };
    case 'freeze':
      return { ...state, frozen: true };
  }
}

/**
 * Whether a pause in typing on `title` should ask the model: not once Save or a tap has settled the chip, not for a
 * blank title, and not when history recalled the title (the person's own earlier choice stands).
 */
export function shouldAskModel(state: ChipState, title: string): boolean {
  if (state.frozen || state.source === 'user' || title.trim() === '') return false;
  return guessCategory(title).from !== 'history';
}

/** The pause after the last keystroke before the model is asked (design.md "Model refinement"). */
export const MODEL_PAUSE_MS = 500;

export interface ChipControllerDeps {
  /** The on-device model (`refineCategory` in the app); null when it has no answer or no model exists. */
  refine: (title: string) => Promise<Category | null>;
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule: (fn: () => void, ms: number) => () => void;
}

/**
 * Owns the chip for one sheet: applies keystrokes, runs the 500 ms pause, issues model requests with the exact title
 * they ask about, and feeds replies back through `chipReducer` in arrival order.
 */
export class ChipController {
  private state: ChipState;
  private title: string;
  private cancelPause: (() => void) | null = null;
  /** Bumped by a tap, Save and dispose: every request issued before it is cancelled, its reply dropped. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly deps: ChipControllerDeps;

  constructor(initialTitle: string, initial: ChipState, deps: ChipControllerDeps) {
    this.title = initialTitle;
    this.state = initial;
    this.deps = deps;
  }

  getState = (): ChipState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A keystroke. Keyword inference now; a model request once typing pauses. */
  setTitle(title: string): void {
    this.title = title;
    this.dispatch({ type: 'title', title });
    this.cancelPause?.();
    this.cancelPause = null;
    if (!shouldAskModel(this.state, title)) return;
    this.cancelPause = this.deps.schedule(() => {
      this.cancelPause = null;
      this.ask(title);
    }, MODEL_PAUSE_MS);
  }

  /** A pick from the category picker: sticky, and it cancels whatever the model was doing. */
  tap(category: Category): void {
    this.cancelAll();
    this.dispatch({ type: 'tap', category });
  }

  /** Save: the chip stops changing; returns the category the event carries. */
  freeze(): Category {
    this.cancelAll();
    this.dispatch({ type: 'freeze' });
    return this.state.category;
  }

  dispose(): void {
    this.cancelAll();
    this.listeners.clear();
  }

  private cancelAll(): void {
    this.generation += 1;
    this.cancelPause?.();
    this.cancelPause = null;
  }

  private ask(askedTitle: string): void {
    if (!shouldAskModel(this.state, askedTitle)) return;
    const generation = this.generation;
    let reply: Promise<Category | null>;
    try {
      reply = this.deps.refine(askedTitle);
    } catch {
      return;
    }
    reply.then(
      (category) => {
        if (generation !== this.generation) return; // cancelled by a tap, Save, or dismissal
        this.dispatch({ type: 'reply', askedTitle, currentTitle: this.title, category });
      },
      () => undefined, // no model, or it failed: the keyword guess stands
    );
  }

  private dispatch(event: ChipEvent): void {
    const next = chipReducer(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}
