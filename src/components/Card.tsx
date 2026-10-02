import { Children, Fragment, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { radii, strokes, useTheme, type ThemeTokens } from '@/theme';

import { separatedRowKey } from './cardLogic';

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
  const separatorTone =
    tone === 'fill' || tone === 'inset' ? 'inset' : tone === 'tint' ? 'tint' : 'surface';
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          borderRadius: radii[radius],
          backgroundColor: bg === null ? undefined : (tokens[bg] as string),
          // Clips a pressed row's fill to the card's corners, as the States board's list does.
          overflow: 'hidden',
        },
        tone === 'outline' && { borderWidth: strokes.hairline, borderColor: tokens.border },
        style,
      ]}
    >
      {separatorInset === undefined
        ? children
        : items.map((child, i) => (
            <Fragment key={separatedRowKey(child, i)}>
              {i > 0 && <Separator inset={separatorInset} tone={separatorTone} />}
              {child}
            </Fragment>
          ))}
    </View>
  );
}

/**
 * One row of a `Card` as a view of its own, for a list too long to mount at once (a cell of a virtualised list, Group's
 * Expenses and Activity): the card's fill, its top corners on the first row and its bottom corners on the last, and
 * the separator above every row but the first. Stacked, slices draw exactly the card the same rows make inside one
 * `Card`, the pressed fill clipped to the corners as there.
 */
export function CardSlice({
  children,
  first,
  last,
  tone = 'surface',
  radius = 'card',
  separatorInset,
  style,
}: {
  children: ReactNode;
  first: boolean;
  last: boolean;
  tone?: Exclude<CardTone, 'outline'>;
  radius?: 'card' | 'group';
  /** As `Card`'s: the separator above this row, starting this far from the leading edge. */
  separatorInset?: number;
  style?: ViewProps['style'];
}) {
  const { tokens } = useTheme();
  const bg = BACKGROUND[tone];
  const r = radii[radius];
  const backgroundColor = bg === null ? undefined : (tokens[bg] as string);
  const separator = !first && separatorInset !== undefined && (
    <Separator
      inset={separatorInset}
      tone={tone === 'fill' || tone === 'inset' ? 'inset' : tone === 'tint' ? 'tint' : 'surface'}
    />
  );
  // The corners are the card's own: one uniform radius, as `Card` draws it, run past the slice's open edge and
  // clipped there. Per-corner radii would be drawn by another path on iOS and anti-alias a few pixels differently.
  const rounded = { backgroundColor, overflow: 'hidden' as const, borderRadius: r };
  if (first && last) {
    return (
      <View style={[rounded, style]}>
        {separator}
        {children}
      </View>
    );
  }
  if (!first && !last) {
    return (
      <View style={[{ backgroundColor, overflow: 'hidden' }, style]}>
        {separator}
        {children}
      </View>
    );
  }
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      <View
        style={[
          rounded,
          first ? { marginBottom: -r, paddingBottom: r } : { marginTop: -r, paddingTop: r },
        ]}
      >
        {separator}
        {children}
      </View>
    </View>
  );
}

/**
 * A 1 pt rule inside a list, inset from the leading edge; `inset` tone on fill and inset lists, `tint` inside the
 * soft-accent card (Group, everyone done).
 */
export function Separator({
  inset = 0,
  tone = 'surface',
}: {
  inset?: number;
  tone?: 'surface' | 'inset' | 'tint';
}) {
  const { tokens } = useTheme();
  return (
    <View
      style={{
        height: strokes.hairline,
        marginLeft: inset,
        backgroundColor:
          tone === 'inset'
            ? tokens.separatorInset
            : tone === 'tint'
              ? tokens.separatorTint
              : tokens.separator,
      }}
    />
  );
}
