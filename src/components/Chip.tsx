import { Pressable, StyleSheet, View } from 'react-native';

import { layout, strokes, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface CategoryChipProps {
  emoji: string;
  label: string;
  /**
   * `suggested`: inferred from the title, with the "suggested" tag (Add expense).
   * `chosen`: picked by you, no tag (Category chosen by you).
   * `choosing`: the picker is open: the suggested chip with a 2 pt accent ring (Category picker open).
   */
  state: 'suggested' | 'chosen' | 'choosing';
  onPress?: () => void;
}

/**
 * The category chip inside the title field: 40 tall, fully round, soft accent, emoji 18/22, label 15/20
 * semibold and "suggested" 13/18 medium, all in the accent.
 */
export function CategoryChip({ emoji, label, state, onPress }: CategoryChipProps) {
  const { tokens } = useTheme();
  const tagged = state !== 'chosen';
  const spoken =
    state === 'chosen'
      ? `Category: ${label}, chosen by you. Tap to change.`
      : state === 'choosing'
        ? `Category: ${label}, suggested. Choosing.`
        : `Category: ${label}, suggested. Tap to change.`;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ expanded: state === 'choosing' }}
      style={[
        styles.category,
        { backgroundColor: tokens.accentSoft, paddingRight: tagged ? 12 : 14 },
        state === 'choosing' && { boxShadow: `0 0 0 ${strokes.ring}px ${tokens.accent}` },
      ]}
    >
      <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
        {emoji}
      </AppText>
      <AppText variant="subhead" weight="semibold" color="accent">
        {label}
      </AppText>
      {tagged && (
        <AppText variant="caption" weight="medium" color="accent">
          suggested
        </AppText>
      )}
    </Pressable>
  );
}

export interface MemberChipProps {
  name: string;
  initials?: string;
  emoji?: string;
  color?: number;
  /**
   * A removable name (Create group, "People"): 36 tall on `fill`, 28 pt avatar, a 28 pt remove button.
   * Omit to get the toggle form instead.
   */
  onRemove?: () => void;
  /**
   * The toggle form (Regenerate invite, "Remove someone?"): 40 tall on `fill`, 32 pt avatar; selected turns soft
   * accent with a 1.5 pt inset accent ring and a semibold accent name.
   */
  selected?: boolean;
  onToggle?: () => void;
}

export function MemberChip({
  name,
  initials,
  emoji,
  color,
  onRemove,
  selected = false,
  onToggle,
}: MemberChipProps) {
  const { tokens } = useTheme();
  if (onRemove !== undefined) {
    return (
      <View style={[styles.removable, { backgroundColor: tokens.fill }]}>
        <Avatar size={28} name={name} initials={initials} emoji={emoji} color={color} on="inset" />
        <AppText variant="subhead">{name}</AppText>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          style={styles.remove}
        >
          <Icon name="close" size={10} color={tokens.textMuted} />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={{ top: 2, bottom: 2 }}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
      style={[
        styles.toggle,
        { backgroundColor: selected ? tokens.accentSoft : tokens.fill },
        selected && { boxShadow: `inset 0 0 0 ${strokes.selected}px ${tokens.accent}` },
      ]}
    >
      <Avatar size={32} name={name} initials={initials} emoji={emoji} color={color} />
      <AppText
        variant="subhead"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? 'accent' : 'text'}
      >
        {name}
      </AppText>
    </Pressable>
  );
}

export interface SelectPillProps {
  /** A muted prefix ("Paid by"). */
  label?: string;
  /** The current choice, semibold ("You", "Today"). */
  value: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** A pill that opens a picker: 44 tall on `fill`, 15/20, a 14 pt chevron in `textSecondary` (Add expense). */
export function SelectPill({ label, value, onPress, accessibilityLabel }: SelectPillProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (label ? `${label}: ${value}` : value)}
      style={({ pressed }) => [
        styles.select,
        { backgroundColor: tokens.fill },
        pressed && styles.pressed,
      ]}
    >
      {label !== undefined && (
        <AppText variant="subhead" color="textSecondary">
          {label}
        </AppText>
      )}
      <AppText variant="subhead" weight="semibold">
        {value}
      </AppText>
      <Icon name="chevronDown" size={14} color={tokens.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingLeft: 10,
    borderRadius: 20,
    flexShrink: 0,
  },
  emoji: { fontSize: 18, lineHeight: 22 },
  removable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 4,
    borderRadius: 18,
    alignSelf: 'flex-start',
  },
  remove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingLeft: 4,
    paddingRight: 14,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: layout.tapTarget,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 22,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.7 },
});
