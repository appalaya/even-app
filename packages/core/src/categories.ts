import type { Category } from './types.js';
export const CATEGORY_EMOJI: Readonly<Record<Category, string>> = {} as Record<Category, string>;
export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {} as Record<Category, string>;
export function isCategory(value: unknown): value is Category { throw new Error('not implemented'); }
/** Keyword inference: lowercase, word-boundary match, longest keyword wins, 'other' when nothing matches. Deterministic, offline. */
export function inferCategory(title: string): Category { throw new Error('not implemented'); }
