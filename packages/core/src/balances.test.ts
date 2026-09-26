import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { myNet, nets, simplify } from './balances.js';
import { emptyState, memberColor, reduce } from './reduce.js';
import type { Event, EventBase, EventPayload, Expense, GroupState, LogEntry, Transfer } from './types.js';

// ---------- fixtures (kept local: test files do not import each other) ----------

const T0 = 1_750_000_000_000;
const pad = (stem: string): string => stem.padEnd(22, '_');
const eid = (n: number): string => String(n).padStart(22, '0');

const MAYA = pad('maya');
const JORDAN = pad('jordan');
const NATHAN = pad('nathan');

type Draft = EventPayload & Partial<EventBase>;

function entry(n: number, draft: Draft): LogEntry {
  const ts = draft.ts ?? T0 + n * 1000;
  const event = { sv: 1, ts, at: ts, by: MAYA, dev: pad('dev'), ...draft } as Event;
  return { id: eid(n), event };
}

function expense(id: string, over: Partial<Expense>): Expense {
  return { id, title: 'X', amount: 0, currency: 'CAD', paidBy: MAYA, date: '2026-02-14', category: 'other', split: {}, ...over };
}

const two = (n: number): string => (n / 100).toFixed(2);

function banff(withPayment: boolean): LogEntry[] {
  const log: LogEntry[] = [
    entry(1, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' }),
    entry(2, { type: 'member.added', member: { id: MAYA, name: 'Maya' } }),
    entry(3, { type: 'member.added', member: { id: JORDAN, name: 'Jordan' } }),
    entry(4, { type: 'member.added', member: { id: NATHAN, name: 'Nathan' } }),
    entry(5, {
      type: 'expense.added',
      expense: expense(pad('dinner'), { title: 'Dinner', amount: 9000, category: 'food', split: { [MAYA]: 3000, [JORDAN]: 3000, [NATHAN]: 3000 } }),
    }),
    entry(6, {
      type: 'expense.added',
      by: JORDAN,
      expense: expense(pad('gas'), { title: 'Gas', amount: 6000, paidBy: JORDAN, category: 'fuel', split: { [MAYA]: 2000, [JORDAN]: 2000, [NATHAN]: 2000 } }),
    }),
    entry(7, {
      type: 'expense.updated',
      id: pad('dinner'),
      changes: { amount: 9600, split: { [MAYA]: 3200, [JORDAN]: 3200, [NATHAN]: 3200 } },
    }),
  ];
  if (withPayment) {
    log.push(
      entry(8, {
        type: 'payment.added',
        by: NATHAN,
        payment: { id: pad('pay'), from: NATHAN, to: JORDAN, amount: 800, currency: 'CAD', date: '2026-02-16' },
      }),
    );
  }
  return log;
}

const sum = (m: ReadonlyMap<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);

/** Applies transfers as payments to a copy of the nets. */
function settle(ns: ReadonlyMap<string, number>, transfers: readonly Transfer[]): Map<string, number> {
  const out = new Map(ns);
  for (const t of transfers) {
    out.set(t.from, (out.get(t.from) ?? 0) + t.amount);
    out.set(t.to, (out.get(t.to) ?? 0) - t.amount);
  }
  return out;
}

function checkSimplify(ns: ReadonlyMap<string, number>): Transfer[] {
  const transfers = simplify(ns);
  const nonZero = [...ns.values()].filter((v) => v !== 0).length;
  expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
  for (const t of transfers) {
    expect(Number.isSafeInteger(t.amount)).toBe(true);
    expect(t.amount).toBeGreaterThan(0);
    expect(t.from).not.toBe(t.to);
    expect(ns.get(t.from) ?? 0).toBeLessThan(0);
    expect(ns.get(t.to) ?? 0).toBeGreaterThan(0);
  }
  for (const v of settle(ns, transfers).values()) expect(v).toBe(0);
  return transfers;
}

// ---------- tests ----------

describe('balances: Banff', () => {
  it('you owe Maya 44.00 and Jordan 8.00', () => {
    const s = reduce(banff(false));
    const ns = nets(s);
    expect([...ns]).toEqual([
      [MAYA, 4400],
      [JORDAN, 800],
      [NATHAN, -5200],
    ]);
    expect(sum(ns)).toBe(0);
    const transfers = checkSimplify(ns);
    expect(transfers).toEqual([
      { from: NATHAN, to: MAYA, amount: 4400 },
      { from: NATHAN, to: JORDAN, amount: 800 },
    ]);
    const names = new Map([...s.members].map(([id, m]) => [id, m.name]));
    const line = transfers
      .filter((t) => t.from === NATHAN)
      .map((t) => `${names.get(t.to) ?? '?'} ${two(t.amount)}`)
      .join(' and ');
    expect(`you owe ${line}`).toBe('you owe Maya 44.00 and Jordan 8.00');
    expect(myNet(s, NATHAN)).toBe(-5200);
    expect(myNet(s, MAYA)).toBe(4400);
  });

  it('after Nathan pays Jordan 8.00, only Maya is owed', () => {
    const s = reduce(banff(true));
    const ns = nets(s);
    expect(ns.get(JORDAN)).toBe(0);
    expect(ns.get(NATHAN)).toBe(-4400);
    expect(sum(ns)).toBe(0);
    expect(checkSimplify(ns)).toEqual([{ from: NATHAN, to: MAYA, amount: 4400 }]);
  });
});

describe('nets', () => {
  it('includes every member, archived and placeholders, with 0 when idle', () => {
    const ghost = pad('ghost');
    const s = reduce([
      ...banff(false),
      entry(10, { type: 'member.added', member: { id: pad('idle'), name: 'Idle' } }),
      entry(11, { type: 'member.archived', id: JORDAN }),
      entry(12, { type: 'member.claimed', id: pad('nobody') }),
      entry(13, { type: 'payment.added', payment: { id: pad('p'), from: ghost, to: MAYA, amount: 100, currency: 'CAD', date: '2026-02-16' } }),
    ]);
    const ns = nets(s);
    expect(ns.get(pad('idle'))).toBe(0);
    expect(ns.get(pad('nobody'))).toBe(0);
    expect(ns.get(JORDAN)).toBe(800);
    expect(ns.get(ghost)).toBe(100);
    expect(ns.get(MAYA)).toBe(4300);
    expect([...ns.keys()].sort()).toEqual([...s.members.keys()].sort());
    expect(sum(ns)).toBe(0);
    expect(myNet(s, pad('stranger'))).toBe(0);
  });

  it('excludes flagged expenses and payments', () => {
    const s = reduce([
      ...banff(false),
      entry(10, { type: 'expense.added', expense: expense(pad('usd'), { amount: 5000, currency: 'USD', split: { [NATHAN]: 5000 } }) }),
      entry(11, { type: 'expense.added', expense: expense(pad('bad'), { amount: 5000, split: { [NATHAN]: 1 } }) }),
      entry(12, { type: 'payment.added', payment: { id: pad('p'), from: NATHAN, to: MAYA, amount: 100, currency: 'USD', date: '2026-02-16' } }),
    ]);
    expect(s.flagged).toHaveLength(3);
    expect([...nets(s)]).toEqual([...nets(reduce(banff(false)))]);
  });

  it('honours state.flagged as given', () => {
    const s = reduce(banff(true));
    const flaggedState: GroupState = { ...s, flagged: [{ kind: 'expense', id: pad('gas'), reason: 'split_mismatch' }, { kind: 'payment', id: pad('pay'), reason: 'currency_mismatch' }] };
    expect([...nets(flaggedState)]).toEqual([
      [MAYA, 6400],
      [JORDAN, -3200],
      [NATHAN, -3200],
    ]);
  });

  it('throws RangeError when a total leaves the safe-integer range', () => {
    const s = emptyState();
    const [a, b] = [pad('a'), pad('b')];
    for (const id of [a, b]) {
      s.members.set(id, { id, name: id, archived: false, devices: [], unknown: false, color: memberColor(id), initials: 'A' });
    }
    const big = Number.MAX_SAFE_INTEGER;
    for (const id of [pad('e1'), pad('e2')]) {
      const e = expense(id, { currency: '', amount: big, paidBy: a, split: { [b]: big } });
      s.expenses.set(id, { ...e, addedBy: a, addedAt: T0, updatedAt: T0, history: [] });
    }
    expect(() => nets(s)).toThrow(RangeError);
  });

  it('accumulates in BigInt: an intermediate total beyond 2^53 is fine when every final net is safe', () => {
    const s = emptyState();
    const [a, b] = [pad('a'), pad('b')];
    for (const id of [a, b]) {
      s.members.set(id, { id, name: id, archived: false, devices: [], unknown: false, color: memberColor(id), initials: 'A' });
    }
    const big = Number.MAX_SAFE_INTEGER;
    for (const id of [pad('e1'), pad('e2')]) {
      const e = expense(id, { currency: '', amount: big, paidBy: a, split: { [b]: big } });
      s.expenses.set(id, { ...e, addedBy: a, addedAt: T0, updatedAt: T0, history: [] });
    }
    // a is at 2·MAX_SAFE after the expenses (the old Number accumulator threw here); b pays a back one MAX_SAFE.
    s.payments.set(pad('p'), { id: pad('p'), from: b, to: a, amount: big, currency: '', date: '2026-02-16', addedBy: b, addedAt: T0 });
    expect([...nets(s)]).toEqual([
      [a, big],
      [b, -big],
    ]);
  });
});

describe('simplify', () => {
  it('returns nothing when everyone is even', () => {
    expect(simplify(new Map())).toEqual([]);
    expect(simplify(new Map([[MAYA, 0], [JORDAN, 0]]))).toEqual([]);
  });

  it('breaks ties by member id, independent of Map order', () => {
    const ns = new Map([
      ['d2', -100],
      ['c2', 100],
      ['d1', -100],
      ['c1', 100],
    ]);
    const expected = [
      { from: 'd1', to: 'c1', amount: 100 },
      { from: 'd2', to: 'c2', amount: 100 },
    ];
    expect(checkSimplify(ns)).toEqual(expected);
    expect(simplify(new Map([...ns].reverse()))).toEqual(expected);
    expect(simplify(new Map([['y', 100], ['a', -200], ['x', 100]]))).toEqual([
      { from: 'a', to: 'x', amount: 100 },
      { from: 'a', to: 'y', amount: 100 },
    ]);
  });

  it('matches largest debtor with largest creditor and advances on zero', () => {
    const ns = new Map([
      ['a', 700],
      ['b', 300],
      ['c', -600],
      ['d', -400],
    ]);
    expect(checkSimplify(ns)).toEqual([
      { from: 'c', to: 'a', amount: 600 },
      { from: 'd', to: 'a', amount: 100 },
      { from: 'd', to: 'b', amount: 300 },
    ]);
  });

  it('property: ≤ n−1 positive transfers that settle every net, deterministically', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 0, maxLength: 20 }), fc.integer(), (values, seed) => {
        const ns = new Map(values.map((v, i) => [pad(`m${i}`), v] as const));
        ns.set(pad('balancer'), -values.reduce((a, b) => a + b, 0) || 0);
        const transfers = checkSimplify(ns);
        const entries = [...ns];
        const r = ((seed % entries.length) + entries.length) % entries.length;
        const rotated = [...entries.slice(r), ...entries.slice(0, r)];
        if (seed & 1) rotated.reverse();
        expect(simplify(new Map(rotated))).toEqual(transfers);
      }),
      { numRuns: 300 },
    );
  });
});

describe('balances property: random groups', () => {
  const arbGroup = fc.integer({ min: 2, max: 8 }).chain((n) =>
    fc.record({
      n: fc.constant(n),
      expenses: fc.array(
        fc.record({
          payer: fc.integer({ min: 0, max: n - 1 }),
          shares: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 1_000_000_000 })), { minLength: n, maxLength: n }),
          foreign: fc.boolean(),
          deleted: fc.boolean(),
        }),
        { maxLength: 15 },
      ),
      payments: fc.array(
        fc.record({
          from: fc.integer({ min: 0, max: n - 1 }),
          hop: fc.integer({ min: 1, max: n - 1 }),
          amount: fc.integer({ min: 1, max: 1_000_000_000 }),
          foreign: fc.boolean(),
        }),
        { maxLength: 10 },
      ),
    }),
  );

  it('Σ nets = 0, nets match a direct computation, and simplify settles them', () => {
    fc.assert(
      fc.property(arbGroup, ({ n, expenses, payments }) => {
        const ids = Array.from({ length: n }, (_, i) => pad(`m${i}`));
        const id = (i: number): string => ids[i] ?? '';
        const log: LogEntry[] = [entry(1, { type: 'group.created', name: 'G', currency: 'CAD' })];
        let k = 2;
        for (const [i, mid] of ids.entries()) log.push(entry(k++, { type: 'member.added', member: { id: mid, name: `M${i}` } }));
        const expected = new Map(ids.map((m) => [m, 0]));
        const bump = (m: string, d: number): void => {
          expected.set(m, (expected.get(m) ?? 0) + d);
        };

        expenses.forEach((x, i) => {
          const shares = x.shares.every((v) => v === 0) ? [1, ...x.shares.slice(1)] : x.shares;
          const split: Record<string, number> = {};
          shares.forEach((v, j) => {
            if (v > 0) split[id(j)] = v;
          });
          const amount = shares.reduce((a, b) => a + b, 0);
          const eidStr = pad(`e${i}`);
          log.push(
            entry(k++, {
              type: 'expense.added',
              expense: expense(eidStr, { amount, paidBy: id(x.payer), split, currency: x.foreign ? 'USD' : 'CAD' }),
            }),
          );
          if (x.deleted) log.push(entry(k++, { type: 'expense.deleted', id: eidStr }));
          if (!x.foreign && !x.deleted) {
            bump(id(x.payer), amount);
            for (const [m, v] of Object.entries(split)) bump(m, -v);
          }
        });
        payments.forEach((p, i) => {
          const to = (p.from + p.hop) % n;
          log.push(
            entry(k++, {
              type: 'payment.added',
              payment: { id: pad(`p${i}`), from: id(p.from), to: id(to), amount: p.amount, currency: p.foreign ? 'USD' : 'CAD', date: '2026-02-16' },
            }),
          );
          if (!p.foreign) {
            bump(id(p.from), p.amount);
            bump(id(to), -p.amount);
          }
        });

        const ns = nets(reduce(log));
        expect(sum(ns)).toBe(0);
        expect(ns).toEqual(expected);
        checkSimplify(ns);
      }),
      { numRuns: 300 },
    );
  });
});
