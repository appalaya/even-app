// Must stay the first import: installs crypto.getRandomValues before anything can call @even/core.
import '@/polyfills';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { runStartupSelfCheck } from '@/selfCheck';
// Imported for its side effect too: the task is defined when the bundle loads, before the OS asks for it.
import { registerBackgroundRefresh } from '@/services/background/task';
import { AppProvider, usePrefs } from '@/state';
import { ThemeProvider, useTheme } from '@/theme';

if (__DEV__) runStartupSelfCheck();

/**
 * Groups is always the bottom of the stack, so a cold start from a link (`/i#…`, `even://join`) still has Groups
 * under the Join sheet and Cancel lands there.
 */
export const unstable_settings = { anchor: 'index' };

/** How long the first frame waits for the Appearance preference before drawing in the system scheme. */
const PREFS_WAIT_MS = 400;

export default function RootLayout() {
  // Once per launch; iOS decides when the task runs (the simulator refuses it, which is logged, not thrown).
  useEffect(() => {
    void registerBackgroundRefresh();
  }, []);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppProvider renderError={(error) => <StartupError error={error} />}>
          <ThemedRoot />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * App settings → Appearance (a `prefs` row) drives the root theme: System follows the phone; Light or Dark overrides
 * it for the app and its native chrome (`ThemeProvider` applies `Appearance.setColorScheme` at the root).
 */
function ThemedRoot() {
  const { prefs } = usePrefs();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PREFS_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // Avoid a frame in the wrong scheme for someone who chose Light or Dark.
  if (prefs === null && !waited) return null;
  return (
    <ThemeProvider appearance={prefs?.appearance ?? 'system'}>
      <RootStack />
    </ThemeProvider>
  );
}

/** Create group and Join are sheets over Groups: transparent routes, with the kit Sheet doing the motion. */
const SHEET_ROUTE = {
  presentation: 'transparentModal',
  animation: 'none',
  contentStyle: { backgroundColor: 'transparent' },
} as const;

/**
 * The native root view under everything React draws has a single fixed colour, the light launch background from the
 * splash plugin. A gesture that moves the whole stack (the interactive pop on iOS) uncovers it, so in dark mode a
 * light strip showed. This keeps it in step with the theme, on both platforms.
 */
function useNativeBackground(color: string) {
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(color);
  }, [color]);
}

function RootStack() {
  const { tokens, scheme } = useTheme();
  useNativeBackground(tokens.background);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="create" options={SHEET_ROUTE} />
        <Stack.Screen name="join" options={SHEET_ROUTE} />
        <Stack.Screen name="i" options={SHEET_ROUTE} />
        <Stack.Screen name="settings" />
      </Stack>
    </>
  );
}

/** The store could not open (e.g. written by a newer version). No board draws this yet; logged, canvas colour only. */
function StartupError({ error }: { error: Error }) {
  useEffect(() => {
    console.error('Even could not open its data', error.message);
  }, [error]);
  return (
    <ThemeProvider>
      <Blank />
    </ThemeProvider>
  );
}

function Blank() {
  const { tokens } = useTheme();
  useNativeBackground(tokens.background);
  return <View style={[styles.root, { backgroundColor: tokens.background }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
