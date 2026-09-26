/**
 * Dev only: seeds stack A's canvas data and opens one of its screens, for simulator screenshots. For example
 * `com.appalaya.even://dev/seed-a?screen=groups`, `…?screen=empty&t=320`, `…?screen=settings&emoji=🌲`.
 * Screens: groups, archived, empty, create, emoji, join-code, join-preview, join-error, join-pick, settings,
 * settings-emoji, recovery. Production builds redirect home.
 */
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { SEED_SCREENS, seedA, type SeedScreen } from '@/dev/seedA';
import { resetRecoveryOffer, suppressRecoveryOffer } from '@/features/groups/useKeychainRecovery';
import { useApp } from '@/state';
import { useTheme } from '@/theme';

export default function SeedARoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Seeder />;
}

function Seeder() {
  const services = useApp();
  const { tokens } = useTheme();
  const params = useLocalSearchParams<{ screen?: string; emoji?: string; t?: string }>();
  const [status, setStatus] = useState('Seeding…');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const screen = (SEED_SCREENS as readonly string[]).includes(params.screen ?? '')
      ? (params.screen as SeedScreen)
      : 'groups';
    // Screenshots: no LogBox toasts (the unreachable server's sync warnings) over the footer.
    LogBox.ignoreAllLogs(true);
    suppressRecoveryOffer();
    seedA(services, screen, {
      emoji: params.emoji ?? null,
      motionAt: params.t === undefined ? undefined : Number(params.t),
    })
      .then((target) => {
        router.dismissAll();
        setTimeout(() => {
          if (target.mode === 'replace') router.replace(target.path as Href);
          else router.push(target.path as Href);
          // Once the new Groups screen is up, let it ask (asking earlier reaches the one being replaced).
          if (screen === 'recovery') setTimeout(resetRecoveryOffer, 600);
        }, 60);
      })
      .catch((error: unknown) => {
        setStatus(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, [services, params.screen, params.emoji, params.t]);

  return (
    <View style={[styles.fill, { backgroundColor: tokens.background }]}>
      <AppText color="textMuted">{status}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
});
