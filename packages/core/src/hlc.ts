import { LIMITS } from './constants.js';
import type { Event, LogEntry } from './types.js';

/**
 * Hybrid logical timestamp for a new event (design.md "Ordering").
 * ts = max(nowMs, lastSeenTs + 1) where lastSeenTs is the largest ts in `log` that is ≤ nowMs + clockAbsorbWindowMs.
 * If `targetId` is given (the entity this event edits/deletes), ts is also ≥ maxTs(events targeting that entity) + 1,
 * regardless of how far ahead those are. "Targeting" includes the `*.added` event that created the entity.
 *
 * Stateless, one pass over `log`. Not clamped to the validator range: callers check `isClockSane(nowMs)` first, and should
 * also refuse to write if the returned value is ≥ LIMITS.tsMax (only possible when a target sits at the very top of
 * the range). A fractional `nowMs` is floored so the result is always an integer.
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
      return event.id;
    case 'group.created':
    case 'group.renamed':
    case 'group.closed':
    case 'group.rotated':
    case 'group.moved':
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
