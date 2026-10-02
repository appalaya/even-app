/**
 * The key of each row a separated `Card` wraps (the row and the separator above it, in one Fragment). Pure so Vitest
 * can run it without React Native.
 */
import { isValidElement, type ReactNode } from 'react';

/**
 * The row's own key when it has one (`Children.toArray` gives every element one), else its position. Keyed by
 * position alone, a row added at the top (a new expense on Group, newest first) put every row under another
 * Fragment, and React unmounted and mounted the whole list again: thousands of rows in a long-running group.
 */
export function separatedRowKey(child: ReactNode, index: number): string | number {
  return isValidElement(child) && child.key !== null ? child.key : index;
}
