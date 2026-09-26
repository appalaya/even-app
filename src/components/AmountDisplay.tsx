import { formatMinor } from '@even/core';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';

export interface AmountDisplayProps {
  /** Integer minor units of `currency`. */
  amount: number;
  currency: string;
  locale?: string;
}

/**
 * The amount being entered, centred (Add expense, Settle): 60/68 semibold −1.5 tabular, and under it, 2 pt away,
 * the currency code at 13/18 medium with +0.6 tracking in `textMuted`. Announced as it changes.
 */
export function AmountDisplay({ amount, currency, locale }: AmountDisplayProps) {
  const text = formatMinor(amount, currency, locale);
  return (
    <View
      style={styles.column}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Amount ${text}`}
      accessibilityLiveRegion="polite"
    >
      <AppText
        variant="amount"
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.3}
        align="center"
      >
        {text}
      </AppText>
      <AppText variant="currencyCode" color="textMuted" maxFontSizeMultiplier={1.3}>
        {currency}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'center', gap: 2 },
});
