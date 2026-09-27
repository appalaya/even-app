/**
 * Words the sheets show that come from data: member labels, the date pill, and save errors. Pure.
 */
import type { GroupState, MemberState } from '@even/core';

import { isStateError } from '@/state/errors';

/** "You" for your own seat (as every board draws it), else the member's name. */
export function memberLabel(member: MemberState | undefined, meId: string | null): string {
  if (member === undefined) return '';
  return member.id === meId ? 'You' : member.name;
}

/**
 * The members a picker or the split editor lists: you first, then everyone else not archived, in the order they
 * were added; then `keep` (members already on the expense), even when archived, so they stay visible.
 */
export function listedMembers(
  state: GroupState | null,
  meId: string | null,
  keep: readonly string[] = [],
): MemberState[] {
  if (state === null) return [];
  const all = [...state.members.values()].filter((m) => !m.unknown);
  const active = all.filter((m) => !m.archived);
  const me = active.filter((m) => m.id === meId);
  const others = active.filter((m) => m.id !== meId);
  const kept = keep
    .map((id) => state.members.get(id))
    .filter((m): m is MemberState => m !== undefined && m.archived && !m.unknown);
  return [...me, ...others, ...kept];
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function isoOf(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** The date pill: "Today" (as drawn), "Yesterday", else "Sep 20" (with the year when it is not this year). */
export function dateLabel(iso: string, today: string, locale?: string): string {
  if (iso === today) return 'Today';
  const t = parseIso(today);
  const yesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (iso === isoOf(yesterday)) return 'Yesterday';
  const date = parseIso(iso);
  const sameYear = date.getFullYear() === t.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/**
 * A save error in words, shown just above Save (Add expense, extra states: "Save failed" draws "Couldn't save. Try
 * again."; the specific causes below keep that sentence's form).
 */
export function saveErrorMessage(error: unknown): string {
  if (isStateError(error)) {
    switch (error.code) {
      case 'read_only':
        return 'This group is read-only.';
      case 'clock':
        return "Check your phone's date.";
      case 'not_claimed':
        return 'Pick your name in this group first.';
      case 'invalid_split':
        return "The split doesn't add up to the amount. Open Split to fix it.";
      case 'not_found':
        return 'Someone in this split is no longer in the group.';
      case 'no_secret':
        return "This phone can't write to this group.";
      default:
        break;
    }
  }
  return "Couldn't save. Try again.";
}
