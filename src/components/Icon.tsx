import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Stroke icons drawn with plain Views, because the app has no vector library (react-native-svg and expo-symbols
 * are not installed). Each icon is the canvas's 24-unit SVG path re-expressed as primitives in the same
 * coordinates: straight segments (round caps and joins, as `stroke-linecap/linejoin: round`), circles, rounded
 * rectangles, and circular arcs. Arcs are a ring clipped by rotated half-planes, which gives the radial (butt)
 * ends SVG draws; round-capped arcs add a dot at each end.
 */

type Pt = readonly [number, number];

export type Prim =
  | { k: 'line'; a: Pt; b: Pt; cap?: 'round' | 'butt' }
  | { k: 'poly'; pts: readonly Pt[]; closed?: boolean }
  | { k: 'ring'; c: Pt; r: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; rx: number }
  /** Angles in degrees, clockwise from +x on screen (SVG's y-down convention), `from` < `to`. */
  | { k: 'arc'; c: Pt; r: number; from: number; to: number; cap?: 'round' | 'butt' };

interface StrokeCanvasProps {
  prims: readonly Prim[];
  /** Side of the square coordinate space the primitives are written in (24 for icons, 100 for the mark). */
  viewBox: number;
  /** Rendered side, in points. */
  size: number;
  /** Stroke width in viewBox units. */
  stroke: number;
  color: string;
}

/** Renders stroke primitives written in a `viewBox`-unit square, scaled to `size` points. */
export function StrokeCanvas({ prims, viewBox, size, stroke, color }: StrokeCanvasProps) {
  const k = size / viewBox;
  const w = stroke * k;
  const nodes: ReactNode[] = [];
  const s = (p: Pt): Pt => [p[0] * k, p[1] * k];

  prims.forEach((p, i) => {
    switch (p.k) {
      case 'line':
        nodes.push(segment(`${i}`, s(p.a), s(p.b), w, color, p.cap ?? 'round'));
        break;
      case 'poly': {
        const pts = p.closed === true ? [...p.pts, p.pts[0] as Pt] : p.pts;
        for (let j = 0; j < pts.length - 1; j++) {
          nodes.push(segment(`${i}.${j}`, s(pts[j] as Pt), s(pts[j + 1] as Pt), w, color, 'round'));
        }
        break;
      }
      case 'ring':
        nodes.push(ring(`${i}`, s(p.c), p.r * k, w, color));
        break;
      case 'rect':
        nodes.push(
          <View
            key={i}
            style={{
              position: 'absolute',
              left: p.x * k - w / 2,
              top: p.y * k - w / 2,
              width: p.w * k + w,
              height: p.h * k + w,
              borderRadius: p.rx * k + w / 2,
              borderWidth: w,
              borderColor: color,
            }}
          />,
        );
        break;
      case 'arc':
        nodes.push(arc(`${i}`, s(p.c), p.r * k, p.from, p.to, w, color, p.cap ?? 'butt', size));
        break;
    }
  });

  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {nodes}
    </View>
  );
}

function segment(key: string, a: Pt, b: Pt, w: number, color: string, cap: 'round' | 'butt') {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) + (cap === 'round' ? w : 0);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: (a[0] + b[0]) / 2 - length / 2,
        top: (a[1] + b[1]) / 2 - w / 2,
        width: length,
        height: w,
        borderRadius: cap === 'round' ? w / 2 : 0,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function ring(key: string, c: Pt, r: number, w: number, color: string) {
  return (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: c[0] - r - w / 2,
        top: c[1] - r - w / 2,
        width: 2 * r + w,
        height: 2 * r + w,
        borderRadius: r + w / 2,
        borderWidth: w,
        borderColor: color,
      }}
    />
  );
}

function dot(key: string, c: Pt, d: number, color: string) {
  return (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: c[0] - d / 2,
        top: c[1] - d / 2,
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: color,
      }}
    />
  );
}

/**
 * Keeps only the half-plane of angles [angle, angle + 180] around `c`: a large box whose top edge runs through
 * `c`, rotated about `c`, clipping a canvas-sized frame counter-rotated so its content stays put.
 */
function HalfPlane({
  angle,
  c,
  size,
  children,
}: {
  angle: number;
  c: Pt;
  size: number;
  children: ReactNode;
}) {
  const S = size * 2;
  return (
    <View
      collapsable={false}
      style={{
        position: 'absolute',
        left: c[0] - S,
        top: c[1],
        width: 2 * S,
        height: S,
        overflow: 'hidden',
        transformOrigin: [S, 0, 0],
        transform: [{ rotate: `${angle}deg` }],
      }}
    >
      <View
        collapsable={false}
        style={{
          position: 'absolute',
          left: S - c[0],
          top: -c[1],
          width: size,
          height: size,
          transformOrigin: [c[0], c[1], 0],
          transform: [{ rotate: `${-angle}deg` }],
        }}
      >
        {children}
      </View>
    </View>
  );
}

function arc(
  key: string,
  c: Pt,
  r: number,
  from: number,
  to: number,
  w: number,
  color: string,
  cap: 'round' | 'butt',
  size: number,
) {
  // Pieces of at most 179°, each but the last running 1° past its end so the next one overlaps it: the clip
  // edges are not antialiased, and butting two pieces exactly leaves a hairline seam.
  const pieces: [number, number][] = [];
  for (let start = from; start < to; start += 179) {
    const end = Math.min(start + 179, to);
    pieces.push([start, end < to ? end + 1 : end]);
  }
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const end = (deg: number): Pt => [c[0] + r * Math.cos(rad(deg)), c[1] + r * Math.sin(rad(deg))];
  return (
    <View key={key} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map(([a, b], j) => (
        <HalfPlane key={j} angle={a} c={c} size={size}>
          <HalfPlane angle={b - 180} c={c} size={size}>
            {ring('r', c, r, w, color)}
          </HalfPlane>
        </HalfPlane>
      ))}
      {cap === 'round' && dot('a', end(from), w, color)}
      {cap === 'round' && dot('b', end(to), w, color)}
    </View>
  );
}

// ---------- The icon set (paths from the canvas boards, 24-unit viewBox) ----------

/** Feather's cog as the canvas draws it: eight semicircular teeth at radius 9, straight flanks to valleys at 7.9. */
function gear(): Prim[] {
  const out: Prim[] = [{ k: 'ring', c: [12, 12], r: 3 }];
  const at = (deg: number, r: number): Pt => [
    12 + r * Math.cos((deg * Math.PI) / 180),
    12 + r * Math.sin((deg * Math.PI) / 180),
  ];
  const offset = (p: Pt, deg: number, d: number): Pt => [
    p[0] + d * Math.cos((deg * Math.PI) / 180),
    p[1] + d * Math.sin((deg * Math.PI) / 180),
  ];
  for (let t = 0; t < 8; t++) {
    const axis = -90 + t * 45;
    const tip = at(axis, 9);
    out.push({ k: 'arc', c: tip, r: 2, from: axis - 90, to: axis + 90 });
    const next = at(axis + 45, 9);
    out.push({
      k: 'poly',
      pts: [offset(tip, axis + 90, 2), at(axis + 22.5, 7.9), offset(next, axis + 45 - 90, 2)],
    });
  }
  return out;
}

const ICONS = {
  chevronLeft: {
    stroke: 2.2,
    prims: [
      {
        k: 'poly',
        pts: [
          [15, 5],
          [8, 12],
          [15, 19],
        ],
      },
    ],
  },
  chevronRight: {
    stroke: 2.4,
    prims: [
      {
        k: 'poly',
        pts: [
          [9, 5],
          [16, 12],
          [9, 19],
        ],
      },
    ],
  },
  chevronDown: {
    stroke: 2.6,
    prims: [
      {
        k: 'poly',
        pts: [
          [6, 9],
          [12, 15],
          [18, 9],
        ],
      },
    ],
  },
  plus: {
    stroke: 2.4,
    prims: [
      { k: 'line', a: [12, 5], b: [12, 19] },
      { k: 'line', a: [5, 12], b: [19, 12] },
    ],
  },
  minus: { stroke: 2.6, prims: [{ k: 'line', a: [5, 12], b: [19, 12] }] },
  close: {
    stroke: 3,
    prims: [
      { k: 'line', a: [6, 6], b: [18, 18] },
      { k: 'line', a: [18, 6], b: [6, 18] },
    ],
  },
  check: {
    stroke: 2.6,
    prims: [
      {
        k: 'poly',
        pts: [
          [5, 12.5],
          [9.5, 17],
          [19, 7.5],
        ],
      },
    ],
  },
  arrowRight: {
    stroke: 2,
    prims: [
      { k: 'line', a: [5, 12], b: [19, 12] },
      {
        k: 'poly',
        pts: [
          [13, 6],
          [19, 12],
          [13, 18],
        ],
      },
    ],
  },
  sync: {
    stroke: 2,
    prims: [
      { k: 'arc', c: [12, 12], r: 8, from: 0, to: 135.5, cap: 'round' },
      { k: 'arc', c: [12, 12], r: 8, from: 180, to: 315.5, cap: 'round' },
      {
        k: 'poly',
        pts: [
          [17.7, 2.6],
          [17.7, 6.6],
          [13.7, 6.6],
        ],
      },
      {
        k: 'poly',
        pts: [
          [6.3, 21.4],
          [6.3, 17.4],
          [10.3, 17.4],
        ],
      },
    ],
  },
  info: {
    stroke: 2,
    prims: [
      { k: 'ring', c: [12, 12], r: 9 },
      { k: 'line', a: [12, 11], b: [12, 16] },
      { k: 'line', a: [12, 7.6], b: [12, 8] },
    ],
  },
  archive: {
    stroke: 2,
    prims: [
      { k: 'rect', x: 3, y: 4, w: 18, h: 5, rx: 1.5 },
      { k: 'line', a: [5, 9], b: [5, 18] },
      { k: 'arc', c: [7, 18], r: 2, from: 90, to: 180 },
      { k: 'line', a: [7, 20], b: [17, 20] },
      { k: 'arc', c: [17, 18], r: 2, from: 0, to: 90 },
      { k: 'line', a: [19, 18], b: [19, 9] },
      { k: 'line', a: [10, 13], b: [14, 13] },
    ],
  },
  gear: { stroke: 1.8, prims: gear() },
  share: {
    stroke: 2,
    prims: [
      { k: 'line', a: [12, 3], b: [12, 15] },
      {
        k: 'poly',
        pts: [
          [8, 7],
          [12, 3],
          [16, 7],
        ],
      },
      { k: 'line', a: [7, 10], b: [6, 10] },
      { k: 'arc', c: [6, 12], r: 2, from: 180, to: 270 },
      { k: 'line', a: [4, 12], b: [4, 19] },
      { k: 'arc', c: [6, 19], r: 2, from: 90, to: 180 },
      { k: 'line', a: [6, 21], b: [18, 21] },
      { k: 'arc', c: [18, 19], r: 2, from: 0, to: 90 },
      { k: 'line', a: [20, 19], b: [20, 12] },
      { k: 'arc', c: [18, 12], r: 2, from: 270, to: 360 },
      { k: 'line', a: [18, 10], b: [17, 10] },
    ],
  },
  search: {
    stroke: 2.2,
    prims: [
      { k: 'ring', c: [11, 11], r: 6.5 },
      { k: 'line', a: [16, 16], b: [20.5, 20.5] },
    ],
  },
  device: {
    stroke: 2.2,
    prims: [
      { k: 'rect', x: 7, y: 2.5, w: 10, h: 19, rx: 2.5 },
      { k: 'line', a: [11, 18.5], b: [13, 18.5] },
    ],
  },
  pencil: {
    stroke: 3,
    prims: [
      {
        k: 'poly',
        closed: true,
        pts: [
          [4, 20],
          [8, 19],
          [19, 8],
          [16, 5],
          [5, 16],
        ],
      },
    ],
  },
  backspace: {
    stroke: 1.8,
    prims: [
      { k: 'line', a: [9, 5], b: [19, 5] },
      { k: 'arc', c: [19, 7], r: 2, from: 270, to: 360 },
      { k: 'line', a: [21, 7], b: [21, 17] },
      { k: 'arc', c: [19, 17], r: 2, from: 0, to: 90 },
      { k: 'line', a: [19, 19], b: [9, 19] },
      {
        k: 'poly',
        pts: [
          [9, 19],
          [3, 12],
          [9, 5],
        ],
      },
      { k: 'line', a: [12.5, 9.5], b: [17.5, 14.5] },
      { k: 'line', a: [17.5, 9.5], b: [12.5, 14.5] },
    ],
  },
  paste: {
    stroke: 2,
    prims: [
      { k: 'rect', x: 7, y: 4, w: 10, h: 4, rx: 1.5 },
      { k: 'line', a: [7, 6], b: [6, 6] },
      { k: 'arc', c: [6, 8], r: 2, from: 180, to: 270 },
      { k: 'line', a: [4, 8], b: [4, 19] },
      { k: 'arc', c: [6, 19], r: 2, from: 90, to: 180 },
      { k: 'line', a: [6, 21], b: [18, 21] },
      { k: 'arc', c: [18, 19], r: 2, from: 0, to: 90 },
      { k: 'line', a: [20, 19], b: [20, 8] },
      { k: 'arc', c: [18, 8], r: 2, from: 270, to: 360 },
      { k: 'line', a: [18, 6], b: [17, 6] },
    ],
  },
  /** Rounded triangle: corner arcs of radius 2 (centres solved from the canvas path's endpoints). */
  warning: {
    stroke: 2,
    prims: [
      { k: 'line', a: [10.3, 4.2], b: [2.6, 17.5] },
      { k: 'arc', c: [4.33, 18.5], r: 2, from: 90.9, to: 210 },
      { k: 'line', a: [4.3, 20.5], b: [19.7, 20.5] },
      { k: 'arc', c: [19.67, 18.5], r: 2, from: -30, to: 89.1 },
      { k: 'line', a: [21.4, 17.5], b: [13.7, 4.2] },
      { k: 'arc', c: [12, 5.254], r: 2, from: -148.2, to: -31.8 },
      { k: 'line', a: [12, 9.5], b: [12, 14] },
      { k: 'line', a: [12, 17.2], b: [12, 17.5] },
    ],
  },
  import: {
    stroke: 2,
    prims: [
      { k: 'line', a: [12, 4], b: [12, 14] },
      {
        k: 'poly',
        pts: [
          [8, 10],
          [12, 14],
          [16, 10],
        ],
      },
      { k: 'line', a: [4, 15], b: [4, 18] },
      { k: 'arc', c: [6, 18], r: 2, from: 90, to: 180 },
      { k: 'line', a: [6, 20], b: [18, 20] },
      { k: 'arc', c: [18, 18], r: 2, from: 0, to: 90 },
      { k: 'line', a: [20, 18], b: [20, 15] },
    ],
  },
} as const satisfies Record<string, { stroke: number; prims: readonly Prim[] }>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** Rendered size in points (the canvas uses 12, 14, 16, 18, 20, 22, 24, 26). */
  size: number;
  /** A resolved token colour (`tokens.glyph`, `tokens.accent`, …). */
  color: string;
  /** Stroke width in 24-unit viewBox units; defaults to the width the canvas draws this glyph with. */
  strokeWidth?: number;
}

/** A canvas glyph. Decorative: wrap it in a labelled control, never rely on it for meaning alone. */
export function Icon({ name, size, color, strokeWidth }: IconProps) {
  const icon = ICONS[name];
  return (
    <StrokeCanvas
      prims={icon.prims}
      viewBox={24}
      size={size}
      stroke={strokeWidth ?? icon.stroke}
      color={color}
    />
  );
}
