/**
 * What the Group screen shows, derived from the state layer's `DerivedGroup` (reducer output plus balances). Pure (no
 * React Native), so Vitest runs it. Each rule below is read off the boards; where a board is silent the choice is
 * named in a comment.
 */
import {
  type ActivityItem,
  type Category,
  type ExpenseState,
  type GroupState,
  type MemberState,
  type Transfer,
} from '@even/core';

import { deviceSeat, deviceSeats } from '@/state/seat';

import { dayKey, deviceShort } from './format';

// ---------- Done adding ----------

export interface DonePerson {
  member: MemberState;
  done: boolean;
  isMe: boolean;
}

export interface DoneSummary {
  /**
   * Everyone counted, in the boards' order: still adding first with you leading (Group: S then …; Group · twelve
   * members: S, P, L, B, D), then done with you last (Group, everyone done: M, J, N, S); others in member order.
   */
  people: DonePerson[];
  doneCount: number;
  /** M in "N of M done adding": non-archived members who have joined on a device (design.md "Group"). */
  total: number;
  allDone: boolean;
  meDone: boolean;
}

export function doneSummary(state: GroupState, myId: string | null): DoneSummary {
  const done = new Set(state.doneMembers);
  const eligible = [...state.members.values()].filter(
    (m) => !m.archived && !m.unknown && m.devices.length > 0,
  );
  const me = eligible.find((m) => m.id === myId);
  const others = eligible.filter((m) => m.id !== myId);
  const person = (member: MemberState): DonePerson => ({
    member,
    done: done.has(member.id),
    isMe: member.id === myId,
  });
  const stillAdding = [
    ...(me !== undefined && !done.has(me.id) ? [me] : []),
    ...others.filter((m) => !done.has(m.id)),
  ];
  const finished = [
    ...others.filter((m) => done.has(m.id)),
    ...(me !== undefined && done.has(me.id) ? [me] : []),
  ];
  return {
    people: [...stillAdding, ...finished].map(person),
    doneCount: finished.length,
    total: eligible.length,
    allDone: state.allDone,
    meDone: me !== undefined && done.has(me.id),
  };
}

/**
 * The done-adding row shows once a second member has joined on a device: alone in the group there is nobody to wait
 * for (Group, new with expenses has no row). Pre-added names that nobody has claimed never count.
 */
export function showsDoneRow(summary: DoneSummary): boolean {
  return summary.total >= 2;
}

// ---------- Invite state ----------

/**
 * Group, just created: the invite card shows until another member has joined on a device (design.md "Invites": "the
 * card collapses into the settings gear once another member has joined").
 */
export function showsInviteCard(state: GroupState, myId: string | null): boolean {
  for (const m of state.members.values()) {
    if (m.id !== myId && !m.unknown && m.devices.length > 0) return false;
  }
  return true;
}

/**
 * Where the invite card goes while nobody else has joined (`showsInviteCard`): with no expenses yet it replaces the
 * balance area (Group, just created: 'alone'); once you have added one it is pinned above the normal header, settle
 * list and done-adding row ('pinned': Group, new with expenses). 'none' after another member has joined.
 */
export type InviteLayout = 'none' | 'alone' | 'pinned';

export function inviteLayout(state: GroupState, myId: string | null): InviteLayout {
  if (!showsInviteCard(state, myId)) return 'none';
  return state.expenses.size > 0 ? 'pinned' : 'alone';
}

/** Non-archived people for "4 people · nobody else has joined yet", in member order. */
export function peopleOf(state: GroupState): MemberState[] {
  return [...state.members.values()].filter((m) => !m.archived && !m.unknown);
}

// ---------- Your seat ----------

/**
 * "Which name is yours?" over Group (the Join boards' sheet, re-offered on every focus until a seat is claimed):
 * this phone holds a writable group without a seat, the members are known (not "Joined, waiting for first sync"),
 * and no member already carries this device (that seat is this phone's and comes back without asking,
 * `GroupService.restoreSeat`).
 */
export function offersNamePick(
  state: GroupState,
  seat: { needsClaim: boolean; writable: boolean; deviceId: string },
): boolean {
  return (
    seat.needsClaim &&
    seat.writable &&
    peopleOf(state).length > 0 &&
    deviceSeat(state, seat.deviceId) === null
  );
}

/*
 * While the pick is offered, Group is drawn with no name picked (GroupNoSeat): "Spent so far" and the note in place of
 * the big number, no settle list or done-adding row, "Pick your name" in place of Add expense, and no share arrow.
 */

/**
 * "Spent so far" (GroupNoSeat: $1,780.00 CAD, the Banff trip's five expenses): the trip total Balances' "Spend by
 * category" adds up, so an expense the reducer flags (a split that does not add up, another currency) stands aside
 * here too. Payments are not spending.
 */
export function spentSoFar(state: GroupState): number {
  let total = 0;
  for (const amount of state.totalsByCategory.values()) total += amount;
  return total;
}

/**
 * The mark beside a name in "Which name is yours?" offered again on Group: 'thisPhone' when this device claimed it
 * ("this phone", SeatSameDevice), 'joined' when only other phones did, null when nobody has (the row has a chevron).
 * After Join the boards draw every claimed name "joined".
 */
export type SeatMark = 'thisPhone' | 'joined' | null;

export function seatMark(member: MemberState, deviceId: string): SeatMark {
  if (member.devices.includes(deviceId)) return 'thisPhone';
  return member.devices.length > 0 ? 'joined' : null;
}

/**
 * What a tap on a name in "Which name is yours?", offered again on Group (SeatPick), does:
 * - 'claim': a name nobody has claimed, or one only this phone claimed. This phone's own name skips "Is that you on
 *   another phone?" (SeatPick); claiming it again writes nothing (`claimMember` is idempotent per device).
 * - 'otherPhone': a name another phone claimed asks "Is that you on another phone, or a different Maya?" (Join).
 * - 'sameDevice': this phone claimed this name and others too, so it asks "This phone was Maya before", naming the
 *   others (SeatSameDevice).
 */
export type NamePick =
  { kind: 'claim' } | { kind: 'otherPhone' } | { kind: 'sameDevice'; others: MemberState[] };

export function namePick(state: GroupState, member: MemberState, deviceId: string): NamePick {
  const mark = seatMark(member, deviceId);
  if (mark === 'joined') return { kind: 'otherPhone' };
  if (mark === null) return { kind: 'claim' };
  const others = deviceSeats(state, deviceId)
    .filter((id) => id !== member.id)
    .map((id) => state.members.get(id))
    .filter((m): m is MemberState => m !== undefined);
  return others.length === 0 ? { kind: 'claim' } : { kind: 'sameDevice', others };
}

/** "Maya K.", "Maya K. and Sam", "Maya K., Sam and Jo". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * SeatSameDevice's words for a tap on Maya while this phone also claimed Maya K.: "This phone was Maya before",
 * "Continue as Maya? This phone was also Maya K. If that one is left over, archive it in Group settings.", "Continue as
 * Maya". With more than one other name (not drawn) the sentence names them all and says "those" and "them".
 */
export function sameDeviceWords(
  name: string,
  others: readonly string[],
): { question: string; body: string; confirm: string } {
  const one = others.length <= 1;
  const list = listNames(others);
  // "Maya K." ends its own sentence.
  const stop = list.endsWith('.') ? '' : '.';
  return {
    question: `This phone was ${name} before`,
    body:
      `Continue as ${name}? This phone was also ${list}${stop} ` +
      (one
        ? 'If that one is left over, archive it in Group settings.'
        : 'If those are left over, archive them in Group settings.'),
    confirm: `Continue as ${name}`,
  };
}

// ---------- Share ----------

/**
 * The share arrow in Group's nav bar, which opens "Share link" · "Show QR code" (GroupShareMenu): hidden while the
 * invite card shows (it carries its own buttons), in a read-only group, and while this phone has no seat
 * (GroupNoSeat draws the gear alone).
 */
export function showsShareButton(
  card: InviteLayout,
  seat: { readOnly: boolean; needsClaim: boolean },
): boolean {
  return card === 'none' && !seat.readOnly && !seat.needsClaim;
}

// ---------- Settled ----------

/** At least one live expense or payment: only then can a zero balance mean "settled" (design.md "Groups"). */
export function hasActivity(state: GroupState): boolean {
  return state.expenses.size > 0 || state.payments.size > 0;
}

/**
 * "✓ Everyone's settled" and the archive offer (Group, even; inside the archived header): nobody owes anybody, the
 * balances could be computed, and something has been added. A group with nothing in it is not settled: it reads
 * "You're even" and "No expenses yet" only (the same rule as the Groups card).
 */
export function everyoneSettled(
  state: GroupState,
  transfers: readonly Transfer[],
  balancesUnavailable: boolean,
): boolean {
  return transfers.length === 0 && !balancesUnavailable && hasActivity(state);
}

// ---------- Settle list ----------

/**
 * The settle list on Group: the simplified transfers that involve you, in `simplify`'s order (largest first). The
 * boards draw only yours ("You pay Maya", "You pay Jordan") while the same log also has Nathan → Maya (Group,
 * archived: "Nathan paid Maya $128.00").
 */
export function myTransfers(transfers: readonly Transfer[], myId: string | null): Transfer[] {
  if (myId === null) return [];
  return transfers.filter((t) => t.from === myId || t.to === myId);
}

// ---------- Balances ----------

export interface BalanceRow {
  member: MemberState;
  net: number;
  isMe: boolean;
}

/**
 * Balances → "Everyone": you first, then everyone else by the size of their balance (the board: You, Maya $172,
 * Nathan $128, Jordan $8), ties by name; so a settled member sorts last ("Nathan is settled", Group screen copy).
 * Archived members stay while they still owe or are owed.
 */
export function balanceRows(
  state: GroupState,
  nets: ReadonlyMap<string, number>,
  myId: string | null,
): BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (const m of state.members.values()) {
    const net = nets.get(m.id) ?? 0;
    if (m.unknown && net === 0) continue;
    if (m.archived && net === 0) continue;
    rows.push({ member: m, net, isMe: m.id === myId });
  }
  return rows.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    const size = Math.abs(b.net) - Math.abs(a.net);
    if (size !== 0) return size;
    return a.member.name.localeCompare(b.member.name);
  });
}

export interface CategoryRow {
  category: Category;
  amount: number;
}

/** "Spend by category": largest first (Lodging, Activities, Food, Fuel, Parking on the board) and the trip total. */
export function categoryRows(state: GroupState): { rows: CategoryRow[]; total: number } {
  const rows = [...state.totalsByCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  return { rows, total: rows.reduce((sum, r) => sum + r.amount, 0) };
}

// ---------- Expenses ----------

/** Newest day first; within a day, the latest added first (Dinner above the lift tickets, both Sep 20). */
export function sortedExpenses(state: GroupState): ExpenseState[] {
  return [...state.expenses.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.addedAt !== b.addedAt) return b.addedAt - a.addedAt;
    return a.id < b.id ? -1 : 1;
  });
}

// ---------- Activity ----------

export interface ActivityRow {
  key: string;
  /** Whose avatar leads the row: the sentence's subject ("Jordan paid Maya" → Jordan), else the actor. */
  member: MemberState | null;
  /** The subject as bolded ("Maya", or "You"), or null when the sentence names nobody we know. */
  subject: string | null;
  /** The rest of the sentence after the subject. */
  rest: string;
  at: number;
  /** The short device code, when this came from a device other than the member's first (design.md "Identity"). */
  device: string | null;
}

export interface ActivitySection {
  key: number;
  at: number;
  rows: ActivityRow[];
}

function subjectOf(
  item: ActivityItem,
  state: GroupState,
): { name: string | null; member: MemberState | null } {
  const byMember = state.members.get(item.by) ?? null;
  const names = new Set<string>(['Someone', 'Unknown']);
  for (const m of state.members.values()) names.add(m.name);
  const sorted = [...names].sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    if (!item.summary.startsWith(name)) continue;
    const next = item.summary.charAt(name.length);
    if (next !== '' && next !== ' ' && next !== "'") continue;
    if (byMember !== null && byMember.name === name) return { name, member: byMember };
    const match = [...state.members.values()].find((m) => m.name === name) ?? null;
    return { name, member: match ?? byMember };
  }
  return { name: null, member: byMember };
}

/**
 * The Activity tab: newest first, grouped by calendar day of `at` (Today, Yesterday, Sep 20). The sentence's subject
 * is bolded and reads "You" when it is you ("You paid Maya $369.00"; "You are done adding expenses").
 */
export function activitySections(state: GroupState, myId: string | null): ActivitySection[] {
  const firstDevice = new Map<string, string>();
  for (const item of state.activity) {
    if (!firstDevice.has(item.by)) firstDevice.set(item.by, item.dev);
  }
  const sections: ActivitySection[] = [];
  const items = [...state.activity].reverse();
  for (const item of items) {
    const { name, member } = subjectOf(item, state);
    const isMe = member !== null && member.id === myId && name === member.name;
    let rest = name === null ? item.summary : item.summary.slice(name.length);
    if (isMe && rest.startsWith(' is ')) rest = ` are ${rest.slice(4)}`;
    const row: ActivityRow = {
      key: item.eventId,
      member,
      subject: name === null ? null : isMe ? 'You' : name,
      rest,
      at: item.at,
      device: firstDevice.get(item.by) === item.dev ? null : deviceShort(item.dev),
    };
    const key = dayKey(item.at);
    const last = sections[sections.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(row);
    else sections.push({ key, at: item.at, rows: [row] });
  }
  return sections;
}

/** Who wrote the latest `group.moved` ("Maya moved this group to sync.example.net. Follow?"). */
export function movedBy(state: GroupState, myId: string | null): string {
  for (let i = state.activity.length - 1; i >= 0; i -= 1) {
    const item = state.activity[i];
    if (item === undefined || item.type !== 'group.moved') continue;
    if (item.by === myId) return 'You';
    return state.members.get(item.by)?.name ?? 'Someone';
  }
  return 'Someone';
}

/** The host of a canonical server URL ("sync.example.net"). */
export function hostOf(serverUrl: string): string {
  return serverUrl.replace(/^https:\/\//, '');
}
