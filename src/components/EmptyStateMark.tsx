import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { MARK_PRIMS, MARK_STROKE, MARK_VIEWBOX } from './Mark';
import { StrokeCanvas } from './Icon';

type Pt = readonly [number, number];

/**
 * The empty-state composition (Groups, empty; EmptyMotion board), in the board's 320 × 360 space: the mark at
 * (90, 110) scaled 1.4 (a 140 pt square), and nine circles in avatar-palette colours.
 *
 * Each circle carries its position in the three drawn keyframes, so the motion (not built yet) only has to
 * interpolate between them: `arcIn` (frame 2, 0.6–2.2 s, circles arc in on the 150 × 130 ellipse), `orbit`
 * (frame 3, 2.2–3.0 s, settled on the 128 × 110 ellipse), `rest` (frame 4, then a ±3 % breath over 4 s; the only
 * frame shown under Reduce Motion). Frame 1 (0–0.8 s) draws the mark in: the crossbar to x 52 and 70 units of the
 * arc; `MARK_DRAW_IN` records it.
 *
 * `palette` maps each board colour to the nearest avatar token (by OKLCH hue), so the circles follow themes:
 * #9E4A5A rose 11 · #336A8E steel 7 · #8A6A1F mustard 2 · #85508A plum 10 · #2B6C70 lagoon 6 · #A0553B clay 0 ·
 * #4B56A0 indigo 8 · #4E7038 moss 3 · #6A539A violet 9. Only clay and steel are exact; see the kit report.
 */
export const EMPTY_CIRCLES: readonly {
  palette: number;
  r: number;
  arcIn: Pt;
  orbit: Pt;
  rest: Pt;
}[] = [
  { palette: 11, r: 6, arcIn: [63.6, 80.4], orbit: [155.3, 65.1], rest: [182.2, 71.7] },
  { palette: 7, r: 5, arcIn: [173.1, 50.5], orbit: [251.4, 95.9], rest: [264.9, 116.9] },
  { palette: 2, r: 7, arcIn: [266.1, 88.1], orbit: [293, 166], rest: [287.5, 189.6] },
  { palette: 10, r: 4.5, arcIn: [309.4, 168.7], orbit: [272.4, 242.6], rest: [250.5, 257.8] },
  { palette: 6, r: 6.5, arcIn: [266.1, 271.9], orbit: [176.3, 294.1], rest: [148.8, 289.6] },
  { palette: 0, r: 5, arcIn: [160, 310], orbit: [77.5, 270.6], rest: [61.9, 250.7] },
  { palette: 8, r: 6, arcIn: [53.9, 271.9], orbit: [27, 194], rest: [32.5, 170.4] },
  { palette: 3, r: 4.5, arcIn: [12.3, 202.6], orbit: [41.7, 126], rest: [61.9, 109.3] },
  { palette: 9, r: 5.5, arcIn: [30.1, 115], orbit: [109.8, 73.4], rest: [137.8, 71.7] },
];

/** Frame 1 of the motion: how much of the mark is drawn at 0.8 s (crossbar end x, arc length in units). */
export const MARK_DRAW_IN = { crossbarEndX: 52, arcDash: 70 } as const;

const WIDTH = 320;
const HEIGHT = 360;
const MARK_ORIGIN: Pt = [90, 110];
const MARK_SCALE = 1.4;

export interface EmptyStateMarkProps {
  /** Rendered width; the height keeps the board's 320 × 360 ratio. Default 320. */
  width?: number;
  /** Which keyframe to draw. `rest` (default) is the resting frame. */
  frame?: 'arcIn' | 'orbit' | 'rest';
}

/** The empty state's mark and circles, at rest. Decorative. */
export function EmptyStateMark({ width = WIDTH, frame = 'rest' }: EmptyStateMarkProps) {
  const { tokens } = useTheme();
  const k = width / WIDTH;
  const markSize = MARK_VIEWBOX * MARK_SCALE * k;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height: HEIGHT * k }}
    >
      <View style={[styles.abs, { left: MARK_ORIGIN[0] * k, top: MARK_ORIGIN[1] * k }]}>
        <StrokeCanvas
          prims={MARK_PRIMS}
          viewBox={MARK_VIEWBOX}
          size={markSize}
          stroke={MARK_STROKE}
          color={tokens.accent}
        />
      </View>
      {EMPTY_CIRCLES.map((c, i) => {
        const [x, y] = c[frame];
        const d = 2 * c.r * k;
        return (
          <View
            key={i}
            style={[
              styles.abs,
              {
                left: x * k - d / 2,
                top: y * k - d / 2,
                width: d,
                height: d,
                borderRadius: d / 2,
                backgroundColor: tokens.avatar[c.palette],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
});
