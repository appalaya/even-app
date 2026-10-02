import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants.js';
import {
  canWrite,
  entityIdOf,
  holdBackHorizon,
  isClockSane,
  isHeldBack,
  isReceivedAt,
  mustFollowTarget,
  nextTs,
  writesLastWriterField,
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

describe('nextTs: held-back writes (review H2)', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;
  const titleEdit = { type: 'expense.updated', id: EXPENSE, changes: { title: 'Pwned' } } as const;

  it("does not climb over another device's edit of the target that the reducer holds back", () => {
    const far = fromDevice('far', TOP, titleEdit);
    const log = [expenseAdded(NOW - DAY), fromDevice('honest', NOW - HOUR, rename), far];
    expect(isHeldBack(far.event, holdBackHorizon(log))).toBe(true);
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW);
    expect(canWrite(NOW, log, EXPENSE)).toBe(true);
  });

  it('still climbs over an edit from a phone hours fast, as before', () => {
    const fast = fromDevice('fast', NOW + 3 * HOUR, titleEdit);
    const log = [expenseAdded(NOW - DAY), fromDevice('honest', NOW - HOUR, rename), fast];
    expect(nextTs(NOW, log, EXPENSE)).toBe(NOW + 3 * HOUR + 1);
  });

  it('still climbs over an add however far ahead: an add takes effect, so an edit must follow it', () => {
    const add = expenseAdded(TOP);
    const log = [{ id: add.id, event: { ...add.event, dev: id('far') } }, fromDevice('honest', NOW - HOUR, rename)];
    expect(nextTs(NOW, log, EXPENSE)).toBe(LIMITS.tsMax);
    expect(canWrite(NOW, log, EXPENSE)).toBe(false);
  });

  it('climbs over a far edit once a second device sits next to it (the rule reads only the log)', () => {
    const log = [
      expenseAdded(NOW - DAY),
      fromDevice('far', TOP, titleEdit),
      fromDevice('second', TOP, { type: 'member.done', id: MAYA }),
    ];
    expect(holdBackHorizon(log)).toBeGreaterThanOrEqual(TOP);
    expect(nextTs(NOW, log, EXPENSE)).toBe(LIMITS.tsMax);
    expect(canWrite(NOW, log, EXPENSE)).toBe(false);
  });

  it('leaves the group clock alone: an untargeted write never looked past the absorb window', () => {
    const log = [fromDevice('honest', NOW - HOUR, rename), fromDevice('far', TOP, rename)];
    expect(nextTs(NOW, log)).toBe(NOW);
  });
});

describe('holdBackHorizon', () => {
  const rename = { type: 'group.renamed', name: 'A' } as const;

  it('holds nothing back in an empty log or one written by a single device, however far apart', () => {
    expect(holdBackHorizon([])).toBe(Number.POSITIVE_INFINITY);
    expect(holdBackHorizon([entry(NOW, rename), entry(TOP, rename)])).toBe(Number.POSITIVE_INFINITY);
  });

  it("is the latest ts by any device but the one with the log's latest ts, plus the window", () => {
    const log = [
      fromDevice('a', NOW - DAY, rename),
      fromDevice('b', NOW, rename),
      fromDevice('a', NOW + HOUR, rename),
      fromDevice('c', TOP, rename),
      fromDevice('c', NOW - 2 * DAY, rename),
    ];
    expect(holdBackHorizon(log)).toBe(NOW + HOUR + LIMITS.holdBackMs);
  });

  it('holds nothing at the latest ts when two devices share it', () => {
    const log = [fromDevice('a', NOW, rename), fromDevice('b', TOP, rename), fromDevice('c', TOP, rename)];
    expect(holdBackHorizon(log)).toBe(TOP + LIMITS.holdBackMs);
  });

  it('matches its definition for any log: past it are exactly the events more than the window ahead of every other device', () => {
    const devices = ['a', 'b', 'c'];
    const arb = fc.array(
      fc.record({
        dev: fc.constantFrom(...devices),
        ts: fc.oneof(
          fc.integer({ min: LIMITS.tsMin, max: LIMITS.tsMin + 3 * LIMITS.holdBackMs }),
          fc.integer({ min: LIMITS.tsMin, max: LIMITS.tsMax - 1 }),
        ),
      }),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(arb, fc.nat(), (rows, turn) => {
        const log = rows.map((r) => fromDevice(r.dev, r.ts, rename));
        const horizon = holdBackHorizon(log);
        for (const { event } of log) {
          const others = log.filter((e) => e.event.dev !== event.dev).map((e) => e.event.ts);
          const ahead = others.length > 0 && event.ts > Math.max(...others) + LIMITS.holdBackMs;
          expect(event.ts > horizon).toBe(ahead);
        }
        // Permutation-invariant: reversed, then rotated.
        const reversed = [...log].reverse();
        const k = log.length === 0 ? 0 : turn % log.length;
        expect(holdBackHorizon([...reversed.slice(k), ...reversed.slice(0, k)])).toBe(horizon);
      }),
      { numRuns: 300 },
    );
  });
});

describe('writesLastWriterField', () => {
  it('names the field writes and nothing else', () => {
    const fields: EventPayload[] = [
      { type: 'group.renamed', name: 'A' },
      { type: 'group.archived' },
      { type: 'group.unarchived' },
      { type: 'group.moved', server: 'https://example.com' },
      { type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } },
      { type: 'member.archived', id: NATHAN },
      { type: 'member.unarchived', id: NATHAN },
      { type: 'member.done', id: NATHAN },
      { type: 'member.undone', id: NATHAN },
      { type: 'expense.updated', id: EXPENSE, changes: { title: 'Lunch' } },
    ];
    const others: EventPayload[] = [
      { type: 'group.created', name: 'Banff', currency: 'CAD' },
      { type: 'group.closed', reason: 'rotated' },
      { type: 'group.rotated', from: 'x'.repeat(43) },
      { type: 'member.added', member: { id: NATHAN, name: 'Nathan' } },
      { type: 'member.claimed', id: NATHAN },
      expenseAdded(NOW).event,
      { type: 'expense.deleted', id: EXPENSE },
      {
        type: 'payment.added',
        payment: { id: PAYMENT, from: NATHAN, to: MAYA, amount: 5, currency: 'CAD', date: '2026-02-14' },
      },
      { type: 'payment.deleted', id: PAYMENT },
    ];
    expect(new Set([...fields, ...others].map((p) => p.type)).size).toBe(19);
    for (const p of fields) expect(writesLastWriterField(entry(NOW, p).event)).toBe(true);
    for (const p of others) expect(writesLastWriterField(entry(NOW, p).event)).toBe(false);
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

  it('refuses to edit an entity whose latest event sits at tsMax − 1 (nextTs would be tsMax)', () => {
    const top = expenseAdded(LIMITS.tsMax - 1);
    expect(nextTs(NOW, [top], EXPENSE)).toBe(LIMITS.tsMax);
    expect(canWrite(NOW, [top], EXPENSE)).toBe(false);
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
  /** An expense another device added at the top of the range, and an honest device's event at now. */
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

  it('gives a write that holds in either order the group clock when its target sits at the top (review H2)', () => {
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

  it('names the two edits that must follow their target', () => {
    const must = (payload: EventPayload): boolean => mustFollowTarget(write(payload));
    expect(must({ type: 'expense.updated', id: EXPENSE, changes: { title: 'B' } })).toBe(true);
    expect(must({ type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } })).toBe(true);
    expect(must({ type: 'expense.deleted', id: EXPENSE })).toBe(false);
    expect(must({ type: 'payment.deleted', id: PAYMENT })).toBe(false);
    expect(must({ type: 'member.archived', id: NATHAN })).toBe(false);
  });
});
