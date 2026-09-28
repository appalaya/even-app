/**
 * Category helpers for the add-expense sheet (design.md "Categories", "Model refinement", "Chip state machine").
 *
 * The UI owns the category chip. This module gives it the two inference sources and the transition rules as pure
 * functions, so the contract is written once and tested:
 *
 * The chip holds `{ category, source }` with `source ∈ keyword | model | user`:
 * - A user tap sets `source = user`, cancels any in-flight model request, and drops any reply that arrives
 *   afterwards. Later title edits do not re-infer (`chipAfterTap`). `user` is sticky until the sheet is dismissed.
 * - While `source` is `keyword` or `model`, every keystroke runs keyword inference, applied immediately with
 *   `source = keyword` (`chipAfterTitle`).
 * - When the user pauses typing (500 ms), and while `source` is not `user`, the UI asks the model (`refineCategory`)
 *   and remembers the exact title it asked about (`shouldRefine`).
 * - A reply is applied only if that title still matches the field and `source` is not `user`; otherwise it is
 *   discarded (`chipAfterReply`). An applied reply sets `source = model`, so a model result can be refined by a
 *   later model result but never overwrite a tap. The swap animates (UI).
 * - A keyword-inferred chip carries no tag. When the model changes the chip, the swap animates and the chip wears
 *   the "suggested" tag for about 1.5 s, so a change the user did not make is never invisible; a chip the user
 *   chose never wears it (UI: `features/addExpense/chipMachine.ts`).
 * - Tapping Save freezes the chip: the event carries whatever it shows, never a later guess (UI).
 * Replies and taps are both handled on the JavaScript thread in arrival order, so a tap is never lost.
 *
 * Only the on-device model is ever used; a title never leaves the phone (design.md "Model refinement").
 */
import { inferCategory as inferFromKeywords, isCategory, type Category } from '@even/core';

import type { ClassifierAvailability } from '../../modules/even-classifier/src/EvenClassifier.types';

/** Keyword inference: deterministic, offline, identical on every phone; `other` when nothing matches. */
export function inferCategory(title: string): Category {
  return inferFromKeywords(title);
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

/** Add expense opened with a chip the model may refine: get the model ready before the first title. */
export function prepareCategoryModel(): void {
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
