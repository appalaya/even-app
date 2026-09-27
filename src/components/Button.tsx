import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { layout, useTheme, type FontWeightName, type TypographyVariant } from '@/theme';

import { AppText, type TextColor } from './AppText';
import { Icon, type IconName } from './Icon';

/**
 * - `primary`: accent fill, `onAccent` label ("Create group", "Add expense", "Save", "Share link"); `accentPressed`
 *   while pressed (States board).
 *
 * The States board draws the pressed state of `primary` only; the other variants keep a 0.7 opacity while pressed
 * until a board draws theirs.
 * - `secondary`: soft accent fill, accent label ("Join with code", "Copy code", "Settle up", "I'm done").
 * - `neutral`: `fill`, text label ("Cancel" under Regenerate, "Add more", "Use initials").
 * - `quiet`: no fill, accent label ("Cancel" and "Done" in a sheet header, "Details", "Unarchive").
 * - `danger`: `fill`, `danger` label ("Leave anyway", Group settings, extra states).
 * - `dangerQuiet`: no fill, `danger` label, padded 20 ("Delete" beside Edit on Expense detail).
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'neutral' | 'quiet' | 'danger' | 'dangerQuiet';

/**
 * Heights as drawn: `large` 52 (17/22), `regular` 48 (17/22, "Settle up" on Balances), `medium` 48 (16/21, the
 * invite card), `small` 44 (16/21, Group settings), `compact` 40 (15/20, "Export group file" under the usage
 * warning), `pill` 36 (15/20, the done-adding row), `pillNarrow` 36 padded 14 (15/20, a member's pills in Group
 * settings, the twelve-member done row), `mini` 32 (15/20, the Done adding sheet). All fully round.
 */
export type ButtonSize =
  'large' | 'regular' | 'medium' | 'small' | 'compact' | 'pill' | 'pillNarrow' | 'mini';

const SIZES: Record<
  ButtonSize,
  { height: number; variant: TypographyVariant; paddingHorizontal: number }
> = {
  large: { height: 52, variant: 'body', paddingHorizontal: 20 },
  regular: { height: 48, variant: 'body', paddingHorizontal: 20 },
  medium: { height: 48, variant: 'callout', paddingHorizontal: 16 },
  small: { height: 44, variant: 'callout', paddingHorizontal: 16 },
  compact: { height: 40, variant: 'subhead', paddingHorizontal: 16 },
  pill: { height: 36, variant: 'subhead', paddingHorizontal: 16 },
  pillNarrow: { height: 36, variant: 'subhead', paddingHorizontal: 14 },
  mini: { height: 32, variant: 'subhead', paddingHorizontal: 14 },
};

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** A leading glyph (the 20 pt plus on "Add expense"). */
  icon?: IconName;
  /** A leading element instead of a glyph (the avatar on "Use initials"). */
  leading?: ReactNode;
  /** Label weight; semibold except a quiet sheet-header "Cancel" (regular). */
  weight?: FontWeightName;
  /** Label colour for `quiet` (default accent); e.g. `textSecondary` for "Import group file". */
  quietColor?: TextColor;
  /** Label colour on a filled variant, when a board draws another ("Unarchive" in the accent on `fill`). */
  labelColor?: TextColor;
  /**
   * Stretch to the container's width (default for large, medium and small). Otherwise the button sizes to its
   * label and centres itself on the cross axis (vertically in a row, as the pills sit in their rows).
   */
  fullWidth?: boolean;
  /** Toggle buttons ("I'm done" / "Add more") report their state. */
  selected?: boolean;
  /** Haptic on press: `impact` (light) or `success` (Save, Record payment). */
  haptic?: 'impact' | 'success';
  /** Draws the pressed state without a touch (the kit gallery's States page). */
  showPressed?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  disabled = false,
  icon,
  leading,
  weight,
  quietColor = 'accent',
  labelColor: labelOverride,
  fullWidth,
  selected,
  haptic,
  showPressed = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { tokens } = useTheme();
  const spec = SIZES[size];
  const stretch =
    fullWidth ??
    (variant !== 'dangerQuiet' &&
      (size === 'large' || size === 'regular' || size === 'medium' || size === 'small'));
  const quiet = variant === 'quiet' || variant === 'dangerQuiet';

  let background: string | undefined;
  let labelColor: TextColor;
  if (quiet) {
    background = undefined;
    labelColor = disabled ? 'textDisabled' : variant === 'dangerQuiet' ? 'danger' : quietColor;
  } else if (disabled) {
    background = tokens.disabledFill;
    labelColor = 'onDisabledFill';
  } else if (variant === 'primary') {
    background = tokens.accent;
    labelColor = 'onAccent';
  } else if (variant === 'secondary') {
    background = tokens.accentSoft;
    labelColor = 'accent';
  } else if (variant === 'danger') {
    background = tokens.fill;
    labelColor = 'danger';
  } else {
    background = tokens.fill;
    labelColor = 'text';
  }
  if (labelOverride !== undefined && !disabled) labelColor = labelOverride;

  const labelWeight: FontWeightName =
    weight ?? (variant === 'quiet' && size === 'large' ? 'regular' : 'semibold');
  const slop = Math.max(0, (layout.tapTarget - spec.height) / 2);

  const handlePress = () => {
    if (haptic === 'impact') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (haptic === 'success')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onPress?.();
  };

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={disabled}
      hitSlop={slop > 0 ? { top: slop, bottom: slop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => {
        const down = (pressed || showPressed) && !disabled;
        const primary = variant === 'primary' && !disabled;
        return [
          styles.base,
          {
            minHeight: quiet ? Math.max(spec.height, layout.tapTarget) : spec.height,
            borderRadius: spec.height / 2,
            paddingHorizontal: variant === 'quiet' ? 10 : spec.paddingHorizontal,
            backgroundColor: down && primary ? tokens.accentPressed : background,
            alignSelf: stretch ? 'stretch' : 'center',
            // "Use initials" puts 10 between its avatar and label; the plus on "Add expense" sits 8 away.
            gap: leading !== undefined ? 10 : 8,
          },
          down && !primary && styles.pressed,
          style,
        ];
      }}
    >
      {icon !== undefined && <Icon name={icon} size={20} color={tokens[labelColor]} />}
      {leading !== undefined && <View>{leading}</View>}
      <AppText variant={spec.variant} weight={labelWeight} color={labelColor} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
