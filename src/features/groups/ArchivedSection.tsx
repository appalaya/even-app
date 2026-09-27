/**
 * "Archived · 2" under the active groups (Main board): an outlined row, radius 18, min 52, padding 0 16 0 18, 10
 * below the list; the archive glyph 18, the label 16/21 and a 14 pt chevron, all `textSecondary`. Collapsed by
 * default.
 *
 * Expanded (Groups, extra states: "Archived, expanded"): the row loses its outline and its chevron points up; under
 * it, 8 apart, one outlined card per archived group (min 64, radius 18, padding 10 6 10 18): the name 17/22
 * semibold and "4 people · settled" 14/19, greyed (`textSecondary`, `textMuted`), and a quiet "Unarchive". A tap
 * on the card opens the group read-only.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon } from '@/components';
import { useApp, type GroupListRow } from '@/state';
import { radii, strokes, useTheme } from '@/theme';

import { archivedLabel } from './cardLabels';
import { cardName } from './GroupCard';

export function ArchivedSection({
  rows,
  onOpen,
  open,
  onToggle,
}: {
  rows: readonly GroupListRow[];
  onOpen: (localId: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const { tokens } = useTheme();
  const { groups } = useApp();
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Archived, ${rows.length}`}
        style={({ pressed }) => [
          styles.row,
          !open && { borderColor: tokens.border, borderWidth: strokes.hairline },
          pressed && { backgroundColor: tokens.rowPressed },
        ]}
      >
        <Icon name="archive" size={18} color={tokens.textSecondary} />
        <AppText variant="callout" color="textSecondary" style={styles.label}>
          {`Archived · ${rows.length}`}
        </AppText>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} color={tokens.textSecondary} />
      </Pressable>
      {open && (
        <View style={styles.list} accessibilityLabel="Archived groups">
          {rows.map((row) => {
            const name = cardName(row);
            return (
              <View key={row.localId} style={[styles.card, { borderColor: tokens.border }]}>
                <Pressable
                  onPress={() => onOpen(row.localId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}, read-only`}
                  style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                >
                  <AppText weight="semibold" color="textSecondary" numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText variant="footnote" color="textMuted" numberOfLines={1}>
                    {archivedLabel(
                      row.memberCount,
                      row.myNet,
                      row.currency,
                      undefined,
                      row.hasActivity,
                    ) ?? ''}
                  </AppText>
                </Pressable>
                <Button
                  label="Unarchive"
                  variant="quiet"
                  size="pill"
                  fullWidth={false}
                  accessibilityLabel={`Unarchive ${name}`}
                  onPress={() => void groups.unarchiveGroup(row.localId).catch(() => undefined)}
                  style={styles.unarchive}
                />
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 10, marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingLeft: 18,
    paddingRight: 16,
    borderRadius: radii.card,
  },
  label: { flex: 1 },
  list: { gap: 8, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 64,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 18,
    paddingRight: 6,
    borderRadius: radii.card,
    borderWidth: strokes.hairline,
  },
  open: { flex: 1, minWidth: 0, gap: 2 },
  unarchive: { paddingHorizontal: 12 },
  pressed: { opacity: 0.6 },
});
