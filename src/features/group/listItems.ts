/**
 * Group's one scrolling surface as the items of a virtualised list (pre-launch review H3: Expenses and Activity used
 * to mount every row, 6,000 and 10,000 of them in a large group). In order: the block above the segmented control,
 * the segmented control (`SEGMENT_INDEX`, the item that sticks under the nav bar), then the open tab's content, each
 * Expenses and Activity row a slice of the card it is drawn in (`CardSlice`), knowing whether it is the card's first
 * or last. Balances stays one item: a member per row and a bar per category, never long. Pure, for Vitest.
 */
import type { ExpenseState } from '@even/core';

import type { ActivityRow, ActivitySection } from './model';

export type GroupTab = 'expenses' | 'balances' | 'activity';

export type GroupItem =
  | { kind: 'header' }
  | { kind: 'segment' }
  | { kind: 'noExpenses' }
  | { kind: 'expense'; expense: ExpenseState; first: boolean; last: boolean }
  | { kind: 'balances' }
  | { kind: 'day'; section: ActivitySection }
  | { kind: 'activity'; row: ActivityRow; first: boolean; last: boolean };

/** The segmented control's index: the list's one sticky item. */
export const SEGMENT_INDEX = 1;

const HEAD: readonly GroupItem[] = [{ kind: 'header' }, { kind: 'segment' }];

export function groupItems(
  tab: GroupTab,
  expenses: readonly ExpenseState[],
  sections: readonly ActivitySection[],
): GroupItem[] {
  const items: GroupItem[] = [...HEAD];
  if (tab === 'balances') {
    items.push({ kind: 'balances' });
  } else if (tab === 'expenses') {
    if (expenses.length === 0) items.push({ kind: 'noExpenses' });
    expenses.forEach((expense, i) => {
      items.push({ kind: 'expense', expense, first: i === 0, last: i === expenses.length - 1 });
    });
  } else {
    for (const section of sections) {
      items.push({ kind: 'day', section });
      section.rows.forEach((row, i) => {
        items.push({ kind: 'activity', row, first: i === 0, last: i === section.rows.length - 1 });
      });
    }
  }
  return items;
}

/** A key per item, stable across renders and tabs: the header and the segment keep theirs when the tab changes. */
export function groupItemKey(item: GroupItem): string {
  switch (item.kind) {
    case 'expense':
      return `expense:${item.expense.id}`;
    case 'day':
      return `day:${item.section.key}`;
    case 'activity':
      return `activity:${item.row.key}`;
    default:
      return item.kind;
  }
}
