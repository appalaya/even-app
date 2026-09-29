import { describe, expect, it } from 'vitest';

import { navTitlePlacement } from '../sheetHeaderLogic';

// A 402 pt sheet with the text row's 16 pt insets.
const ROW = 402;

describe("the sheet header's centred title", () => {
  it('stays centred while it fits between the actions (every title at the default sizes)', () => {
    // "New expense" beside "Cancel" (ends at 70, + 8): the drawn position.
    expect(navTitlePlacement(ROW, 96, 78, 16)).toBe('center');
    // "Split" between "‹ New expense" and "Done".
    expect(navTitlePlacement(ROW, 40, 150, 72)).toBe('center');
    // Not measured yet: centred, as the first frame always was.
    expect(navTitlePlacement(ROW, null, 78, 16)).toBe('center');
    expect(navTitlePlacement(0, 96, 78, 16)).toBe('center');
  });

  it('moves away from a grown Cancel only as far as it must', () => {
    // At 200 %: Cancel ends at 128, + 8; "New expense" is 190 wide and fits right of it.
    expect(navTitlePlacement(ROW, 190, 136, 16)).toBe('flex-start');
    // A grown trailing action pushes it the other way.
    expect(navTitlePlacement(ROW, 190, 16, 136)).toBe('flex-end');
  });

  it('fills the room between the actions, with an ellipsis, when it cannot fit', () => {
    // "Join with code" (250 wide at 200 %) between Cancel (136) and nothing else still reaches past the edge.
    expect(navTitlePlacement(ROW, 300, 136, 16)).toBe('flex-start');
    // Both sides in the way: the room is narrower than the title.
    expect(navTitlePlacement(ROW, 200, 136, 120)).toBe('fill');
  });

  it('allows half a point for rounding', () => {
    // Centred, the title starts at 100.8, 0.2 short of the 101 the action needs.
    expect(navTitlePlacement(ROW, 200.4, 101, 16)).toBe('center');
    expect(navTitlePlacement(ROW, 202, 102, 16)).toBe('flex-start');
  });
});
