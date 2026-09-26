import { Pressable, StyleSheet, View } from 'react-native';

import { radii, useTheme } from '@/theme';

import { AppText } from './AppText';

export interface Segment<K extends string> {
  key: K;
  label: string;
}

export interface SegmentedControlProps<K extends string> {
  segments: readonly Segment<K>[];
  value: K;
  onChange: (key: K) => void;
  /**
   * `full` (default): fills the width; track padding 3, radius 12; segments 32 tall, radius 9 (Expenses ·
   * Balances · Activity; Equal · Exact · Percent).
   * `compact`: segments 64 wide; track padding 2, radius 10; segments radius 8 (System · Light · Dark).
   */
  size?: 'full' | 'compact';
  /** Spoken name of the group ("Appearance"). */
  accessibilityLabel?: string;
}

/**
 * The canvas's segmented control: `segmentTrack` with 2 pt between segments; the selected one on
 * `segmentThumb` (with a `0 1px 3px` shadow in light) at 14/18 semibold, the others 14/18 medium in
 * `textSecondary`. Each segment extends to a 44 pt target vertically.
 */
export function SegmentedControl<K extends string>({
  segments,
  value,
  onChange,
  size = 'full',
  accessibilityLabel,
}: SegmentedControlProps<K>) {
  const { tokens } = useTheme();
  const compact = size === 'compact';
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.track,
        {
          backgroundColor: tokens.segmentTrack,
          padding: compact ? 2 : 3,
          borderRadius: compact ? radii.cell : radii.control,
          alignSelf: compact ? 'center' : 'stretch',
        },
      ]}
    >
      {segments.map((s) => {
        const selected = s.key === value;
        return (
          <Pressable
            key={s.key}
            onPress={() => onChange(s.key)}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[
              styles.segment,
              compact ? styles.compactSegment : styles.fullSegment,
              {
                borderRadius: compact ? radii.segmentCompact : radii.segment,
              },
              selected && {
                backgroundColor: tokens.segmentThumb,
                boxShadow: `0 1px 3px ${tokens.segmentShadow}`,
              },
            ]}
          >
            <AppText
              variant="segment"
              weight={selected ? 'semibold' : 'medium'}
              color={selected ? 'text' : 'textSecondary'}
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
            >
              {s.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 2 },
  segment: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  fullSegment: { flex: 1, flexBasis: 0 },
  compactSegment: { minWidth: 64, paddingHorizontal: 4 },
});
