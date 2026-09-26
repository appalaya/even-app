import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { layout } from '@/theme';

import { AppText } from './AppText';

/**
 * - `group`: 15/20 semibold `textSecondary` over a list on Group ("Everyone", "Today", "Spend by category ·
 *   $1,780.00"); 20 above, 8 below.
 * - `settings`: 13/18 semibold `textSecondary` over a settings section or a list in a sheet ("Invite", "Members",
 *   "Still adding · 5"); 24 above, 6 below.
 * - `title`: 17/22 semibold `text` ("Settle up" once everyone is done); 18 above, 8 below.
 */
export type SectionHeaderVariant = 'group' | 'settings' | 'title';

const SPEC = {
  group: { variant: 'subhead', color: 'textSecondary', top: 20, bottom: 8 },
  settings: { variant: 'caption', color: 'textSecondary', top: 24, bottom: 6 },
  title: { variant: 'body', color: 'text', top: 18, bottom: 8 },
} as const;

export interface SectionHeaderProps {
  children: ReactNode;
  variant?: SectionHeaderVariant;
  /** Space above, when the board differs from the variant's default (e.g. 16 for the first settings section). */
  spacingTop?: number;
  /** Tabular figures (a header carrying a total). */
  tabular?: boolean;
}

/** A heading on the canvas, inset 20 from the screen edge (the text inset, 4 inside the cards' gutter). */
export function SectionHeader({
  children,
  variant = 'group',
  spacingTop,
  tabular,
}: SectionHeaderProps) {
  const spec = SPEC[variant];
  return (
    <View style={[styles.wrap, { marginTop: spacingTop ?? spec.top, marginBottom: spec.bottom }]}>
      <AppText
        variant={spec.variant}
        color={spec.color}
        weight="semibold"
        tabular={tabular}
        accessibilityRole="header"
      >
        {children}
      </AppText>
    </View>
  );
}

/** A caption under a card: 13/18 `textMuted`, 6 below the card, inset 20. `center` for a sheet footnote. */
export function Footnote({
  children,
  align = 'left',
  spacingTop = 6,
}: {
  children: ReactNode;
  align?: 'left' | 'center';
  spacingTop?: number;
}) {
  return (
    <View style={[styles.wrap, { marginTop: spacingTop }]}>
      <AppText variant="caption" color="textMuted" align={align}>
        {children}
      </AppText>
    </View>
  );
}

/** A field label: 13/18 medium `textSecondary`, 4 in from the field's edge (Create group, Settle). */
export function FieldLabel({ children, nativeID }: { children: ReactNode; nativeID?: string }) {
  return (
    <AppText
      variant="caption"
      color="textSecondary"
      weight="medium"
      nativeID={nativeID}
      style={styles.label}
    >
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: layout.textInset },
  label: { paddingHorizontal: 4 },
});
