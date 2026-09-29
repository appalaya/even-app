/**
 * The dev seed's Group scenarios against the boards' numbers, through the same reducer, balances and view models the
 * screens use.
 */
import { formatMinor, nets, reduce, simplify, type Event, type GroupState } from '@even/core';
import { describe, expect, it } from 'vitest';

import {
  historyRows,
  flagOf,
  splitCaption,
  activeMemberIds,
  splitTotalLine,
} from '../features/expense/model';
import {
  activitySections,
  balanceRows,
  categoryRows,
  doneSummary,
  everyoneSettled,
  inviteLayout,
  myTransfers,
  namePick,
  offersNamePick,
  seatMark,
  showsDoneRow,
  sortedExpenses,
  spentSoFar,
} from '../features/group/model';
import { deviceSeat } from '../state/seat';
import {
  buildCopyScenario,
  buildScenario,
  flaggedPreview,
  GROUP_SCENARIOS,
  SEED_STATES,
  seedSecret,
  type GroupScenario,
} from './seed';

const NOW = new Date(2026, 8, 26, 15, 0).getTime();
const DEVICE = 'thisDeviceAAAAAAAAAAAA';
/** The dev server as the iOS simulator reaches it, in the canonical form a group stores. */
const DEV = 'https://127.0.0.1:8787';
const money = (minor: number) => formatMinor(minor, 'CAD', 'en-US');

function load(state: GroupScenario | Parameters<typeof buildCopyScenario>[0]) {
  const spec = (GROUP_SCENARIOS as readonly string[]).includes(state)
    ? buildScenario(state as GroupScenario, DEVICE, NOW, DEV)
    : buildCopyScenario(state as Parameters<typeof buildCopyScenario>[0], DEVICE, NOW, DEV);
  const group = reduce(spec.entries, { format: money });
  const balances = nets(group);
  return { spec, group, balances, transfers: simplify(balances), me: spec.me.id };
}

function nameOf(group: GroupState, id: string): string {
  return group.members.get(id)?.name ?? '?';
}

describe('seed scenarios', () => {
  it('builds every Group state from valid events', () => {
    for (const state of GROUP_SCENARIOS) {
      const { spec, group } = load(state);
      expect(spec.entries.length).toBeGreaterThan(0);
      expect(group.flagged).toEqual([]);
    }
    // Every Group scenario is a seed state the route can open.
    for (const state of GROUP_SCENARIOS) expect(SEED_STATES).toContain(state);
  });

  it("Group screen copy: owed on Maya's phone, a settled member, two Mayas, a USD entry", () => {
    const owed = load('owed');
    expect(owed.balances.get(owed.me)).toBe(17200);
    expect(
      myTransfers(owed.transfers, owed.me).map((t) => [nameOf(owed.group, t.from), t.amount]),
    ).toEqual([
      ['Nathan', 12800],
      ['Sam', 4400],
    ]);
    const settled = load('settled-member');
    expect(
      balanceRows(settled.group, settled.balances, settled.me).map((r) => [r.member.name, r.net]),
    ).toEqual([
      ['Sam', -5200],
      ['Maya', 4400],
      ['Jordan', 800],
      ['Nathan', 0],
    ]);
    const collision = load('collision');
    expect(collision.group.nameCollisions).toHaveLength(1);
    expect(doneSummary(collision.group, collision.me).total).toBe(4);
    const usd = load('expense-currency');
    expect(usd.group.flagged.map((f) => f.reason)).toEqual(['currency_mismatch']);
    expect(usd.balances.get(usd.me)).toBe(-5200);
  });

  it('Group: you owe $52.00, pay Maya $44.00 and Jordan $8.00; 3 of 4 done', () => {
    const { group, balances, transfers, me } = load('group');
    expect(balances.get(me)).toBe(-5200);
    expect(myTransfers(transfers, me).map((t) => [nameOf(group, t.to), t.amount])).toEqual([
      ['Maya', 4400],
      ['Jordan', 800],
    ]);
    const done = doneSummary(group, me);
    expect([done.doneCount, done.total, done.allDone]).toEqual([3, 4, false]);
    expect(done.people.map((p) => [p.member.name, p.done])).toEqual([
      ['Sam', false],
      ['Maya', true],
      ['Jordan', true],
      ['Nathan', true],
    ]);
    expect(sortedExpenses(group).map((e) => [e.title, e.amount, e.date])).toEqual([
      ['Dinner at Park Distillery', 9600, '2026-09-20'],
      ['Sunshine Village lift tickets', 42000, '2026-09-20'],
      ['Banff Town Parking', 2400, '2026-09-19'],
      ['Gas at Petro-Canada', 6000, '2026-09-18'],
      ['Fairmont Banff Springs', 118000, '2026-09-18'],
    ]);
  });

  it('Balances: the board order and figures, and spend by category', () => {
    const { group, balances, me } = load('balances');
    expect(balanceRows(group, balances, me).map((r) => [r.member.name, r.net])).toEqual([
      ['Sam', -5200],
      ['Maya', 17200],
      ['Nathan', -12800],
      ['Jordan', 800],
    ]);
    const { rows, total } = categoryRows(group);
    expect(total).toBe(178000);
    expect(rows.map((r) => [r.category, r.amount])).toEqual([
      ['lodging', 118000],
      ['activities', 42000],
      ['food', 9600],
      ['fuel', 6000],
      ['parking', 2400],
    ]);
  });

  it('Activity: Today and Yesterday as drawn, with the device codes', () => {
    const { group, me } = load('activity');
    const [today, yesterday] = activitySections(group, me);
    expect(today?.rows.map((r) => [r.subject, r.rest, r.device])).toEqual([
      ['Maya', ' is done adding expenses', null],
      ['Jordan', ' joined on a new device', '7QX2'],
      ['Maya', " changed Nathan's Sunshine Village lift tickets from $400.00 to $420.00", 'K2PD'],
    ]);
    expect(yesterday?.rows.map((r) => [r.subject, r.rest])).toEqual([
      ['You', ' paid Maya $369.00'],
      ['Jordan', ' paid Maya $393.00'],
    ]);
  });

  it('Group, everyone done: done members in member order, you last', () => {
    const { group, me } = load('alldone');
    const done = doneSummary(group, me);
    expect(done.allDone).toBe(true);
    expect(done.people.map((p) => p.member.name)).toEqual(['Maya', 'Jordan', 'Nathan', 'Sam']);
  });

  it('Group, even and archived: nobody owes anything', () => {
    for (const state of ['even', 'group-archived'] as const) {
      const { transfers, balances, me } = load(state);
      expect(transfers).toEqual([]);
      expect(balances.get(me)).toBe(0);
    }
    const { group, me } = load('group-archived');
    expect(group.archived).toBe(true);
    const [today, yesterday] = activitySections(group, me);
    expect(today?.rows.map((r) => `${r.subject ?? ''}${r.rest}`)).toEqual([
      'Nathan archived the group',
      'Nathan paid Maya $128.00',
      'You paid Jordan $8.00',
      'You paid Maya $44.00',
    ]);
    expect(yesterday?.rows.map((r) => `${r.subject ?? ''}${r.rest}`)).toEqual([
      'Maya is done adding expenses',
    ]);
  });

  it('Whistler 2027: 7 of 12 done; you owe $86.40 to Priya and Maya', () => {
    const { group, balances, transfers, me } = load('many');
    expect(balances.get(me)).toBe(-8640);
    expect(myTransfers(transfers, me).map((t) => [nameOf(group, t.to), t.amount])).toEqual([
      ['Priya', 6240],
      ['Maya', 2400],
    ]);
    const done = doneSummary(group, me);
    expect([done.doneCount, done.total]).toEqual([7, 12]);
    expect(done.people.map((p) => p.member.name)).toEqual([
      'Sam',
      'Priya',
      'Leo',
      'Ben',
      'Diego',
      'Maya',
      'Jordan',
      'Nathan',
      'Aiko',
      'Chloe',
      'Hana',
      'Omar',
    ]);
  });

  it("Group, new with expenses: the invite card pinned over you're owed $903.00, $301.00 each; no done row", () => {
    const { spec, group, balances, transfers, me } = load('newWithExpenses');
    expect(inviteLayout(group, me)).toBe('pinned');
    expect(balances.get(me)).toBe(90300);
    expect(myTransfers(transfers, me).map((t) => [nameOf(group, t.from), t.amount])).toEqual([
      ['Maya', 30100],
      ['Jordan', 30100],
      ['Nathan', 30100],
    ]);
    // Only you have joined: no done-adding row, and the pre-added names never count.
    const done = doneSummary(group, me);
    expect([done.doneCount, done.total, showsDoneRow(done)]).toEqual([0, 1, false]);
    expect(
      sortedExpenses(group).map((e) => [e.title, e.amount, e.date, e.paidBy === me, e.category]),
    ).toEqual([
      ['Banff Town Parking', 2400, '2026-09-19', true, 'parking'],
      ['Fairmont Banff Springs', 118000, '2026-09-18', true, 'lodging'],
    ]);

    // The card goes once another member has joined on a device; with no expenses it replaces the header.
    const maya = [...group.members.values()].find((m) => m.name === 'Maya');
    expect(maya).toBeDefined();
    if (maya === undefined) return;
    const at = Math.max(...spec.entries.map((e) => e.event.ts)) + 1;
    const claimed = {
      id: 'claimedByMaya',
      event: {
        sv: 1,
        ts: at,
        at,
        by: maya.id,
        dev: 'mayasPhoneAAAAAAAAAAAA',
        type: 'member.claimed',
        id: maya.id,
      } as Event,
    };
    const joined = reduce([...spec.entries, claimed], { format: money });
    expect(inviteLayout(joined, me)).toBe('none');
    const joinedDone = doneSummary(joined, me);
    expect([joinedDone.doneCount, joinedDone.total, showsDoneRow(joinedDone)]).toEqual([
      0,
      2,
      true,
    ]);
    const fresh = load('group-new');
    expect(inviteLayout(fresh.group, fresh.me)).toBe('alone');
    const main = load('group');
    expect(inviteLayout(main.group, main.me)).toBe('none');
  });

  it('Group, held without a seat: another phone asks for a name, this phone gets its own back', () => {
    const pick = { needsClaim: true, writable: true, deviceId: DEVICE };
    // Sam created it on another phone: no member carries this one, so Group offers "Which name is yours?" and reads
    // GroupNoSeat behind it: "Spent so far $1,780.00", the five expenses as listed.
    const other = load('unclaimed');
    expect(other.spec.claimed).toBe(false);
    expect(deviceSeat(other.group, DEVICE)).toBeNull();
    expect(offersNamePick(other.group, pick)).toBe(true);
    expect(money(spentSoFar(other.group))).toBe('$1,780.00');
    expect(sortedExpenses(other.group).map((e) => [e.title, money(e.amount)])).toEqual([
      ['Dinner at Park Distillery', '$96.00'],
      ['Sunshine Village lift tickets', '$420.00'],
      ['Banff Town Parking', '$24.00'],
      ['Gas at Petro-Canada', '$60.00'],
      ['Fairmont Banff Springs', '$1,180.00'],
    ]);
    // SeatPick: Sam, Maya and Jordan joined on other phones; Nathan has not.
    expect([...other.group.members.values()].map((m) => [m.name, seatMark(m, DEVICE)])).toEqual([
      ['Sam', 'joined'],
      ['Maya', 'joined'],
      ['Jordan', 'joined'],
      ['Nathan', null],
    ]);

    // This phone created it as Sam and the row lost the seat: the log names Sam, so it is restored, not asked.
    const own = load('unclaimed-own');
    expect(own.spec.claimed).toBe(false);
    expect(deviceSeat(own.group, DEVICE)).toBe(own.me);
    expect(offersNamePick(own.group, pick)).toBe(false);
    expect(inviteLayout(own.group, own.me)).toBe('alone');
    // Nothing added yet: "You're even", but not "Everyone's settled".
    expect(everyoneSettled(own.group, own.transfers, false)).toBe(false);
  });

  it('Group, two seats on this phone: both marked, and a tap on Maya names Maya K.', () => {
    const two = load('unclaimed-two');
    expect(two.spec.claimed).toBe(false);
    expect(deviceSeat(two.group, DEVICE)).toBeNull();
    expect(offersNamePick(two.group, { needsClaim: true, writable: true, deviceId: DEVICE })).toBe(
      true,
    );
    const members = [...two.group.members.values()];
    expect(members.map((m) => [m.name, seatMark(m, DEVICE)])).toEqual([
      ['Sam', 'joined'],
      ['Maya', 'thisPhone'],
      ['Maya K.', 'thisPhone'],
      ['Jordan', 'joined'],
      ['Nathan', null],
    ]);
    const maya = members.find((m) => m.name === 'Maya');
    expect(maya).toBeDefined();
    if (maya === undefined) return;
    const tap = namePick(two.group, maya, DEVICE);
    expect(tap.kind === 'sameDevice' ? tap.others.map((m) => m.name) : tap.kind).toEqual([
      'Maya K.',
    ]);
  });

  it('Expense detail: the dinner history as drawn', () => {
    const { spec, group, me } = load('expense-detail');
    const dinner = group.expenses.get(spec.open.expenseId ?? '');
    expect(dinner).toBeDefined();
    if (dinner === undefined) return;
    const rows = historyRows(dinner, {
      nameOf: (id) => (id === me ? 'You' : nameOf(group, id)),
      money,
      date: (iso) => iso,
    });
    expect(rows.map((r) => [r.text, r.current, r.restorable])).toEqual([
      ['Maya changed the amount from $90.00 to $96.00', true, false],
      ['Jordan added the note "Split the wine"', false, true],
      ['Maya added this', false, true],
    ]);
    expect(splitCaption(dinner.split, activeMemberIds(group))).toBe('Equally, 3 of 4 people');
  });

  it('Expense detail, flagged: the split adds up to $94.00 of $96.00', () => {
    const { state, dinnerId, myMemberId } = flaggedPreview(DEVICE);
    const dinner = state.expenses.get(dinnerId);
    expect(flagOf(state, dinnerId)?.reason).toBe('split_mismatch');
    expect(dinner && splitTotalLine(dinner, money)).toBe('Shares add up to $94.00, not $96.00');
    expect(dinner && splitCaption(dinner.split, activeMemberIds(state))).toBe('Exact amounts');
    const rows =
      dinner === undefined
        ? []
        : historyRows(dinner, {
            nameOf: (id) => (id === myMemberId ? 'You' : nameOf(state, id)),
            money,
            date: (iso) => iso,
          });
    expect(rows.map((r) => r.text)).toEqual([
      'Jordan changed the split',
      'Maya changed the amount from $90.00 to $96.00',
      'Maya added this',
    ]);
  });

  it('derives one secret per seed key', () => {
    expect(seedSecret('banff')).toHaveLength(32);
    expect(seedSecret('banff')).toEqual(seedSecret('banff'));
    expect(seedSecret('banff')).not.toEqual(seedSecret('banff-even'));
  });
});
