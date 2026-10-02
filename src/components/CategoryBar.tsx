import { CATEGORY_EMOJI, CATEGORY_LABEL, displayMinor, type Category } from '@even/core';
import { StyleSheet, View } from 'react-native';

import { emojiType, radii, useTheme } from '@/theme';

import { AppText } from './AppText';

export interface CategoryBarProps {
  category: Category;
  /** Minor units spent in this category. */
  amount: number;
  /** Minor units spent in the group, all categories: the bar is `amount / total` of the track. */
  total: number;
  currency: string;
  locale?: string;
}

/**
 * One row of "Spend by category" (Balances): padding 9 16, the emoji in a 24 pt column (18/22), 10 pt gaps, the
 * label 15/20, the amount 15/20 medium tabular, the percent of the total 13/18 `textMuted` right-aligned in 40 pt;
 * 6 below, a 6 pt bar (radius 3) under the label column, proportional to the total, in `accentBar` on `barTrack`.
 */
export function CategoryBar({ category, amount, total, currency, locale }: CategoryBarProps) {
  const { tokens } = useTheme();
  const share = total > 0 ? Math.min(1, Math.max(0, amount / total)) : 0;
  const percent = Math.round(share * 100);
  const money = displayMinor(amount, currency, locale);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${CATEGORY_LABEL[category]}, ${money}, ${percent} percent`}
    >
      <View style={styles.line}>
        <AppText style={[emojiType.chip, styles.emoji]} maxFontSizeMultiplier={1.2}>
          {CATEGORY_EMOJI[category]}
        </AppText>
        <AppText variant="subhead" style={styles.label}>
          {CATEGORY_LABEL[category]}
        </AppText>
        <AppText variant="subhead" weight="medium" tabular>
          {money}
        </AppText>
        <AppText variant="caption" color="textMuted" tabular align="right" style={styles.percent}>
          {`${percent}%`}
        </AppText>
      </View>
      <View style={[styles.track, { backgroundColor: tokens.barTrack }]}>
        <View
          style={[styles.fill, { width: `${share * 100}%`, backgroundColor: tokens.accentBar }]}
        />
      </View>
    </View>
  );
}

export interface CategoryBarsProps {
  rows: readonly { category: Category; amount: number }[];
  /** The group's total spend (the header's figure); the sum of `rows` when omitted. */
  total?: number;
  currency: string;
  locale?: string;
}

/** The rows of "Spend by category", largest first as given, inside a card padded 4 top and bottom. */
export function CategoryBars({ rows, total, currency, locale }: CategoryBarsProps) {
  const sum = total ?? rows.reduce((acc, r) => acc + r.amount, 0);
  return (
    <View style={styles.list}>
      {rows.map((r) => (
        <CategoryBar
          key={r.category}
          category={r.category}
          amount={r.amount}
          total={sum}
          currency={currency}
          locale={locale}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 4 },
  row: { gap: 6, paddingVertical: 9, paddingHorizontal: 16 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji: { width: 24, textAlign: 'center' },
  label: { flex: 1 },
  percent: { width: 40 },
  track: { height: 6, marginLeft: 34, borderRadius: radii.bar, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radii.bar },
});
