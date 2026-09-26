import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { StrokeCanvas, type Prim } from './Icon';

/**
 * The brand mark (AppIcon board, "C"): a lowercase "e" whose crossbar runs on into the top bar of an equals sign.
 * Transcribed from the 100-unit SVG, stroke 8, butt caps:
 *   M20 50H84 · M64 50A22 22 0 1 0 56.14 66.85 · M66 63H86
 * The arc is the circle of radius 22 about (42, 50), from the crossbar (0°) the long way round to 50° below it.
 */
export const MARK_PRIMS: readonly Prim[] = [
  { k: 'line', a: [20, 50], b: [84, 50], cap: 'butt' },
  { k: 'arc', c: [42, 50], r: 22, from: 50, to: 360, cap: 'butt' },
  { k: 'line', a: [66, 63], b: [86, 63], cap: 'butt' },
];

export const MARK_VIEWBOX = 100;
export const MARK_STROKE = 8;

export interface MarkProps {
  /** Side of the square the 100-unit mark is drawn in (the icon board uses 240, 60, 52, 44). */
  size: number;
  /** A resolved token colour; the accent by default. */
  color?: string;
}

export function Mark({ size, color }: MarkProps) {
  const { tokens } = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Even">
      <StrokeCanvas
        prims={MARK_PRIMS}
        viewBox={MARK_VIEWBOX}
        size={size}
        stroke={MARK_STROKE}
        color={color ?? tokens.accent}
      />
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
