import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { AVATAR_STACK_MAX, stackLayout } from './avatarStackLogic';

export interface StackMember {
  id: string;
  name?: string;
  initials?: string;
  emoji?: string;
  /** Palette index (core `MemberState.color`). */
  color?: number;
  /** Done adding: filled. Still adding: dashed outline. */
  done: boolean;
}

export interface AvatarStackProps {
  /**
   * Everyone in the group, in any order. The stack sorts them itself (`stackLayout`): still adding first
   * (outlined), then done (filled), each half in the order given.
   */
  members: readonly StackMember[];
  /** At most this many avatars, then a "+N" chip (default 5, as design.md and the 12-member board). */
  max?: number;
  /**
   * 28 on Group (overlap 6), 26 on the 12-member Group (overlap 7, with the "+N" chip), 24 for the people row
   * under a new group's invite card (overlap 6).
   */
  size?: 24 | 26 | 28;
  /** Colour of the 2 pt ring between filled avatars: the container (`surface` in a card, `background` on the
   * canvas). */
  ringColor?: string;
}

/** The done-adding row's avatars. Decorative: the row's label ("7 of 12 done adding") carries the meaning. */
export function AvatarStack({
  members,
  max = AVATAR_STACK_MAX,
  size = 28,
  ringColor,
}: AvatarStackProps) {
  const { tokens } = useTheme();
  const ring = ringColor ?? tokens.surface;
  const { shown, overflow: extra } = stackLayout(members, max);
  const overlap = size === 26 ? -7 : -6;

  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {shown.map((m, i) => (
        <Avatar
          key={m.id}
          size={size}
          name={m.name}
          initials={m.initials}
          emoji={m.emoji}
          color={m.color}
          outlined={!m.done}
          backdrop={ring}
          ring={m.done ? ring : undefined}
          style={i > 0 ? { marginLeft: overlap } : undefined}
        />
      ))}
      {extra > 0 && (
        <View
          style={[
            styles.more,
            { height: size, borderRadius: size / 2, backgroundColor: tokens.separator },
          ]}
        >
          <AppText variant="captionTight" color="textSecondary" tabular maxFontSizeMultiplier={1.2}>
            {`+${extra}`}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  more: { marginLeft: 4, paddingHorizontal: 8, justifyContent: 'center' },
});
