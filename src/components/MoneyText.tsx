import { formatMinor } from '@even/core';
import { StyleSheet, View } from 'react-native';

import type { FontWeightName, TypographyVariant } from '@/theme';

import { AppText, type TextColor } from './AppText';

export interface MoneyTextProps {
  /** Integer minor units of `currency`. Pass the magnitude; the words around it ("you owe") carry the sign. */
  amount: number;
  /** ISO 4217 code: the group currency. */
  currency: string;
  /** BCP 47 locale for Intl; the device locale when omitted. */
  locale?: string;
  /** `inline` (default): figures in a text style. `big`: the Group header number with the code beside it. */
  size?: 'inline' | 'big';
  /** Type step for `inline` (default `callout`, 16/21). */
  variant?: TypographyVariant;
  /** Default: semibold, as every amount on the canvas except expense rows (medium). */
  weight?: FontWeightName;
  color?: TextColor;
  /** Show the currency code beside the big number (default true for `big`). */
  showCode?: boolean;
  /** `inline` only: shrink a long figure to fit its column (down to 60 %) rather than wrap it. */
  shrink?: boolean;
}

/**
 * An amount formatted by core `formatMinor` (Intl with the currency's ISO exponent), in tabular figures.
 *
 * `big` is the header of Group: 56/64 semibold −1.5, then 8 pt, then the code at 15/20 medium in `textMuted`,
 * sharing a baseline. It shrinks to fit rather than wrapping, and caps Dynamic Type growth at 1.3×.
 */
export function MoneyText({
  amount,
  currency,
  locale,
  size = 'inline',
  variant = 'callout',
  weight = 'semibold',
  color = 'text',
  showCode = true,
  shrink = false,
}: MoneyTextProps) {
  const text = formatMinor(amount, currency, locale);
  if (size === 'big') {
    return (
      <View
        style={styles.big}
        accessible
        accessibilityLabel={showCode ? `${text} ${currency}` : text}
      >
        <AppText
          variant="display"
          color={color}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          maxFontSizeMultiplier={1.3}
          style={styles.shrink}
        >
          {text}
        </AppText>
        {showCode && (
          <AppText variant="currencyInline" color="textMuted" maxFontSizeMultiplier={1.3}>
            {currency}
          </AppText>
        )}
      </View>
    );
  }
  return (
    <AppText
      variant={variant}
      weight={weight}
      color={color}
      tabular
      {...(shrink ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6 } : {})}
    >
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  big: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  shrink: { flexShrink: 1 },
});
