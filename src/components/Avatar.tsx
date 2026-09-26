import { initialsOf, memberColor } from '@even/core';
import { StyleSheet, Text, View, type ViewProps } from 'react-native';

import { avatarType, fontWeight, strokes, useTheme, type AvatarSize } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface AvatarProps {
  /** Diameter as drawn: 24, 26, 28, 30, 32, 36 or 72. */
  size: AvatarSize;
  /** The member's name: initials come from core `initialsOf` when `initials` is absent. */
  name?: string;
  initials?: string;
  /** One emoji grapheme; shown instead of initials on a neutral backdrop. */
  emoji?: string;
  /** Palette index (core `MemberState.color`); or pass `memberId` and core `memberColor` picks it. */
  color?: number;
  memberId?: string;
  /**
   * Still adding (the done-adding row and sheet): a 1.5 pt dashed outline in `iconMuted`, no fill, initials in
   * `textMuted`.
   */
  outlined?: boolean;
  /** What the avatar sits on, which picks an emoji avatar's backdrop: `separator` on surface, `separatorInset`
   * on a fill or inset list, `surface` on a fill card (the 72 pt avatar under Create). Default `surface`. */
  on?: 'surface' | 'inset' | 'fill';
  /** Opaque colour behind an outlined avatar, so it covers the one it overlaps in a stack. */
  backdrop?: string;
  /** A 2 pt ring in the container colour, separating stacked avatars. */
  ring?: string;
  /** The pencil badge on the You card (26 pt, accent, 3 pt ring in `badgeRing`). */
  badge?: 'pencil';
  /** The container colour around the badge. Default `surface`. */
  badgeRing?: string;
  /** Not included in a split: 40 % opacity. */
  dimmed?: boolean;
  style?: ViewProps['style'];
}

/**
 * A member's avatar: initials on their palette colour, or their emoji on a neutral backdrop. Decorative by
 * default (the name is always beside it); a lone avatar should be wrapped in a labelled control.
 */
export function Avatar({
  size,
  name,
  initials,
  emoji,
  color,
  memberId,
  outlined = false,
  on = 'surface',
  backdrop,
  ring,
  badge,
  badgeRing,
  dimmed = false,
  style,
}: AvatarProps) {
  const { tokens } = useTheme();
  const index = color ?? (memberId !== undefined ? memberColor(memberId) : 0);
  const letters = initials ?? (name !== undefined ? initialsOf(name) : '?');
  const glyphs = avatarType[size];

  const emojiBackdrop =
    on === 'surface' ? tokens.separator : on === 'inset' ? tokens.separatorInset : tokens.surface;
  const background = outlined
    ? (backdrop ?? 'transparent')
    : emoji !== undefined
      ? emojiBackdrop
      : tokens.avatar[index % tokens.avatar.length];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        outlined && {
          borderWidth: strokes.dashed,
          borderStyle: 'dashed',
          borderColor: tokens.iconMuted,
        },
        ring !== undefined && { boxShadow: `0 0 0 ${strokes.ring}px ${ring}` },
        dimmed && styles.dimmed,
        style,
      ]}
    >
      {emoji !== undefined ? (
        <Text style={glyphs.emoji} maxFontSizeMultiplier={1}>
          {emoji}
        </Text>
      ) : (
        <Text
          maxFontSizeMultiplier={1}
          style={[
            glyphs.initials,
            { fontWeight: fontWeight.semibold },
            { color: outlined ? tokens.textMuted : tokens.onAvatar },
          ]}
        >
          {letters}
        </Text>
      )}
      {badge === 'pencil' && (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: tokens.accent,
              boxShadow: `0 0 0 ${strokes.badgeRing}px ${badgeRing ?? tokens.surface}`,
            },
          ]}
        >
          <Icon name="pencil" size={12} color={tokens.onAccent} />
        </View>
      )}
    </View>
  );
}

/** The dashed accent circle with a plus that leads "Add member" and "I'm not listed" (36 pt). */
export function AddAvatar({ size = 36 }: { size?: 36 }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: strokes.dashed,
        borderStyle: 'dashed',
        borderColor: tokens.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name="plus" size={16} color={tokens.accent} />
    </View>
  );
}

/**
 * The joined mark as the States board draws it: a check (stroke 2.8) 4 pt before a 13/18 caption, both in
 * `textMuted`, at the trailing edge of a row or under a name, never on the avatar. 13 pt beside a 17/22 name (Join,
 * States); 12 pt under a 16/21 name or in a 16/21 row (Group settings "joined · this phone", Done adding "done").
 */
export function JoinedMark({ label = 'joined', size = 12 }: { label?: string; size?: 12 | 13 }) {
  const { tokens } = useTheme();
  return (
    <View style={styles.joined}>
      <Icon name="check" size={size} color={tokens.textMuted} strokeWidth={2.8} />
      <AppText variant="caption" color="textMuted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  dimmed: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joined: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
