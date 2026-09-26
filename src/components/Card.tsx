import { Children, Fragment, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { radii, strokes, useTheme, type ThemeTokens } from '@/theme';

/**
 * - `surface`: a card on the canvas (lists on Group, settings sections, group cards).
 * - `fill`: a list or card inside a sheet or on a surface card (Split's member list, the You card under Create).
 * - `inset`: a grouped list inside a sheet (Done adding, Join).
 * - `tint`: the soft-accent card (the settle list once everyone is done).
 * - `outline`: a 1 pt `border` and no fill (the archive offer, a read invite code).
 */
export type CardTone = 'surface' | 'fill' | 'inset' | 'tint' | 'outline';

const BACKGROUND: Record<CardTone, keyof ThemeTokens | null> = {
  surface: 'surface',
  fill: 'fill',
  inset: 'surfaceInset',
  tint: 'accentSoft',
  outline: null,
};

export interface CardProps {
  children: ReactNode;
  tone?: CardTone;
  /** `card` 18 (lists on Group, group cards), `group` 16 (settings sections, lists in sheets). Default `card`. */
  radius?: 'card' | 'group';
  /**
   * Put a 1 pt separator between children, starting this far from the leading edge (60 after a 32 pt avatar,
   * 68 after a 40 pt tile, 16 for text-only settings rows).
   */
  separatorInset?: number;
  style?: ViewProps['style'];
  accessibilityLabel?: string;
}

/** A rounded container. Rows inside carry their own padding. */
export function Card({
  children,
  tone = 'surface',
  radius = 'card',
  separatorInset,
  style,
  accessibilityLabel,
}: CardProps) {
  const { tokens } = useTheme();
  const bg = BACKGROUND[tone];
  const items = Children.toArray(children);
  const onFill = tone === 'fill' || tone === 'inset';
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          borderRadius: radii[radius],
          backgroundColor: bg === null ? undefined : (tokens[bg] as string),
        },
        tone === 'outline' && { borderWidth: strokes.hairline, borderColor: tokens.border },
        style,
      ]}
    >
      {separatorInset === undefined
        ? children
        : items.map((child, i) => (
            <Fragment key={i}>
              {i > 0 && <Separator inset={separatorInset} tone={onFill ? 'inset' : 'surface'} />}
              {child}
            </Fragment>
          ))}
    </View>
  );
}

/** A 1 pt rule inside a list, inset from the leading edge; `inset` tone on fill and inset lists. */
export function Separator({
  inset = 0,
  tone = 'surface',
}: {
  inset?: number;
  tone?: 'surface' | 'inset';
}) {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        height: strokes.hairline,
        marginLeft: inset,
        backgroundColor: tone === 'inset' ? tokens.separatorInset : tokens.separator,
      }}
    />
  );
}
