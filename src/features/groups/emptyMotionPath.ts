/**
 * The empty state's motion (EmptyMotion board), as pure functions of time so the Reanimated component only samples
 * them. Every function is a worklet; none allocates per frame beyond its return value.
 *
 * The board draws four keyframes in its 320 × 360 space:
 * 1. 0–0.8 s, the mark draws in (the snapshot: crossbar to x 52, 70 units of the arc, no equals bar);
 * 2. 0.6–2.2 s, the circles arc in onto the 150 × 130 ellipse (`EMPTY_CIRCLES[].arcIn`);
 * 3. 2.2–3.0 s, they settle onto the 128 × 110 orbit (`orbit`);
 * 4. rest (`rest`), then a ±3 % breath over 4 s.
 * "3 s, ease-in-out, once on open, then breathes slowly; Reduce Motion shows the rest frame."
 *
 * Each circle moves in polar coordinates about the canvas centre, measured on the rest ellipse (so the orbit is
 * radius 1): the angle and radius are piecewise in one ease-in-out progress over 0.6–3.0 s, linear from `arcIn`
 * to `rest` after 2.2 s (which passes within a point of the drawn `orbit` frame) and, before it, a spiral in from
 * outside the canvas whose speed matches at 2.2 s, so the motion never stops between phases.
 */

/** One circle as `EMPTY_CIRCLES` (kit) records it: palette index, radius and its three drawn positions. */
export interface BoardCircle {
  palette: number;
  r: number;
  arcIn: readonly [number, number];
  orbit: readonly [number, number];
  rest: readonly [number, number];
}

export const CANVAS = { width: 320, height: 360 } as const;
const CX = 160;
const CY = 180;
/** The rest orbit's radii (the board's frame 3 ellipse). */
const RX = 128;
const RY = 110;

export const TIMING = {
  /** Circles appear. */
  circlesStart: 600,
  /** The arc-in keyframe. */
  arcIn: 2200,
  /** At rest; the breath starts. */
  rest: 3000,
  /** One breath (out and back). */
  breathPeriod: 4000,
  /** ±3 % of each circle's distance from the centre. */
  breathAmplitude: 0.03,
} as const;

/** Mark paths' lengths in the mark's 100-unit space. */
const CROSSBAR = 64; // M20 50H84
const ARC = (22 * 310 * Math.PI) / 180; // r 22, the long way from 0° to 50°
const BAR = 20; // M66 63H86
export const MARK_LENGTHS = { crossbar: CROSSBAR, arc: ARC, bar: BAR } as const;

/**
 * Frame 1 is the moment the crossbar reaches x 52 while the arc is 70 units in: with both on ease-in-out from 0 s,
 * the crossbar runs 640 ms and the arc 600 ms (the arc is 59 % drawn when the crossbar is 50 % drawn, at 320 ms).
 * The equals bar follows, 550–800 ms, so the mark is whole at 0.8 s.
 */
export const MARK_TIMING = {
  crossbar: { start: 0, end: 640 },
  arc: { start: 0, end: 600 },
  bar: { start: 550, end: 800 },
  /** When the board's frame-1 snapshot holds. */
  snapshot: 320,
} as const;

export function easeInOutCubic(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function progress(t: number, start: number, end: number): number {
  'worklet';
  return easeInOutCubic((t - start) / (end - start));
}

/** How much of each mark path is drawn at `t` ms (0..1). */
export function markAt(t: number): { crossbar: number; arc: number; bar: number } {
  'worklet';
  return {
    crossbar: progress(t, MARK_TIMING.crossbar.start, MARK_TIMING.crossbar.end),
    arc: progress(t, MARK_TIMING.arc.start, MARK_TIMING.arc.end),
    bar: progress(t, MARK_TIMING.bar.start, MARK_TIMING.bar.end),
  };
}

interface Polar {
  angle: number;
  radius: number;
}

function toPolar([x, y]: readonly [number, number]): Polar {
  return {
    angle: Math.atan2((y - CY) / RY, (x - CX) / RX),
    radius: Math.hypot((x - CX) / RX, (y - CY) / RY),
  };
}

/** How far the spiral turns before the arc-in keyframe, and how far out it starts (in orbit radii). */
const SPIRAL_TURN = (150 * Math.PI) / 180;
const SPIRAL_START_RADIUS = 1.8;

export interface CirclePath {
  palette: number;
  r: number;
  arcAngle: number;
  arcRadius: number;
  restAngle: number;
  restRadius: number;
  /** Quadratic coefficients of the spiral before the knot, in d = knot − g: angle = arc − (va·d + ca·d²). */
  va: number;
  ca: number;
  vr: number;
  cr: number;
}

/** The global progress at the arc-in keyframe. */
export const KNOT = easeInOutCubic(
  (TIMING.arcIn - TIMING.circlesStart) / (TIMING.rest - TIMING.circlesStart),
);

function unwrap(from: number, to: number): number {
  // The circles travel clockwise on screen (increasing angle): take the forward difference.
  let delta = to - from;
  while (delta < 0) delta += 2 * Math.PI;
  while (delta >= 2 * Math.PI) delta -= 2 * Math.PI;
  return from + delta;
}

/** Precomputes each circle's path from the board's keyframes (pass the kit's `EMPTY_CIRCLES`). */
export function buildCirclePaths(circles: readonly BoardCircle[]): CirclePath[] {
  return circles.map((c) => {
    const arc = toPolar(c.arcIn);
    const rest = toPolar(c.rest);
    const restAngle = unwrap(arc.angle, rest.angle);
    const span = 1 - KNOT;
    // Speeds (per unit of global progress) of the linear segment after the knot, carried into the spiral.
    const va = (restAngle - arc.angle) / span;
    const vr = (rest.radius - arc.radius) / span;
    // angle(d) = arc − (va·d + ca·d²) reaches arc − SPIRAL_TURN at d = KNOT; radius likewise reaches the start.
    const ca = (SPIRAL_TURN - va * KNOT) / (KNOT * KNOT);
    const cr = (SPIRAL_START_RADIUS - arc.radius + vr * KNOT) / (KNOT * KNOT);
    return {
      palette: c.palette,
      r: c.r,
      arcAngle: arc.angle,
      arcRadius: arc.radius,
      restAngle,
      restRadius: rest.radius,
      va,
      ca,
      vr: -vr,
      cr,
    };
  });
}

/** A circle's centre and opacity at `t` ms, breathing once `t` passes rest; `breath` is 0..1 of one period. */
export function circleAt(
  p: CirclePath,
  t: number,
  breath: number,
): { x: number; y: number; opacity: number } {
  'worklet';
  const g = easeInOutCubic((t - TIMING.circlesStart) / (TIMING.rest - TIMING.circlesStart));
  let angle: number;
  let radius: number;
  if (g >= KNOT) {
    const s = (g - KNOT) / (1 - KNOT);
    angle = p.arcAngle + (p.restAngle - p.arcAngle) * s;
    radius = p.arcRadius + (p.restRadius - p.arcRadius) * s;
  } else {
    const d = KNOT - g;
    angle = p.arcAngle - (p.va * d + p.ca * d * d);
    radius = p.arcRadius + (p.vr * d + p.cr * d * d);
  }
  if (t >= TIMING.rest) radius *= 1 + TIMING.breathAmplitude * Math.sin(2 * Math.PI * breath);
  const fade = (t - TIMING.circlesStart) / 400;
  const opacity = fade <= 0 ? 0 : fade >= 1 ? 1 : fade;
  return { x: CX + RX * radius * Math.cos(angle), y: CY + RY * radius * Math.sin(angle), opacity };
}
