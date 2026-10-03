import { LIMITS } from './constants.js';
import type { Event, LogEntry } from './types.js';

/**
 * The arrival-time rule (design.md "Ordering", pre-launch review H2). A server stamps every envelope it stores with R,
 * its own arrival time (PROTOCOL.md §4; `LogEntry.receivedAt`). A claimed `ts` is believed only as far as R:
 *
 * - **Order.** Every event sorts by `(min(ts, R), ts, id)` (`compareLog`), its effective time first (`effectiveTs`). An
 *   event with no R (not yet pushed, pulled, or imported with one) uses its claimed `ts`.
 * - **Hold.** An event whose claimed `ts` is more than W (`LIMITS.clockAbsorbWindowMs`, a day) past the latest R in the
 *   log (`holdBackHorizon`) changes nothing yet (`isHeldBack`): the reducer skips it like a no-op until a later R
 *   raises the horizon, and it then takes effect at its effective time, its arrival. An event with no R is never held.
 *
 * Everything here reads only the log (and, for the write gate, the clock and this phone's last push), so it is
 * deterministic and permutation-invariant like the fold that uses it.
 */

/** W: how far a claimed `ts` may run ahead of the server's latest arrival time before it waits for one (a day). */
const W = LIMITS.clockAbsorbWindowMs;

/** The entry's R when it is a usable one (`isReceivedAt`), else undefined: an unusable R counts as absent. */
export function receivedAtOf(entry: LogEntry): number | undefined {
  const r = entry.receivedAt;
  return isReceivedAt(r) ? r : undefined;
}

/** The entry's effective time: `min(ts, R)`, or the claimed `ts` while it has no R. Never later than its arrival. */
export function effectiveTs(entry: LogEntry): number {
  const r = receivedAtOf(entry);
  return r === undefined ? entry.event.ts : Math.min(entry.event.ts, r);
}

/**
 * The log's one total order, the fold's and `newer`'s: `(min(ts, R), ts, id)`, ids by UTF-16 code units. Entries that
 * share all three (the same envelope id twice, with different R) go R first, the smaller first, then no R, so which
 * copy a duplicate keeps does not depend on input order.
 */
export function compareLog(a: LogEntry, b: LogEntry): number {
  const ea = effectiveTs(a);
  const eb = effectiveTs(b);
  if (ea !== eb) return ea < eb ? -1 : 1;
  if (a.event.ts !== b.event.ts) return a.event.ts < b.event.ts ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  const ra = receivedAtOf(a);
  const rb = receivedAtOf(b);
  if (ra === rb) return 0;
  if (ra === undefined) return 1;
  if (rb === undefined) return -1;
  return ra < rb ? -1 : 1;
}

/**
 * The hold horizon of a log: the latest R in it plus W. An event with an R whose claimed `ts` is past it is held
 * (`isHeldBack`). `+Infinity`, nothing held, when no entry has an R. One pass; depends only on the R values.
 */
export function holdBackHorizon(log: readonly LogEntry[]): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const entry of log) {
    const r = receivedAtOf(entry);
    if (r !== undefined && r > latest) latest = r;
  }
  return latest === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : latest + W;
}

/**
 * True if the reducer holds `entry` in a log whose `holdBackHorizon` is `horizon`: it has an R and claims a `ts` past
 * the horizon, so it changes nothing yet, whatever its type. An entry with no R is never held.
 */
export function isHeldBack(entry: LogEntry, horizon: number): boolean {
  return receivedAtOf(entry) !== undefined && entry.event.ts > horizon;
}

/**
 * Hybrid logical timestamp for a new event (design.md "Ordering"), over effective times:
 * ts = max(nowMs, lastSeen + 1), where lastSeen is the largest effective time in `log` of an event that has an R
 * (bounded by the server's clock already, so a phone running slow still writes after what it has seen), or of one
 * without an R not more than W past nowMs (an unstamped claim far ahead must not drag the group clock).
 * If `targetId` is given (the entity this event edits or deletes, its `*.added` included), ts is also ≥ the largest
 * effective time among the events about it that take effect (held ones do not) + 1, however far ahead. An event with
 * an R is effective at its arrival at the latest, so only one with no R (this phone's own unsynced write, or a log a
 * server has not stamped) can push the result to the top of the range.
 *
 * Stateless, one pass over `log` plus the horizon's. Not clamped to the validator range: the write path asks
 * `writeTs`, which refuses or falls back when the result would be ≥ LIMITS.tsMax. A fractional `nowMs` is floored.
 */
export function nextTs(nowMs: number, log: readonly LogEntry[], targetId?: string): number {
  const now = Math.floor(nowMs);
  const absorbLimit = now + W;
  const horizon = targetId === undefined ? Number.POSITIVE_INFINITY : holdBackHorizon(log);
  let lastSeen = 0;
  let maxTarget: number | null = null;
  for (const entry of log) {
    const effective = effectiveTs(entry);
    const absorbed = receivedAtOf(entry) !== undefined || effective <= absorbLimit;
    if (absorbed && effective > lastSeen) lastSeen = effective;
    if (targetId !== undefined && (maxTarget === null || effective > maxTarget) && !isHeldBack(entry, horizon)) {
      const { event } = entry;
      if (entityIdOf(event) === targetId || createdIdOf(event) === targetId) maxTarget = effective;
    }
  }
  const ts = Math.max(now, lastSeen + 1);
  return maxTarget === null ? ts : Math.max(ts, maxTarget + 1);
}

/**
 * This phone's last push as the server saw it: the claimed `ts` of its own latest event that has an R, and that R
 * (the app reads it from its store across every group). `ts` is what this phone's clock said when it wrote the event.
 */
export interface OwnReceipt {
  ts: number;
  receivedAt: number;
}

/**
 * True when this phone's clock is more than W ahead of the server's (design.md "Ordering"): its last push arrived
 * more than W before the time the phone stamped on it, and the clock still reads what it read then, give or take W.
 * A clock set back since (`nowMs` below that stamp) or a push more than W old by this clock says nothing about the
 * clock now, and the next push measures again. A local check; nothing here asks the server.
 */
export function aheadOfServer(nowMs: number, own: OwnReceipt | null | undefined): boolean {
  if (own === null || own === undefined || !isReceivedAt(own.receivedAt) || !Number.isFinite(own.ts)) return false;
  const now = Math.floor(nowMs);
  return own.ts - own.receivedAt > W && now >= own.ts && now - own.ts <= W;
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

/**
 * True for a usable server arrival time (`received_at`, R; design.md "Ordering"): an integer in the validator's absolute
 * range, `tsMin ≤ R < tsMax`. Anything else a server or a group file reports is treated as absent.
 */
export function isReceivedAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= LIMITS.tsMin && value < LIMITS.tsMax;
}

/** True if the device clock is inside the validator's absolute range; the app refuses to write otherwise. */
export function isClockSane(nowMs: number): boolean {
  return Number.isInteger(nowMs) && nowMs >= LIMITS.tsMin && nowMs < LIMITS.tsMax;
}

/**
 * The strict write gate (design.md "Ordering"): false only when the device clock is outside the validator's range,
 * when this phone is more than W ahead of the server (`aheadOfServer`, from `own`, this phone's last push), or when
 * the event would need `ts ≥ tsMax` (`nextTs` with the same `targetId`: an event about the target with no R sits at
 * `tsMax − 1`). The app's write path asks `writeTs`, which lets a write that holds in either order through then.
 */
export function canWrite(
  nowMs: number,
  log: readonly LogEntry[],
  targetId?: string,
  own?: OwnReceipt | null,
): boolean {
  return isClockSane(nowMs) && !aheadOfServer(nowMs, own) && nextTs(nowMs, log, targetId) < LIMITS.tsMax;
}

/**
 * True for a write about an entity that takes effect only if it sorts after the event that created the entity: an
 * `expense.updated` before its `expense.added` is ignored, and a `member.updated` before its `member.added` is
 * overwritten by it. Every other targeted write holds in either order: a delete's tombstone keeps a later add out, and
 * a member's archive mark, done mark or claim survives the `member.added` that fills its placeholder.
 */
export function mustFollowTarget(event: Event): boolean {
  return event.type === 'expense.updated' || event.type === 'member.updated';
}

/**
 * The write gate and the timestamp together, for the app's write path (design.md "Ordering"): the `ts` for `event`
 * (whose own `ts` is ignored), or null when the app must refuse it ("check your phone's date"). Null when the device
 * clock is outside the validator's range or this phone is more than W ahead of the server (`own`, its last push).
 * Otherwise `nextTs(nowMs, log, target)`; when that would reach `tsMax`, because an event about the target with no R
 * sits at `tsMax − 1`, a write that holds in either order (`mustFollowTarget` false) takes the group clock's `ts`
 * instead, so it is never refused merely because another device wrote a far-future event (rotation's removal, a
 * delete). An edit that must follow its target is refused then: below the top of the range it would change nothing.
 */
export function writeTs(
  nowMs: number,
  log: readonly LogEntry[],
  event: Event,
  own?: OwnReceipt | null,
): number | null {
  if (!isClockSane(nowMs) || aheadOfServer(nowMs, own)) return null;
  const target = entityIdOf(event) ?? undefined;
  const ts = nextTs(nowMs, log, target);
  if (ts < LIMITS.tsMax) return ts;
  if (target === undefined || mustFollowTarget(event)) return null;
  const groupClock = nextTs(nowMs, log);
  return groupClock < LIMITS.tsMax ? groupClock : null;
}
