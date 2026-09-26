import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import {
  fontWeight,
  tabularNums,
  typography,
  useTheme,
  type FontWeightName,
  type TypographyVariant,
} from '@/theme';

/** The token names text may take. */
export type TextColor =
  | 'text'
  | 'textSecondary'
  | 'textMuted'
  | 'textDisabled'
  | 'onDisabledFill'
  | 'glyph'
  | 'accent'
  | 'onAccent'
  | 'onAvatar';

export interface AppTextProps extends TextProps {
  /** A step of the canvas type scale (`src/theme/typography.ts`). Default `body` (17/22). */
  variant?: TypographyVariant;
  /** Default `text`. */
  color?: TextColor;
  /** Overrides the variant's weight. */
  weight?: FontWeightName;
  /** Tabular figures (money, counts, percentages). */
  tabular?: boolean;
  align?: TextStyle['textAlign'];
  children?: ReactNode;
}

/**
 * Text in one of the canvas type styles and a semantic colour. Scales with Dynamic Type (the OS default), so
 * never put it in a fixed-height box; rows use `minHeight`.
 */
export function AppText({
  variant = 'body',
  color = 'text',
  weight,
  tabular,
  align,
  style,
  ...rest
}: AppTextProps) {
  const { tokens } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        typography[variant],
        { color: tokens[color] },
        weight !== undefined && { fontWeight: fontWeight[weight] },
        tabular === true && tabularNums,
        align !== undefined && { textAlign: align },
        style,
      ]}
    />
  );
}

/**
 * An emphasised run inside `AppText` ("**Maya** is owed", "Done adding · 7 of 12"). Inherits size and colour from
 * the parent text; sets only weight (and colour, when given).
 */
export function Strong({
  children,
  weight = 'semibold',
  color,
}: {
  children: ReactNode;
  weight?: FontWeightName;
  color?: TextColor;
}) {
  const { tokens } = useTheme();
  return (
    <Text
      style={[{ fontWeight: fontWeight[weight] }, color !== undefined && { color: tokens[color] }]}
    >
      {children}
    </Text>
  );
}
