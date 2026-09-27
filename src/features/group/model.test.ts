/**
 * The Group screen's rules for "Everyone's settled" and for offering "Which name is yours?", over logs reduced by the
 * same core reducer the screen reads.
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

import { everyoneSettled, hasActivity, offersNamePick } from './model';

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
