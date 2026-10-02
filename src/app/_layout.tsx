// Must stay the first import: installs crypto.getRandomValues before anything can call @even/core.
import '@/polyfills';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Icon } from '@/components';
import { useInAppBrowser } from '@/features/report/inAppBrowser';
import { LINKS } from '@/features/settings/about';
import { runStartupSelfCheck } from '@/selfCheck';
// Imported for its side effect too: the task is defined when the bundle loads, before the OS asks for it.
import { registerBackgroundRefresh } from '@/services/background/task';
import { ensureActivityChannel } from '@/services/notifications/local';
import { AppProvider, describeForLog, usePrefs } from '@/state';
import { NavigationTheme, ThemeProvider, useTheme } from '@/theme';

if (__DEV__) runStartupSelfCheck();

/**
 * Groups is always the bottom of the stack, so a cold start from a link (an invite link, which `+native-intent.ts`
 * sends to `/join?code=…`, or `even://join`) still has Groups under the Join sheet and Cancel lands there.
 */
export const unstable_settings = { anchor: 'index' };

/** How long the first frame waits for the Appearance preference before drawing in the system scheme. */
const PREFS_WAIT_MS = 400;

export default function RootLayout() {
  // Once per launch; iOS decides when the task runs (the simulator refuses it, which is logged, not thrown). Android's
  // notification channel is made here too, so Settings lists "Group activity" before the first notification.
  useEffect(() => {
    void registerBackgroundRefresh();
    void ensureActivityChannel();
  }, []);
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppProvider renderError={(error, retry) => <StartupError error={error} retry={retry} />}>
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
      <NavigationTheme>
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
          <Stack.Screen name="about" />
          <Stack.Screen name="diagnostics" />
        </Stack>
      </NavigationTheme>
    </>
  );
}

/**
 * The store could not open (e.g. written by a newer version): the StartupError board, in the system scheme (the
 * Appearance preference lives in the store). The error is logged.
 */
function StartupError({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    console.error('Even could not open its data', describeForLog(error));
  }, [error]);
  return (
    <ThemeProvider>
      <StartupErrorScreen onRetry={retry} />
    </ThemeProvider>
  );
}

/**
 * StartupError, at the Groups screen's size: the 24 pt warning glyph in a 56 pt `surface` circle, "Even couldn't open
 * your groups." 22/28 bold 20 below it and "Try again. If it keeps happening, restart your phone." 16/23
 * `textSecondary` 10 below that, centred in the space above the buttons (inset 32, 40 clear of them); then "Try
 * again" (opens the app's services again) and "Get help" (44 pt, 8 below; the contact page in the in-app browser, as
 * App settings' Help row opens it), inset 16, with 12 above them and the home indicator's inset below.
 */
function StartupErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { tokens, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const openPage = useInAppBrowser();
  useNativeBackground(tokens.background);
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: tokens.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={styles.errorBody} accessibilityRole="alert">
        <View style={[styles.errorGlyph, { backgroundColor: tokens.surface }]}>
          <Icon name="warning" size={24} color={tokens.text} strokeWidth={2} />
        </View>
        <AppText
          variant="title3"
          align="center"
          accessibilityRole="header"
          style={styles.errorTitle}
        >
          Even couldn&apos;t open your groups.
        </AppText>
        <AppText
          variant="calloutLoose"
          color="textSecondary"
          align="center"
          style={styles.errorText}
        >
          Try again. If it keeps happening, restart your phone.
        </AppText>
      </View>
      <View style={styles.errorActions}>
        <Button label="Try again" onPress={onRetry} />
        <Button
          label="Get help"
          variant="quiet"
          weight="semibold"
          onPress={() => void openPage(LINKS.contact)}
          style={styles.help}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  errorBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  errorGlyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: { marginTop: 20 },
  errorText: { marginTop: 10 },
  errorActions: { paddingTop: 12, paddingHorizontal: 16 },
  help: { minHeight: 44, marginTop: 8 },
});
