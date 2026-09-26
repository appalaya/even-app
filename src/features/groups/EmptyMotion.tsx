/**
 * The empty state's mark and nine circles, moving as the EmptyMotion board draws them: the mark draws in (0–0.8 s),
 * the circles arc in (0.6–2.2 s) and settle onto their orbit (2.2–3.0 s), then the orbit breathes ±3 % over 4 s.
 * Plays once per mount. Under Reduce Motion only the rest frame is drawn (the kit's `EmptyStateMark`).
 *
 * The geometry is the kit's (`EMPTY_CIRCLES`, `MARK_PATHS`, the 320 × 360 board space with the mark under
 * `translate(90 110) scale(1.4)`); the timing lives in `emptyMotionPath.ts`, where a test pins it to the keyframes.
 */
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { EMPTY_CIRCLES, EmptyStateMark, MARK_PATHS, MARK_STROKE } from '@/components';
import { useTheme } from '@/theme';

import {
  buildCirclePaths,
  CANVAS,
  circleAt,
  MARK_LENGTHS,
  markAt,
  TIMING,
  type CirclePath,
} from './emptyMotionPath';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const [CROSSBAR_D, ARC_D, BAR_D] = MARK_PATHS;

export interface EmptyMotionProps {
  /** Rendered width; the height keeps the board's 320 × 360. Default 320. */
  width?: number;
  /** Dev screenshots: hold the motion at this many milliseconds instead of playing it. */
  at?: number;
}

export function EmptyMotion({ width = CANVAS.width, at }: EmptyMotionProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <EmptyStateMark width={width} frame="rest" />;
  return <Playing width={width} at={at} />;
}

function Playing({ width, at }: { width: number; at: number | undefined }) {
  const { tokens } = useTheme();
  const time = useSharedValue(at ?? 0);
  const breath = useSharedValue(0);
  const paths = useMemo(() => buildCirclePaths(EMPTY_CIRCLES), []);

  useEffect(() => {
    if (at !== undefined) {
      time.set(at);
      return;
    }
    time.set(0);
    breath.set(0);
    time.set(
      withTiming(TIMING.rest, { duration: TIMING.rest, easing: Easing.linear }, (finished) => {
        'worklet';
        if (finished !== true) return;
        breath.set(
          withRepeat(
            withTiming(1, { duration: TIMING.breathPeriod, easing: Easing.linear }),
            -1,
            false,
          ),
        );
      }),
    );
  }, [at, time, breath]);

  const height = (CANVAS.height * width) / CANVAS.width;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height }}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}>
        <G
          transform="translate(90 110) scale(1.4)"
          fill="none"
          stroke={tokens.accent}
          strokeWidth={MARK_STROKE}
        >
          <MarkStroke d={CROSSBAR_D} length={MARK_LENGTHS.crossbar} time={time} part="crossbar" />
          <MarkStroke d={ARC_D} length={MARK_LENGTHS.arc} time={time} part="arc" />
          <MarkStroke d={BAR_D} length={MARK_LENGTHS.bar} time={time} part="bar" />
        </G>
        {paths.map((p, i) => (
          <MovingCircle
            key={i}
            path={p}
            fill={tokens.avatar[p.palette] ?? tokens.accent}
            time={time}
            breath={breath}
          />
        ))}
      </Svg>
    </View>
  );
}

function MarkStroke({
  d,
  length,
  time,
  part,
}: {
  d: string | undefined;
  length: number;
  time: SharedValue<number>;
  part: 'crossbar' | 'arc' | 'bar';
}) {
  const props = useAnimatedProps(() => {
    const drawn = markAt(time.get())[part];
    return { strokeDashoffset: length * (1 - drawn) };
  });
  if (d === undefined) return null;
  return <AnimatedPath d={d} strokeDasharray={[length, length]} animatedProps={props} />;
}

function MovingCircle({
  path,
  fill,
  time,
  breath,
}: {
  path: CirclePath;
  fill: string;
  time: SharedValue<number>;
  breath: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => {
    const c = circleAt(path, time.get(), breath.get());
    return { cx: c.x, cy: c.y, opacity: c.opacity };
  });
  return <AnimatedCircle r={path.r} fill={fill} animatedProps={props} />;
}
