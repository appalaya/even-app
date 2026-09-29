/**
 * Diagnostics → "Check the model" (AppDiagnostics, DiagnosticsStates 2–4): the app's labelled test titles
 * (packages/core/src/categories.eval.json, every split) asked of this phone's on-device model one at a time, then
 * scored per category. Pure apart from the classifier it is handed, so Vitest runs it with a stub.
 *
 * The model is asked directly (`classifyExpense`), never through `refineCategory`: a check's answers reach neither
 * the outcomes since launch nor the logs of the chip, and nothing is saved. Each reply is read by the same checks
 * the chip uses (`readModelReply`); the model's `other` counts as the answer `other`, and a refusal, a timeout, an
 * error or a throw counts as wrong without stopping the run.
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
  total: number;
  /** The median time per title in milliseconds, as the app measured each call; null when nothing was asked. */
  medianMs: number | null;
  /** In the app's category order; a category with no titles is left out. */
  byCategory: CategoryScore[];
}

/** Lets the caller stop a run (an `AbortSignal` will do): no title is asked once it reads true. */
export interface CheckSignal {
  readonly aborted: boolean;
}

export interface ModelCheckOptions {
  signal?: CheckSignal;
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

/**
 * Asks `classify` about each case in turn (never two at once), and scores the answers. Resolves null when the run
 * was stopped (`signal`); a reply that arrives after that is ignored.
 */
export async function runModelCheck(
  cases: readonly EvalCase[],
  classify: (title: string) => Promise<unknown>,
  options: ModelCheckOptions = {},
): Promise<ModelCheckResult | null> {
  const { signal, onProgress, clock = Date.now, pause = macrotask } = options;
  // A function, so each read sees the signal as it is now (it changes across the awaits).
  const stopped = () => signal?.aborted === true;
  const scores = new Map<Category, CategoryScore>();
  const times: number[] = [];
  let right = 0;
  for (const [i, item] of cases.entries()) {
    if (stopped()) return null;
    const started = clock();
    let answer: Category | null = null;
    try {
      const reply = readModelReply(await classify(item.title));
      answer = reply.outcome === 'other' ? 'other' : reply.category;
    } catch {
      answer = null;
    }
    times.push(Math.max(0, clock() - started));
    if (stopped()) return null;
    const score = scores.get(item.category) ?? { category: item.category, right: 0, total: 0 };
    score.total += 1;
    if (answer === item.category) {
      score.right += 1;
      right += 1;
    }
    scores.set(item.category, score);
    onProgress?.(i + 1, cases.length);
    await pause();
  }
  if (stopped()) return null;
  return {
    right,
    total: cases.length,
    medianMs: median(times),
    byCategory: CATEGORIES.flatMap((c) => {
      const score = scores.get(c);
      return score === undefined ? [] : [{ ...score }];
    }),
  };
}
