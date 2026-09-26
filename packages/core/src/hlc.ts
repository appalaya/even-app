import { LIMITS } from './constants.js';
import type { Event, LogEntry } from './types.js';

/**
 * Hybrid logical timestamp for a new event (design.md "Ordering").
 * ts = max(nowMs, lastSeenTs + 1) where lastSeenTs is the largest ts in `log` that is ≤ nowMs + clockAbsorbWindowMs.
 * If `targetId` is given (the entity this event edits/deletes), ts is also ≥ maxTs(events targeting that entity) + 1,
 * regardless of how far ahead those are. "Targeting" includes the `*.added` event that created the entity.
 *
 * Stateless, one pass over `log`. Not clamped to the validator range: callers gate every write on `canWrite`, which
 * refuses when the clock is insane or when the result would be ≥ LIMITS.tsMax (an entity whose latest event sits at
 * tsMax − 1 can no longer be edited). A fractional `nowMs` is floored so the result is always an integer.
 */
export function nextTs(nowMs: number, log: readonly LogEntry[], targetId?: string): number {
  const now = Math.floor(nowMs);
  const absorbLimit = now + LIMITS.clockAbsorbWindowMs;
  let lastSeen = 0;
  let maxTarget: number | null = null;
  for (const { event } of log) {
    if (event.ts <= absorbLimit && event.ts > lastSeen) lastSeen = event.ts;
    if (targetId !== undefined && (maxTarget === null || event.ts > maxTarget)) {
      if (entityIdOf(event) === targetId || createdIdOf(event) === targetId) maxTarget = event.ts;
    }
  }
  const ts = Math.max(now, lastSeen + 1);
  return maxTarget === null ? ts : Math.max(ts, maxTarget + 1);
}

/** The entity id an event targets (expense/payment/member id), or null for group-level and *.added events. */
export function entityIdOf(event: Event): string | null {
  switch (event.type) {
    case 'expense.updated':
    case 'expense.deleted':
    case 'payment.deleted':
    case 'member.updated':
    case 'member.claimed':
    case 'member.archived':
    case 'member.unarchived':
    case 'member.done':
    case 'member.undone':
      return event.id;
    case 'group.created':
    case 'group.renamed':
    case 'group.closed':
    case 'group.rotated':
    case 'group.moved':
    case 'group.archived':
    case 'group.unarchived':
    case 'member.added':
    case 'expense.added':
    case 'payment.added':
      return null;
    default: {
      const unreachable: never = event;
      void unreachable;
      return null;
    }
  }
}

/** The id of the entity an `*.added` event creates, or null for every other event. */
function createdIdOf(event: Event): string | null {
  switch (event.type) {
    case 'member.added':
      return event.member.id;
    case 'expense.added':
      return event.expense.id;
    case 'payment.added':
      return event.payment.id;
    default:
      return null;
  }
}

/** True if the device clock is inside the validator's absolute range; the app refuses to write otherwise. */
export function isClockSane(nowMs: number): boolean {
  return Number.isInteger(nowMs) && nowMs >= LIMITS.tsMin && nowMs < LIMITS.tsMax;
}

/**
 * The write gate (design.md "Ordering"): true iff the device clock is sane AND the timestamp the new event would get,
 * `nextTs(nowMs, log, targetId)`, is inside the validator's range. The app refuses to write otherwise, so it never
 * produces an event that fails validation on every phone. Pass the same `targetId` the write will use.
 */
export function canWrite(nowMs: number, log: readonly LogEntry[], targetId?: string): boolean {
  return isClockSane(nowMs) && nextTs(nowMs, log, targetId) < LIMITS.tsMax;
}
