/**
 * A form-level error line in the field-error style the States board draws (16 pt warning glyph at stroke 2.2, 8 pt
 * gap, 14/19 semibold, inset 4), for an error that belongs to no single field. Composed because the kit draws it
 * only inside `TextField`.
 */
import { StyleSheet, View, type ViewProps } from 'react-native';

import { AppText, Icon } from '@/components';
import { useTheme } from '@/theme';

export function FieldError({ message, style }: { message: string; style?: ViewProps['style'] }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.row, style]} accessibilityRole="alert">
      <View style={styles.icon}>
        <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
      </View>
      <AppText variant="footnote" weight="semibold" style={styles.text}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 4 },
  icon: { paddingTop: 1 },
  text: { flex: 1 },
});
