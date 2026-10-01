import { formatMinor } from '@even/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { typography } from '@/theme';

import { AppText } from './AppText';

export interface AmountDisplayProps {
  /** Integer minor units of `currency`. */
  amount: number;
  currency: string;
  locale?: string;
  /**
   * Nothing typed yet: "$0" (no minor digits) in `iconMuted`, as the first-open boards draw it (Add expense and
   * Settle, extra states).
   */
  empty?: boolean;
  /**
   * The title is being typed (Add expense, extra states: "Typing the title"): one line, 28/34 semibold, the code
   * beside it on its baseline; tapping it goes back to the keypad (`onPress`).
   */
  compact?: boolean;
  onPress?: () => void;
  /**
   * Add expense on a screen shorter than the boards (`fitShortScreen`): the amount's size relative to 60/68, down to
   * half, and `inline` puts the code beside it on its baseline, as `compact` does. The defaults draw the boards.
   */
  scale?: number;
  inline?: boolean;
}

/**
 * "$0" for an amount with nothing typed: the currency's zero without its minor digits ("$0.00" → "$0", "¥0" as
 * is), from core `formatMinor`, so the symbol and its position follow the locale.
 */
export function zeroLabel(currency: string, locale?: string): string {
  return formatMinor(0, currency, locale).replace(/([.,\u066B\u2396])0+(?!\d)/u, '');
}

/**
 * The amount being entered, centred (Add expense, Settle): 60/68 semibold −1.5 tabular, and under it, 2 pt away,
 * the currency code at 13/18 medium with +0.6 tracking in `textMuted`. Announced as it changes.
 */
export function AmountDisplay({
  amount,
  currency,
  locale,
  empty = false,
  compact = false,
  onPress,
  scale = 1,
  inline = false,
}: AmountDisplayProps) {
  const text = empty ? zeroLabel(currency, locale) : formatMinor(amount, currency, locale);
  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Amount ${text}. Edit.`}
        style={styles.compact}
      >
        <AppText
          variant="amountCompact"
          color={empty ? 'iconMuted' : 'text'}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          maxFontSizeMultiplier={1.3}
          style={styles.shrink}
        >
          {text}
        </AppText>
        <AppText variant="currencyCode" color="textMuted" maxFontSizeMultiplier={1.3}>
          {currency}
        </AppText>
      </Pressable>
    );
  }
  const sized = scale === 1 ? null : scaledAmount(scale);
  return (
    <View
      style={inline ? styles.inline : styles.column}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Amount ${text}`}
      accessibilityLiveRegion="polite"
    >
      <AppText
        variant="amount"
        color={empty ? 'iconMuted' : 'text'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.4}
        maxFontSizeMultiplier={1.3}
        align="center"
        style={[sized, inline && styles.shrink]}
      >
        {text}
      </AppText>
      <AppText variant="currencyCode" color="textMuted" maxFontSizeMultiplier={1.3}>
        {currency}
      </AppText>
    </View>
  );
}

/** `typography.amount` (60/68, −1.5) at `scale`. */
function scaledAmount(scale: number) {
  const { fontSize, lineHeight, letterSpacing } = typography.amount;
  return {
    fontSize: fontSize * scale,
    lineHeight: Math.round(lineHeight * scale),
    letterSpacing: letterSpacing * scale,
  };
}

const styles = StyleSheet.create({
  column: { alignItems: 'center', gap: 2, alignSelf: 'stretch' },
  inline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  compact: { flexDirection: 'row', alignItems: 'baseline', gap: 6, maxWidth: '100%' },
  shrink: { flexShrink: 1 },
});
