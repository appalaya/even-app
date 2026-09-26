/**
 * The split editor's three modes (design.md "Split", "Rounding"), resolved through core into the stored split:
 * member id → minor units, summing to the amount. Splits are stored resolved, so the reducer never learns which mode
 * produced them. Pure.
 */
import {
  isValidSplit,
  LIMITS,
  splitByBasisPoints,
  splitWeighted,
  type WeightedShare,
} from '@even/core';

import { StateError } from './errors';

/**
 * What the split editor produces.
 * - `equal`: "Everyone, equally", with an optional per-member multiplier (`weights`, default 1; Splitwise's shares)
 *   and an optional amount on top (`extras`, minor units, default 0; its adjustments). Extras come off the top and
 *   the rest splits by weight. `weights` and `extras` may only name ids in `members`.
 * - `exact`: minor units per member, which must sum to the amount.
 * - `percent`: integer basis points per member (100 bp = 1%), which must sum to 10,000.
 */
export type SplitSpec =
  | {
      mode: 'equal';
      members: readonly string[];
      weights?: Readonly<Record<string, number>>;
      extras?: Readonly<Record<string, number>>;
    }
  | { mode: 'exact'; amounts: Readonly<Record<string, number>> }
  | { mode: 'percent'; bps: Readonly<Record<string, number>> };

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function fail(message: string): never {
  throw new StateError('invalid_split', message);
}

/** The member ids a spec names, in the order given. */
export function splitMemberIds(spec: SplitSpec): string[] {
  switch (spec.mode) {
    case 'equal':
      return [...spec.members];
    case 'exact':
      return Object.keys(spec.amounts);
    case 'percent':
      return Object.keys(spec.bps);
  }
}

function resolveEqual(
  amount: number,
  spec: Extract<SplitSpec, { mode: 'equal' }>,
  seed: string,
): Record<string, number> {
  const members = spec.members;
  if (members.length === 0) fail('choose at least one member');
  if (new Set(members).size !== members.length) fail('a member is listed twice');
  const inSplit = new Set(members);
  for (const [what, table] of [
    ['weight', spec.weights],
    ['extra', spec.extras],
  ] as const) {
    if (table === undefined) continue;
    for (const id of Object.keys(table)) {
      if (!inSplit.has(id)) fail(`a ${what} names a member who is not in the split`);
    }
  }
  const shares: Record<string, WeightedShare> = Object.fromEntries(
    members.map((id) => {
      const weight = spec.weights !== undefined && hasOwn(spec.weights, id) ? spec.weights[id] : 1;
      const extra = spec.extras !== undefined && hasOwn(spec.extras, id) ? spec.extras[id] : 0;
      return [id, { weight: weight ?? 1, extra: extra ?? 0 }];
    }),
  );
  try {
    return splitWeighted(amount, shares, seed);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'the shares do not split this amount');
  }
}

/**
 * Resolves a spec for `amount` (minor units). `seed` is the expense id, so the leftover unit of an uneven split
 * moves with the expense rather than always landing on the same person. Throws `StateError('invalid_split')`
 * unless the result is a valid split (non-empty, non-negative safe integers, summing to `amount`) of at most
 * LIMITS.membersMax members.
 */
export function resolveSplit(
  amount: number,
  spec: SplitSpec,
  seed: string,
): Record<string, number> {
  if (!Number.isSafeInteger(amount) || amount < LIMITS.amountMin || amount > LIMITS.amountMax) {
    fail('the amount is out of range');
  }
  let split: Record<string, number>;
  switch (spec.mode) {
    case 'equal':
      split = resolveEqual(amount, spec, seed);
      break;
    case 'exact':
      if (!isValidSplit(amount, spec.amounts)) fail('the amounts must add up to the total');
      split = Object.fromEntries(Object.entries(spec.amounts));
      break;
    case 'percent':
      try {
        split = splitByBasisPoints(amount, spec.bps, seed);
      } catch (error) {
        fail(error instanceof Error ? error.message : 'the percentages must add up to 100%');
      }
      break;
    default: {
      const unknown: never = spec;
      void unknown;
      fail('unknown split mode');
    }
  }
  if (Object.keys(split).length > LIMITS.membersMax) fail(`at most ${LIMITS.membersMax} members`);
  if (!isValidSplit(amount, split)) fail('the split does not add up to the total');
  return split;
}

/** Same keys and values, in any order. */
export function sameSplit(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const ae = Object.entries(a);
  if (ae.length !== Object.keys(b).length) return false;
  return ae.every(([id, v]) => hasOwn(b, id) && b[id] === v);
}
