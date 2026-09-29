/**
 * The top right of Groups (Main, GroupsDark; GroupsEmpty, GroupsEmptyDark; Groups states panel 1): you, not a gear.
 * A 32 pt avatar centred in the 44 × 44 target at the end of the large-title row (so 18 from the screen edge), drawn
 * as the You card in App settings draws it: the prefs name's initials on `memberColor(deviceId)`, or the prefs
 * emoji on `separator`. Until a name is set, the `person` glyph (18, `textSecondary`) on `separator`, the neutral
 * the board draws (#ECEBE6 light, #2A2D2B dark). Tapping opens App settings.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, Icon } from '@/components';
import { useApp, usePrefs } from '@/state';
import { layout, useTheme } from '@/theme';

import { youLabel } from './youLabel';

const SIZE = 32;

export function YouButton({ onPress }: { onPress: () => void }) {
  const { tokens } = useTheme();
  const { deviceId } = useApp();
  const { prefs } = usePrefs();
  const name = prefs?.name ?? null;
  const emoji = prefs?.emoji ?? null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={youLabel(name)}
      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
    >
      {name === null ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.circle, { backgroundColor: tokens.separator }]}
        >
          <Icon name="person" size={18} color={tokens.textSecondary} />
        </View>
      ) : (
        <Avatar size={SIZE} name={name} emoji={emoji ?? undefined} memberId={deviceId} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.tapTarget,
    height: layout.tapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.5 },
});
