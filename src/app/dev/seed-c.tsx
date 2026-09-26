/**
 * Dev only: seeds "Banff 2026" for screen stack C and opens one of its sheets as a board draws it.
 * `com.appalaya.even://dev/seed-c?screen=expense|new|picker|chosen|error|edit|settle|split&mode=equal|exact|percent`
 * (`bg=0` skips opening the Group screen underneath). See `src/dev/seedC.ts`.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { openSeed, type SeedMode, type SeedScreen } from '@/dev/seedC';
import { WithServices } from '@/features/addExpense/routing';
import { useApp } from '@/state';
import { useTheme } from '@/theme';

const SCREENS: readonly SeedScreen[] = [
  'expense',
  'new',
  'picker',
  'chosen',
  'error',
  'split',
  'edit',
  'settle',
];
const MODES: readonly SeedMode[] = ['equal', 'exact', 'percent'];

export default function SeedCRoute() {
  return (
    <WithServices>
      <Seeder />
    </WithServices>
  );
}

function Seeder() {
  const services = useApp();
  const { tokens } = useTheme();
  const params = useLocalSearchParams<{ screen?: string; mode?: string; bg?: string }>();
  const [status, setStatus] = useState('Seeding Banff 2026…');
  const started = useRef(false);

  useEffect(() => {
    if (!__DEV__ || started.current) return;
    started.current = true;
    const screen = SCREENS.find((s) => s === params.screen) ?? 'expense';
    const mode = MODES.find((m) => m === params.mode) ?? 'exact';
    openSeed(services, screen, mode, { background: params.bg !== '0' }).catch((error: unknown) =>
      setStatus(`seed-c failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }, [params.bg, params.mode, params.screen, services]);

  return (
    <View style={[styles.screen, { backgroundColor: tokens.background }]}>
      <AppText color="textMuted">{status}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
