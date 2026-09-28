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
   * - `chosen`: picked by you: looks the same as `inferred`, and is never re-inferred.
   * The chip's width never jumps for the sparkle: its room (18 pt) opens and closes with it. Going from `suggested`
   * to `chosen` fades the sparkle out while the room closes, both over 250 ms; any other way (a keystroke's keyword
   * guess) the sparkle goes at once and the room closes over 250 ms. When it appears the sparkle fades in as its
   * room opens, in step with the model's swap. Under Reduce Motion none of this animates.
   */
  state: 'placeholder' | 'inferred' | 'suggested' | 'chosen';
  /** The category picker is open under it: a 2 pt accent ring around the chip (Category picker open). */
  choosing?: boolean;
  /**
   * This chip is entering with the model's swap and the chip before it carried no sparkle: the sparkle's room opens
   * with the swap instead of being there from the first frame.
   */
  swapIn?: boolean;
  onPress?: () => void;
}

/** The sparkle leaving when you choose a category over the model's pick (AddExpenseStates, "Category chip"). */
const SPARKLE_OUT_MS = 250;

/** The model's swap (ChipSlot's keyframe); the sparkle's room opens in step with it. */
export const CHIP_SWAP_MS = 260;

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
  swapIn = false,
  onPress,
}: CategoryChipProps) {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const tagged = state === 'suggested';
  // How the sparkle leaves: `fade` (you chose a category: it fades as its room closes) or `cut` (a keystroke's
  // keyword guess: it goes at once, its room closes); null while it shows, or once its room has closed.
  // `enter`: the next sparkle to mount fades in as its room opens.
  const [prevState, setPrevState] = useState(state);
  const [leaving, setLeaving] = useState<'fade' | 'cut' | null>(null);
  const [enter, setEnter] = useState(swapIn && !reduceMotion);
  if (state !== prevState) {
    setPrevState(state);
    const left = prevState === 'suggested' && !tagged && state !== 'placeholder' && !reduceMotion;
    setLeaving(left ? (state === 'chosen' ? 'fade' : 'cut') : null);
    setEnter(!reduceMotion);
  }
  const closed = useCallback(() => setLeaving(null), []);
  const sparkle = tagged || leaving !== null;
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
        { backgroundColor: tokens.accentSoft, paddingRight: 14, boxShadow: ring },
      ]}
    >
      <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
        {emoji}
      </AppText>
      <AppText variant="subhead" weight="semibold" color="accent">
        {name}
      </AppText>
      {sparkle && <Sparkle leaving={leaving} enter={enter} onClosed={closed} />}
    </Pressable>
  );
}

/**
 * The model's-pick sparkle, 14 pt in `textSecondary`, hidden from assistive tech (the chip's label says it), in a
 * room that takes the chip's width from the label to the edge from 14 pt to 32 (6 gap, the glyph, 12 to the edge).
 * `room` 1 is that room fully open, 0 none of it: the room's margins cancel the chip's 6 pt gap and 2 pt of its right
 * padding in step, so the chip's width follows `room` without a jump, and the glyph stays between the label and the
 * chip's edge throughout.
 */
function Sparkle({
  leaving,
  enter,
  onClosed,
}: {
  leaving: 'fade' | 'cut' | null;
  /** Mount with the room closed and open it (fading the glyph in); otherwise mount open. */
  enter: boolean;
  onClosed: () => void;
}) {
  const { tokens } = useTheme();
  const room = useSharedValue(enter ? 0 : 1);
  const opacity = useSharedValue(enter ? 0 : 1);
  useEffect(() => {
    if (leaving === null) {
      room.set(withTiming(1, { duration: CHIP_SWAP_MS }));
      opacity.set(withTiming(1, { duration: CHIP_SWAP_MS }));
      return;
    }
    if (leaving === 'cut') {
      cancelAnimation(opacity);
      opacity.set(0);
    } else {
      opacity.set(withTiming(0, { duration: SPARKLE_OUT_MS }));
    }
    room.set(
      withTiming(0, { duration: SPARKLE_OUT_MS }, (finished) => {
        if (finished === true) scheduleOnRN(onClosed);
      }),
    );
  }, [leaving, onClosed, opacity, room]);
  const roomStyle = useAnimatedStyle(() => {
    const r = room.get();
    return { width: 14 * r, marginLeft: -6 + 6 * r, marginRight: -2 * r };
  });
  const glyphStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[styles.sparkleRoom, roomStyle]}>
      <Animated.View style={[styles.sparkle, glyphStyle]}>
        <Icon name="sparkle" size={14} color={tokens.textSecondary} />
      </Animated.View>
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
  sparkleRoom: { height: 14 },
  sparkle: { position: 'absolute', left: 0, top: 0 },
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
