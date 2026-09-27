/**
 * "Import group file" on Groups (Main board): a quiet 44 pt button centred 12 below the list, the import glyph 18
 * and 15/20 regular text 8 apart, padding 0 12, both `textSecondary`. The kit's quiet `Button` draws a 20 pt glyph,
 * 10 pt padding and a semibold label, so this is composed from kit pieces.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components';
import { layout, useTheme } from '@/theme';

export function ImportGroupFileButton({
  onPress,
  disabled = false,
  spacingTop = 12,
}: {
  onPress: () => void;
  disabled?: boolean;
  /** 12 under the collapsed Archived row (Main), 8 under the open list (Groups, extra states). */
  spacingTop?: number;
}) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.wrap, { paddingTop: spacingTop }]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={({ pressed }) => [styles.button, (pressed || disabled) && styles.pressed]}
      >
        <Icon name="import" size={18} color={tokens.textSecondary} />
        <AppText variant="subhead" color="textSecondary">
          Import group file
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 16 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: layout.tapTarget,
    paddingHorizontal: 12,
  },
  pressed: { opacity: 0.5 },
});
