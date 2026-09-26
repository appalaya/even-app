import type { Event, LogEntry } from './types.js';
/**
 * Hybrid logical timestamp for a new event (design.md "Ordering").
 * ts = max(nowMs, lastSeenTs + 1) where lastSeenTs is the largest ts in `log` that is ≤ nowMs + clockAbsorbWindowMs.
 * If `targetId` is given (the entity this event edits/deletes), ts is also ≥ maxTs(events targeting that entity) + 1,
 * regardless of how far ahead those are.
 */
export function nextTs(nowMs: number, log: readonly LogEntry[], targetId?: string): number { throw new Error('not implemented'); }
/** The entity id an event targets (expense/payment/member id), or null for group-level and *.added events. */
export function entityIdOf(event: Event): string | null { throw new Error('not implemented'); }
/** True if the device clock is inside the validator's absolute range; the app refuses to write otherwise. */
export function isClockSane(nowMs: number): boolean { throw new Error('not implemented'); }
