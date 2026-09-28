/**
 * Category helpers for the add-expense sheet (design.md "Categories", "Model refinement", "Chip state machine").
 *
 * The UI owns the category chip. This module gives it the inference sources (history, the keyword table, the
 * on-device model) and the transition rules as pure functions, so the contract is written once and tested:
 *
 * The chip holds `{ category, source }` with `source ∈ keyword | model | user`:
 * - A user tap sets `source = user`, cancels any in-flight model request, and drops any reply that arrives
 *   afterwards. Later title edits do not re-infer (`chipAfterTap`). `user` is sticky until the sheet is dismissed.
 * - While `source` is `keyword` or `model`, every keystroke runs instant inference (history first, then the keyword
 *   table: `inferCategory`), applied immediately with `source = keyword` (`chipAfterTitle`).
 * - When the user pauses typing (500 ms), and while `source` is not `user`, the UI asks the model (`refineCategory`)
 *   and remembers the exact title it asked about (`shouldRefine`).
 * - A reply is applied only if that title still matches the field and `source` is not `user`; otherwise it is
 *   discarded (`chipAfterReply`). An applied reply sets `source = model`, so a model result can be refined by a
 *   later model result but never overwrite a tap. The swap animates (UI).
 * - While `source` is `model` the chip carries the sparkle, with no timer (`carriesSparkle`), so a choice the user
 *   did not make is never invisible. A keyword-inferred chip and a chip the user chose never carry it: a tap takes
 *   it away (the UI fades it out) and a keystroke's keyword guess drops it. When the model changes the chip, the
 *   swap animates (UI: `features/addExpense/chipMachine.ts`).
 * - Tapping Save freezes the chip: the event carries whatever it shows, never a later guess, and the chip keeps
 *   what it shows, the sparkle included (UI).
 * Replies and taps are both handled on the JavaScript thread in arrival order, so a tap is never lost.
 *
 * Only the on-device model is ever used; a title never leaves the phone (design.md "Model refinement").
 */
import {
  inferCategory as inferFromKeywords,
  isCategory,
  recallCategory,
  rememberCategories,
  type Category,
  type CategoryMemory,
  type GroupState,
} from '@even/core';

import type { ClassifierAvailability } from '../../modules/even-classifier/src/EvenClassifier.types';

// ---------- History first ----------

/**
 * Where the chip's history comes from: the reduced states of the groups this process holds in memory, the open
 * group's first (`GroupStateStore.peekStates`, installed by `openAppServices.ts`). History is the expenses already in
 * each group's decrypted log, so it needs no storage of its own: nothing is read from disk and nothing is written.
 * The index over each state lives in memory, keyed by the state object, and goes when the state is replaced.
 */
export type CategoryHistorySource = (openGroup: string | null) => readonly GroupState[];

let historySource: CategoryHistorySource | null = null;
let openGroup: string | null = null;
const memories = new WeakMap<GroupState, CategoryMemory>();

function memoryOf(state: GroupState): CategoryMemory {
  let memory = memories.get(state);
  if (memory === undefined) {
    const past = [...state.expenses.values()].map((e) => ({
      title: e.title,
      category: e.category,
      at: e.updatedAt,
    }));
    memory = rememberCategories(past);
    memories.set(state, memory);
  }
  return memory;
}

/** Installs the history source (the app, once services are open) or a stub (tests); null removes it. */
export function setCategoryHistory(source: CategoryHistorySource | null): void {
  historySource = source;
}

/** The category saved with the same or a similar title earlier (`recallCategory`), or null. Never throws. */
function recall(title: string): Category | null {
  if (historySource === null) return null;
  try {
    return recallCategory(title, historySource(openGroup).map(memoryOf))?.category ?? null;
  } catch {
    return null;
  }
}

/** Where the chip's instant guess came from: `history`, the keyword `table`, or `none` (the table found nothing). */
export type GuessSource = 'history' | 'table' | 'none';

/**
 * The chip's instant guess for `title`, on every keystroke: the category saved with the same or a similar title
 * earlier (this group first, then any group on this phone), else the keyword table's, else `other`.
 */
export function guessCategory(title: string): { category: Category; from: GuessSource } {
  const recalled = recall(title);
  if (recalled !== null) return { category: recalled, from: 'history' };
  const category = inferFromKeywords(title);
  return { category, from: category === 'other' ? 'none' : 'table' };
}

/**
 * Instant inference: history first, then the keyword table (deterministic, offline, identical on every phone);
 * `other` when neither knows the title. With no history installed it is the table alone.
 */
export function inferCategory(title: string): Category {
  return guessCategory(title).category;
}

/**
 * The phone's on-device model, as `refineCategory` uses it: the `even-classifier` native module in the app
 * (installed by `openAppServices.ts`), a stub in tests. iOS answers with Foundation Models' on-device system model
 * (never Private Cloud Compute, never a cloud provider); Android reports unavailable for now.
 */
export interface OnDeviceModel {
  availability(): Promise<ClassifierAvailability>;
  /** A category id, or null; resolves within the native timeout (2.5 s on iOS). */
  classifyExpense(title: string): Promise<string | null>;
  /** Loads the model ahead of the first title. */
  prewarm?(): Promise<void>;
}

export interface CategoryRefiner {
  /** Add expense opened: check availability now and, if the model is there, load it before the first title. */
  prepare(): void;
  /** The model's category for `title`, or null. */
  refine(title: string): Promise<Category | null>;
}

/**
 * The model's two uses, bound to `model` (null: no model). Availability is asked once and kept for the session:
 * unavailable, or an availability call that fails, means null for every title without asking the model. An answer
 * that is not one of the sixteen category ids, a rejection, or a throw is null too, so the keyword guess stands. A
 * model that becomes ready later (Apple Intelligence just turned on) is used from the next launch.
 */
export function createCategoryRefiner(model: OnDeviceModel | null): CategoryRefiner {
  let usable: Promise<boolean> | null = null;
  const isUsable = (): Promise<boolean> => {
    if (model === null) return Promise.resolve(false);
    usable ??= Promise.resolve()
      .then(() => model.availability())
      .then(
        (availability) => availability.status === 'available',
        () => false,
      );
    return usable;
  };
  return {
    prepare() {
      void isUsable()
        .then((yes) => (yes ? model?.prewarm?.() : undefined))
        .catch(() => undefined);
    },
    async refine(title) {
      if (model === null || title.trim() === '' || !(await isUsable())) return null;
      try {
        const answer: unknown = await model.classifyExpense(title);
        return isCategory(answer) ? answer : null;
      } catch {
        return null;
      }
    },
  };
}

let refiner = createCategoryRefiner(null);

/** Installs the on-device model (the app, once per process) or a stub (tests); null removes it. */
export function setOnDeviceModel(model: OnDeviceModel | null): void {
  refiner = createCategoryRefiner(model);
}

/**
 * Add expense opened with a chip that may still be inferred: get the model ready before the first title, and look up
 * history in `groupId` (the open group) before the others.
 */
export function prepareCategoryModel(groupId: string | null = null): void {
  openGroup = groupId;
  refiner.prepare();
}

/**
 * The on-device model's answer for `title`, or null when there is no model, it is unavailable, or it has no valid
 * answer. The chip controller calls this after the 500 ms pause (`features/addExpense/chipMachine.ts`).
 */
export function refineCategory(title: string): Promise<Category | null> {
  return refiner.refine(title);
}

export type ChipSource = 'keyword' | 'model' | 'user';

export interface CategoryChip {
  category: Category;
  source: ChipSource;
}

/** The chip for a fresh sheet (or an edited expense, which starts from its saved category as `user`). */
export function initialChip(title: string, saved?: Category): CategoryChip {
  return saved === undefined
    ? { category: inferCategory(title), source: 'keyword' }
    : { category: saved, source: 'user' };
}

/**
 * The sparkle: the chip carries it exactly while it shows the model's pick and the user has not tapped it. It is
 * derived from `source`, never timed; a keystroke (back to `keyword`) or a tap (`user`) takes it away.
 */
export function carriesSparkle(chip: CategoryChip): boolean {
  return chip.source === 'model';
}

/** A keystroke: unless the user chose, keyword inference runs and its guess replaces a keyword or model chip. */
export function chipAfterTitle(chip: CategoryChip, title: string): CategoryChip {
  if (chip.source === 'user') return chip;
  const category = inferCategory(title);
  return category === chip.category && chip.source === 'keyword'
    ? chip
    : { category, source: 'keyword' };
}

/** A tap on the chip: the user's choice wins from now on. */
export function chipAfterTap(chip: CategoryChip, category: Category): CategoryChip {
  return chip.source === 'user' && chip.category === category ? chip : { category, source: 'user' };
}

/** Whether a pause in typing should ask the model about `title`: yes unless the user chose. */
export function shouldRefine(chip: CategoryChip, title: string): boolean {
  return chip.source !== 'user' && title.trim() !== '';
}

/**
 * A model reply for `askedTitle`: applied only if the field still shows that exact title and the source is not
 * `user` (so a later model reply refines an earlier one); otherwise the chip is returned unchanged (the reply is
 * dropped).
 */
export function chipAfterReply(
  chip: CategoryChip,
  currentTitle: string,
  reply: { askedTitle: string; category: Category | null },
): CategoryChip {
  if (reply.category === null) return chip;
  if (chip.source === 'user' || reply.askedTitle !== currentTitle) return chip;
  return chip.source === 'model' && chip.category === reply.category
    ? chip
    : { category: reply.category, source: 'model' };
}
