/**
 * Diagnostics → "Check the model" (AppDiagnostics, DiagnosticsStates 2–4): the app's labelled test titles
 * (packages/core/src/categories.eval.json, every split) asked of this phone's on-device model one at a time, then
 * scored per category. Pure apart from the classifier and the app state it is handed, so Vitest runs it with stubs.
 *
 * The model is asked directly (`classifyExpense`), never through `refineCategory`: a check's answers reach neither
 * the outcomes since launch nor the logs of the chip, and nothing is saved. Each reply is read by the same checks
 * the chip uses (`readModelReply`); the model's `other` counts as the answer `other`, and a refusal, a timeout, an
 * error or a throw counts as wrong without stopping the run.
 *
 * A run is bounded: a title with no reply after `TITLE_TIMEOUT_MS` (above the native 6 s) counts as timed out and
 * the run moves on, and the app going to the background stops the run, which then reports the titles scored so
 * far as `stopped`, never as `done`.
 */
import { CATEGORIES, isCategory, type Category } from '@even/core';

import { readModelReply } from '@/state/categories';

/** A labelled title: what a person would expect on the chip. */
export interface EvalCase {
  title: string;
  category: Category;
}

/**
 * The cases of a labelled set (`{ cases: [{ title, category, split }] }`), every split, in file order. An entry
 * without a title or with a label that is not one of the sixteen category ids is left out.
 */
export function readEvalCases(set: unknown): EvalCase[] {
  const cases = (set as { cases?: unknown } | null | undefined)?.cases;
  if (!Array.isArray(cases)) return [];
  const read: EvalCase[] = [];
  for (const entry of cases as unknown[]) {
    const { title, category } = (entry ?? {}) as { title?: unknown; category?: unknown };
    if (typeof title === 'string' && title.trim() !== '' && isCategory(category)) {
      read.push({ title, category });
    }
  }
  return read;
}

/** One category's score: the titles labelled with it that the model named right. */
export interface CategoryScore {
  category: Category;
  right: number;
  total: number;
}

export interface ModelCheckResult {
  right: number;
  /** The titles scored: every one when the run is done, those asked before it stopped otherwise. */
  total: number;
  /** Of those, the ones with no reply in time: the model's own timeout, or the check's (`titleTimeoutMs`). */
  timedOut: number;
  /** The median time per title in milliseconds, as the app measured each call; null when nothing was asked. */
  medianMs: number | null;
  /** In the app's category order; a category with no titles is left out. */
  byCategory: CategoryScore[];
}

/** How a run ended: every title asked, or stopped early with the titles scored by then (`of` were to be asked). */
export type ModelCheckOutcome =
  | { status: 'done'; result: ModelCheckResult }
  | { status: 'stopped'; result: ModelCheckResult; of: number };

/** Lets the caller stop a run (an `AbortSignal` will do): no title is asked once it reads true. */
export interface CheckSignal {
  readonly aborted: boolean;
}

/** The part of React Native's `AppState` a run listens to. */
export interface AppStateEvents {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/** A title with no reply after this long counts as timed out; above the native side's own 6 s. */
export const TITLE_TIMEOUT_MS = 8_000;

export interface ModelCheckOptions {
  signal?: CheckSignal;
  /** Stops the run when the app goes to the background (`'background'`); the outcome is then `stopped`. */
  appState?: AppStateEvents;
  /** A title with no reply after this many milliseconds counts as timed out. `TITLE_TIMEOUT_MS` by default. */
  titleTimeoutMs?: number;
  /** After each title: how many are done, of how many. */
  onProgress?: (done: number, total: number) => void;
  /** Milliseconds, for the time each call takes (`Date.now` by default). */
  clock?: () => number;
  /** Between titles, so the screen draws the progress (a macrotask by default). */
  pause?: () => Promise<void>;
}

/** The middle value; the mean of the two middle ones for an even count; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** One title's fate: the model's reply, a rejection or throw, no reply in time, or the run stopping meanwhile. */
type Asked =
  { kind: 'reply'; value: unknown } | { kind: 'failed' } | { kind: 'late' } | { kind: 'stopped' };

/**
 * Asks `classify` about each case in turn (never two at once, unless a title outlives `titleTimeoutMs`: its reply
 * is then ignored and the next title is asked), and scores the answers. `done` when every title was scored;
 * `stopped` with the titles scored so far when `signal` or the app going to the background ended it first. The
 * background ends the wait for the reply in flight at once; that reply, and any after a stop, is ignored.
 */
export async function runModelCheck(
  cases: readonly EvalCase[],
  classify: (title: string) => Promise<unknown>,
  options: ModelCheckOptions = {},
): Promise<ModelCheckOutcome> {
  const {
    signal,
    appState,
    titleTimeoutMs = TITLE_TIMEOUT_MS,
    onProgress,
    clock = Date.now,
    pause = macrotask,
  } = options;
  let backgrounded = false;
  /** Settles the title in flight as `stopped`; set only while one is out. */
  let interrupt: (() => void) | null = null;
  const subscription = appState?.addEventListener('change', (state) => {
    if (state !== 'background') return;
    backgrounded = true;
    interrupt?.();
  });
  // A function, so each read sees the signal as it is now (it changes across the awaits).
  const stopped = () => backgrounded || signal?.aborted === true;

  /** The first of: the reply, a rejection or throw, the timeout, or the app going to the background. */
  const ask = (title: string): Promise<Asked> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<Asked>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'late' }), titleTimeoutMs);
      interrupt = () => resolve({ kind: 'stopped' });
      try {
        Promise.resolve(classify(title)).then(
          (value) => resolve({ kind: 'reply', value }),
          () => resolve({ kind: 'failed' }),
        );
      } catch {
        resolve({ kind: 'failed' });
      }
    }).finally(() => {
      clearTimeout(timer);
      interrupt = null;
    });
  };

  const scores = new Map<Category, CategoryScore>();
  const times: number[] = [];
  let right = 0;
  let timedOut = 0;
  let scored = 0;
  try {
    for (const item of cases) {
      if (stopped()) break;
      const started = clock();
      const asked = await ask(item.title);
      if (stopped() || asked.kind === 'stopped') break;
      times.push(Math.max(0, clock() - started));
      let answer: Category | null = null;
      if (asked.kind === 'late') {
        timedOut += 1;
      } else if (asked.kind === 'reply') {
        const reply = readModelReply(asked.value);
        if (reply.outcome === 'timeout') timedOut += 1;
        answer = reply.outcome === 'other' ? 'other' : reply.category;
      }
      const score = scores.get(item.category) ?? { category: item.category, right: 0, total: 0 };
      score.total += 1;
      if (answer === item.category) {
        score.right += 1;
        right += 1;
      }
      scores.set(item.category, score);
      scored += 1;
      onProgress?.(scored, cases.length);
      await pause();
    }
  } finally {
    subscription?.remove();
  }
  const result: ModelCheckResult = {
    right,
    total: scored,
    timedOut,
    medianMs: median(times),
    byCategory: CATEGORIES.flatMap((c) => {
      const score = scores.get(c);
      return score === undefined ? [] : [{ ...score }];
    }),
  };
  return scored === cases.length
    ? { status: 'done', result }
    : { status: 'stopped', result, of: cases.length };
}

/** What "Check the model" shows: the button, the progress, the score, or the score of a run the app stopped. */
export type ModelCheckState =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number }
  | { phase: 'done'; result: ModelCheckResult }
  | { phase: 'stopped'; result: ModelCheckResult; of: number };

/** A run started by `startModelCheck`. */
export interface ModelCheckRun {
  /** True until the run has ended, however it ended. */
  readonly running: boolean;
  /** The page went away: no further title is asked (the reply in flight is dropped) and no state is reported. */
  cancel(): void;
}

/** The run in progress anywhere in the app: starting another stops it, so two never ask the model at once. */
let current: { aborted: boolean } | null = null;

/**
 * Starts a run over `cases`, first stopping the one in progress anywhere in the app (which then reports `idle`),
 * and reports each state through `onState`: `running` with progress, then `done`, or `stopped` with the titles
 * scored so far when the app went to the background. `cancel` ends it without another report.
 */
export function startModelCheck(
  cases: readonly EvalCase[],
  classify: (title: string) => Promise<unknown>,
  options: Omit<ModelCheckOptions, 'signal' | 'onProgress'> & {
    onState: (state: ModelCheckState) => void;
  },
): ModelCheckRun {
  const { onState, ...rest } = options;
  if (current !== null) current.aborted = true;
  const signal = { aborted: false };
  current = signal;
  let cancelled = false;
  let running = true;
  const report = (state: ModelCheckState) => {
    if (!cancelled) onState(state);
  };
  report({ phase: 'running', done: 0, total: cases.length });
  void runModelCheck(cases, classify, {
    ...rest,
    signal,
    onProgress: (done, total) => report({ phase: 'running', done, total }),
  })
    .then(
      (outcome) => {
        if (signal.aborted) report({ phase: 'idle' });
        else if (outcome.status === 'done') report({ phase: 'done', result: outcome.result });
        else report({ phase: 'stopped', result: outcome.result, of: outcome.of });
      },
      () => report({ phase: 'idle' }),
    )
    .finally(() => {
      running = false;
      if (current === signal) current = null;
    });
  return {
    get running() {
      return running;
    },
    cancel() {
      cancelled = true;
      signal.aborted = true;
    },
  };
}
