/**
 * The emoji picker sheet (EmojiPicker board): Cancel and "Emoji" in the header, "Search emoji", the "Suggested"
 * grid of 7 columns, and "Use initials" at the foot. Used by Create group, Join, App settings and Group settings
 * (a member's avatar).
 *
 * As drawn: the sheet's top edge 300 pt from the screen top on the 874 pt board (the safe-area top + 238); search
 * 8 below the header, inset 16; "Suggested" 13/18 semibold `textSecondary`, 16 above and 8 below, inset 20; cells
 * 44 tall, 6 apart, radius 12, emoji 26/30; the current emoji on `accentSoft` with a 2 pt inset accent ring; "Use
 * initials" a neutral 52 pt button with a 28 pt initials avatar, inset 16.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Avatar, Button, SearchField, Sheet } from '@/components';
import { emojiType, radii, useTheme } from '@/theme';

import { searchEmoji } from './emojiData';

const COLUMNS = 7;
const GAP = 6;
const GUTTER = 16;
/** The sheet's top edge below the safe area, as drawn (300 − 62). */
const TOP_BELOW_SAFE_AREA = 238;

export interface EmojiPickerSheetProps {
  visible: boolean;
  /** Cancel, a scrim tap or a swipe down. */
  onDismiss: () => void;
  /** The current emoji (drawn selected), or null for initials. */
  value: string | null;
  onPick: (emoji: string) => void;
  /** "Use initials": clears the emoji. */
  onUseInitials: () => void;
  /** Whose initials "Use initials" shows. */
  name: string;
  /** Palette index of the initials avatar, or pass `memberId`. */
  color?: number;
  memberId?: string;
}

export function EmojiPickerSheet({
  visible,
  onDismiss,
  value,
  onPick,
  onUseInitials,
  name,
  color,
  memberId,
}: EmojiPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const results = searchEmoji(query);
  const searching = query.trim() !== '';

  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      top={insets.top + TOP_BELOW_SAFE_AREA}
      leftAction={{ label: 'Cancel', onPress: onDismiss }}
      navTitle="Emoji"
      accessibilityLabel="Choose an emoji"
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Search emoji"
        autoCorrect={false}
        containerStyle={styles.search}
      />
      {!searching && (
        <AppText
          variant="caption"
          weight="semibold"
          color="textSecondary"
          accessibilityRole="header"
          style={styles.heading}
        >
          Suggested
        </AppText>
      )}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={searching ? styles.resultsTop : undefined}
        keyboardShouldPersistTaps="handled"
      >
        <EmojiGrid emoji={results} selected={value} onPick={onPick} />
      </ScrollView>
      <Button
        label="Use initials"
        variant="neutral"
        onPress={onUseInitials}
        leading={<Avatar size={28} name={name} color={color} memberId={memberId} />}
        style={styles.initials}
      />
    </Sheet>
  );
}

function EmojiGrid({
  emoji,
  selected,
  onPick,
}: {
  emoji: readonly string[];
  selected: string | null;
  onPick: (emoji: string) => void;
}) {
  const { tokens } = useTheme();
  // Rows of seven equal cells, as the board's `repeat(7, minmax(0, 1fr))` grid divides the width.
  const rows: (string | null)[][] = [];
  for (let i = 0; i < emoji.length; i += COLUMNS) {
    const row: (string | null)[] = emoji.slice(i, i + COLUMNS);
    while (row.length < COLUMNS) row.push(null);
    rows.push(row);
  }
  return (
    <View accessibilityRole="list" accessibilityLabel="Emoji" style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((e, c) => {
            if (e === null) return <View key={`empty-${c}`} style={styles.cellSlot} />;
            const current = e === selected;
            return (
              <Pressable
                key={e}
                onPress={() => onPick(e)}
                accessibilityRole="button"
                accessibilityLabel={e}
                accessibilityState={{ selected: current }}
                style={({ pressed }) => [
                  styles.cellSlot,
                  styles.cell,
                  current && {
                    backgroundColor: tokens.accentSoft,
                    boxShadow: `inset 0 0 0 2px ${tokens.accent}`,
                  },
                  pressed && !current && { backgroundColor: tokens.rowPressed },
                ]}
              >
                <AppText style={emojiType.grid} maxFontSizeMultiplier={1}>
                  {e}
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
  flex: { flex: 1 },
  search: { marginTop: 8, marginHorizontal: GUTTER },
  heading: { marginTop: 16, marginBottom: 8, marginHorizontal: 20 },
  resultsTop: { paddingTop: 16 },
  grid: { gap: GAP, marginHorizontal: GUTTER },
  row: { flexDirection: 'row', gap: GAP },
  cellSlot: { flex: 1, flexBasis: 0 },
  cell: {
    height: 44,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { marginHorizontal: GUTTER },
});
