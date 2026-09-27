import { Pressable, StyleSheet, View } from 'react-native';

import { layout, radii, strokes, useTheme, type FontWeightName } from '@/theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

/**
 * Banners under a nav bar (design.md "Banners, when relevant"), each as a board draws it:
 * - `unreadable` (Group · dark): info glyph, "2 entries couldn't be read", "Details".
 * - `archived` (Group, archived): archive glyph, "Archived · read-only" (medium), "Unarchive".
 * - `updateRequired` (States): arrow-up-in-circle glyph, "Update Even to see everything in this group.", "Update".
 * - `closed` (States; Group screen copy): lock glyph, "This group's invite was regenerated. Ask a member for the new one.",
 *   "Paste".
 * - `moved` (States): arrow glyph, "Maya moved this group to sync.example.net. Follow?", "Follow".
 * - `collision` (Group screen copy): members glyph, "Two members are named Maya. Rename one in settings.",
 *   "Settings".
 * - `flagged` (Expense detail, flagged; Group screen copy, different currency): warning glyph and the reason, no
 *   action, padded 8 · 14.
 * The action is drawn only when the variant has one and `onAction` is given, so any banner can stand without it.
 */
export type BannerVariant =
  'unreadable' | 'archived' | 'updateRequired' | 'closed' | 'moved' | 'collision' | 'flagged';

interface Spec {
  icon: IconName;
  weight: FontWeightName;
  /** The board's action label, if the board draws one. */
  action?: string;
  /** The board's copy, where it does not depend on the group. */
  message?: string;
  /**
   * The States board pads its banners 6 all round inside a 56 pt minimum; Group's two banners pad 0 vertically,
   * so the 44 pt action sets their height; a banner without an action pads 8 · 14 (Expense detail, flagged).
   */
  padded: boolean;
}

const SPEC: Record<BannerVariant, Spec> = {
  unreadable: { icon: 'info', weight: 'regular', action: 'Details', padded: false },
  archived: { icon: 'archive', weight: 'medium', action: 'Unarchive', padded: false },
  updateRequired: {
    icon: 'update',
    weight: 'regular',
    action: 'Update',
    message: 'Update Even to see everything in this group.',
    padded: true,
  },
  closed: {
    icon: 'lock',
    weight: 'regular',
    action: 'Paste',
    message: "This group's invite was regenerated. Ask a member for the new one.",
    padded: true,
  },
  moved: { icon: 'arrowRight', weight: 'regular', action: 'Follow', padded: true },
  collision: { icon: 'members', weight: 'regular', action: 'Settings', padded: true },
  flagged: { icon: 'warning', weight: 'regular', padded: true },
};

/** The `moved` banner's copy: "Maya moved this group to sync.example.net. Follow?" */
export function movedMessage(movedBy: string, host: string): string {
  return `${movedBy} moved this group to ${host}. Follow?`;
}

/** The `collision` banner's copy: "Two members are named Maya. Rename one in settings." */
export function collisionMessage(name: string, count = 2): string {
  const number = count === 2 ? 'Two' : String(count);
  return `${number} members are named ${name}. Rename one in settings.`;
}

interface BannerCommon {
  /** Overrides the board's action label. */
  actionLabel?: string;
  /** The action; without it the banner is drawn without one. */
  onAction?: () => void;
}

export type BannerProps = BannerCommon &
  (
    | {
        variant: 'updateRequired' | 'closed';
        /** Defaults to the board's copy. */
        message?: string;
      }
    | {
        variant: 'unreadable' | 'archived' | 'moved' | 'collision' | 'flagged';
        /** The group's own line ("2 entries couldn't be read"; `movedMessage(by, host)` for `moved`). */
        message: string;
      }
  );

/**
 * `surface` with a 1 pt `border`, radius 14, padding 14 at the leading edge and 6 at the trailing; a 20 pt glyph
 * in `textSecondary`, 12 pt gap, the message at 15/20, and a 44 pt quiet action at 15/20 semibold in the accent
 * (padding 0 10). Without an action the banner pads 8 · 14.
 */
export function Banner(props: BannerProps) {
  const { variant, actionLabel, onAction } = props;
  const { tokens } = useTheme();
  const spec = SPEC[variant];
  const message = props.message ?? spec.message ?? '';
  const label = actionLabel ?? spec.action;
  const action = label !== undefined && onAction !== undefined;
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={action ? undefined : 'alert'}
      style={[
        styles.banner,
        !action ? styles.bare : spec.padded ? styles.padded : styles.flush,
        { backgroundColor: tokens.surface, borderColor: tokens.border },
      ]}
    >
      <Icon name={spec.icon} size={20} color={tokens.textSecondary} />
      <AppText
        variant="subhead"
        weight={spec.weight}
        style={[styles.message, action && !spec.padded && styles.messageFlush]}
      >
        {message}
      </AppText>
      {action && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <AppText variant="subhead" weight="semibold" color="accent">
            {label}
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
    paddingLeft: 14,
    paddingRight: 6,
    borderWidth: strokes.hairline,
    borderRadius: radii.tile,
  },
  /** States: min-height 56 (border box), padding 6 6 6 14. */
  padded: { minHeight: 56, paddingVertical: 6 },
  /** Group: padding 0 6 0 14; the 44 pt action and the 1 pt border make it 46. */
  flush: { minHeight: layout.tapTarget + 2 * strokes.hairline },
  /** No action (Expense detail, flagged; different currency): min-height 56, padding 8 14. */
  bare: { minHeight: 56, paddingVertical: 8, paddingRight: 14 },
  message: { flex: 1 },
  /** Keeps a wrapped message off the border where the banner has no vertical padding of its own. */
  messageFlush: { paddingVertical: 12 },
  action: { minHeight: layout.tapTarget, paddingHorizontal: 10, justifyContent: 'center' },
  pressed: { opacity: 0.5 },
});
