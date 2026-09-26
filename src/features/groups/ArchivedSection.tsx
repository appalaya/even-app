/**
 * "Archived · 2" under the active groups (Main board): an outlined row, radius 18, min 52, padding 0 16 0 18, 10
 * below the list; the archive glyph 18, the label 16/21 and a 14 pt chevron, all `textSecondary`. Collapsed by
 * default. Open, it lists the archived groups as the same cards (no board draws the open state; see the report).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components';
import type { GroupListRow } from '@/state';
import { radii, strokes, useTheme } from '@/theme';

import { GroupCard } from './GroupCard';

export function ArchivedSection({
  rows,
  onOpen,
  initiallyOpen = false,
}: {
  rows: readonly GroupListRow[];
  onOpen: (localId: string) => void;
  initiallyOpen?: boolean;
}) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Archived, ${rows.length}`}
        style={({ pressed }) => [
          styles.row,
          { borderColor: tokens.border },
          pressed && { backgroundColor: tokens.rowPressed },
        ]}
      >
        <Icon name="archive" size={18} color={tokens.textSecondary} />
        <AppText variant="callout" color="textSecondary" style={styles.label}>
          {`Archived · ${rows.length}`}
        </AppText>
        <View style={open && styles.flipped}>
          <Icon name="chevronDown" size={14} color={tokens.textSecondary} />
        </View>
      </Pressable>
      {open && (
        <View style={styles.list}>
          {rows.map((row) => (
            <GroupCard key={row.localId} row={row} onPress={() => onOpen(row.localId)} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 10, marginHorizontal: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingLeft: 18,
    paddingRight: 16,
    borderRadius: radii.card,
    borderWidth: strokes.hairline,
  },
  label: { flex: 1 },
  flipped: { transform: [{ rotate: '180deg' }] },
  list: { gap: 10 },
});
