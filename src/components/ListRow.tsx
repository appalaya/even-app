import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { emojiType, radii, useTheme, type FontWeightName, type TypographyVariant } from '@/theme';

import { AppText, type TextColor } from './AppText';
import { Icon } from './Icon';

/**
 * Row layouts as drawn (min height · padding · title):
 * - `expense`  64 · 10 16 · 16/21 medium, second line 14/19 `textSecondary`; trailing amount over a date (Group).
 * - `settle`   60 · 0 14 0 16 · 16/21; trailing amount and chevron (settle list).
 * - `balance`  54 · 0 16 · 16/21; trailing amount (Balances "Everyone").
 * - `activity` top-aligned · 12 16 · 15/21, second line 13/18 `textMuted` 3 below (Activity).
 * - `settings` 52 · 0 14 0 16 · 16/21; chevron or value (settings sections; pass `minHeight` 48 for About).
 * - `member`   60 · 0 4 0 16 · 16/21 medium, second line 13/18 `textMuted` (Group settings members).
 * - `person`   46 · 0 14 · 16/21 (Done adding sheet).
 * - `choice`   58 · 0 14 · 17/22 (Join: "Which name is yours?").
 * The gap between columns is 12 throughout.
 */
export type ListRowVariant =
  'expense' | 'settle' | 'balance' | 'activity' | 'settings' | 'member' | 'person' | 'choice';

interface Preset {
  minHeight?: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  alignItems: 'center' | 'flex-start';
  title: { variant: TypographyVariant; weight: FontWeightName };
  subtitle: { variant: TypographyVariant; color: TextColor };
  textGap: number;
}

const PRESETS: Record<ListRowVariant, Preset> = {
  expense: {
    minHeight: 64,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 16,
    paddingRight: 16,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'medium' },
    subtitle: { variant: 'footnote', color: 'textSecondary' },
    textGap: 2,
  },
  settle: {
    minHeight: 60,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 16,
    paddingRight: 14,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 2,
  },
  balance: {
    minHeight: 54,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 16,
    paddingRight: 16,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 2,
  },
  activity: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 16,
    paddingRight: 16,
    alignItems: 'flex-start',
    title: { variant: 'subheadLoose', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 3,
  },
  settings: {
    minHeight: 52,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 16,
    paddingRight: 14,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 1,
  },
  member: {
    minHeight: 60,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 16,
    paddingRight: 4,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'medium' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 1,
  },
  person: {
    minHeight: 46,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 14,
    paddingRight: 14,
    alignItems: 'center',
    title: { variant: 'callout', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 1,
  },
  choice: {
    minHeight: 58,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 14,
    paddingRight: 14,
    alignItems: 'center',
    title: { variant: 'body', weight: 'regular' },
    subtitle: { variant: 'caption', color: 'textMuted' },
    textGap: 1,
  },
};

export interface ListRowProps {
  variant?: ListRowVariant;
  /** Avatar, emoji tile (`CategoryTile`) or glyph. */
  leading?: ReactNode;
  /** A string in the variant's style, or a node (e.g. `AppText` with a `Strong` name). */
  title: ReactNode;
  titleColor?: TextColor;
  /** Overrides the variant's title weight (medium for an accent action row: "Move to another server"). */
  titleWeight?: FontWeightName;
  subtitle?: ReactNode;
  /** The value before the chevron: usually a `MoneyText`, or a string in `textMuted` ("Version 1.0 (1)"). */
  detail?: ReactNode;
  /** A caption under `detail` ("Sep 20"), right-aligned. */
  detailCaption?: string;
  /** Anything else at the trailing edge (a `JoinedMark`, "still adding"). */
  trailing?: ReactNode;
  /** A 16 pt chevron in `glyph` (or the accent, on a tinted card). */
  chevron?: boolean | 'accent';
  onPress?: () => void;
  /** Overrides the variant's minimum height (48 for the About rows). */
  minHeight?: number;
  /** Overrides the trailing padding (8 for the "You" row that ends in an "I'm done" pill). */
  paddingRight?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function ListRow({
  variant = 'settings',
  leading,
  title,
  titleColor = 'text',
  titleWeight,
  subtitle,
  detail,
  detailCaption,
  trailing,
  chevron,
  onPress,
  minHeight,
  paddingRight,
  accessibilityLabel,
  accessibilityHint,
}: ListRowProps) {
  const { tokens } = useTheme();
  const p = PRESETS[variant];

  const body = (
    <>
      {leading}
      <View style={[styles.text, { gap: p.textGap }]}>
        {typeof title === 'string' ? (
          <AppText
            variant={p.title.variant}
            weight={titleWeight ?? p.title.weight}
            color={titleColor}
          >
            {title}
          </AppText>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <AppText variant={p.subtitle.variant} color={p.subtitle.color}>
            {subtitle}
          </AppText>
        ) : (
          subtitle
        )}
      </View>
      {(detail !== undefined || detailCaption !== undefined) && (
        <View style={styles.detail}>
          {typeof detail === 'string' ? (
            <AppText variant="callout" color="textMuted" tabular>
              {detail}
            </AppText>
          ) : (
            detail
          )}
          {detailCaption !== undefined && (
            <AppText variant="caption" color="textMuted">
              {detailCaption}
            </AppText>
          )}
        </View>
      )}
      {trailing}
      {chevron !== undefined && chevron !== false && (
        <Icon
          name="chevronRight"
          size={16}
          color={chevron === 'accent' ? tokens.accent : tokens.glyph}
        />
      )}
    </>
  );

  const rowStyle = {
    minHeight: minHeight ?? p.minHeight,
    paddingTop: p.paddingTop,
    paddingBottom: p.paddingBottom,
    paddingLeft: p.paddingLeft,
    paddingRight: paddingRight ?? p.paddingRight,
    alignItems: p.alignItems,
  };

  if (onPress === undefined) {
    return (
      <View
        style={[styles.row, rowStyle]}
        accessible={accessibilityLabel !== undefined}
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.row, rowStyle, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

/** The 40 pt rounded tile holding a category emoji at the start of an expense row. */
export function CategoryTile({ emoji }: { emoji: string }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { backgroundColor: tokens.tile }]}
    >
      <AppText style={emojiType.tile} maxFontSizeMultiplier={1}>
        {emoji}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  text: { flex: 1, minWidth: 0 },
  detail: { flexShrink: 0, alignItems: 'flex-end', gap: 2 },
  pressed: { opacity: 0.6 },
  tile: {
    width: 40,
    height: 40,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
