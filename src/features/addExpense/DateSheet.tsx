/**
 * The date picker (Add expense, extra states: "Date picker"; Settle's date pill uses it too): Cancel · Date · Done,
 * then "Today" and "Yesterday" as quick picks (36 pt; the chosen one soft accent), the month ("September 2026",
 * 17/22 semibold) with previous and next buttons, the weekday letters (13/18 semibold `textMuted`), and the days in
 * 42 pt rows (17/22 tabular), the chosen day on a 38 pt accent disc. Done applies the choice; Cancel keeps the old
 * date.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, Sheet } from '@/components';
import { useTheme } from '@/theme';

import { isoDay, monthGrid, monthTitle, shiftIso, weekdayLetters } from './calendar';

/** Five rows of days as drawn, plus the board's space under them (the sheet's top edge at 420 of 874). */
const GRID_MIN = 5 * 42 + 29;

export interface DateSheetProps {
  visible: boolean;
  /** YYYY-MM-DD. */
  value: string;
  /** Today on this phone, YYYY-MM-DD. */
  today: string;
  onDone: (iso: string) => void;
  onDismiss: () => void;
}

export function DateSheet({ visible, value, today, onDone, onDismiss }: DateSheetProps) {
  const { tokens } = useTheme();
  const [picked, setPicked] = useState(value);
  const [month, setMonth] = useState(() => value.slice(0, 7));
  // Each time the sheet opens it starts from the expense's date (adjusted during render).
  const [open, setOpen] = useState(visible);
  if (visible !== open) {
    setOpen(visible);
    if (visible) {
      setPicked(value);
      setMonth(value.slice(0, 7));
    }
  }
  const yesterday = shiftIso(today, -1);
  const pick = (iso: string) => {
    setPicked(iso);
    setMonth(iso.slice(0, 7));
  };
  const grid = monthGrid(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const step = (by: number) => setMonth(isoDay(new Date(y, m - 1 + by, 1)).slice(0, 7));
  return (
    <Sheet
      visible={visible}
      onDismiss={onDismiss}
      navTitle="Date"
      accessibilityLabel="Date"
      leftAction={{ label: 'Cancel', onPress: onDismiss }}
      rightAction={{ label: 'Done', onPress: () => onDone(picked) }}
    >
      <View style={styles.quick}>
        {(
          [
            ['Today', today],
            ['Yesterday', yesterday],
          ] as const
        ).map(([label, iso]) => (
          <Button
            key={label}
            label={label}
            size="pill"
            variant={picked === iso ? 'secondary' : 'neutral'}
            weight={picked === iso ? 'semibold' : 'medium'}
            fullWidth={false}
            selected={picked === iso}
            onPress={() => pick(iso)}
            style={styles.quickPill}
          />
        ))}
      </View>
      <View style={styles.monthRow}>
        <AppText weight="semibold" style={styles.flex} accessibilityRole="header">
          {monthTitle(month)}
        </AppText>
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
        >
          <Icon name="chevronLeft" size={18} color={tokens.accent} strokeWidth={2.4} />
        </Pressable>
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={({ pressed }) => [styles.monthButton, pressed && styles.pressed]}
        >
          <Icon name="chevronRight" size={18} color={tokens.accent} />
        </Pressable>
      </View>
      <View style={styles.weekdays} importantForAccessibility="no-hide-descendants">
        {weekdayLetters().map((letter, i) => (
          <AppText
            key={i}
            variant="caption"
            weight="semibold"
            color="textMuted"
            align="center"
            style={styles.cell}
          >
            {letter}
          </AppText>
        ))}
      </View>
      <View style={styles.grid} accessibilityLabel={monthTitle(month)}>
        {grid.map((week, r) => (
          <View key={r} style={styles.week}>
            {week.map((iso, c) => {
              if (iso === null) return <View key={c} style={styles.day} />;
              const chosen = iso === picked;
              return (
                <Pressable
                  key={iso}
                  onPress={() => pick(iso)}
                  accessibilityRole="button"
                  accessibilityLabel={dayLabel(iso)}
                  accessibilityState={{ selected: chosen }}
                  style={styles.day}
                >
                  <View style={[styles.disc, chosen && { backgroundColor: tokens.accent }]}>
                    <AppText
                      tabular
                      weight={chosen ? 'semibold' : 'regular'}
                      color={chosen ? 'onAccent' : 'text'}
                      maxFontSizeMultiplier={1.2}
                    >
                      {String(Number(iso.slice(8)))}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

/** A day as VoiceOver reads it ("Saturday, September 26"). */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(y, m - 1, d));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  quick: { flexDirection: 'row', gap: 8, marginTop: 4, marginHorizontal: 16 },
  quickPill: { alignSelf: 'flex-start' },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginLeft: 20,
    marginRight: 12,
  },
  monthButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  weekdays: { flexDirection: 'row', marginTop: 6, marginHorizontal: 16 },
  cell: { flex: 1 },
  grid: { marginTop: 4, marginHorizontal: 16, minHeight: GRID_MIN },
  week: { flexDirection: 'row' },
  day: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.5 },
});
