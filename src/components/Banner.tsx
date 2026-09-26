import { Pressable, StyleSheet, View } from 'react-native';

import { layout, radii, strokes, useTheme, type FontWeightName } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/**
 * Banners under Group's nav bar (design.md "Banners, when relevant"). Drawn on the canvas:
 * - `unreadable` (Group · dark): info glyph, "2 entries couldn't be read", "Details".
 * - `archived` (Group, archived): archive glyph, "Archived · read-only" (medium), "Unarchive".
 * Not drawn: `updateRequired`, `closed`, `moved`. They reuse the drawn anatomy with the info glyph and the
 * caller's copy until the canvas has them (see the kit report).
 */
export type BannerVariant = 'unreadable' | 'archived' | 'updateRequired' | 'closed' | 'moved';

const SPEC: Record<BannerVariant, { icon: IconName; weight: FontWeightName }> = {
  unreadable: { icon: 'info', weight: 'regular' },
  archived: { icon: 'archive', weight: 'medium' },
  updateRequired: { icon: 'info', weight: 'regular' },
  closed: { icon: 'info', weight: 'regular' },
  moved: { icon: 'info', weight: 'regular' },
};

export interface BannerProps {
  variant: BannerVariant;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * `surface` with a 1 pt `border`, radius 14, padding 0 6 0 14; a 20 pt glyph in `textSecondary`, 12 pt gap,
 * the message at 15/20, and a 44 pt quiet action at 15/20 semibold in the accent.
 */
export function Banner({ variant, message, actionLabel, onAction }: BannerProps) {
  const { tokens } = useTheme();
  const spec = SPEC[variant];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: tokens.surface,
          borderColor: tokens.border,
        },
      ]}
    >
      <Icon name={spec.icon} size={20} color={tokens.textSecondary} />
      <AppText variant="subhead" weight={spec.weight} style={styles.message}>
        {message}
      </AppText>
      {actionLabel !== undefined && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText variant="subhead" weight="semibold" color="accent">
            {actionLabel}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: layout.tapTarget + 2 * strokes.hairline,
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: strokes.hairline,
    borderRadius: radii.tile,
  },
  message: { flex: 1, paddingVertical: 12 },
  action: { minHeight: layout.tapTarget, paddingHorizontal: 10, justifyContent: 'center' },
  pressed: { opacity: 0.5 },
});
