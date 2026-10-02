import { LIMITS } from './constants.js';
import type { Event, LogEntry } from './types.js';

/**
 * Hybrid logical timestamp for a new event (design.md "Ordering").
 * ts = max(nowMs, lastSeenTs + 1) where lastSeenTs is the largest ts in `log` that is ≤ nowMs + clockAbsorbWindowMs.
 * If `targetId` is given (the entity this event edits/deletes), ts is also ≥ maxTs(events targeting that entity) + 1,
 * however far ahead those are, counting only events that take effect: a last-writer-wins write the reducer holds back
 * (`isHeldBack`) is left out, so an edit never has to climb over an event that cannot win anyway (pre-launch review
 * H2). "Targeting" includes the `*.added` event that created the entity.
 *
 * Stateless, two passes over `log`. Not clamped to the validator range: callers gate every write on `canWrite`, which
 * refuses when the clock is insane or when the result would be ≥ LIMITS.tsMax (an entity whose latest event that takes
 * effect sits at tsMax − 1 can no longer be edited). A fractional `nowMs` is floored so the result is an integer.
 */
export function nextTs(nowMs: number, log: readonly LogEntry[], targetId?: string): number {
  const now = Math.floor(nowMs);
  const absorbLimit = now + LIMITS.clockAbsorbWindowMs;
  const horizon = targetId === undefined ? Number.POSITIVE_INFINITY : holdBackHorizon(log);
  let lastSeen = 0;
  let maxTarget: number | null = null;
  for (const { event } of log) {
    if (event.ts <= absorbLimit && event.ts > lastSeen) lastSeen = event.ts;
    if (targetId !== undefined && (maxTarget === null || event.ts > maxTarget) && !isHeldBack(event, horizon)) {
      if (entityIdOf(event) === targetId || createdIdOf(event) === targetId) maxTarget = event.ts;
    }
  }
  const ts = Math.max(now, lastSeen + 1);
  return maxTarget === null ? ts : Math.max(ts, maxTarget + 1);
}

/**
 * The hold-back horizon of a log (design.md "Reducer", pre-launch review H2): the latest `ts` at which an event can
 * still win a last-writer-wins field. An event more than `LIMITS.holdBackMs` ahead of every event written by another
 * device does not win until the log catches up, that is until some other device's event reaches within
 * `LIMITS.holdBackMs` of it.
 *
 * Only one device can be that far ahead of all the others (two such devices would each be ahead of the other), so
 * the rule is one number: the latest `ts` written by any device other than the one holding the log's latest `ts`,
 * plus the window. Every event past it is that one device's. `+Infinity`, nothing held, when one device wrote the
 * whole log or two devices share its latest `ts`.
 *
 * Depends only on the (`dev`, `ts`) pairs in `log`, not on their order or on any clock: pure, deterministic and
 * permutation-invariant like the reducer that uses it. One pass.
 */
export function holdBackHorizon(log: readonly LogEntry[]): number {
  let top = Number.NEGATIVE_INFINITY; // the latest ts in the log
  let topDev: string | null = null; // a device that wrote it
  let others = Number.NEGATIVE_INFINITY; // the latest ts by any device but topDev
  for (const { event } of log) {
    const { ts, dev } = event;
    if (dev === topDev) {
      if (ts > top) top = ts;
    } else if (ts > top) {
      others = top; // everything so far is ≤ the old top, which another device wrote
      top = ts;
      topDev = dev;
    } else if (ts > others) {
      others = ts;
    }
  }
  return others === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : others + LIMITS.holdBackMs;
}

/**
 * True for the events that write a last-writer-wins field, the only ones the hold-back rule applies to: the group's
 * name, archive state and move (`group.renamed`, `group.archived`, `group.unarchived`, `group.moved`), a member's
 * name and avatar, archive state and done mark (`member.updated`, `member.archived`, `member.unarchived`,
 * `member.done`, `member.undone`), and an expense's fields (`expense.updated`). Creations, claims, tombstones and the
 * other control events are not fields: they take effect whatever their `ts`.
 */
export function writesLastWriterField(event: Event): boolean {
  switch (event.type) {
    case 'group.renamed':
    case 'group.archived':
    case 'group.unarchived':
    case 'group.moved':
    case 'member.updated':
    case 'member.archived':
    case 'member.unarchived':
    case 'member.done':
    case 'member.undone':
    case 'expense.updated':
      return true;
    case 'group.created':
    case 'group.closed':
    case 'group.rotated':
    case 'member.added':
    case 'member.claimed':
    case 'expense.added':
    case 'expense.deleted':
    case 'payment.added':
    case 'payment.deleted':
      return false;
    default: {
      const unreachable: never = event;
      void unreachable;
      return false;
    }
  }
}

/** True if the reducer holds `event` back in a log whose `holdBackHorizon` is `horizon`: it changes nothing yet. */
export function isHeldBack(event: Event, horizon: number): boolean {
  return event.ts > horizon && writesLastWriterField(event);
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
