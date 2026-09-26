import { StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

/**
 * The brand mark (IconOptions board, "C · e =", chosen; AppIcon board): a lowercase "e" whose crossbar runs on
 * into the top bar of an equals sign. The board's 100-unit SVG, verbatim: stroke 8, no fill, butt caps (the
 * boards set no `stroke-linecap`), the accent colour.
 */
export const MARK_PATHS = ['M20 50H84', 'M64 50A22 22 0 1 0 56.14 66.85', 'M66 63H86'] as const;
export const MARK_VIEWBOX = 100;
export const MARK_STROKE = 8;

/** The mark's paths as SVG children, for a caller that places them in its own `Svg` (the empty state). */
export function MarkPaths({
  color,
  paths = MARK_PATHS,
}: {
  color: string;
  paths?: readonly string[];
}) {
  return (
    <G fill="none" stroke={color} strokeWidth={MARK_STROKE}>
      {paths.map((d) => (
        <Path key={d} d={d} />
      ))}
    </G>
  );
}

export interface MarkProps {
  /** Side of the square the 100-unit mark is drawn in (the boards use 240, 60, 52, 44). */
  size: number;
  /** A resolved token colour; the accent by default. */
  color?: string;
}

export function Mark({ size, color }: MarkProps) {
  const { tokens } = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Even">
      <Svg width={size} height={size} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}>
        <MarkPaths color={color ?? tokens.accent} />
      </Svg>
    </View>
  );
}

export interface WordmarkProps {
  /**
   * `header`: the word alone, 34/41 bold −0.8, as the Groups (empty) header draws it.
   * `lockup`: the 52 pt mark, 12 pt gap, the word at 44/48 bold −1.2 (AppIcon board).
   */
  variant?: 'header' | 'lockup';
}

export function Wordmark({ variant = 'header' }: WordmarkProps) {
  if (variant === 'header') {
    return (
      <AppText variant="wordmark" accessibilityRole="header">
        Even
      </AppText>
    );
  }
  return (
    <View style={styles.lockup} accessible accessibilityRole="header" accessibilityLabel="Even">
      <Mark size={52} />
      <AppText variant="wordmarkLockup">Even</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
