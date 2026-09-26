/**
 * Category helpers for the add-expense sheet (design.md "Categories", "Model refinement", "Chip state machine").
 *
 * The UI owns the category chip. This module gives it the two inference sources and the transition rules as pure
 * functions, so the contract is written once and tested:
 *
 * The chip holds `{ category, source }` with `source ∈ keyword | model | user`:
 * - A user tap sets `source = user`, cancels any in-flight model request, and drops any reply that arrives
 *   afterwards. Later title edits do not re-infer (`chipAfterTap`).
 * - Keyword inference runs on a keystroke only while `source = keyword` (`chipAfterTitle`).
 * - When the user pauses typing (500 ms), and only while `source = keyword`, the UI asks the model
 *   (`refineCategory`) and remembers the exact title it asked about (`shouldRefine`).
 * - A reply is applied only if that title still matches the field and `source` is still `keyword`; otherwise it is
 *   discarded (`chipAfterReply`). An applied reply sets `source = model`; the swap animates and shows "suggested"
 *   for a moment, so a change the user did not make is never invisible (UI).
 * - Tapping Save freezes the chip: the event carries whatever it shows, never a later guess (UI).
 * Replies and taps are both handled on the JavaScript thread in arrival order, so a tap is never lost.
 *
 * Only the on-device model is ever used; a title never leaves the phone (design.md "Model refinement").
 */
import { inferCategory as inferFromKeywords, type Category } from '@even/core';

/** Keyword inference: deterministic, offline, identical on every phone; `other` when nothing matches. */
export function inferCategory(title: string): Category {
  return inferFromKeywords(title);
}

/**
 * The on-device model's answer for `title`, or null when no model is available or it has no answer.
 *
 * A stub until the native module lands: iOS `SystemLanguageModel` (Foundation Models) behind a one-function Expo
 * module `classifyExpense(title) → Category | null`, gated on availability; Android Gemini Nano via ML Kit GenAI.
 * Never Private Cloud Compute, never a cloud provider.
 */
export async function refineCategory(title: string): Promise<Category | null> {
  void title;
  return null;
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

/** A keystroke: keyword inference runs only while the chip's source is `keyword`. */
export function chipAfterTitle(chip: CategoryChip, title: string): CategoryChip {
  if (chip.source !== 'keyword') return chip;
  const category = inferCategory(title);
  return category === chip.category ? chip : { category, source: 'keyword' };
}

/** A tap on the chip: the user's choice wins from now on. */
export function chipAfterTap(chip: CategoryChip, category: Category): CategoryChip {
  return chip.source === 'user' && chip.category === category ? chip : { category, source: 'user' };
}

/** Whether a pause in typing should ask the model about `title`. */
export function shouldRefine(chip: CategoryChip, title: string): boolean {
  return chip.source === 'keyword' && title.trim() !== '';
}

/**
 * A model reply for `askedTitle`: applied only if the field still shows that exact title and the source is still
 * `keyword`; otherwise the chip is returned unchanged (the reply is dropped).
 */
export function chipAfterReply(
  chip: CategoryChip,
  currentTitle: string,
  reply: { askedTitle: string; category: Category | null },
): CategoryChip {
  if (reply.category === null) return chip;
  if (chip.source !== 'keyword' || reply.askedTitle !== currentTitle) return chip;
  return { category: reply.category, source: 'model' };
}
