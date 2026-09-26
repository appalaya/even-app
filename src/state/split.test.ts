import { isValidSplit, LIMITS, newId, splitEqual } from '@even/core';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isStateError } from './errors';
import { resolveSplit, sameSplit, splitMemberIds, type SplitSpec } from './split';

const [a, b, c, d] = [newId(), newId(), newId(), newId()] as const;
const seed = newId();

function invalid(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(isStateError(thrown, 'invalid_split')).toBe(true);
}

describe('resolveSplit', () => {
  it('equal: floor per member, the leftover spread one unit each, summing to the amount', () => {
    const split = resolveSplit(1000, { mode: 'equal', members: [a, b, c] }, seed);
    expect(isValidSplit(1000, split)).toBe(true);
    expect(Object.keys(split).sort()).toEqual([a, b, c].sort());
    expect(Object.values(split).sort()).toEqual([333, 333, 334]);
    // Identical to core's splitEqual: the app adds nothing to the rounding rule.
    expect(split).toEqual(splitEqual(1000, [a, b, c], seed));
  });

  it('equal: weights are multipliers and extras come off the top', () => {
    const split = resolveSplit(
      1100,
      { mode: 'equal', members: [a, b], weights: { [a]: 2 }, extras: { [b]: 200 } },
      seed,
    );
    // 1100 − 200 = 900 split 2:1 → a 600, b 300 + 200.
    expect(split).toEqual({ [a]: 600, [b]: 500 });
  });

  it('equal: a weight of 0 with an extra pays exactly the extra', () => {
    const split = resolveSplit(
      1000,
      { mode: 'equal', members: [a, b], weights: { [b]: 0 }, extras: { [b]: 100 } },
      seed,
    );
    expect(split).toEqual({ [a]: 900, [b]: 100 });
  });

  it('equal: refuses no members, duplicates, and weights or extras for members outside the split', () => {
    invalid(() => resolveSplit(100, { mode: 'equal', members: [] }, seed));
    invalid(() => resolveSplit(100, { mode: 'equal', members: [a, a] }, seed));
    invalid(() => resolveSplit(100, { mode: 'equal', members: [a], weights: { [b]: 1 } }, seed));
    invalid(() => resolveSplit(100, { mode: 'equal', members: [a], extras: { [b]: 1 } }, seed));
    invalid(() =>
      resolveSplit(100, { mode: 'equal', members: [a, b], extras: { [a]: 101 } }, seed),
    );
    invalid(() => resolveSplit(100, { mode: 'equal', members: [a], weights: { [a]: 1.5 } }, seed));
    invalid(() =>
      resolveSplit(100, { mode: 'equal', members: [a, b], weights: { [a]: 0, [b]: 0 } }, seed),
    );
  });

  it('exact: taken as given when it sums to the amount', () => {
    expect(resolveSplit(1000, { mode: 'exact', amounts: { [a]: 250, [b]: 750 } }, seed)).toEqual({
      [a]: 250,
      [b]: 750,
    });
    invalid(() => resolveSplit(1000, { mode: 'exact', amounts: { [a]: 250, [b]: 700 } }, seed));
    invalid(() => resolveSplit(1000, { mode: 'exact', amounts: {} }, seed));
    invalid(() => resolveSplit(1000, { mode: 'exact', amounts: { [a]: -1, [b]: 1001 } }, seed));
  });

  it('percent: basis points, remainder only to members above 0%', () => {
    const split = resolveSplit(
      1001,
      { mode: 'percent', bps: { [a]: 5000, [b]: 5000, [c]: 0 } },
      seed,
    );
    expect(isValidSplit(1001, split)).toBe(true);
    expect(split[c]).toBe(0);
    invalid(() => resolveSplit(1000, { mode: 'percent', bps: { [a]: 5000, [b]: 4000 } }, seed));
    invalid(() => resolveSplit(1000, { mode: 'percent', bps: { [a]: 10001 } }, seed));
  });

  it('refuses an amount out of range and more than LIMITS.membersMax members', () => {
    invalid(() => resolveSplit(0, { mode: 'equal', members: [a] }, seed));
    invalid(() => resolveSplit(LIMITS.amountMax + 1, { mode: 'equal', members: [a] }, seed));
    invalid(() => resolveSplit(1.5, { mode: 'equal', members: [a] }, seed));
    const many = Array.from({ length: LIMITS.membersMax + 1 }, () => newId());
    invalid(() => resolveSplit(10_000, { mode: 'equal', members: many }, seed));
  });

  it('the seed moves the leftover unit: different expenses, different recipients', () => {
    const winners = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const split = resolveSplit(100, { mode: 'equal', members: [a, b, c] }, newId());
      for (const [id, v] of Object.entries(split)) if (v === 34) winners.add(id);
    }
    expect(winners.size).toBeGreaterThan(1);
  });

  it('property: any spec either resolves to a valid split of the amount over its own members or is refused', () => {
    const ids = [a, b, c, d];
    const members = fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 4 });
    const spec: fc.Arbitrary<SplitSpec> = fc.oneof(
      members.chain((m) =>
        fc.record({
          mode: fc.constant('equal' as const),
          members: fc.constant(m),
          weights: fc.dictionary(fc.constantFrom(...m), fc.integer({ min: 0, max: 5 })),
          extras: fc.dictionary(fc.constantFrom(...m), fc.integer({ min: 0, max: 5_000 })),
        }),
      ),
      members.chain((m) =>
        fc.record({
          mode: fc.constant('exact' as const),
          amounts: fc.dictionary(fc.constantFrom(...m), fc.integer({ min: 0, max: 20_000 })),
        }),
      ),
      members.chain((m) =>
        fc.record({
          mode: fc.constant('percent' as const),
          bps: fc.dictionary(fc.constantFrom(...m), fc.integer({ min: 0, max: 10_000 })),
        }),
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: LIMITS.amountMax }),
        spec,
        fc.string(),
        (amount, s, sd) => {
          let split: Record<string, number>;
          try {
            split = resolveSplit(amount, s, sd);
          } catch (error) {
            expect(isStateError(error, 'invalid_split')).toBe(true);
            return;
          }
          expect(isValidSplit(amount, split)).toBe(true);
          for (const id of Object.keys(split)) expect(splitMemberIds(s)).toContain(id);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('property: equal over any member set always resolves', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: LIMITS.amountMax }),
        fc.uniqueArray(fc.constantFrom(a, b, c, d), { minLength: 1 }),
        (amount, m) => {
          expect(
            isValidSplit(amount, resolveSplit(amount, { mode: 'equal', members: m }, seed)),
          ).toBe(true);
        },
      ),
    );
  });
});

describe('sameSplit', () => {
  it('compares keys and values in any order', () => {
    expect(sameSplit({ [a]: 1, [b]: 2 }, { [b]: 2, [a]: 1 })).toBe(true);
    expect(sameSplit({ [a]: 1 }, { [a]: 1, [b]: 0 })).toBe(false);
    expect(sameSplit({ [a]: 1 }, { [a]: 2 })).toBe(false);
    expect(sameSplit({ [a]: 1 }, { [b]: 1 })).toBe(false);
  });
});
