import { describe, expect, it } from 'vitest';

import { resolveSplit } from '@/state/split';

import {
  draftFromResolved,
  draftToSpec,
  equalDraft,
  EXTRA_PLACEHOLDER,
  extraText,
  formatBps,
  isEveryoneEqually,
  previewAmounts,
  remaining,
  setAmount,
  setBps,
  setExtra,
  setWeight,
  sharesLine,
  summarize,
  switchMode,
  toggleMember,
} from './draft';

const [YOU, MAYA, JORDAN, NATHAN] = ['you', 'maya', 'jordan', 'nathan'];
const ALL = [YOU, MAYA, JORDAN, NATHAN];
const SEED = 'expense-id';

describe('split draft → spec', () => {
  it('"Everyone, equally" is exactly an equal spec over every member', () => {
    const d = equalDraft(ALL);
    expect(draftToSpec(d, 3600)).toEqual({ ok: true, spec: { mode: 'equal', members: ALL } });
    expect(isEveryoneEqually(d, ALL)).toBe(true);
    expect(summarize(d, 3600, 'CAD', ALL, { locale: 'en-US' })).toEqual({
      label: 'Everyone, equally',
      detail: '$9.00 each',
    });
  });

  it('Equal with a multiplier and an extra (SplitEqual board): extras off the top, the rest by share', () => {
    let d = equalDraft(ALL);
    d = setWeight(d, MAYA, 2);
    d = setExtra(d, NATHAN, 1200);
    const result = draftToSpec(d, 9600);
    expect(result).toEqual({
      ok: true,
      spec: { mode: 'equal', members: ALL, weights: { [MAYA]: 2 }, extras: { [NATHAN]: 1200 } },
    });
    expect(previewAmounts(d, 9600, SEED)).toEqual({
      [YOU]: 1680,
      [MAYA]: 3360,
      [JORDAN]: 1680,
      [NATHAN]: 2880,
    });
    expect(sharesLine(d, 9600, 'CAD', 'en-US')).toBe(
      '$12.00 in extras first, then $84.00 split 2 : 1 : 1 : 1.',
    );
    const names: Record<string, string> = {
      you: 'You',
      maya: 'Maya',
      jordan: 'Jordan',
      nathan: 'Nathan',
    };
    const nameOf = (id: string) => names[id] ?? id;
    // Split, extra states: "Maya ×2, Nathan +$12.00", no per-person figure.
    expect(summarize(d, 9600, 'CAD', ALL, { nameOf, locale: 'en-US' })).toEqual({
      label: 'Maya ×2, Nathan +$12.00',
      detail: null,
    });
    // Two named at most, then "+ N more"; "3 of 4 · " in front when someone is also left out.
    const more = setWeight(setExtra(d, JORDAN, 300), YOU, 3);
    expect(summarize(more, 9600, 'CAD', ALL, { nameOf, locale: 'en-US' }).label).toBe(
      'You ×3, Maya ×2 + 2 more',
    );
    expect(
      summarize(toggleMember(d, JORDAN), 9600, 'CAD', ALL, { nameOf, locale: 'en-US' }).label,
    ).toBe('3 of 4 · Maya ×2, Nathan +$12.00');
  });

  it('writes the ratio largest share first, as the board does', () => {
    const d = setWeight(setWeight(equalDraft(ALL), JORDAN, 3), MAYA, 2);
    expect(sharesLine(d, 8400, 'CAD', 'en-US')).toBe('$84.00 split 3 : 2 : 1 : 1.');
  });

  it('Equal refuses extras above the amount, and all-zero shares unless extras cover it', () => {
    expect(draftToSpec(setExtra(equalDraft([YOU]), YOU, 5000), 3600)).toEqual({
      ok: false,
      problem: 'extras_exceed',
    });
    let d = setWeight(setWeight(equalDraft([YOU, MAYA]), YOU, 0), MAYA, 0);
    expect(draftToSpec(d, 3600)).toEqual({ ok: false, problem: 'no_shares' });
    d = setExtra(setExtra(d, YOU, 1000), MAYA, 2600);
    expect(draftToSpec(d, 3600).ok).toBe(true);
  });

  it('Exact (Split board): Remaining $6.00 until the amounts add up; excluded members drop out', () => {
    let d = toggleMember(equalDraft(ALL), NATHAN);
    d = switchMode(d, 'exact', 3600, SEED);
    // Entering Exact starts from the current split, so it adds up at once.
    expect(remaining(d, 3600)).toBe(0);
    d = setAmount(setAmount(setAmount(d, YOU, 1200), MAYA, 1200), JORDAN, 600);
    expect(remaining(d, 3600)).toBe(600);
    expect(draftToSpec(d, 3600)).toEqual({ ok: false, problem: 'remaining' });
    d = setAmount(d, JORDAN, 1200);
    expect(draftToSpec(d, 3600)).toEqual({
      ok: true,
      spec: { mode: 'exact', amounts: { [YOU]: 1200, [MAYA]: 1200, [JORDAN]: 1200 } },
    });
    // What was typed for an excluded member is kept but never counted.
    d = setAmount(d, NATHAN, 999);
    expect(remaining(d, 3600)).toBe(0);
  });

  it('Percent (SplitPercent board): basis points, Remaining 0%', () => {
    let d = switchMode(equalDraft(ALL), 'percent', 9600, SEED);
    expect(remaining(d, 9600)).toBe(0);
    d = setBps(setBps(setBps(setBps(d, YOU, 1500), MAYA, 4000), JORDAN, 1500), NATHAN, 3000);
    expect(remaining(d, 9600)).toBe(0);
    const result = draftToSpec(d, 9600);
    expect(result).toEqual({
      ok: true,
      spec: { mode: 'percent', bps: { [YOU]: 1500, [MAYA]: 4000, [JORDAN]: 1500, [NATHAN]: 3000 } },
    });
    expect(previewAmounts(d, 9600, SEED)).toEqual({
      [YOU]: 1440,
      [MAYA]: 3840,
      [JORDAN]: 1440,
      [NATHAN]: 2880,
    });
    d = setBps(d, MAYA, 3500);
    expect(remaining(d, 9600)).toBe(500);
    expect(draftToSpec(d, 9600)).toEqual({ ok: false, problem: 'remaining' });
    // Unbalanced: each shows floor(amount × bp / 10 000).
    expect(previewAmounts(d, 9600, SEED)[MAYA]).toBe(3360);
  });

  it('equal percentages start from floor(10000 / n) with the leftover points first', () => {
    const d = switchMode(equalDraft([YOU, MAYA, JORDAN]), 'percent', 10000, SEED);
    expect([d.bps[YOU], d.bps[MAYA], d.bps[JORDAN]]).toEqual([3334, 3333, 3333]);
  });

  it('every valid spec resolves through the state layer to a split that sums to the amount', () => {
    const drafts = [
      equalDraft(ALL),
      setExtra(setWeight(equalDraft(ALL), JORDAN, 3), YOU, 7),
      switchMode(toggleMember(equalDraft(ALL), MAYA), 'exact', 10001, SEED),
      switchMode(equalDraft(ALL), 'percent', 10001, SEED),
    ];
    for (const d of drafts) {
      const result = draftToSpec(d, 10001);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const split = resolveSplit(10001, result.spec, SEED);
      expect(Object.values(split).reduce((a, b) => a + b, 0)).toBe(10001);
    }
  });

  it('refuses an empty split and a zero amount', () => {
    let d = equalDraft([YOU]);
    d = toggleMember(d, YOU);
    expect(draftToSpec(d, 3600)).toEqual({ ok: false, problem: 'no_members' });
    expect(draftToSpec(equalDraft([YOU]), 0)).toEqual({ ok: false, problem: 'amount' });
  });

  it('switching modes keeps what was typed in each', () => {
    let d = setWeight(equalDraft(ALL), MAYA, 2);
    d = switchMode(d, 'exact', 3600, SEED);
    d = setAmount(d, YOU, 3600);
    d = switchMode(d, 'equal', 3600, SEED);
    expect(d.weights[MAYA]).toBe(2);
    d = switchMode(d, 'exact', 3600, SEED);
    expect(d.amounts[YOU]).toBe(3600);
  });

  it('clamps multipliers to 0…99 and never goes negative', () => {
    expect(setWeight(equalDraft(ALL), YOU, -1).weights[YOU]).toBe(0);
    expect(setWeight(equalDraft(ALL), YOU, 120).weights[YOU]).toBe(99);
    expect(setExtra(equalDraft(ALL), YOU, -5).extras[YOU]).toBe(0);
  });
});

describe('stored split → draft', () => {
  it('opens an equal split on Equal with its members', () => {
    const split = resolveSplit(1000, { mode: 'equal', members: [YOU, MAYA, JORDAN] }, SEED);
    const d = draftFromResolved(1000, split, ALL, SEED);
    expect(d.mode).toBe('equal');
    expect(d.included).toEqual({ [YOU]: true, [MAYA]: true, [JORDAN]: true, [NATHAN]: false });
    expect(draftToSpec(d, 1000)).toEqual({
      ok: true,
      spec: { mode: 'equal', members: [YOU, MAYA, JORDAN] },
    });
  });

  it('opens anything else on Exact with the stored amounts, and round-trips', () => {
    const split = { [YOU]: 700, [MAYA]: 300 };
    const d = draftFromResolved(1000, split, ALL, SEED);
    expect(d.mode).toBe('exact');
    const result = draftToSpec(d, 1000);
    expect(result.ok && resolveSplit(1000, result.spec, SEED)).toEqual(split);
  });

  it('keeps an archived member who is on the expense visible', () => {
    const split = { [YOU]: 500, archived: 500 };
    const d = draftFromResolved(1000, split, [YOU, MAYA], SEED);
    expect(d.members).toEqual([YOU, MAYA, 'archived']);
    expect(d.included.archived).toBe(true);
  });
});

describe('labels', () => {
  it('summarises a subset, exact and percent splits', () => {
    const subset = toggleMember(equalDraft(ALL), NATHAN);
    // Split, extra states: "3 of 4, equally · $12.00 each".
    expect(summarize(subset, 3600, 'CAD', ALL, { locale: 'en-US' })).toEqual({
      label: '3 of 4, equally',
      detail: '$12.00 each',
    });
    expect(
      summarize(switchMode(subset, 'exact', 3600, SEED), 3600, 'CAD', ALL, { locale: 'en-US' })
        .label,
    ).toBe('Exact amounts');
    expect(
      summarize(switchMode(subset, 'percent', 3600, SEED), 3600, 'CAD', ALL, { locale: 'en-US' })
        .label,
    ).toBe('By percent');
  });

  it('formats basis points as the cell shows them', () => {
    expect(formatBps(1500)).toBe('15%');
    expect(formatBps(3333)).toBe('33.33%');
    expect(formatBps(1250)).toBe('12.5%');
    expect(formatBps(0)).toBe('0%');
    expect(formatBps(-500)).toBe('-5%');
  });
});

describe('the "+ extra" field', () => {
  // The field shows this whole string and grows to fit it (72 wide at least). At 72 fixed, bold "+$25.00" needed
  // 57 pt of the 54 inside it and iOS drew only the "+".
  it('shows an amount whole, with its sign and symbol', () => {
    expect(extraText(2500, 'CAD', null, 'en-US')).toBe('+$25.00');
    expect(extraText(1200, 'CAD', null, 'en-US')).toBe('+$12.00');
    expect(extraText(123400, 'CAD', null, 'en-US')).toBe('+$1,234.00');
    expect(extraText(1234, 'JPY', null, 'en-US')).toBe('+¥1,234');
  });

  it('shows the typed text while focused, and nothing (the placeholder) while empty', () => {
    expect(extraText(2500, 'CAD', '25.0', 'en-US')).toBe('25.0');
    expect(extraText(2500, 'CAD', '', 'en-US')).toBe('');
    expect(extraText(0, 'CAD', null, 'en-US')).toBe('');
    expect(EXTRA_PLACEHOLDER).toBe('+ extra');
  });
});
