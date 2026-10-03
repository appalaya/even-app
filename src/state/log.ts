/**
 * Small pure helpers over stored envelopes, shared by the derived state, the write path, rotation and recognition.
 * Decrypted bodies only ever live in memory.
 */
import { compareLog, isEnvelope, open, type Envelope, type LogEntry } from '@even/core';

import type { EventStatus, ReadableStatus } from '../services/storage/types';

/**
 * Control events are about one group's place in the world (design.md "Rotation, moving, closing"). They are never
 * carried from an old group into its rotated successor, neither by the rotator nor by a straggler's rescue.
 */
export const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'group.closed',
  'group.rotated',
  'group.moved',
]);

/**
 * The group's own last-writer-wins fields, its name and archive state. The rotator leaves these behind with the
 * control events and re-states the current values in the new group at its own clock (design.md "Rotate invite",
 * steps 3 and 4), so none crosses with a timestamp nobody in the new group can outrank (pre-launch review H2). A
 * straggler's rescue still carries its own: they are its writes, at its clock.
 */
export const GROUP_TOGGLE_TYPES: ReadonlySet<string> = new Set([
  'group.renamed',
  'group.archived',
  'group.unarchived',
]);

const READABLE: ReadonlySet<EventStatus> = new Set<EventStatus>([
  'ok',
  'invalid',
  'unsupported_body',
]);

/** Statuses whose envelope this client opened and can re-encrypt. */
export function isReadable(status: EventStatus): status is ReadableStatus {
  return READABLE.has(status);
}

/** The stored envelope text as a strict v1 envelope, or null. Never throws. */
export function parseEnvelopeText(text: string): Envelope | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isEnvelope(value) ? { id: value.id, v: value.v, n: value.n, c: value.c } : null;
}

/** The `type` field of an opened body, if it has one. */
export function typeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const type = (body as Record<string, unknown>).type;
  return typeof type === 'string' ? type : null;
}

/** Expense and payment events: the ones whose loss makes balances incomplete. */
export function isMoneyType(type: string | null): boolean {
  return type !== null && (type.startsWith('expense.') || type.startsWith('payment.'));
}

/** Opens an envelope and returns its body's `type`, or null when it cannot be opened or has none. */
export function openType(key: Uint8Array, groupId: string, envelope: Envelope): string | null {
  try {
    return typeOf(open({ key, groupId, envelope }));
  } catch {
    return null;
  }
}

/** The earliest entry in the reducer's order (core `compareLog`: min(ts, R), ts, id) matching `predicate`. */
export function firstEntry(
  entries: readonly LogEntry[],
  predicate: (entry: LogEntry) => boolean,
): LogEntry | null {
  let best: LogEntry | null = null;
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    if (best === null || compareLog(entry, best) < 0) best = entry;
  }
  return best;
}

/** The latest entry in the reducer's order (core `compareLog`) matching `predicate`. */
export function lastEntry(
  entries: readonly LogEntry[],
  predicate: (entry: LogEntry) => boolean,
): LogEntry | null {
  let best: LogEntry | null = null;
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    if (best === null || compareLog(entry, best) > 0) best = entry;
  }
  return best;
}
