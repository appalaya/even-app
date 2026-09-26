import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABEL, type Category } from '@even/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { emojiType, radii, strokes, useTheme } from '@/theme';

import { AppText } from './AppText';

/** The grid's tile label: core's label (core labels `rental` "Rental", as the category picker board draws it). */
export function gridLabel(category: Category): string {
  return CATEGORY_LABEL[category];
}

export interface CategoryGridProps {
  /** The selected category (the suggestion, until you pick). */
  value?: Category;
  onChange: (category: Category) => void;
}

/**
 * The sixteen categories in core order, four to a row, 6 apart: 60 pt tiles on `fill`, radius 14, the emoji
 * 20/24 over the label 13/18 in `textSecondary`. The selected tile is soft accent with a 1.5 pt inset accent
 * ring and a semibold accent label.
 */
export function CategoryGrid({ value, onChange }: CategoryGridProps) {
  const { tokens } = useTheme();
  const rows: Category[][] = [];
  for (let i = 0; i < CATEGORIES.length; i += 4) rows.push(CATEGORIES.slice(i, i + 4));
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Categories">
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((c) => {
            const selected = c === value;
            return (
              <Pressable
                key={c}
                onPress={() => onChange(c)}
                accessibilityRole="radio"
                accessibilityLabel={gridLabel(c)}
                accessibilityState={{ selected }}
                style={[
                  styles.tile,
                  {
                    backgroundColor: selected ? tokens.accentSoft : tokens.fill,
                    boxShadow: selected
                      ? `inset 0 0 0 ${strokes.selected}px ${tokens.accent}`
                      : undefined,
                  },
                ]}
              >
                <AppText style={emojiType.tile} maxFontSizeMultiplier={1.2}>
                  {CATEGORY_EMOJI[c]}
                </AppText>
                <AppText
                  variant="caption"
                  weight={selected ? 'semibold' : 'regular'}
                  color={selected ? 'accent' : 'textSecondary'}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {gridLabel(c)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 6 },
  row: { flexDirection: 'row', gap: 6 },
  tile: {
    flex: 1,
    flexBasis: 0,
    minHeight: 60,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: 2,
  },
});
