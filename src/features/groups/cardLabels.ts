/**
 * What a group card on Groups says (Main board; Groups, extra states: Archived, expanded), as pure functions:
 * "4 people", "6 people · waiting to sync", the net ("you owe" / "you're owed" over the amount, or "settled"), and
 * an archived card's one line ("4 people · settled").
 */
import { formatMinor } from '@even/core';

/**
 * "4 people" (the board); one member reads "1 person". `count` is the row's member count (archived and placeholder
 * members are not counted); null while the group's log is not readable yet.
 */
export function peopleLabel(count: number | null, waiting: boolean): string | null {
  if (count === null) return waiting ? 'waiting to sync' : null;
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  return waiting ? `${people} · waiting to sync` : people;
}

/** An archived card's line: "4 people · settled" (as drawn), or the net when one is left. */
export function archivedLabel(
  count: number | null,
  myNet: number | null,
  currency: string | null,
  locale?: string,
): string | null {
  const people = peopleLabel(count, false);
  const net = netLabel(myNet, currency);
  if (net === null || currency === null) return people;
  const words =
    net.kind === 'settled'
      ? 'settled'
      : `${net.caption} ${formatMinor(net.amount, currency, locale)}`;
  return people === null ? words : `${people} · ${words}`;
}

export type NetLabel =
  | { kind: 'owe' | 'owed'; caption: string; amount: number }
  | { kind: 'settled'; caption: 'settled' }
  | null;

/** The trailing column: nothing while the net is unknown. `amount` is the magnitude in minor units. */
export function netLabel(myNet: number | null, currency: string | null): NetLabel {
  if (myNet === null || currency === null) return null;
  if (myNet === 0) return { kind: 'settled', caption: 'settled' };
  return myNet < 0
    ? { kind: 'owe', caption: 'you owe', amount: -myNet }
    : { kind: 'owed', caption: "you're owed", amount: myNet };
}

/**
 * The hollow "waiting to sync" dot: this phone holds changes no server has acknowledged, or the group has never
 * synced here. A failed sync with nothing to send keeps the filled dot; Group's status line carries that error.
 */
export function isWaiting(outbox: number | null, lastSyncedAt: number | null): boolean {
  return lastSyncedAt === null || (outbox ?? 0) > 0;
}
