import type { ExpenseState } from '@even/core';
import { describe, expect, it } from 'vitest';

import { groupItemKey, groupItems, SEGMENT_INDEX } from './listItems';
import type { ActivityRow, ActivitySection } from './model';

const expense = (id: string) => ({ id }) as ExpenseState;
const row = (key: string): ActivityRow => ({
  key,
  member: null,
  subject: null,
  rest: key,
  at: 0,
  device: null,
});
const day = (key: number, ...rows: string[]): ActivitySection => ({
  key,
  at: key,
  rows: rows.map(row),
});

describe('groupItems', () => {
  it('heads every tab with the header and the segment, which is the sticky index', () => {
    for (const tab of ['expenses', 'balances', 'activity'] as const) {
      const items = groupItems(tab, [], []);
      expect(items.slice(0, 2).map((i) => i.kind)).toEqual(['header', 'segment']);
      expect(items[SEGMENT_INDEX]?.kind).toBe('segment');
    }
    expect(groupItems('balances', [expense('a')], [day(1, 'x')]).map((i) => i.kind)).toEqual([
      'header',
      'segment',
      'balances',
    ]);
  });

  it('gives Expenses one slice per expense, the card closed at both ends, or the empty card', () => {
    expect(groupItems('expenses', [], []).map((i) => i.kind)).toEqual([
      'header',
      'segment',
      'noExpenses',
    ]);
    const items = groupItems('expenses', ['a', 'b', 'c'].map(expense), []).slice(2);
    expect(items.map((i) => (i.kind === 'expense' ? [i.first, i.last] : null))).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    const one = groupItems('expenses', [expense('a')], []).slice(2);
    expect(one).toMatchObject([{ kind: 'expense', first: true, last: true }]);
  });

  it('gives Activity each day heading, then that day card’s rows', () => {
    const items = groupItems('activity', [], [day(2, 'p', 'q'), day(1, 'r')]).slice(2);
    expect(
      items.map((i) => (i.kind === 'activity' ? [i.row.key, i.first, i.last] : i.kind)),
    ).toEqual(['day', ['p', true, false], ['q', false, true], 'day', ['r', true, true]]);
  });

  it('keys every item uniquely, the header and segment the same on every tab', () => {
    const items = [
      ...groupItems('expenses', ['a', 'b'].map(expense), []),
      ...groupItems('activity', [], [day(2, 'a', 'b'), day(1, 'c')]).slice(2),
      ...groupItems('balances', [], []).slice(2),
    ];
    const keys = items.map(groupItemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groupItems('activity', [], []).map(groupItemKey)).toEqual(['header', 'segment']);
  });
});
