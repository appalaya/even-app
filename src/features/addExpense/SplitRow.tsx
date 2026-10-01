import { Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';

import { AppText, Icon } from '@/components';
import { radii, useTheme } from '@/theme';

/** The gap above the Split row, under Paid by and the date. */
export const SPLIT_ROW_GAP = 8;

/**
 * The Split row on Add expense, as drawn: 52 tall on `fill`, radius 16, padding 0 14 0 16, 10 apart; "Split" 15/20
 * `textSecondary`, the rule 15/20 semibold, the per-person figure 15/20 `textMuted` tabular, a 16 pt chevron in
 * `iconMuted`. `fillPressed` while pressed (States board, chips on `fill`). No kit row has these metrics (ListRow is
 * 16/21 with 12 gaps), so it is composed here.
 */
export function SplitRow({
  label,
  detail,
  onPress,
  onLayout,
}: {
  label: string;
  detail: string | null;
  onPress: () => void;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={`Split: ${label}${detail === null ? '' : `, ${detail}`}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? tokens.fillPressed : tokens.fill },
      ]}
    >
      <AppText variant="subhead" color="textSecondary">
        Split
      </AppText>
      <AppText variant="subhead" weight="semibold" numberOfLines={1} style={styles.label}>
        {label}
      </AppText>
      {detail !== null && (
        <AppText variant="subhead" color="textMuted" tabular>
          {detail}
        </AppText>
      )}
      <Icon name="chevronRight" size={16} color={tokens.iconMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    marginTop: SPLIT_ROW_GAP,
    marginHorizontal: 16,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radii.group,
  },
  label: { flex: 1 },
});
