import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants.js';
import {
  aheadOfServer,
  canWrite,
  compareLog,
  effectiveTs,
  entityIdOf,
  holdBackHorizon,
  isClockSane,
  isHeldBack,
  isReceivedAt,
  mustFollowTarget,
  nextTs,
  receivedAtOf,
  writeTs,
} from './hlc.js';
import type { Event, EventPayload, LogEntry } from './types.js';

const id = (seed: string): string => seed.padEnd(22, '0');
const MAYA = id('maya');
const NATHAN = id('nathan');
const EXPENSE = id('expense1');
const OTHER_EXPENSE = id('expense2');
const PAYMENT = id('payment1');

const NOW = 1_750_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let counter = 0;
function entry(ts: number, payload: EventPayload): LogEntry {
  counter++;
  const event = { sv: 1, ts, at: ts, by: MAYA, dev: id('device1'), ...payload } as Event;
  return { id: id(`env${counter}`), event };
}

/** An entry written from device `dev` (the fixtures above all come from one device). */
function fromDevice(dev: string, ts: number, payload: EventPayload): LogEntry {
  const made = entry(ts, payload);
  return { id: made.id, event: { ...made.event, dev: id(dev) } };
}

const TOP = LIMITS.tsMax - 1;
const W = LIMITS.clockAbsorbWindowMs;

/** The entry as a server reported it, arriving at `receivedAt`. */
const arrived = (made: LogEntry, receivedAt: number): LogEntry => ({ ...made, receivedAt });

const expenseAdded = (ts: number, expenseId = EXPENSE): LogEntry =>
  entry(ts, {
    type: 'expense.added',
    expense: {
      id: expenseId,
      title: 'Dinner',
      amount: 100,
      currency: 'CAD',
      paidBy: MAYA,
      date: '2026-02-14',
      category: 'food',
      split: { [MAYA]: 100 },
    },
  });

describe('nextTs', () => {
  it('returns nowMs for an empty log', () => {
    expect(nextTs(NOW, [])).toBe(NOW);
    expect(nextTs(NOW, [], EXPENSE)).toBe(NOW);
  });

  it('returns nowMs when every event is in the past', () => {
    expect(nextTs(NOW, [entry(NOW - 5_000, { type: 'group.renamed', name: 'A' })])).toBe(NOW);
  });

  it('is monotonic after a newer event', () => {
    const log = [entry(NOW + 5_000, { type: 'group.renamed', name: 'A' })];
    expect(nextTs(NOW, log)).toBe(NOW + 5_001);
  });

  it('is strictly after an event at the same ms', () => {
    expect(nextTs(NOW, [entry(NOW, { type: 'group.renamed', name: 'A' })])).toBe(NOW + 1);
  });

  it('absorbs an event 23 hours ahead', () => {
    const log = [entry(NOW + 23 * HOUR, { type: 'group.renamed', name: 'A' })];
    expect(nextTs(NOW, log)).toBe(NOW + 23 * HOUR + 1);
  });

  it('absorbs an event exactly at the window edge, not one ms past it', () => {
    const edge = NOW + LIMITS.clockAbsorbWindowMs;
    expect(nextTs(NOW, [entry(edge, { type: 'group.renamed', name: 'A' })])).toBe(edge + 1);
    expect(nextTs(NOW, [entry(edge + 1, { type: 'group.renamed', name: 'A' })])).toBe(NOW);
  });

  it('does not absorb an event 2 days ahead', () => {
    const log = [
      entry(NOW - 1_000, { type: 'group.renamed', name: 'A' }),
      entry(NOW + 2 * DAY, { type: 'group.renamed', name: 'B' }),
    ];
    expect(nextTs(NOW, log)).toBe(NOW);
  });

  it('uses the largest absorbable ts, ignoring order in the log', () => {
    const log = [
      entry(NOW + 3 * DAY, { type: 'group.renamed', name: 'far' }),
      entry(NOW + 2 * HOUR, { type: 'group.renamed', name: 'near' }),
      entry(NOW + 1 * HOUR, { type: 'group.renamed', name: 'nearer' }),
    ];
    expect(nextTs(NOW, log)).toBe(NOW + 2 * HOUR + 1);
  });

  it('orders an edit after its expense even when the add is 2 days ahead', () => {
    const add = expenseAdded(NOW + 2 * DAY);
    const log = [add, entry(NOW - 1_000, { type: 'group.renamed', name: 'A' })];
    expect(nextTs(NOW, log)).toBe(NOW); // the group clock ignores it
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW + 2 * DAY + 1);
  });

  it('orders after the latest event targeting the entity, not just the add', () => {
    const log = [
      expenseAdded(NOW - DAY),
      entry(NOW + 5 * DAY, { type: 'expense.updated', id: EXPENSE, changes: { title: 'Lunch' } }),
      entry(NOW + 3 * DAY, { type: 'expense.updated', id: EXPENSE, changes: { title: 'Brunch' } }),
    ];
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW + 5 * DAY + 1);
  });

  it('ignores events targeting other entities', () => {
    const log = [expenseAdded(NOW - DAY), expenseAdded(NOW + 4 * DAY, OTHER_EXPENSE)];
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW);
    expect(nextTs(NOW, log, OTHER_EXPENSE)).toBe(NOW + 4 * DAY + 1);
  });

  it('keeps the group-clock value when it is already after the target', () => {
    const log = [expenseAdded(NOW - DAY), entry(NOW + HOUR, { type: 'group.renamed', name: 'A' })];
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW + HOUR + 1);
  });

  it('applies the target rule to payments and members', () => {
    const paymentLog = [
      entry(NOW + 3 * DAY, {
        type: 'payment.added',
        payment: { id: PAYMENT, from: NATHAN, to: MAYA, amount: 5, currency: 'CAD', date: '2026-02-14' },
      }),
    ];
    expect(nextTs(NOW, paymentLog, PAYMENT)).toBe(NOW + 3 * DAY + 1);

    const memberLog = [
      entry(NOW + 2 * DAY, { type: 'member.added', member: { id: NATHAN, name: 'Nathan' } }),
      entry(NOW + 6 * DAY, { type: 'member.claimed', id: NATHAN }),
    ];
    expect(nextTs(NOW, memberLog, NATHAN)).toBe(NOW + 6 * DAY + 1);
    expect(nextTs(NOW, memberLog)).toBe(NOW);

    // member.done / member.undone target the member too, so an undo sorts after the done it reverses.
    const doneLog = [...memberLog, entry(NOW + 8 * DAY, { type: 'member.done', id: NATHAN })];
    expect(nextTs(NOW, doneLog, NATHAN)).toBe(NOW + 8 * DAY + 1);
  });

  it('returns an integer for a fractional clock', () => {
    const ts = nextTs(NOW + 0.7, []);
    expect(ts).toBe(NOW);
    expect(Number.isInteger(ts)).toBe(true);
  });
});

describe('effectiveTs and compareLog: (min(ts, R), ts, id)', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;

  it('an entry is effective at min(ts, R), or at its claimed ts with no usable R', () => {
    const e = entry(NOW + HOUR, rename);
    expect(effectiveTs(e)).toBe(NOW + HOUR);
    expect(effectiveTs(arrived(e, NOW))).toBe(NOW);
    expect(effectiveTs(arrived(e, NOW + 2 * HOUR))).toBe(NOW + HOUR);
    for (const bad of [0.5, LIMITS.tsMin - 1, LIMITS.tsMax, Number.NaN]) {
      expect(effectiveTs(arrived(e, bad))).toBe(NOW + HOUR);
      expect(receivedAtOf(arrived(e, bad))).toBeUndefined();
    }
    expect(receivedAtOf(arrived(e, NOW))).toBe(NOW);
  });

  it('the sort key is exactly (min(ts, R), ts, id), for any entries', () => {
    const arb = fc.record({
      ts: fc.integer({ min: NOW - DAY, max: NOW + DAY }),
      r: fc.option(fc.integer({ min: NOW - DAY, max: NOW + DAY }), { nil: undefined }),
      id: fc.constantFrom('a', 'b', 'c').map((c) => id(c)),
    });
    const key = (x: { ts: number; r: number | undefined; id: string }) =>
      [x.r === undefined ? x.ts : Math.min(x.ts, x.r), x.ts, x.id] as const;
    const lex = (a: readonly [number, number, string], b: readonly [number, number, string]): number =>
      a[0] !== b[0] ? Math.sign(a[0] - b[0]) : a[1] !== b[1] ? Math.sign(a[1] - b[1]) : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
    const make = (x: { ts: number; r: number | undefined; id: string }): LogEntry => {
      const e = { id: x.id, event: entry(x.ts, rename).event };
      return x.r === undefined ? e : arrived(e, x.r);
    };
    fc.assert(
      fc.property(arb, arb, (a, b) => {
        const k = lex(key(a), key(b));
        if (k !== 0) expect(Math.sign(compareLog(make(a), make(b)))).toBe(k);
      }),
      { numRuns: 500 },
    );
  });

  it('an add then an edit from a phone 3 h ahead, pushed in one request, keep their order', () => {
    // Both arrive in one request, so they share an R three hours before what the phone stamped.
    const R = NOW;
    const add = arrived(expenseAdded(NOW + 3 * HOUR), R);
    const edit = arrived(entry(NOW + 3 * HOUR + 1, { type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } }), R);
    expect(effectiveTs(add)).toBe(effectiveTs(edit));
    // Whatever the envelope ids: the claimed ts breaks the tie, not the id.
    for (const [ia, ie] of [[id('zzz'), id('aaa')], [id('aaa'), id('zzz')]] as const) {
      expect(compareLog({ ...add, id: ia }, { ...edit, id: ie })).toBeLessThan(0);
    }
  });

  it('copies of one envelope id order by R, then the copy with none, so de-duplication keeps the same one', () => {
    const e = entry(NOW, rename);
    expect(compareLog(arrived(e, NOW + 5), arrived(e, NOW + 9))).toBeLessThan(0);
    expect(compareLog(arrived(e, NOW + 5), e)).toBeLessThan(0);
    expect(compareLog(e, { ...e })).toBe(0);
  });
});

describe('holdBackHorizon and isHeldBack: the latest R plus W', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;

  it('is +Infinity with no usable R: nothing is held', () => {
    expect(holdBackHorizon([])).toBe(Number.POSITIVE_INFINITY);
    const far = entry(TOP, rename);
    expect(holdBackHorizon([entry(NOW, rename), far, arrived(entry(NOW, rename), 0.5)])).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(isHeldBack(far, holdBackHorizon([far]))).toBe(false);
  });

  it('is the latest R in the log plus W, whoever wrote what', () => {
    const log = [
      arrived(fromDevice('a', NOW - DAY, rename), NOW - DAY),
      arrived(fromDevice('b', TOP, rename), NOW - HOUR),
      arrived(fromDevice('a', NOW, rename), NOW),
      fromDevice('c', NOW + 5 * DAY, rename),
    ];
    expect(holdBackHorizon(log)).toBe(NOW + W);
  });

  it('holds an entry with an R exactly when its claimed ts is past the horizon: H + W + 1 held, H + W not', () => {
    const H = NOW; // the latest R
    const horizon = holdBackHorizon([arrived(entry(NOW, rename), H)]);
    expect(isHeldBack(arrived(entry(H + W + 1, rename), H), horizon)).toBe(true);
    expect(isHeldBack(arrived(entry(H + W, rename), H), horizon)).toBe(false);
    // An entry with no R is never held, however far ahead; an unusable R is no R.
    expect(isHeldBack(entry(TOP, rename), horizon)).toBe(false);
    expect(isHeldBack(arrived(entry(TOP, rename), LIMITS.tsMax), horizon)).toBe(false);
  });

  it('is permutation-invariant and reads only the R values', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: LIMITS.tsMin, max: LIMITS.tsMax + 10 }), { nil: undefined }), {
          maxLength: 10,
        }),
        fc.nat(),
        (rs, turn) => {
          const log = rs.map((r, i) => {
            const e = entry(NOW + i, rename);
            return r === undefined ? e : arrived(e, r);
          });
          const usable = rs.filter((r): r is number => r !== undefined && isReceivedAt(r));
          expect(holdBackHorizon(log)).toBe(usable.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...usable) + W);
          const k = log.length === 0 ? 0 : turn % log.length;
          expect(holdBackHorizon([...log.slice(k), ...log.slice(0, k)].reverse())).toBe(holdBackHorizon(log));
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('nextTs over effective times', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;
  const titleEdit = { type: 'expense.updated', id: EXPENSE, changes: { title: 'Pwned' } } as const;

  it('the group clock absorbs effective times: an event stamped ahead counts from its arrival', () => {
    const fast = arrived(entry(NOW + 20 * HOUR, rename), NOW - HOUR);
    expect(nextTs(NOW, [fast])).toBe(NOW); // effective at NOW - HOUR
    expect(nextTs(NOW, [entry(NOW + 20 * HOUR, rename)])).toBe(NOW + 20 * HOUR + 1); // no R: as claimed
    // A phone behind the server climbs over what arrived.
    expect(nextTs(NOW - 2 * HOUR, [arrived(entry(NOW - HOUR, rename), NOW - HOUR)])).toBe(NOW - HOUR + 1);
  });

  it('absorbs every event with an R, however far past this clock: a phone running slow still writes after them', () => {
    // This phone runs two days slow; what it has seen arrived at the server's now.
    const slow = NOW - 2 * DAY;
    const seen = arrived(entry(NOW - HOUR, rename), NOW);
    expect(nextTs(slow, [seen])).toBe(NOW - HOUR + 1);
    // Without an R, a claim more than W past the clock is still not absorbed.
    expect(nextTs(slow, [entry(NOW - HOUR, rename)])).toBe(slow);
    // So the slow phone's untargeted toggle sorts after the rename it saw, and wins.
    const mine = { id: id('mine'), event: { ...entry(nextTs(slow, [seen]), { type: 'group.renamed', name: 'B' }).event } };
    expect(compareLog(mine, seen)).toBeGreaterThan(0);
    expect(compareLog(arrived(mine, NOW + 5_000), seen)).toBeGreaterThan(0);
  });

  it('climbs over the effective time of the target, not its claim', () => {
    const add = arrived(expenseAdded(NOW + 20 * HOUR), NOW - HOUR);
    const edit = arrived(entry(NOW + 22 * HOUR, titleEdit), NOW - 30 * 60 * 1000);
    expect(nextTs(NOW, [add, edit], EXPENSE)).toBe(NOW);
    expect(nextTs(NOW - 2 * HOUR, [add, edit], EXPENSE)).toBe(NOW - 30 * 60 * 1000 + 1);
  });

  it("does not climb over a held edit, and a far event with an R never reaches the top", () => {
    const add = arrived(expenseAdded(NOW - DAY), NOW - DAY);
    const far = arrived(fromDevice('far', TOP, titleEdit), NOW - HOUR);
    const log = [add, far];
    expect(isHeldBack(far, holdBackHorizon(log))).toBe(true);
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW);
    // A far add with an R takes effect once a later R releases it, at its arrival, so an edit need only follow that.
    const farAdd = arrived(expenseAdded(TOP, OTHER_EXPENSE), NOW - HOUR);
    // (An old write that reached the server only now raises the horizon; its own claim stays early.)
    const released = [farAdd, arrived(entry(NOW - 3 * HOUR, rename), TOP - W)];
    expect(isHeldBack(farAdd, holdBackHorizon(released))).toBe(false);
    expect(nextTs(NOW - 2 * HOUR, released, OTHER_EXPENSE)).toBe(NOW - HOUR + 1);
  });

  it('climbs over a target with no R however far ahead (this phone\'s own unsynced write, or an unstamped log)', () => {
    const top = expenseAdded(TOP);
    expect(nextTs(NOW, [top], EXPENSE)).toBe(LIMITS.tsMax);
    expect(nextTs(NOW, [arrived(top, NOW - HOUR)], EXPENSE)).toBe(NOW);
  });
});

describe('aheadOfServer: this phone more than W ahead of the server, from its last push', () => {
  const own = (ts: number, receivedAt: number) => ({ ts, receivedAt });

  it('is true when the last push arrived more than W before what the phone stamped, and the clock still says so', () => {
    const stamped = NOW + 3 * DAY;
    expect(aheadOfServer(stamped + 1_000, own(stamped, NOW))).toBe(true);
    expect(aheadOfServer(stamped + W, own(stamped, NOW))).toBe(true);
  });

  it('is false for a lead of W or less, no push yet, or an unusable R', () => {
    expect(aheadOfServer(NOW + W, own(NOW + W, NOW))).toBe(false);
    expect(aheadOfServer(NOW + W + 2, own(NOW + W + 1, NOW))).toBe(true);
    expect(aheadOfServer(NOW, null)).toBe(false);
    expect(aheadOfServer(NOW, undefined)).toBe(false);
    expect(aheadOfServer(NOW + 3 * DAY, own(NOW + 3 * DAY, 0.5))).toBe(false);
  });

  it('says nothing once the clock is set back below that stamp, or the push is more than W old by this clock', () => {
    const stamped = NOW + 3 * DAY;
    expect(aheadOfServer(NOW + 5_000, own(stamped, NOW))).toBe(false); // the date was fixed
    expect(aheadOfServer(stamped + W + 1, own(stamped, NOW))).toBe(false); // the next push measures again
  });
});

describe('entityIdOf', () => {
  const cases: Array<[EventPayload, string | null]> = [
    [{ type: 'group.created', name: 'Banff', currency: 'CAD' }, null],
    [{ type: 'group.renamed', name: 'Banff' }, null],
    [{ type: 'group.closed', reason: 'rotated' }, null],
    [{ type: 'group.rotated', from: 'x'.repeat(43) }, null],
    [{ type: 'group.moved', server: 'https://example.com' }, null],
    [{ type: 'group.archived' }, null],
    [{ type: 'group.unarchived' }, null],
    [{ type: 'member.added', member: { id: NATHAN, name: 'Nathan' } }, null],
    [{ type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } }, NATHAN],
    [{ type: 'member.claimed', id: NATHAN }, NATHAN],
    [{ type: 'member.archived', id: NATHAN }, NATHAN],
    [{ type: 'member.unarchived', id: NATHAN }, NATHAN],
    [{ type: 'member.done', id: NATHAN }, NATHAN],
    [{ type: 'member.undone', id: NATHAN }, NATHAN],
    [expenseAdded(NOW).event, null],
    [{ type: 'expense.updated', id: EXPENSE, changes: { title: 'Lunch' } }, EXPENSE],
    [{ type: 'expense.deleted', id: EXPENSE }, EXPENSE],
    [
      {
        type: 'payment.added',
        payment: { id: PAYMENT, from: NATHAN, to: MAYA, amount: 5, currency: 'CAD', date: '2026-02-14' },
      },
      null,
    ],
    [{ type: 'payment.deleted', id: PAYMENT }, PAYMENT],
  ];

  it('covers all nineteen event types', () => {
    expect(new Set(cases.map(([p]) => p.type)).size).toBe(19);
  });

  it.each(cases)('%o → %s', (payload, expected) => {
    expect(entityIdOf(entry(NOW, payload).event)).toBe(expected);
  });
});

describe('isReceivedAt', () => {
  it('accepts an integer in [tsMin, tsMax) and nothing else', () => {
    for (const ok of [LIMITS.tsMin, NOW, LIMITS.tsMax - 1]) expect(isReceivedAt(ok)).toBe(true);
    for (const bad of [LIMITS.tsMin - 1, LIMITS.tsMax, NOW + 0.5, Number.NaN, Infinity, -NOW, 0, '1750000000000', null, undefined]) {
      expect(isReceivedAt(bad)).toBe(false);
    }
  });
});

describe('isClockSane', () => {
  it('accepts the range [tsMin, tsMax)', () => {
    expect(isClockSane(LIMITS.tsMin)).toBe(true);
    expect(isClockSane(NOW)).toBe(true);
    expect(isClockSane(LIMITS.tsMax - 1)).toBe(true);
  });

  it('rejects clocks outside the range', () => {
    expect(isClockSane(LIMITS.tsMin - 1)).toBe(false);
    expect(isClockSane(LIMITS.tsMax)).toBe(false);
    expect(isClockSane(0)).toBe(false);
    expect(isClockSane(-NOW)).toBe(false);
  });

  it('rejects non-integers and non-finite values', () => {
    expect(isClockSane(NOW + 0.5)).toBe(false);
    expect(isClockSane(Number.NaN)).toBe(false);
    expect(isClockSane(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('canWrite', () => {
  it('allows a normal write', () => {
    expect(canWrite(NOW, [])).toBe(true);
    expect(canWrite(NOW, [expenseAdded(NOW - DAY)], EXPENSE)).toBe(true);
  });

  it('refuses when the clock is outside the validator range', () => {
    expect(canWrite(LIMITS.tsMin - 1, [])).toBe(false);
    expect(canWrite(LIMITS.tsMax, [])).toBe(false);
    expect(canWrite(NOW + 0.5, [])).toBe(false);
  });

  it('refuses while this phone is more than W ahead of the server', () => {
    const stamped = NOW + 3 * DAY;
    expect(canWrite(stamped + 1_000, [], undefined, { ts: stamped, receivedAt: NOW })).toBe(false);
    expect(canWrite(stamped + 1_000, [], undefined, { ts: stamped, receivedAt: stamped - HOUR })).toBe(true);
    expect(canWrite(stamped + 1_000, [], undefined, null)).toBe(true);
  });

  it('refuses to edit an entity whose latest event, with no R, sits at tsMax − 1 (nextTs would be tsMax)', () => {
    const top = expenseAdded(LIMITS.tsMax - 1);
    expect(nextTs(NOW, [top], EXPENSE)).toBe(LIMITS.tsMax);
    expect(canWrite(NOW, [top], EXPENSE)).toBe(false);
    // With an R it is effective at its arrival: the edit fits.
    expect(canWrite(NOW, [arrived(top, NOW - HOUR)], EXPENSE)).toBe(true);
    // Group-level writes are unaffected: an event that far ahead is not absorbed into the group clock.
    expect(canWrite(NOW, [top])).toBe(true);
    // An entity at tsMax − 2 can still take exactly one more edit.
    const almost = expenseAdded(LIMITS.tsMax - 2, OTHER_EXPENSE);
    expect(nextTs(NOW, [almost], OTHER_EXPENSE)).toBe(LIMITS.tsMax - 1);
    expect(canWrite(NOW, [almost], OTHER_EXPENSE)).toBe(true);
  });

  it('refuses when the absorbed group clock would reach tsMax', () => {
    const clock = LIMITS.tsMax - 1 - HOUR;
    expect(canWrite(clock, [entry(LIMITS.tsMax - 1, { type: 'group.renamed', name: 'A' })])).toBe(false);
  });
});

describe('writeTs', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;
  const write = (payload: EventPayload): Event => entry(NOW, payload).event;
  /** An expense another device added at the top of the range, not stamped by a server, and an honest event at now. */
  const farAdd = (): LogEntry[] => {
    const add = expenseAdded(TOP);
    return [{ id: add.id, event: { ...add.event, dev: id('far') } }, fromDevice('honest', NOW - HOUR, rename)];
  };

  it('is nextTs when that fits, and null for a clock outside the range', () => {
    const log = [expenseAdded(NOW - DAY)];
    expect(writeTs(NOW, log, write({ type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } }))).toBe(
      nextTs(NOW, log, EXPENSE),
    );
    expect(writeTs(NOW, log, write(rename))).toBe(nextTs(NOW, log));
    expect(writeTs(LIMITS.tsMax, log, write(rename))).toBeNull();
    expect(writeTs(LIMITS.tsMin - 1, log, write(rename))).toBeNull();
  });

  it('is null while this phone is more than W ahead of the server, whatever the event', () => {
    const stamped = NOW + 3 * DAY;
    const own = { ts: stamped, receivedAt: NOW };
    expect(writeTs(stamped + 1, [], write(rename), own)).toBeNull();
    expect(writeTs(stamped + 1, farAdd(), write({ type: 'expense.deleted', id: EXPENSE }), own)).toBeNull();
    expect(writeTs(NOW + 1, [], write(rename), own)).toBe(NOW + 1); // the date was fixed since
  });

  it('gives a write that holds in either order the group clock when its target, with no R, sits at the top', () => {
    const log = farAdd();
    expect(nextTs(NOW, log, EXPENSE)).toBe(LIMITS.tsMax);
    expect(writeTs(NOW, log, write({ type: 'expense.deleted', id: EXPENSE }))).toBe(NOW);
    const member = [
      fromDevice('far', TOP, { type: 'member.claimed', id: NATHAN }),
      fromDevice('honest', NOW - HOUR, rename),
    ];
    for (const payload of [
      { type: 'member.archived', id: NATHAN },
      { type: 'member.unarchived', id: NATHAN },
      { type: 'member.done', id: NATHAN },
      { type: 'member.undone', id: NATHAN },
      { type: 'member.claimed', id: NATHAN },
    ] as const) {
      expect(writeTs(NOW, member, write(payload))).toBe(NOW);
    }
  });

  it('refuses an edit that must follow its target when nothing below the top can', () => {
    expect(writeTs(NOW, farAdd(), write({ type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } }))).toBeNull();
    const member = [
      fromDevice('far', TOP, { type: 'member.added', member: { id: NATHAN, name: 'Nathan' } }),
      fromDevice('honest', NOW - HOUR, rename),
    ];
    expect(writeTs(NOW, member, write({ type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } }))).toBeNull();
  });

  it('once the far add has an R, the edit is an ordinary one after its arrival', () => {
    const [add, honest] = farAdd() as [LogEntry, LogEntry];
    const log = [arrived(add, NOW - 2 * HOUR), arrived(honest, NOW - HOUR)];
    expect(writeTs(NOW, log, write({ type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } }))).toBe(NOW);
  });

  it('names the two edits that must follow their target', () => {
    const must = (payload: EventPayload): boolean => mustFollowTarget(write(payload));
    expect(must({ type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } })).toBe(true);
    expect(must({ type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } })).toBe(true);
    expect(must({ type: 'expense.deleted', id: EXPENSE })).toBe(false);
    expect(must({ type: 'payment.deleted', id: PAYMENT })).toBe(false);
    expect(must({ type: 'member.archived', id: NATHAN })).toBe(false);
  });
});
