/**
 * Spacing as drawn on the canvas (points). The boards are 402 × 874 (iPhone 17 class): 62 pt of status bar
 * above the content and 34 pt under the sticky footer, which on the device are the safe-area insets.
 */

/** Every gap, margin and padding step the boards use. Components pick from these, never an in-between value. */
export const space = {
  2: 2,
  3: 3,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  18: 18,
  20: 20,
  24: 24,
  28: 28,
  34: 34,
  40: 40,
} as const;

export const layout = {
  /** Cards, lists, buttons and fields sit this far from the screen edge. */
  gutter: 16,
  /** Text that sits directly on the canvas (section headers, the big number, footnotes) is inset this far. */
  textInset: 20,
  /** Gap between stacked cards on Groups and between side-by-side buttons. */
  stackGap: 10,
  /** Height of the nav bar row (back button, centred title, icon buttons). */
  navBarHeight: 44,
  /** Minimum tap target, both axes. Smaller visuals (36 pt pills, 32 pt segments) extend with hitSlop. */
  tapTarget: 44,
  /** Sticky footer: top padding above the primary button. */
  footerTop: 12,
  /**
   * Bottom inset above the home indicator: the canvas pads the footer and every sheet by 34 (the iPhone 17
   * safe-area bottom). Components use max(safe-area bottom, this).
   */
  homeIndicator: 34,
  /** Sheets that end in a keypad (Add expense, Split, Settle, the category picker) pad the bottom by 30. */
  keypadSheetBottom: 30,
  /** Large title row: padding top, right, bottom, left. */
  largeTitle: { top: 12, right: 12, bottom: 16, left: 20 },
} as const;

/** Line and outline widths. The canvas draws separators at 1 pt, not a device hairline. */
export const strokes = {
  hairline: 1,
  /** Dashed "not done" avatar outline, the add-member circle, the hollow sync dot. */
  dashed: 1.5,
  /** Inset ring on a selected tile or member chip. */
  selected: 1.5,
  /** Focus ring on a field or an open chip; the ring around a stacked avatar. */
  ring: 2,
  /** Ring separating the pencil badge from the avatar under it. */
  badgeRing: 3,
} as const;
