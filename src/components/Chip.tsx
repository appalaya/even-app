import { Pressable, StyleSheet, View } from 'react-native';

import { layout, strokes, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface CategoryChipProps {
  /** The category's emoji; not drawn for `placeholder`. */
  emoji?: string;
  /** The category's label; `placeholder` always reads "Category". */
  label?: string;
  /**
   * As the Add expense boards draw the chip (Add expense, extra states: "Category chip"):
   * - `placeholder`: no title yet: a dashed `outlineStrong` outline and "Category" in `textSecondary` (first open);
   * - `inferred`: from the title (keyword or model), at rest: soft accent, no tag;
   * - `suggested`: the model just changed it: the same chip with the "suggested" tag, shown for about 1.5 s;
   * - `chosen`: picked by you: looks the same as `inferred`, and is never re-inferred.
   */
  state: 'placeholder' | 'inferred' | 'suggested' | 'chosen';
  /** The category picker is open under it: a 2 pt accent ring around the chip (Category picker open). */
  choosing?: boolean;
  onPress?: () => void;
}

/**
 * The category chip inside the title field: 40 tall, fully round, soft accent, emoji 18/22, label 15/20
 * semibold and "suggested" 13/18 medium, all in the accent; the placeholder is outlined instead.
 */
export function CategoryChip({
  emoji,
  label,
  state,
  choosing = false,
  onPress,
}: CategoryChipProps) {
  const { tokens } = useTheme();
  const ring = choosing ? `0 0 0 ${strokes.ring}px ${tokens.accent}` : undefined;
  if (state === 'placeholder') {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 2, bottom: 2 }}
        accessibilityRole="button"
        accessibilityLabel="Category: none yet. Choose."
        accessibilityState={{ expanded: choosing }}
        style={[
          styles.category,
          styles.placeholder,
          { borderColor: tokens.outlineStrong, boxShadow: ring },
        ]}
      >
        <AppText variant="subhead" weight="medium" color="textSecondary">
          Category
        </AppText>
      </Pressable>
    );
  }
  const tagged = state === 'suggested';
  const name = label ?? '';
  const spoken =
    state === 'chosen'
      ? `Category: ${name}, chosen by you. ${choosing ? 'Choosing.' : 'Tap to change.'}`
      : tagged
        ? `Category: ${name}, suggested. ${choosing ? 'Choosing.' : 'Tap to change.'}`
        : `Category: ${name}. ${choosing ? 'Choosing.' : 'Tap to change.'}`;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ expanded: choosing }}
      style={[
        styles.category,
        { backgroundColor: tokens.accentSoft, paddingRight: tagged ? 12 : 14, boxShadow: ring },
      ]}
    >
      <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
        {emoji}
      </AppText>
      <AppText variant="subhead" weight="semibold" color="accent">
        {name}
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
   * The toggle form (Regenerate invite, "Remove someone?"): 40 tall on `fill` (`fillPressed` while pressed), 32 pt
   * avatar; selected turns soft accent with a 1.5 pt inset accent ring and a semibold accent name.
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
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: selected
            ? tokens.accentSoft
            : pressed
              ? tokens.fillPressed
              : tokens.fill,
        },
        selected && { boxShadow: `inset 0 0 0 ${strokes.selected}px ${tokens.accent}` },
      ]}
    >
      <Avatar size={32} name={name} initials={initials} emoji={emoji} color={color} on="chip" />
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
  /** Draws the pressed state without a touch (the kit gallery's States page). */
  showPressed?: boolean;
  accessibilityLabel?: string;
}

/**
 * A pill that opens a picker: 44 tall on `fill`, `fillPressed` while pressed (States board), 15/20, a 14 pt chevron
 * in `textSecondary` (Add expense).
 */
export function SelectPill({
  label,
  value,
  onPress,
  showPressed = false,
  accessibilityLabel,
}: SelectPillProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (label ? `${label}: ${value}` : value)}
      style={({ pressed }) => [
        styles.select,
        { backgroundColor: pressed || showPressed ? tokens.fillPressed : tokens.fill },
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
  placeholder: {
    paddingLeft: 14,
    paddingRight: 14,
    borderWidth: strokes.hairline,
    borderStyle: 'dashed',
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
});
