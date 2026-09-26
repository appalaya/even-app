import type { Event } from './types.js';
/**
 * Validates a decrypted body (design.md "Validation"). Returns null for anything that fails, including unknown sv/type.
 * Unknown fields on known event types are STRIPPED, except inside expense.updated.changes, which is strict.
 * Referential checks (does the member exist) are NOT done here; the reducer handles dangling references.
 */
export function parseEvent(json: unknown): Event | null { throw new Error('not implemented'); }
/** YYYY-MM-DD and a real calendar date. */
export function isIsoDate(text: string): boolean { throw new Error('not implemented'); }
/** Exactly one emoji grapheme cluster. */
export function isSingleEmoji(text: string): boolean { throw new Error('not implemented'); }
