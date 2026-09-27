import { Pressable, StyleSheet } from 'react-native';

import { radii, strokes, useTheme } from '@/theme';

import { AppText } from './AppText';

export interface AmountCellProps {
  /** The figure as shown ("$12.00", "15%"). */
  value: string;
  /** 100 for amounts, 76 for percentages (Split boards). */
  width: 100 | 76;
  /** The cell the keypad is typing into: a 2 pt accent ring. */
  active?: boolean;
  onPress?: () => void;
  /** "Amount for Maya". */
  accessibilityLabel: string;
}

/**
 * An amount the keypad types into (Split: Exact and Percent): 40 tall, radius 10, `surface`, the figure 16/21
 * medium tabular, right-aligned in 12 of padding; a 2 pt accent ring while active. A long figure shrinks to fit
 * the cell (down to half size) instead of being cut off.
 */
export function AmountCell({
  value,
  width,
  active = false,
  onPress,
  accessibilityLabel,
}: AmountCellProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: value }}
      accessibilityState={{ selected: active }}
      style={[
        styles.cell,
        {
          width,
          backgroundColor: tokens.surface,
          boxShadow: active ? `0 0 0 ${strokes.ring}px ${tokens.accent}` : undefined,
        },
      ]}
    >
      <AppText
        variant="callout"
        weight="medium"
        tabular
        align="right"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        maxFontSizeMultiplier={1.3}
      >
        {value}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radii.cell,
  },
});
