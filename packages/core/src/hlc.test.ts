import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants.js';
import { canWrite, entityIdOf, isClockSane, nextTs } from './hlc.js';
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
  });

  it('returns an integer for a fractional clock', () => {
    const ts = nextTs(NOW + 0.7, []);
    expect(ts).toBe(NOW);
    expect(Number.isInteger(ts)).toBe(true);
  });
});

describe('entityIdOf', () => {
  const cases: Array<[EventPayload, string | null]> = [
    [{ type: 'group.created', name: 'Banff', currency: 'CAD' }, null],
    [{ type: 'group.renamed', name: 'Banff' }, null],
    [{ type: 'group.closed', reason: 'rotated' }, null],
    [{ type: 'group.rotated', from: 'x'.repeat(43) }, null],
    [{ type: 'group.moved', server: 'https://example.com' }, null],
    [{ type: 'member.added', member: { id: NATHAN, name: 'Nathan' } }, null],
    [{ type: 'member.updated', id: NATHAN, changes: { name: 'Nate' } }, NATHAN],
    [{ type: 'member.claimed', id: NATHAN }, NATHAN],
    [{ type: 'member.archived', id: NATHAN }, NATHAN],
    [{ type: 'member.unarchived', id: NATHAN }, NATHAN],
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

  it('covers all fifteen event types', () => {
    expect(new Set(cases.map(([p]) => p.type)).size).toBe(15);
  });

  it.each(cases)('%o → %s', (payload, expected) => {
    expect(entityIdOf(entry(NOW, payload).event)).toBe(expected);
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
