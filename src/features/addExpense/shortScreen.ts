/**
 * Add expense on a screen shorter than the boards (402 × 874): what gives way, in order, so that Save and the keypad
 * (or the category grid) keep their size and their place at the bottom of the sheet (design.md, Add expense).
 *
 * 1. The space above the amount: the free space around it first (the amount block is flexible), then its top padding.
 * 2. The amount: its currency code moves beside it, on its baseline (as the typing state draws it), then the amount
 *    shrinks from 60/68 to 30/34.
 * 3. The gap above the keypad: 12 to 4.
 * 4. What is left over scrolls: the amount, title, Paid by, date and Split rows, above Save.
 *
 * At the boards' size and taller nothing changes, so those screens stay as drawn. Pure, so it is tested in Node.
 */

/** The amount's line height at full size (`typography.amount`, 60/68). */
export const AMOUNT_LINE = 68;
/** The currency code's line height under the amount (`typography.currencyCode`, 13/18), and the 2 between them. */
export const CODE_LINE = 18;
export const CODE_GAP = 2;
/** The smallest the amount gets: half size, 30/34 (the typing state's line height). */
export const AMOUNT_MIN_SCALE = 0.5;
/** The gap above the keypad or category grid, as drawn, and the least it gives way to (the keypad's own row gap). */
export const KEYPAD_GAP = 12;
export const KEYPAD_GAP_MIN = 4;
/** The amount block's padding above and below: 8, or 4 while the category picker is open (CategoryPicker). */
export const AMOUNT_PAD = 8;
export const AMOUNT_PAD_PICKING = 4;
/** Text never scales past this for the amount and its code (`AmountDisplay`'s `maxFontSizeMultiplier`). */
export const AMOUNT_MAX_FONT_SCALE = 1.3;

export interface ShortFit {
  /** The amount block's top padding (its bottom padding never changes). */
  amountPadTop: number;
  /** The currency code beside the amount, on its baseline, instead of under it. */
  amountInline: boolean;
  /** The amount's size relative to 60/68. */
  amountScale: number;
  /** The gap above the keypad or category grid. */
  keypadGap: number;
  /** What still does not fit once everything above has given way: the rows above Save scroll by this much. */
  overflow: number;
}

export const FULL_FIT: ShortFit = {
  amountPadTop: AMOUNT_PAD,
  amountInline: false,
  amountScale: 1,
  keypadGap: KEYPAD_GAP,
  overflow: 0,
};

/**
 * How the sheet fits `room`: the height left for the amount block and the gap above the keypad once the title, Paid
 * by, date, Split, Save (with the error line) and the keypad or grid have theirs. `fontScale` is the system text
 * size (the amount's is capped at 1.3); `picking` is the category picker being open.
 */
export function fitShortScreen(room: number, fontScale: number, picking: boolean): ShortFit {
  const k = Math.min(Math.max(fontScale, 0), AMOUNT_MAX_FONT_SCALE);
  const pad = picking ? AMOUNT_PAD_PICKING : AMOUNT_PAD;
  const line = AMOUNT_LINE * k;
  const stacked = line + CODE_GAP + CODE_LINE * k;

  // As drawn: the amount, the code under it, both paddings and the full gap. Any room over that is the free space.
  const drawn = pad + stacked + pad + KEYPAD_GAP;
  if (room >= drawn) return { ...FULL_FIT, amountPadTop: pad };

  // 1. The top padding gives way.
  const padTop = pad - (drawn - room);
  if (padTop >= 0) return { ...FULL_FIT, amountPadTop: padTop };

  // 2. The code moves beside the amount, then the amount shrinks to its floor.
  const inlineFull = line + pad + KEYPAD_GAP;
  if (room >= inlineFull) {
    return {
      amountPadTop: 0,
      amountInline: true,
      amountScale: 1,
      keypadGap: KEYPAD_GAP,
      overflow: 0,
    };
  }
  const scale = (room - pad - KEYPAD_GAP) / line;
  if (scale >= AMOUNT_MIN_SCALE) {
    return {
      amountPadTop: 0,
      amountInline: true,
      amountScale: scale,
      keypadGap: KEYPAD_GAP,
      overflow: 0,
    };
  }

  // 3. The gap above the keypad gives way.
  const smallest = line * AMOUNT_MIN_SCALE + pad;
  const gap = room - smallest;
  if (gap >= KEYPAD_GAP_MIN) {
    return {
      amountPadTop: 0,
      amountInline: true,
      amountScale: AMOUNT_MIN_SCALE,
      keypadGap: gap,
      overflow: 0,
    };
  }

  // 4. The rest scrolls.
  return {
    amountPadTop: 0,
    amountInline: true,
    amountScale: AMOUNT_MIN_SCALE,
    keypadGap: KEYPAD_GAP_MIN,
    overflow: smallest + KEYPAD_GAP_MIN - room,
  };
}
