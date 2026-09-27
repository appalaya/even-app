import type { MemberState } from '@even/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Avatar, Icon } from '@/components';
import { strokes, useTheme } from '@/theme';

/**
 * From / To on Settle, as drawn: 48 tall, fully round, on `fill` (`fillPressed` while pressed, as the States board
 * presses a chip); a 36 pt avatar 6 from the edge, the name 16/21 semibold, a 14 pt chevron in `textSecondary`.
 * Nobody chosen yet (Settle, extra states: opened from Balances): a dashed 36 pt `outlineStrong` circle and
 * "Choose" 16/21 medium in `textSecondary`. The kit's pills are 44 tall without an avatar, so it is composed here.
 */
export function MemberSelect({
  role,
  member,
  label,
  onPress,
}: {
  /** "From" or "To". */
  role: string;
  member: MemberState | undefined;
  /** "You" or the name. */
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        member === undefined ? `${role}: nobody yet. Choose.` : `${role}: ${label}. Change.`
      }
      style={({ pressed }) => [
        styles.select,
        { backgroundColor: pressed ? tokens.fillPressed : tokens.fill },
      ]}
    >
      {member !== undefined ? (
        <Avatar
          size={36}
          name={member.name}
          initials={member.initials}
          emoji={member.emoji}
          color={member.color}
          on="inset"
        />
      ) : (
        <View style={[styles.empty, { borderColor: tokens.outlineStrong }]} />
      )}
      <AppText
        variant="callout"
        weight={member === undefined ? 'medium' : 'semibold'}
        color={member === undefined ? 'textSecondary' : 'text'}
        numberOfLines={1}
        style={styles.name}
      >
        {member === undefined ? 'Choose' : label}
      </AppText>
      <Icon name="chevronDown" size={14} color={tokens.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: 24,
  },
  name: { flex: 1 },
  empty: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: strokes.dashed,
    borderStyle: 'dashed',
  },
});
