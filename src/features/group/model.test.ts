/**
 * The Group screen's rules for "Everyone's settled", for offering "Which name is yours?" and for Group without a seat
 * (GroupNoSeat, SeatPick, SeatSameDevice, GroupShareMenu), over logs reduced by the same core reducer the screen reads.
 */
import {
  nets,
  newId,
  parseEvent,
  reduce,
  simplify,
  type Event,
  type EventPayload,
  type GroupState,
  type LogEntry,
} from '@even/core';
import { describe, expect, it } from 'vitest';

import {
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
      body: 'Continue as Maya? This phone was also Maya K. If that one is left over, archive it in Group settings.',
      confirm: 'Continue as Maya',
    });
    // An archived seat is not a seat: with Maya K. archived, Maya is this phone's alone.
    add(sam, { type: 'member.archived', id: mayaK });
    const archived = reduce(entries);
    expect(namePick(archived, member(archived, maya), THIS_PHONE)).toEqual({ kind: 'claim' });
    // A third name on this phone (not drawn): all of them, and "those".
    expect(sameDeviceWords('Maya', ['Maya K.', 'Mo']).body).toBe(
      'Continue as Maya? This phone was also Maya K. and Mo. If those are left over, archive them in Group settings.',
    );
    expect(sameDeviceWords('Mo', ['Sam']).body).toBe(
      'Continue as Mo? This phone was also Sam. If that one is left over, archive it in Group settings.',
    );
    expect(namePick(state, member(state, jordan), THIS_PHONE)).toEqual({ kind: 'claim' });
  });
});
