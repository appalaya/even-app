import { describe, expect, it } from 'vitest';

import {
  buildCirclePaths,
  circleAt,
  MARK_LENGTHS,
  MARK_TIMING,
  markAt,
  TIMING,
  type BoardCircle,
} from './emptyMotionPath';

// The EmptyMotion board's circles (frames 2, 3 and 4), copied from its SVG; the kit's EMPTY_CIRCLES holds the same.
const BOARD: BoardCircle[] = [
  { palette: 0, r: 6, arcIn: [63.6, 80.4], orbit: [155.3, 65.1], rest: [182.2, 71.7] },
  { palette: 8, r: 5, arcIn: [173.1, 50.5], orbit: [251.4, 95.9], rest: [264.9, 116.9] },
  { palette: 2, r: 7, arcIn: [266.1, 88.1], orbit: [293, 166], rest: [287.5, 189.6] },
  { palette: 11, r: 4.5, arcIn: [309.4, 168.7], orbit: [272.4, 242.6], rest: [250.5, 257.8] },
  { palette: 6, r: 6.5, arcIn: [266.1, 271.9], orbit: [176.3, 294.1], rest: [148.8, 289.6] },
  { palette: 1, r: 5, arcIn: [160, 310], orbit: [77.5, 270.6], rest: [61.9, 250.7] },
  { palette: 9, r: 6, arcIn: [53.9, 271.9], orbit: [27, 194], rest: [32.5, 170.4] },
  { palette: 4, r: 4.5, arcIn: [12.3, 202.6], orbit: [41.7, 126], rest: [61.9, 109.3] },
  { palette: 10, r: 5.5, arcIn: [30.1, 115], orbit: [109.8, 73.4], rest: [137.8, 71.7] },
];
const paths = buildCirclePaths(BOARD);

const dist = (a: { x: number; y: number }, [x, y]: readonly [number, number]) =>
  Math.hypot(a.x - x, a.y - y);

describe('empty-state motion', () => {
  it('draws frame 1 of the board at the snapshot time', () => {
    const m = markAt(MARK_TIMING.snapshot);
    // Crossbar from x 20 to 52 of 20..84; 70 units of the arc; no equals bar yet.
    expect(20 + m.crossbar * MARK_LENGTHS.crossbar).toBeCloseTo(52, 0);
    expect(m.arc * MARK_LENGTHS.arc).toBeCloseTo(70, -0.5);
    expect(m.bar).toBe(0);
  });

  it('has the whole mark drawn by 0.8 s', () => {
    expect(markAt(800)).toEqual({ crossbar: 1, arc: 1, bar: 1 });
  });

  it('puts every circle on its arc-in position at 2.2 s and its rest position at 3 s', () => {
    for (const [i, p] of paths.entries()) {
      const circle = BOARD[i]!;
      expect(dist(circleAt(p, TIMING.arcIn, 0), circle.arcIn)).toBeLessThan(0.01);
      expect(dist(circleAt(p, TIMING.rest, 0), circle.rest)).toBeLessThan(0.01);
    }
  });

  it('passes within 2 pt of the drawn orbit frame while settling', () => {
    for (const [i, p] of paths.entries()) {
      const circle = BOARD[i]!;
      let best = Infinity;
      for (let t = TIMING.arcIn; t <= TIMING.rest; t += 5) {
        best = Math.min(best, dist(circleAt(p, t, 0), circle.orbit));
      }
      expect(best).toBeLessThan(2);
    }
  });

  it('never reverses direction on the way in', () => {
    for (const p of paths) {
      let last = -Infinity;
      for (let t = TIMING.circlesStart; t <= TIMING.rest; t += 10) {
        const { x, y } = circleAt(p, t, 0);
        const angle = Math.atan2((y - 180) / 110, (x - 160) / 128);
        // Unwrap against the previous sample.
        let a = angle;
        while (last !== -Infinity && a < last - Math.PI) a += 2 * Math.PI;
        expect(a).toBeGreaterThanOrEqual(last - 1e-9);
        last = a;
      }
    }
  });

  it('is invisible before 0.6 s and breathes by at most 3 % after rest', () => {
    for (const [i, p] of paths.entries()) {
      expect(circleAt(p, 0, 0).opacity).toBe(0);
      const rest = BOARD[i]!.rest;
      const peak = circleAt(p, TIMING.rest + 1000, 0.25);
      const d0 = Math.hypot(rest[0] - 160, rest[1] - 180);
      const d1 = Math.hypot(peak.x - 160, peak.y - 180);
      expect(d1 / d0).toBeCloseTo(1.03, 3);
    }
  });
});
