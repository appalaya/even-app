/** Corner radii as drawn on the canvas (points). Pills and avatars are fully round: height / 2. */
export const radii = {
  /** Top corners of every sheet. */
  sheet: 28,
  /** Group cards, list cards on Group, the invite card, the code field. */
  card: 18,
  /** Settings sections, the done-adding row, large fields (title, name, currency), lists inside sheets. */
  group: 16,
  /** Banners, category tiles, keypad keys. */
  tile: 14,
  /** Segmented track, search field, small inputs, the 40 pt expense tile, emoji cells, the invite link box. */
  control: 12,
  /** Amount cells in Split; the compact (System · Light · Dark) segmented track. */
  cell: 10,
  /** The selected segment. */
  segment: 9,
  /** The selected segment of the compact control. */
  segmentCompact: 8,
  /** Category bar (6 pt tall). */
  bar: 3,
  /** Usage meter (8 pt tall). */
  meter: 4,
  /** Sheet grabber (36 × 5). */
  grabber: 3,
  /** Anything fully round: pills, avatars, dots. */
  round: 999,
} as const;
