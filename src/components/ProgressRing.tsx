import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

export interface ProgressRingProps {
  /** Diameter in points: 16 as drawn (Invite card, preparing; Group settings, invite still preparing). */
  size?: number;
}

/**
 * The small indeterminate ring beside "Preparing your invite…": an `outline` track and an accent quarter arc
 * (stroke 2.6 in a 24-unit viewBox), turning once a second; held still under Reduce Motion. Decorative: the text
 * beside it carries the meaning.
 */
export function ProgressRing({ size = 16 }: ProgressRingProps) {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(turn);
      turn.set(0);
      return;
    }
    turn.set(withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [reduceMotion, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  return (
    <Animated.View
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={9} stroke={tokens.outline} strokeWidth={2.6} />
        <Path
          d="M12 3a9 9 0 0 1 9 9"
          stroke={tokens.accent}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}
