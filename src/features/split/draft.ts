/**
 * The Split editor's working state and its conversion to the state layer's `SplitSpec` (design.md "Split",
 * "Rounding", "Splits are stored resolved"). Pure: no React, so the rules run under Vitest.
 *
 * One draft carries all three modes at once, so switching Equal · Exact · Percent never loses what was typed:
 * - Equal: included members, a ×n multiplier each (default 1) and an optional extra each (minor units). Extras come
 *   off the top; the rest splits by share (`splitWeighted` through `resolveSplit`).
 * - Exact: minor units per included member; Done turns on when the remaining amount reaches zero.
 * - Percent: basis points per included member (whole percentages type as 100 bp steps; the keypad's point allows
 *   hundredths); Done turns on when the remaining percentage reaches 0%.
 * Excluded members stay listed ("Not included") and keep what was typed for them.
 */
import { formatMinor, LIMITS } from '@even/core';

import { resolveSplit, sameSplit, type SplitSpec } from '@/state/split';

export type SplitMode = 'equal' | 'exact' | 'percent';

export interface SplitDraft {
  mode: SplitMode;
  /** Everyone the editor lists, in display order (you first). Archived members on an edited expense stay here. */
  members: readonly string[];
  included: Readonly<Record<string, boolean>>;
  /** Equal: the ×n multiplier; absent means 1. */
  weights: Readonly<Record<string, number>>;
  /** Equal: the amount on top, minor units; absent means 0. */
  extras: Readonly<Record<string, number>>;
  /** Exact: minor units; absent means 0. */
  amounts: Readonly<Record<string, number>>;
  /** Percent: basis points (100 = 1%); absent means 0. */
  bps: Readonly<Record<string, number>>;
}

export const BPS_TOTAL = 10_000;
/** The most shares one member can take in Equal mode. */
export const MAX_WEIGHT = 99;

const valueOf = (table: Readonly<Record<string, number>>, id: string, fallback: number): number =>
  Object.prototype.hasOwnProperty.call(table, id) ? (table[id] ?? fallback) : fallback;

export const weightOf = (d: SplitDraft, id: string): number => valueOf(d.weights, id, 1);
export const extraOf = (d: SplitDraft, id: string): number => valueOf(d.extras, id, 0);
export const amountOf = (d: SplitDraft, id: string): number => valueOf(d.amounts, id, 0);
export const bpsOf = (d: SplitDraft, id: string): number => valueOf(d.bps, id, 0);

/** "Everyone, equally": each of `members` in, one share each, no extras. */
export function equalDraft(members: readonly string[], included?: readonly string[]): SplitDraft {
  const on = new Set(included ?? members);
  return {
    mode: 'equal',
    members: [...members],
    included: Object.fromEntries(members.map((id) => [id, on.has(id)])),
    weights: {},
    extras: {},
    amounts: {},
    bps: {},
  };
}

export function includedIds(d: SplitDraft): string[] {
  return d.members.filter((id) => d.included[id] === true);
}

export function isIncluded(d: SplitDraft, id: string): boolean {
  return d.included[id] === true;
}

function sumOver(d: SplitDraft, of: (d: SplitDraft, id: string) => number): number {
  return includedIds(d).reduce((sum, id) => sum + of(d, id), 0);
}

export function toggleMember(d: SplitDraft, id: string): SplitDraft {
  if (!d.members.includes(id)) return d;
  return { ...d, included: { ...d.included, [id]: !isIncluded(d, id) } };
}

export function setWeight(d: SplitDraft, id: string, weight: number): SplitDraft {
  const w = Math.max(0, Math.min(MAX_WEIGHT, Math.trunc(weight)));
  return { ...d, weights: { ...d.weights, [id]: w } };
}

export function setExtra(d: SplitDraft, id: string, minor: number): SplitDraft {
  return { ...d, extras: { ...d.extras, [id]: Math.max(0, Math.trunc(minor)) } };
}

export function setAmount(d: SplitDraft, id: string, minor: number): SplitDraft {
  return { ...d, amounts: { ...d.amounts, [id]: Math.max(0, Math.trunc(minor)) } };
}

export function setBps(d: SplitDraft, id: string, bp: number): SplitDraft {
  return { ...d, bps: { ...d.bps, [id]: Math.max(0, Math.min(BPS_TOTAL, Math.trunc(bp))) } };
}

/**
 * Switches mode. Entering Exact or Percent with nothing typed for the included members starts from the current
 * split (the Equal result in minor units, or equal percentages), so the remaining amount starts at zero.
 */
export function switchMode(
  d: SplitDraft,
  mode: SplitMode,
  amount: number,
  seed: string,
): SplitDraft {
  if (mode === d.mode) return d;
  const ids = includedIds(d);
  if (mode === 'exact' && ids.length > 0 && sumOver(d, amountOf) === 0) {
    const current = previewAmounts(d, amount, seed);
    return { ...d, mode, amounts: { ...d.amounts, ...current } };
  }
  if (mode === 'percent' && ids.length > 0 && sumOver(d, bpsOf) === 0) {
    const base = Math.floor(BPS_TOTAL / ids.length);
    const left = BPS_TOTAL - base * ids.length;
    const bps = Object.fromEntries(ids.map((id, i) => [id, base + (i < left ? 1 : 0)]));
    return { ...d, mode, bps: { ...d.bps, ...bps } };
  }
  return { ...d, mode };
}

/**
 * What is left to assign: Exact, minor units (amount − Σ included amounts); Percent, basis points (10,000 − Σ);
 * Equal, the part that splits by share (amount − Σ extras). Negative when over-assigned.
 */
export function remaining(d: SplitDraft, amount: number): number {
  switch (d.mode) {
    case 'exact':
      return amount - sumOver(d, amountOf);
    case 'percent':
      return BPS_TOTAL - sumOver(d, bpsOf);
    case 'equal':
      return amount - sumOver(d, extraOf);
  }
}

export type SplitProblem =
  /** Nobody is included. */
  | 'no_members'
  /** Exact or Percent does not add up yet. */
  | 'remaining'
  /** Equal: the extras are more than the amount. */
  | 'extras_exceed'
  /** Equal: every share is ×0 and the extras do not cover the amount. */
  | 'no_shares'
  /** The amount itself is out of range (zero before anything is typed). */
  | 'amount';

export type SpecResult = { ok: true; spec: SplitSpec } | { ok: false; problem: SplitProblem };

/**
 * The spec for `amount`, naming only included members (in display order). Equal mode lists only multipliers other
 * than 1 and extras above 0, so "Everyone, equally" is exactly `{ mode: 'equal', members }`.
 */
export function draftToSpec(d: SplitDraft, amount: number): SpecResult {
  const ids = includedIds(d);
  if (ids.length === 0) return { ok: false, problem: 'no_members' };
  if (ids.length > LIMITS.membersMax) return { ok: false, problem: 'no_members' };
  if (!Number.isSafeInteger(amount) || amount < LIMITS.amountMin || amount > LIMITS.amountMax) {
    return { ok: false, problem: 'amount' };
  }
  switch (d.mode) {
    case 'equal': {
      const weights: Record<string, number> = {};
      const extras: Record<string, number> = {};
      let weightSum = 0;
      let extraSum = 0;
      for (const id of ids) {
        const w = weightOf(d, id);
        const x = extraOf(d, id);
        if (w !== 1) weights[id] = w;
        if (x > 0) extras[id] = x;
        weightSum += w;
        extraSum += x;
      }
      if (extraSum > amount) return { ok: false, problem: 'extras_exceed' };
      if (weightSum === 0 && extraSum !== amount) return { ok: false, problem: 'no_shares' };
      const spec: SplitSpec = {
        mode: 'equal',
        members: ids,
        ...(Object.keys(weights).length > 0 ? { weights } : {}),
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
      };
      return { ok: true, spec };
    }
    case 'exact':
      if (remaining(d, amount) !== 0) return { ok: false, problem: 'remaining' };
      return {
        ok: true,
        spec: {
          mode: 'exact',
          amounts: Object.fromEntries(ids.map((id) => [id, amountOf(d, id)])),
        },
      };
    case 'percent':
      if (remaining(d, amount) !== 0) return { ok: false, problem: 'remaining' };
      return {
        ok: true,
        spec: { mode: 'percent', bps: Object.fromEntries(ids.map((id) => [id, bpsOf(d, id)])) },
      };
  }
}

/**
 * Each included member's share for display. A valid draft resolves exactly as Save will (for a new expense the
 * leftover unit of an uneven split may land on someone else, since Save seeds with the new expense id). An
 * unbalanced draft shows what each would owe as typed: Exact the amounts, Percent floor(amount × bp / 10,000),
 * Equal the extras alone.
 */
export function previewAmounts(
  d: SplitDraft,
  amount: number,
  seed: string,
): Record<string, number> {
  const ids = includedIds(d);
  const result = draftToSpec(d, amount);
  if (result.ok) {
    try {
      return resolveSplit(amount, result.spec, seed);
    } catch {
      // fall through to the as-typed view
    }
  }
  const safe = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
  switch (d.mode) {
    case 'exact':
      return Object.fromEntries(ids.map((id) => [id, amountOf(d, id)]));
    case 'percent':
      return Object.fromEntries(
        ids.map((id) => [id, Number((BigInt(safe) * BigInt(bpsOf(d, id))) / BigInt(BPS_TOTAL))]),
      );
    case 'equal':
      return Object.fromEntries(ids.map((id) => [id, extraOf(d, id)]));
  }
}

/**
 * The editor state for a stored (resolved) split. The rule that produced a split is not stored, so this recovers
 * the one case that matters: if the split is what "equally among its members" resolves to for this expense, the
 * editor opens on Equal; otherwise it opens on Exact with the stored amounts. `members` is the editor's list (you
 * first); anyone in the split but missing from it is appended, so an archived member on the expense stays visible.
 */
export function draftFromResolved(
  amount: number,
  split: Readonly<Record<string, number>>,
  members: readonly string[],
  seed: string,
): SplitDraft {
  const inSplit = Object.keys(split);
  const listed = [...members, ...inSplit.filter((id) => !members.includes(id))];
  const ids = listed.filter((id) => inSplit.includes(id));
  const equal = equalDraft(listed, ids);
  try {
    if (sameSplit(resolveSplit(amount, { mode: 'equal', members: ids }, seed), split)) return equal;
  } catch {
    // not an equal split
  }
  return { ...equal, mode: 'exact', amounts: { ...split } };
}

/** "Everyone, equally": Equal mode, every listed active member in, one share each, no extras. */
export function isEveryoneEqually(d: SplitDraft, activeMembers: readonly string[]): boolean {
  if (d.mode !== 'equal') return false;
  const ids = includedIds(d);
  if (ids.length !== activeMembers.length || !activeMembers.every((id) => isIncluded(d, id))) {
    return false;
  }
  return ids.every((id) => weightOf(d, id) === 1 && extraOf(d, id) === 0);
}

export interface SplitSummary {
  /** "Everyone, equally". */
  label: string;
  /** "$9.00 each", or null when there is no single per-person figure. */
  detail: string | null;
}

/** How many named differences the Split row spells out before "+ N more" (Split, extra states). */
const NAMED_DIFFERENCES = 2;

/**
 * The Split row on Add expense, worded as the Split, extra states board lists it:
 * - Equal, everyone in: "Everyone, equally" · "$9.00 each";
 * - Equal, someone left out: "3 of 4, equally" · "$12.00 each";
 * - Equal with shares or extras: who differs, two at most, then "+ 2 more" ("Maya ×2, Nathan +$12.00"), with
 *   "3 of 4 · " in front when someone is also left out; no per-person figure;
 * - Exact: "Exact amounts"; Percent: "By percent".
 * `nameOf` words a member as the sheet does ("You", "Maya").
 */
export function summarize(
  d: SplitDraft,
  amount: number,
  currency: string,
  activeMembers: readonly string[],
  {
    nameOf = (id: string) => id,
    locale,
  }: { nameOf?: (memberId: string) => string; locale?: string } = {},
): SplitSummary {
  const ids = includedIds(d);
  const each = (): string | null =>
    ids.length === 0 || amount <= 0
      ? null
      : `${formatMinor(Math.floor(Math.max(0, amount) / ids.length), currency, locale)} each`;
  if (d.mode === 'exact') return { label: 'Exact amounts', detail: null };
  if (d.mode === 'percent') return { label: 'By percent', detail: null };
  const everyone = isEveryoneIncluded(d, activeMembers);
  const of = `${ids.length} of ${Math.max(activeMembers.length, ids.length)}`;
  const differs = ids.filter((id) => weightOf(d, id) !== 1 || extraOf(d, id) > 0);
  if (differs.length === 0) {
    return { label: everyone ? 'Everyone, equally' : `${of}, equally`, detail: each() };
  }
  const named = differs.slice(0, NAMED_DIFFERENCES).map((id) => {
    const parts = [nameOf(id)];
    if (weightOf(d, id) !== 1) parts.push(`×${weightOf(d, id)}`);
    if (extraOf(d, id) > 0) parts.push(`+${formatMinor(extraOf(d, id), currency, locale)}`);
    return parts.join(' ');
  });
  const more = differs.length - named.length;
  const list = `${named.join(', ')}${more > 0 ? ` + ${more} more` : ''}`;
  return { label: everyone ? list : `${of} · ${list}`, detail: null };
}

/** Every listed active member is included (whatever their shares). */
function isEveryoneIncluded(d: SplitDraft, activeMembers: readonly string[]): boolean {
  const ids = includedIds(d);
  return ids.length === activeMembers.length && activeMembers.every((id) => isIncluded(d, id));
}

/**
 * The line under Equal's total: "$12.00 in extras first, then $84.00 split 2 : 1 : 1 : 1." (as drawn, largest share
 * first), or without extras "$96.00 split 1 : 1 : 1 : 1.".
 */
export function sharesLine(
  d: SplitDraft,
  amount: number,
  currency: string,
  locale?: string,
): string {
  const ids = includedIds(d);
  const extras = sumOver(d, extraOf);
  // Largest share first, as the board writes it ("split 2 : 1 : 1 : 1" with the ×2 member listed second).
  const ratio = ids
    .map((id) => weightOf(d, id))
    .sort((a, b) => b - a)
    .join(' : ');
  const rest = formatMinor(Math.max(0, amount - extras), currency, locale);
  if (extras > 0) {
    return `${formatMinor(extras, currency, locale)} in extras first, then ${rest} split ${ratio}.`;
  }
  return `${rest} split ${ratio}.`;
}

/** The "+ extra" field's placeholder (SplitEqual), shown while it holds nothing. */
export const EXTRA_PLACEHOLDER = '+ extra';

/**
 * What the "+ extra" field shows: while focused, the text as typed; otherwise "+$12.00" once it holds an amount, or ''
 * (the placeholder shows). The whole string is drawn: the field is 72 wide and grows to fit it.
 */
export function extraText(
  extra: number,
  currency: string,
  editing: string | null,
  locale?: string,
): string {
  if (editing !== null) return editing;
  return extra > 0 ? `+${formatMinor(extra, currency, locale)}` : '';
}

/** A percentage in basis points as the cell shows it: 1500 → "15%", 3333 → "33.33%", 1250 → "12.5%". */
export function formatBps(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = String(Math.abs(bp % 100))
    .padStart(2, '0')
    .replace(/0+$/, '');
  const sign = bp < 0 && whole === 0 ? '-' : '';
  return fraction === '' ? `${sign}${whole}%` : `${sign}${whole}.${fraction}%`;
}
