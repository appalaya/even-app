import { describe, expect, it } from 'vitest';

import {
  AMOUNT_LINE,
  AMOUNT_MIN_SCALE,
  AMOUNT_PAD,
  AMOUNT_PAD_PICKING,
  CODE_GAP,
  CODE_LINE,
  fitShortScreen,
  FULL_FIT,
  KEYPAD_GAP,
  KEYPAD_GAP_MIN,
  type ShortFit,
} from './shortScreen';

/**
 * The rows that never give way, as the boards draw them: the title 56; Paid by and the date 12 + 44; Split 8 + 52;
 * Save 16 + 52; the keypad 4 × 54 + 3 × 4. The sheet starts 116 from the top, its header is 59 and its bottom pad 30.
 */
const ROWS = 56 + 56 + 60 + 68 + 228;
const roomOn = (screenHeight: number) => screenHeight - 116 - 59 - 30 - ROWS;

/** The height the amount block (at its least) and the gap above the keypad take with this fit. */
function used(fit: ShortFit, picking = false, k = 1): number {
  const pad = picking ? AMOUNT_PAD_PICKING : AMOUNT_PAD;
  const line = AMOUNT_LINE * k * fit.amountScale;
  const amount = fit.amountInline ? line : line + CODE_GAP + CODE_LINE * k;
  return fit.amountPadTop + amount + pad + fit.keypadGap;
}

describe('Add expense on short screens', () => {
  it('leaves the boards’ size and taller as drawn', () => {
    expect(fitShortScreen(roomOn(874), 1, false)).toEqual(FULL_FIT); // iPhone 17 / 18 Pro, the boards
    expect(fitShortScreen(roomOn(956), 1, false)).toEqual(FULL_FIT); // iPhone 18 Pro Max
    expect(fitShortScreen(roomOn(812), 1, false)).toEqual(FULL_FIT); // iPhone 13 mini
    expect(fitShortScreen(roomOn(808), 1, false)).toEqual(FULL_FIT); // 1080 × 1920 at 380 dpi
    expect(fitShortScreen(roomOn(923), 1, false)).toEqual(FULL_FIT); // Pixel 10
  });

  it('fits a 16:9 Android phone (411 × 731 dp) without scrolling: the code moves beside a smaller amount', () => {
    const fit = fitShortScreen(roomOn(731), 1, false);
    expect(fit.amountPadTop).toBe(0);
    expect(fit.amountInline).toBe(true);
    expect(fit.amountScale).toBeCloseTo((58 - AMOUNT_PAD - KEYPAD_GAP) / AMOUNT_LINE, 6);
    expect(fit.keypadGap).toBe(KEYPAD_GAP);
    expect(fit.overflow).toBe(0);
    expect(used(fit)).toBeCloseTo(roomOn(731), 6);
  });

  it('on an iPhone SE (375 × 667) takes everything else, then scrolls the rows above Save', () => {
    const fit = fitShortScreen(roomOn(667), 1, false);
    expect(fit).toEqual({
      amountPadTop: 0,
      amountInline: true,
      amountScale: AMOUNT_MIN_SCALE,
      keypadGap: KEYPAD_GAP_MIN,
      overflow: 52,
    });
    expect(used(fit) - fit.overflow).toBe(roomOn(667));
  });

  it('gives way in order: top padding, the code beside, the amount’s size, the gap, then scrolling', () => {
    const order = (f: ShortFit) =>
      f.overflow > 0
        ? 5
        : f.keypadGap < KEYPAD_GAP
          ? 4
          : f.amountScale < 1
            ? 3
            : f.amountInline
              ? 2
              : f.amountPadTop < AMOUNT_PAD
                ? 1
                : 0;
    let last = 0;
    for (let room = 140; room >= -40; room -= 0.5) {
      const fit = fitShortScreen(room, 1, false);
      const step = order(fit);
      expect(step).toBeGreaterThanOrEqual(last);
      last = step;
      expect(fit.amountScale).toBeGreaterThanOrEqual(AMOUNT_MIN_SCALE);
      expect(fit.amountScale).toBeLessThanOrEqual(1);
      expect(fit.keypadGap).toBeGreaterThanOrEqual(KEYPAD_GAP_MIN);
      expect(fit.amountPadTop).toBeGreaterThanOrEqual(0);
      // Never more than the room, except by what scrolls; never less unless the amount is whole.
      expect(used(fit) - fit.overflow).toBeLessThanOrEqual(room + 1e-9);
      if (fit.amountScale < 1 || fit.overflow > 0 || fit.amountPadTop < AMOUNT_PAD) {
        if (!(fit.amountInline && fit.amountScale === 1)) {
          expect(used(fit) - fit.overflow).toBeCloseTo(room, 6);
        }
      }
    }
    expect(last).toBe(5);
  });

  it('starts from the picker’s tighter padding while the category picker is open', () => {
    const drawn = AMOUNT_PAD_PICKING * 2 + AMOUNT_LINE + CODE_GAP + CODE_LINE + KEYPAD_GAP;
    expect(fitShortScreen(drawn, 1, true)).toEqual({
      ...FULL_FIT,
      amountPadTop: AMOUNT_PAD_PICKING,
    });
    const fit = fitShortScreen(drawn - 3, 1, true);
    expect(fit.amountPadTop).toBe(AMOUNT_PAD_PICKING - 3);
    expect(used(fit, true)).toBe(drawn - 3);
  });

  it('measures the amount at the text size the system asks for, up to 1.3', () => {
    const roomAt = (k: number) =>
      2 * AMOUNT_PAD + (AMOUNT_LINE + CODE_LINE) * k + CODE_GAP + KEYPAD_GAP;
    expect(fitShortScreen(roomAt(1.2), 1.2, false).amountScale).toBe(1);
    expect(fitShortScreen(roomAt(1.2) - 1, 1.2, false).amountPadTop).toBeCloseTo(AMOUNT_PAD - 1, 6);
    // Past 1.3 the amount stops growing, so the room it needs does too.
    expect(fitShortScreen(roomAt(1.3), 3, false)).toEqual(FULL_FIT);
    const fit = fitShortScreen(roomAt(1.3) - 40, 3, false);
    expect(used(fit, false, 1.3)).toBeCloseTo(roomAt(1.3) - 40, 6);
  });
});

/**
 * Settle's rows that never give way, as its boards draw them: From and To 12 + 18 + 6 + 48; the date and note 44;
 * Record payment 16 + 52; its footnote 8 + 18 a line (two lines on a 375 pt wide screen); the keypad 4 × 52 + 3 × 4.
 * The sheet's top, header and bottom pad are Add expense's.
 */
const SETTLE_ROWS = 84 + 44 + 68 + 8 + 220;
const settleRoomOn = (screenHeight: number, footnoteLines = 1) =>
  screenHeight - 116 - 59 - 30 - SETTLE_ROWS - 18 * footnoteLines;

describe('Settle on short screens', () => {
  it('leaves the boards’ size and taller as drawn', () => {
    expect(fitShortScreen(settleRoomOn(874), 1, false)).toEqual(FULL_FIT); // the boards
    expect(fitShortScreen(settleRoomOn(956), 1, false)).toEqual(FULL_FIT); // iPhone 18 Pro Max
    expect(fitShortScreen(settleRoomOn(923), 1, false)).toEqual(FULL_FIT); // Pixel 10
    expect(fitShortScreen(settleRoomOn(808), 1, false)).toEqual(FULL_FIT); // 1080 × 1920 at 380 dpi
  });

  it('fits a 16:9 Android phone (411 × 731 dp) without scrolling: the code moves beside a smaller amount', () => {
    const fit = fitShortScreen(settleRoomOn(731), 1, false);
    expect(fit.amountPadTop).toBe(0);
    expect(fit.amountInline).toBe(true);
    expect(fit.amountScale).toBeCloseTo((84 - AMOUNT_PAD - KEYPAD_GAP) / AMOUNT_LINE, 6);
    expect(fit.keypadGap).toBe(KEYPAD_GAP);
    expect(fit.overflow).toBe(0);
    expect(used(fit)).toBeCloseTo(settleRoomOn(731), 6);
  });

  it('on an iPhone SE (375 × 667) takes everything else, then scrolls the rows above Record payment', () => {
    const fit = fitShortScreen(settleRoomOn(667, 2), 1, false);
    expect(fit).toEqual({
      amountPadTop: 0,
      amountInline: true,
      amountScale: AMOUNT_MIN_SCALE,
      keypadGap: KEYPAD_GAP_MIN,
      overflow: 44,
    });
    expect(used(fit) - fit.overflow).toBe(settleRoomOn(667, 2));
  });
});
