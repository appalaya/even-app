/**
 * The Group screen's rules for "Everyone's settled", for offering "Which name is yours?" and for Group without a seat
 * (GroupNoSeat, SeatPick, SeatSameDevice, GroupShareMenu), over logs reduced by the same core reducer the screen reads.
 */
import {
  emptyState,
  memberColor,
  nets,
  newId,
  parseEvent,
  reduce,
  simplify,
  type ActivityItem,
  type Event,
  type EventPayload,
  type GroupState,
  type LogEntry,
  type MemberState,
} from '@even/core';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  activitySections,
  everyoneSettled,
  hasActivity,
  namePick,
  offersNamePick,
  sameDeviceWords,
  seatMark,
  showsShareButton,
  spentSoFar,
} from './model';

const THIS_PHONE = 'thisPhoneAAAAAAAAAAAAA';
const OTHER_PHONE = 'otherPhoneBBBBBBBBBBBB';

interface Seat {
  id: string;
  dev: string;
}

/** A just-created Banff 2026: Sam (on `samDevice`) and two pre-added names nobody has claimed. */
function newGroup(samDevice: string) {
  const entries: LogEntry[] = [];
  let ts = 1_790_000_000_000;
  const sam: Seat = { id: newId(), dev: samDevice };
  const maya = newId();
  const jordan = newId();
  const add = (by: Seat, payload: EventPayload) => {
    ts += 1;
    const event = { sv: 1, ts, at: ts, by: by.id, dev: by.dev, ...payload } as Event;
    if (parseEvent(JSON.parse(JSON.stringify(event))) === null) {
      throw new Error(`invalid ${payload.type}`);
    }
    entries.push({ id: newId(), event });
  };
  add(sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  add(sam, { type: 'member.claimed', id: sam.id });
  add(sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  add(sam, { type: 'member.added', member: { id: maya, name: 'Maya' } });
  add(sam, { type: 'member.added', member: { id: jordan, name: 'Jordan' } });
  return { entries, add, sam, maya, jordan };
}

function settled(state: GroupState): boolean {
  const transfers = simplify(nets(state));
  return everyoneSettled(state, transfers, false);
}

describe("Everyone's settled", () => {
  it('needs something to have happened: a new group is even, not settled', () => {
    const { entries } = newGroup(THIS_PHONE);
    const state = reduce(entries);
    expect(simplify(nets(state))).toEqual([]);
    expect(hasActivity(state)).toBe(false);
    expect(settled(state)).toBe(false);
  });

  it('holds once expenses are paid back, and not while someone still owes', () => {
    const { entries, add, sam, maya } = newGroup(THIS_PHONE);
    add(sam, {
      type: 'expense.added',
      expense: {
        id: newId(),
        title: 'Cabin',
        amount: 20000,
        currency: 'CAD',
        paidBy: sam.id,
        date: '2026-09-18',
        category: 'lodging',
        split: { [sam.id]: 10000, [maya]: 10000 },
      },
    });
    const owing = reduce(entries);
    expect(hasActivity(owing)).toBe(true);
    expect(settled(owing)).toBe(false);

    add(sam, {
      type: 'payment.added',
      payment: {
        id: newId(),
        from: maya,
        to: sam.id,
        amount: 10000,
        currency: 'CAD',
        date: '2026-09-19',
      },
    });
    expect(settled(reduce(entries))).toBe(true);
  });

  it('counts a payment alone as activity, and never holds while balances are unavailable', () => {
    const { entries, add, sam, maya } = newGroup(THIS_PHONE);
    add(sam, {
      type: 'payment.added',
      payment: {
        id: newId(),
        from: maya,
        to: sam.id,
        amount: 500,
        currency: 'CAD',
        date: '2026-09-19',
      },
    });
    const state = reduce(entries);
    expect(hasActivity(state)).toBe(true);
    expect(everyoneSettled(state, [], true)).toBe(false);
  });
});

describe('Which name is yours? over Group', () => {
  const writable = { needsClaim: true, writable: true, deviceId: THIS_PHONE };

  it('is offered to a phone with no seat when no member carries it', () => {
    const state = reduce(newGroup(OTHER_PHONE).entries);
    expect(offersNamePick(state, writable)).toBe(true);
  });

  it("is not offered when this phone's own seat is in the log (it is restored silently)", () => {
    const state = reduce(newGroup(THIS_PHONE).entries);
    expect(offersNamePick(state, writable)).toBe(false);
  });

  it('waits for the members, and is never offered with a seat or in a read-only group', () => {
    const state = reduce(newGroup(OTHER_PHONE).entries);
    expect(offersNamePick(reduce([]), writable)).toBe(false);
    expect(offersNamePick(state, { ...writable, needsClaim: false })).toBe(false);
    expect(offersNamePick(state, { ...writable, writable: false })).toBe(false);
  });

  it('is offered when two members carry this phone: it cannot tell which is its own', () => {
    const { entries, add, maya } = newGroup(THIS_PHONE);
    add({ id: maya, dev: THIS_PHONE }, { type: 'member.claimed', id: maya });
    expect(offersNamePick(reduce(entries), writable)).toBe(true);
  });
});

function member(state: GroupState, id: string) {
  const m = state.members.get(id);
  if (m === undefined) throw new Error('no such member');
  return m;
}

function cad(id: string, amount: number, paidBy: string, split: Record<string, number>) {
  return {
    type: 'expense.added' as const,
    expense: {
      id,
      title: 'Cabin',
      amount,
      currency: 'CAD',
      paidBy,
      date: '2026-09-18',
      category: 'lodging' as const,
      split,
    },
  };
}

describe('Group with no name picked (GroupNoSeat)', () => {
  it('"Spent so far" adds the expenses, not the payments, and leaves flagged ones aside', () => {
    const { entries, add, sam, maya } = newGroup(OTHER_PHONE);
    expect(spentSoFar(reduce(entries))).toBe(0);
    add(sam, cad(newId(), 118000, sam.id, { [sam.id]: 59000, [maya]: 59000 }));
    add(sam, cad(newId(), 6000, maya, { [sam.id]: 3000, [maya]: 3000 }));
    add(sam, {
      type: 'payment.added',
      payment: {
        id: newId(),
        from: maya,
        to: sam.id,
        amount: 5000,
        currency: 'CAD',
        date: '2026-09-19',
      },
    });
    expect(spentSoFar(reduce(entries))).toBe(124000);
    // In another currency the reducer flags it: out of the balances and the total alike.
    add(sam, {
      type: 'expense.added',
      expense: {
        id: newId(),
        title: 'Souvenirs',
        amount: 2000,
        currency: 'USD',
        paidBy: sam.id,
        date: '2026-09-19',
        category: 'shopping',
        split: { [sam.id]: 2000 },
      },
    });
    const state = reduce(entries);
    expect(state.flagged).toHaveLength(1);
    expect(spentSoFar(state)).toBe(124000);
  });

  it('hides the share arrow with no seat, while the invite card shows, and in a read-only group', () => {
    const seated = { readOnly: false, needsClaim: false };
    expect(showsShareButton('none', seated)).toBe(true);
    expect(showsShareButton('none', { ...seated, needsClaim: true })).toBe(false);
    expect(showsShareButton('none', { ...seated, readOnly: true })).toBe(false);
    expect(showsShareButton('alone', seated)).toBe(false);
    expect(showsShareButton('pinned', seated)).toBe(false);
  });
});

describe('Which name is yours? marks and taps (SeatPick, SeatSameDevice)', () => {
  it('marks "this phone", "joined" by another phone, or nothing', () => {
    const { entries, add, sam, maya, jordan } = newGroup(OTHER_PHONE);
    add({ id: maya, dev: THIS_PHONE }, { type: 'member.claimed', id: maya });
    const state = reduce(entries);
    expect(seatMark(member(state, maya), THIS_PHONE)).toBe('thisPhone');
    expect(seatMark(member(state, sam.id), THIS_PHONE)).toBe('joined');
    expect(seatMark(member(state, jordan), THIS_PHONE)).toBeNull();
  });

  it('asks the other-phone question for a name another phone claimed, and claims a free one', () => {
    const { entries, sam, jordan } = newGroup(OTHER_PHONE);
    const state = reduce(entries);
    expect(namePick(state, member(state, sam.id), THIS_PHONE)).toEqual({ kind: 'otherPhone' });
    expect(namePick(state, member(state, jordan), THIS_PHONE)).toEqual({ kind: 'claim' });
  });

  it("skips the other-phone question for this phone's own name, even one another phone shares", () => {
    const { entries, add, maya } = newGroup(OTHER_PHONE);
    add({ id: maya, dev: OTHER_PHONE }, { type: 'member.claimed', id: maya });
    add({ id: maya, dev: THIS_PHONE }, { type: 'member.claimed', id: maya });
    const state = reduce(entries);
    expect(seatMark(member(state, maya), THIS_PHONE)).toBe('thisPhone');
    expect(namePick(state, member(state, maya), THIS_PHONE)).toEqual({ kind: 'claim' });
  });

  it('with two seats on this phone, a tap on one names the other', () => {
    const { entries, add, sam, maya, jordan } = newGroup(OTHER_PHONE);
    const mayaK = newId();
    add(sam, { type: 'member.added', member: { id: mayaK, name: 'Maya K.' } });
    add({ id: maya, dev: THIS_PHONE }, { type: 'member.claimed', id: maya });
    add({ id: mayaK, dev: THIS_PHONE }, { type: 'member.claimed', id: mayaK });
    const state = reduce(entries);
    expect(offersNamePick(state, { needsClaim: true, writable: true, deviceId: THIS_PHONE })).toBe(
      true,
    );
    const tap = namePick(state, member(state, maya), THIS_PHONE);
    expect(tap.kind).toBe('sameDevice');
    if (tap.kind !== 'sameDevice') return;
    expect(tap.others.map((m) => m.name)).toEqual(['Maya K.']);
    expect(sameDeviceWords('Maya', ['Maya K.'])).toEqual({
      question: 'This phone was Maya before',
      body: "This phone was also Maya K. If that's a leftover, archive it in Group settings.",
      confirm: 'Continue as Maya',
    });
    // An archived seat is not a seat: with Maya K. archived, Maya is this phone's alone.
    add(sam, { type: 'member.archived', id: mayaK });
    const archived = reduce(entries);
    expect(namePick(archived, member(archived, maya), THIS_PHONE)).toEqual({ kind: 'claim' });
    // A third name on this phone (not drawn): all of them, and "those".
    expect(sameDeviceWords('Maya', ['Maya K.', 'Mo']).body).toBe(
      'This phone was also Maya K. and Mo. If those are leftovers, archive them in Group settings.',
    );
    expect(sameDeviceWords('Mo', ['Sam']).body).toBe(
      "This phone was also Sam. If that's a leftover, archive it in Group settings.",
    );
    expect(namePick(state, member(state, jordan), THIS_PHONE)).toEqual({ kind: 'claim' });
  });
});

describe("Activity: the sentence's subject", () => {
  /** The subject rule as first written (one set-and-sort of every name per item), kept as the reference. */
  function referenceSubject(item: ActivityItem, state: GroupState) {
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

  function member(id: string, name: string): MemberState {
    return {
      id,
      name,
      archived: false,
      devices: [],
      unknown: false,
      color: memberColor(id),
      initials: '?',
    };
  }

  function stateOf(members: MemberState[], items: ActivityItem[]): GroupState {
    return { ...emptyState(), members: new Map(members.map((m) => [m.id, m])), activity: items };
  }

  function item(n: number, by: string, summary: string): ActivityItem {
    const at = 1_790_000_000_000 + n * 60_000;
    return {
      eventId: String(n).padStart(22, '0'),
      type: 'expense.added',
      ts: at,
      at,
      by,
      dev: by,
      summary,
    };
  }

  it('picks the longest name that ends at a space, an apostrophe or the end, and the actor when it has that name', () => {
    const maya = member('m'.repeat(22), 'Maya');
    const mayaK = member('k'.repeat(22), 'Maya K.');
    const twin = member('t'.repeat(22), 'Maya K.');
    const state = stateOf(
      [maya, mayaK, twin],
      [
        item(1, maya.id, "Maya K.'s dinner was edited"),
        item(2, twin.id, 'Maya K. added Lunch'),
        item(3, maya.id, 'Mayan ruins'),
        item(4, 'x'.repeat(22), 'Someone deleted a payment'),
        item(5, maya.id, 'Maya'),
      ],
    );
    const rows = activitySections(state, null).flatMap((section) => section.rows);
    expect(rows.map((r) => [r.subject, r.member?.id ?? null, r.rest])).toEqual([
      ['Maya', maya.id, ''],
      ['Someone', null, ' deleted a payment'],
      [null, maya.id, 'Mayan ruins'],
      ['Maya K.', twin.id, ' added Lunch'],
      ['Maya K.', mayaK.id, "'s dinner was edited"],
    ]);
  });

  it('agrees with the reference rule for any names and summaries', () => {
    const text = fc.string({
      unit: fc.constantFrom('M', 'a', 'K', '.', ' ', "'", 'S', 'o'),
      maxLength: 9,
    });
    fc.assert(
      fc.property(
        fc.array(
          text.filter((t) => t.length > 0),
          { maxLength: 6 },
        ),
        fc.array(fc.tuple(fc.nat(6), text, text), { maxLength: 12 }),
        (names, lines) => {
          const members = names.map((name, i) => member(String(i).padStart(22, 'i'), name));
          const ids = [...members.map((m) => m.id), 'z'.repeat(22)];
          const items = lines.map(([who, head, tail], n) =>
            item(n, ids[who % ids.length] ?? '', `${head}${tail}`),
          );
          const state = stateOf(members, items);
          const rows = activitySections(state, null).flatMap((section) => section.rows);
          const expected = [...items].reverse().map((i) => referenceSubject(i, state));
          expect(rows.map((r) => r.member)).toEqual(expected.map((e) => e.member));
          expect(rows.map((r) => (r.subject === null ? null : r.subject))).toEqual(
            expected.map((e) => e.name),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reads 10,000 items among 10,000 members without a per-item pass over the members', () => {
    const count = 10_000;
    const members = Array.from({ length: count }, (_, i) =>
      member(String(i).padStart(22, 'p'), `Person ${i}`),
    );
    const items = Array.from({ length: 10_000 }, (_, n) =>
      item(n, members[n]?.id ?? '', `Person ${n} added Dinner · 1.00`),
    );
    const start = performance.now();
    const rows = activitySections(stateOf(members, items), null).flatMap((section) => section.rows);
    const ms = performance.now() - start;
    expect(rows).toHaveLength(10_000);
    expect(rows[0]?.subject).toBe('Person 9999');
    // About 10 ms; the per-item set-and-sort of every name took about 3 s here.
    expect(ms).toBeLessThan(500);
  });
});
