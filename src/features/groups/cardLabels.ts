/**
 * What a group card on Groups says (Main board), as pure functions: "4 people", "6 people · waiting to sync", and
 * the net ("you owe" / "you're owed" over the amount, or "settled").
 */
import type { MemberState } from '@even/core';

/** "4 people" (the board); one member reads "1 person". Archived and placeholder members are not counted. */
export function peopleLabel(
  members: Iterable<MemberState> | null,
  waiting: boolean,
): string | null {
  if (members === null) return waiting ? 'waiting to sync' : null;
  let count = 0;
  for (const member of members) if (!member.archived && !member.unknown) count += 1;
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  return waiting ? `${people} · waiting to sync` : people;
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
