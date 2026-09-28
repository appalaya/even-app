import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

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
   * - `inferred`: a keyword match: soft accent, no mark;
   * - `suggested`: the model's pick, not yet touched: the same chip with the sparkle after the label, no timer;
   * - `chosen`: picked by you: looks the same as `inferred`, and is never re-inferred. Going from `suggested` to
   *   `chosen` fades the sparkle out over 250 ms (at once under Reduce Motion); any other way it goes, it goes at
   *   once.
   */
  state: 'placeholder' | 'inferred' | 'suggested' | 'chosen';
  /** The category picker is open under it: a 2 pt accent ring around the chip (Category picker open). */
  choosing?: boolean;
  onPress?: () => void;
}

/** The sparkle's fade when you choose a category over the model's pick (AddExpenseStates, "Category chip"). */
const SPARKLE_FADE_MS = 250;

/**
 * The category chip inside the title field: 40 tall, fully round, soft accent, emoji 18/22 and label 15/20
 * semibold in the accent; the model's pick adds a 14 pt sparkle in `textSecondary` after the label (padding
 * 10 / 6 / 6 / 12 around emoji, label, sparkle; 14 on the right without it). The placeholder is outlined instead.
 */
export function CategoryChip({
  emoji,
  label,
  state,
  choosing = false,
  onPress,
}: CategoryChipProps) {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const tagged = state === 'suggested';
  // The model's pick just became your choice: the sparkle stays in place and fades out. A keystroke's keyword
  // guess (or anything else) takes it away at once, as does Reduce Motion.
  const [wasTagged, setWasTagged] = useState(tagged);
  const [fading, setFading] = useState(false);
  if (tagged !== wasTagged) {
    setWasTagged(tagged);
    setFading(!tagged && state === 'chosen' && !reduceMotion);
  }
  const faded = useCallback(() => setFading(false), []);
  const sparkle = tagged || fading;
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
        { backgroundColor: tokens.accentSoft, paddingRight: sparkle ? 12 : 14, boxShadow: ring },
      ]}
    >
      <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
        {emoji}
      </AppText>
      <AppText variant="subhead" weight="semibold" color="accent">
        {name}
      </AppText>
      {sparkle && <Sparkle fading={fading} onFaded={faded} />}
    </Pressable>
  );
}

/** The model's-pick sparkle, 14 pt in `textSecondary`, hidden from assistive tech (the chip's label says it). */
function Sparkle({ fading, onFaded }: { fading: boolean; onFaded: () => void }) {
  const { tokens } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!fading) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(
      withTiming(0, { duration: SPARKLE_FADE_MS }, (finished) => {
        if (finished === true) scheduleOnRN(onFaded);
      }),
    );
  }, [fading, onFaded, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={style}>
      <Icon name="sparkle" size={14} color={tokens.textSecondary} />
    </Animated.View>
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
