/**
 * History first (design.md "Model refinement"): before the keyword table and the model, the category chip reuses the
 * category saved with the same or a similar title earlier, in the open group first and then in any group on this
 * phone. A tap on the chip is what gets saved, so a correction teaches the phone without any new storage: the
 * history is the expenses already in each group's decrypted state, held in memory by the app.
 *
 * Titles match on their words as keyword inference normalises them (case, accents, punctuation, apostrophes), with a
 * trailing "s" dropped from words of four letters or more ("Tim Horton's" = "tim hortons" = "Tim Hortons"; "Chucks"
 * = "Chuck's" = "Chuck").
 *
 * - **Same**: the titles are equal after that. The latest save wins among equal titles in a group.
 * - **Similar**: one title is the other plus trailing words ("Safeway" and "Safeway run", "Shell" and "Shell
 *   Canmore"), and the trailing words change nothing the keyword table can see: they match no keyword, and both
 *   titles get the same keyword guess. So "Costco" does not recall "Costco gas", "Uber" does not recall "Uber Eats",
 *   and "Lake Louise" does not recall "Lake Louise parking". The shorter title needs a word of three letters or more
 *   that is not a filler word ("the", "at", …). A longer saved title wins over a shorter one; when several saved
 *   titles extend the one typed and disagree, history has no answer.
 *
 * Every same match (open group first, then the others) beats every similar match. Pure and deterministic: the same
 * expenses give the same answer on every phone.
 */
import { inferCategory, titleWords } from './categories.js';
import type { Category } from './types.js';

/** One saved expense, as history sees it. */
export interface PastExpense {
  readonly title: string;
  readonly category: Category;
  /** When it was saved or last changed (unix ms): the latest wins among equal titles. */
  readonly at: number;
}

interface Remembered {
  /** Normalised words, for the keyword checks. */
  readonly words: readonly string[];
  /** The same words with a trailing "s" dropped from longer ones, for matching. */
  readonly folded: readonly string[];
  readonly key: string;
  /** `inferCategory` of the title. */
  readonly keyword: Category;
  readonly category: Category;
  readonly at: number;
}

/** One group's history, indexed once per group state (`rememberCategories`) and asked on every keystroke. */
export interface CategoryMemory {
  readonly byKey: ReadonlyMap<string, Remembered>;
}

export interface Recalled {
  category: Category;
  /** `same`: equal titles; `similar`: one is the other plus trailing words. */
  match: 'same' | 'similar';
}

const FILLER: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'at', 'to', 'a', 'an', 'of', 'in', 'on', 'my', 'our', 'from', 'with', 'by',
]);

function fold(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

function prepare(title: string): Omit<Remembered, 'category' | 'at'> | null {
  const words = titleWords(title);
  if (words.length === 0) return null;
  const folded = words.map(fold);
  return { words, folded, key: folded.join(' '), keyword: inferCategory(title) };
}

/** Indexes one group's expenses. Titles with no letters or digits (an emoji alone) are left out. */
export function rememberCategories(expenses: Iterable<PastExpense>): CategoryMemory {
  const byKey = new Map<string, Remembered>();
  for (const expense of expenses) {
    const prepared = prepare(expense.title);
    if (prepared === null) continue;
    const known = byKey.get(prepared.key);
    if (known !== undefined && known.at > expense.at) continue;
    byKey.set(prepared.key, { ...prepared, category: expense.category, at: expense.at });
  }
  return { byKey };
}

type Words = Pick<Remembered, 'words' | 'folded' | 'keyword'>;

/** `longer` is `shorter` plus trailing words that change nothing the keyword table can see. */
function isExtension(shorter: Words, longer: Words): boolean {
  const n = shorter.folded.length;
  if (longer.folded.length <= n) return false;
  for (let i = 0; i < n; i += 1) if (longer.folded[i] !== shorter.folded[i]) return false;
  if (!shorter.folded.some((w) => w.length >= 3 && !FILLER.has(w))) return false;
  if (shorter.keyword !== longer.keyword) return false;
  return inferCategory(longer.words.slice(n).join(' ')) === 'other';
}

function similar(title: Words, memory: CategoryMemory): Category | null {
  // A saved title that the typed one extends: the longest such saved title.
  for (let k = title.folded.length - 1; k >= 1; k -= 1) {
    const saved = memory.byKey.get(title.folded.slice(0, k).join(' '));
    if (saved !== undefined && isExtension(saved, title)) return saved.category;
  }
  // Saved titles that extend the typed one: an answer only if they agree.
  let found: Category | null = null;
  for (const saved of memory.byKey.values()) {
    if (!isExtension(title, saved)) continue;
    if (found !== null && found !== saved.category) return null;
    found = saved.category;
  }
  return found;
}

/**
 * The category saved with the same or a similar `title`, looking through `memories` in order (the open group
 * first), or null.
 */
export function recallCategory(title: string, memories: readonly CategoryMemory[]): Recalled | null {
  const typed = prepare(title);
  if (typed === null) return null;
  for (const memory of memories) {
    const same = memory.byKey.get(typed.key);
    if (same !== undefined) return { category: same.category, match: 'same' };
  }
  for (const memory of memories) {
    const category = similar(typed, memory);
    if (category !== null) return { category, match: 'similar' };
  }
  return null;
}
