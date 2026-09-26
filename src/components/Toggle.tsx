import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { AppText } from './AppText';

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

/**
 * The switch as drawn on App settings: 51 × 31, fully round, the accent when on; a 27 pt `switchThumb` 2 in from
 * the edge with a `0 1px 3px` shadow. The off track (`switchOff`) is not drawn on the canvas.
 */
export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: SwitchProps) {
  const { tokens } = useTheme();
  const reduceMotion = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(
      withTiming(value ? 1 : 0, {
        duration: reduceMotion ? 0 : 200,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [value, reduceMotion, on]);

  const offColor = tokens.switchOff;
  const onColor = tokens.accent;
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [offColor, onColor]),
  }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: on.get() * 20 }] }));

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hitSlop={{ top: 7, bottom: 6 }}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      style={disabled && styles.disabled}
    >
      <Animated.View style={[styles.track, track]}>
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: tokens.switchThumb,
              boxShadow: `0 1px 3px ${tokens.switchShadow}`,
            },
            thumb,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

export interface ToggleRowProps extends Omit<SwitchProps, 'accessibilityLabel'> {
  label: string;
}

/** A settings row with a switch: at least 56 tall, padding 0 12 0 16, the label 16/21. */
export function ToggleRow({ label, ...toggle }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <AppText variant="callout" style={styles.label} importantForAccessibility="no">
        {label}
      </AppText>
      <Switch {...toggle} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: 51, height: 31, borderRadius: 16, justifyContent: 'center' },
  thumb: { position: 'absolute', left: 2, top: 2, width: 27, height: 27, borderRadius: 14 },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 12,
  },
  label: { flex: 1 },
});
