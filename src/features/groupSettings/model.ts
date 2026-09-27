/**
 * Group settings, the parts that are plain data (unit-tested in model.test.ts): who may do what to a member
 * (design.md "Identity model" → "Who may edit a member"), the member rows in the order the board draws them, and
 * the Server section's labels ("2 MB · 10,000 entries", "365 days after last change", "246 KB of 2 MB · 12%").
 */
import type { GroupState, MemberState } from '@even/core';

import type { GroupUsage } from '../../services/sync/usage';
import type { ServerInfo } from '../../services/sync/types';

/** The pills under a member row, in the board's order. */
export type MemberAction = 'rename' | 'avatar' | 'archive' | 'unarchive';

/**
 * - your own seat: Rename, Avatar (never Archive: that is Leave);
 * - a name nobody has claimed yet: Rename, Avatar, Archive (someone has to fix a typo they typed);
 * - another joined member: Archive only (their name and avatar are theirs to change);
 * - an archived member other than you: Unarchive.
 */
export function memberActions(member: MemberState, myMemberId: string | null): MemberAction[] {
  if (member.id === myMemberId) return ['rename', 'avatar'];
  if (member.archived) return ['unarchive'];
  if (member.devices.length === 0) return ['rename', 'avatar', 'archive'];
  return ['archive'];
}

export interface MemberStatus {
  /** Draw the joined mark (a check before the label). */
  joined: boolean;
  /** "joined · this phone", "joined · 2 devices", "joined", "not joined yet". */
  label: string;
}

export function memberStatus(member: MemberState, myMemberId: string | null): MemberStatus {
  if (member.id === myMemberId) return { joined: true, label: 'joined · this phone' };
  // Group settings, extra states: "Archived member".
  if (member.archived) return { joined: false, label: 'archived · still in past expenses' };
  const devices = member.devices.length;
  if (devices === 0) return { joined: false, label: 'not joined yet' };
  if (devices === 1) return { joined: true, label: 'joined' };
  return { joined: true, label: `joined · ${devices} devices` };
}

export interface MemberRow {
  member: MemberState;
  isMe: boolean;
  status: MemberStatus;
  actions: MemberAction[];
}

/**
 * You first, then everyone else in the order they were added, then archived members. Placeholders for dangling
 * references (`unknown`) are not members anyone added, so they are not listed.
 */
export function memberRows(state: GroupState, myMemberId: string | null): MemberRow[] {
  const all = [...state.members.values()].filter((m) => !m.unknown);
  const me = all.filter((m) => m.id === myMemberId);
  const others = all.filter((m) => m.id !== myMemberId && !m.archived);
  const archived = all.filter((m) => m.id !== myMemberId && m.archived);
  return [...me, ...others, ...archived].map((member) => ({
    member,
    isMe: member.id === myMemberId,
    status: memberStatus(member, myMemberId),
    actions: memberActions(member, myMemberId),
  }));
}

/** The members "Remove someone?" offers when regenerating: everyone but you who is not archived yet. */
export function removableMembers(state: GroupState, myMemberId: string | null): MemberState[] {
  return [...state.members.values()].filter(
    (m) => !m.unknown && !m.archived && m.id !== myMemberId,
  );
}

// ---------- Server section ----------

const KIB = 1024;
const MIB = 1024 * 1024;

/** "2 MB", "1.5 MB", "246 KB", "0 KB": binary units, as the server's caps are (2,097,152 bytes is "2 MB"). */
export function formatBytes(bytes: number, locale?: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes >= MIB) return `${number.format(Math.round((bytes / MIB) * 10) / 10)} MB`;
  return `${new Intl.NumberFormat(locale).format(Math.round(bytes / KIB))} KB`;
}

/** "2 MB · 10,000 entries". */
export function limitsLabel(info: ServerInfo, locale?: string): string {
  const entries = new Intl.NumberFormat(locale).format(info.limits.max_group_events);
  return `${formatBytes(info.limits.max_group_bytes, locale)} · ${entries} entries`;
}

/** The Operator row: the server's `operator`, or "Self-hosted" when it names none (Group settings, extra states). */
export function operatorLabel(info: ServerInfo): string {
  const operator = info.operator?.trim() ?? '';
  return operator === '' ? 'Self-hosted' : operator;
}

/** "246 KB · 5% of the limit" (Move server: this group against the new server's caps). */
export function groupAgainstLabel(usage: GroupUsage, locale?: string): string {
  const percent = `${usagePercent(usage.fraction)}% of the limit`;
  if (usage.eventsFraction > usage.bytesFraction) {
    return `${new Intl.NumberFormat(locale).format(usage.events)} entries · ${percent}`;
  }
  return `${formatBytes(usage.bytes, locale)} · ${percent}`;
}

/**
 * The line under the usage meter from 80% (Group settings, extra states: "Usage at 80 % and up"; its footnote words
 * the full case). Null below 80%.
 */
export function usageWarning(usage: GroupUsage): string | null {
  if (usage.fraction >= 1) {
    return 'This group is full. Export it and start a new one.';
  }
  if (usage.warn) {
    return 'This group is almost full. Export it and start a new one.';
  }
  return null;
}

/** "365 days after last change" (the server may delete a group with no write for this long). */
export function retentionLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} after last change`;
}

/**
 * Whole percent, rounded as the boards do ("246 KB of 5 MB · 5%" for 4.8 %), but never 100% before the group is
 * full: below full it stops at 99.
 */
export function usagePercent(fraction: number): number {
  const percent = fraction * 100;
  if (fraction >= 1) return Math.floor(percent + 1e-9);
  return Math.max(0, Math.min(99, Math.round(percent)));
}

/**
 * "246 KB of 2 MB · 12%". The meter shows the larger of the two fractions (usage.ts); when the entry count is the
 * larger one, the label counts entries instead, so the words match the bar.
 */
export function usageLabel(usage: GroupUsage, locale?: string): string {
  const percent = `${usagePercent(usage.fraction)}%`;
  if (usage.eventsFraction > usage.bytesFraction) {
    const number = new Intl.NumberFormat(locale);
    return `${number.format(usage.events)} of ${number.format(usage.maxEvents)} entries · ${percent}`;
  }
  return `${formatBytes(usage.bytes, locale)} of ${formatBytes(usage.maxBytes, locale)} · ${percent}`;
}

/** The meter's fill, 0..1. */
export function meterFill(usage: GroupUsage): number {
  return Math.min(1, Math.max(0, usage.fraction));
}

/** "sync.even.appalaya.com" for "https://sync.even.appalaya.com". */
export function hostOf(serverUrl: string): string {
  return serverUrl.replace(/^https:\/\//, '');
}

/** The invite link as the card prints it: without the scheme ("even.appalaya.com/i#eyJ2…"). */
export function linkForDisplay(link: string): string {
  return link.replace(/^https:\/\//, '');
}
