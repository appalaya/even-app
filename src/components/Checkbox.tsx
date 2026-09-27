import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { strokes, useTheme } from '@/theme';

import { Icon } from './Icon';

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  /** "Include you", "Also delete this group's copy on sync.even.appalaya.com". */
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The 22 pt checkbox the boards draw (Split's include boxes; Leave's "Also delete this group's copy"): the accent
 * square with a check in `onAccent` when on; `surface` with a 1.5 pt `iconMuted` edge when off. Extends to a 44 pt
 * target.
 */
export function Checkbox({ checked, onToggle, label, disabled = false, style }: CheckboxProps) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      hitSlop={11}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      style={[
        styles.box,
        checked
          ? { backgroundColor: tokens.accent }
          : {
              backgroundColor: tokens.surface,
              borderWidth: strokes.selected,
              borderColor: tokens.iconMuted,
            },
        disabled && styles.disabled,
        style,
      ]}
    >
      {checked && <Icon name="check" size={15} color={tokens.onAccent} strokeWidth={3} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
});
