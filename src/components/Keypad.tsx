import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { radii, useTheme } from '@/theme';

import { AppText } from './AppText';
import { Icon } from './Icon';

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'delete';

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'delete'],
];

export interface KeypadProps {
  onKey: (key: KeypadKey) => void;
  /** Key height: 54 on Add expense (default), 52 on Split and Settle. */
  keyHeight?: 54 | 52;
  /** Hide the decimal point for a currency with no minor unit (JPY, ISK…): its cell stays empty. */
  decimal?: boolean;
}

/**
 * The amount keypad (Add expense, Split, Settle): three columns 4 apart, keys radius 14 with no fill, digits
 * 26/32 regular, the delete key a 26 pt glyph. A light selection haptic on each press; a `fill` wash while held.
 */
export function Keypad({ onKey, keyHeight = 54, decimal = true }: KeypadProps) {
  const { tokens } = useTheme();
  const press = (key: KeypadKey) => {
    void Haptics.selectionAsync();
    onKey(key);
  };
  return (
    <View style={styles.grid}>
      {ROWS.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((key) => {
            if (key === '.' && !decimal) return <View key={key} style={styles.key} />;
            const label = key === 'delete' ? 'Delete' : key === '.' ? 'Decimal point' : key;
            return (
              <Pressable
                key={key}
                onPress={() => press(key)}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.key,
                  { minHeight: keyHeight },
                  pressed && { backgroundColor: tokens.fill },
                ]}
              >
                {key === 'delete' ? (
                  <Icon name="backspace" size={26} color={tokens.text} />
                ) : (
                  <AppText variant="keypad" maxFontSizeMultiplier={1.4}>
                    {key}
                  </AppText>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  key: {
    flex: 1,
    flexBasis: 0,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
