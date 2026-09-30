/**
 * Where a sheet's centred title goes (`SheetHeader`'s `navTitle`) when the actions beside it grow with the text size.
 * The actions ("Cancel", "Done") keep their full width and never truncate; a back button ("‹ New expense") keeps its
 * width too until Done would leave the row, then its label takes what Done leaves and ends in an ellipsis. The title
 * gives way to all of them: centred in the sheet while it fits between them, moved off centre only as far as it must,
 * cut with an ellipsis once even that is not enough, and not drawn when the actions leave no room at all.
 *
 * Pure so Vitest can run it without React Native.
 */

/**
 * How the title sits: `center` over the whole row (every title at the default sizes, as drawn); otherwise inside the
 * room the actions leave, against its leading edge (`flex-start`, when the leading action is in the way) or its
 * trailing edge (`flex-end`), or filling it with an ellipsis (`fill`, when both are); `hidden` when the actions leave
 * no room between them (a back label cut short beside Done).
 */
export type NavTitlePlacement = 'center' | 'flex-start' | 'flex-end' | 'fill' | 'hidden';

/**
 * @param rowWidth The action row's width.
 * @param titleWidth The title's width on one line, uncut; null until it is measured.
 * @param clearLeft How far from the row's leading edge the title must stay (where the leading action ends, plus a gap).
 * @param clearRight The same from the trailing edge.
 */
export function navTitlePlacement(
  rowWidth: number,
  titleWidth: number | null,
  clearLeft: number,
  clearRight: number,
): NavTitlePlacement {
  if (titleWidth === null || rowWidth <= 0) return 'center';
  if (rowWidth - clearLeft - clearRight <= 0) return 'hidden';
  const start = (rowWidth - titleWidth) / 2;
  const end = start + titleWidth;
  // Half a point of slack: measured widths are rounded to the pixel grid.
  const leftInTheWay = start < clearLeft - 0.5;
  const rightInTheWay = end > rowWidth - clearRight + 0.5;
  if (leftInTheWay && rightInTheWay) return 'fill';
  if (leftInTheWay) return 'flex-start';
  if (rightInTheWay) return 'flex-end';
  return 'center';
}
