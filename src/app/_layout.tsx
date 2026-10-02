// Installs crypto.getRandomValues before anything can call @even/core. The entry (index.js) imports it first; it
// stays the first import here too.
import '@/polyfills';

import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorScreen, useNativeBackground } from '@/features/errors/ErrorScreen';
import { HELP_PAGE } from '@/features/report/contact';
import { useInAppBrowser } from '@/features/report/inAppBrowser';
import { LINKS } from '@/features/settings/about';
import { runStartupSelfCheck } from '@/selfCheck';
// The task itself is defined by the entry (index.js), which a headless start evaluates without this layout.
import { registerBackgroundRefresh } from '@/services/background/task';
import { quietCaughtRenderErrors } from '@/services/caughtRenderErrors';
import { ensureActivityChannel } from '@/services/notifications/local';
import { AppProvider, describeForLog, usePrefs } from '@/state';
import { lastAppliedAppearance, NavigationTheme, ThemeProvider, useTheme } from '@/theme';

if (__DEV__) runStartupSelfCheck();
// A render error AppError catches is logged by it alone, in fixed words (services/caughtRenderErrors.ts).
if (!__DEV__) quietCaughtRenderErrors();

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

function RootStack() {
  const { tokens, scheme } = useTheme();
  useNativeBackground(tokens.background);
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {__DEV__ && <DevRenderThrow />}
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
 * Development builds only: `globalThis.__evenThrowOnRender()` makes the tree under the root layout throw while
 * rendering, as a screen with a bug would, so the harness can show AppError and press Try again. Never in a release
 * build (`__DEV__` is false there, so this is not rendered and the bundler drops it).
 */
function DevRenderThrow() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const hooks = globalThis as { __evenThrowOnRender?: () => void };
    hooks.__evenThrowOnRender = () => setArmed(true);
    return () => {
      delete hooks.__evenThrowOnRender;
    };
  }, []);
  if (armed) throw new Error('development render throw (__evenThrowOnRender)');
  return null;
}

/**
 * AppError: expo-router renders this in place of the root layout when anything under it throws while rendering (any
 * screen, sheet or layout), so a render error nobody foresaw shows this board instead of closing the app (pre-launch
 * review H1). Try again draws the root layout again, which remounts every screen; Report a problem opens the contact
 * page on Get help. On its own providers, since the layout's are gone, in the Appearance the app last applied. The log
 * keeps fixed words and a code, never the error's message.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.error('Even could not draw a screen', describeForLog(error));
  }, [error]);
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider appearance={lastAppliedAppearance()}>
        <AppError onRetry={() => void retry()} />
      </ThemeProvider>
    </GestureHandlerRootView>
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

/** AppError: "Report a problem" opens the contact page on Get help in the in-app browser. */
function AppError({ onRetry }: { onRetry: () => void }) {
  const openPage = useInAppBrowser();
  return (
    <ErrorScreen
      glyph="warning"
      alert
      title="Something went wrong."
      text="If it keeps happening, let us know."
      primary={{ label: 'Try again', onPress: onRetry }}
      quiet={{ label: 'Report a problem', onPress: () => void openPage(HELP_PAGE) }}
    />
  );
}

/**
 * StartupError: Try again opens the app's services again; Get help opens the contact page in the in-app browser, as
 * App settings' Help row opens it.
 */
function StartupErrorScreen({ onRetry }: { onRetry: () => void }) {
  const openPage = useInAppBrowser();
  return (
    <ErrorScreen
      glyph="warning"
      alert
      title="Even couldn't open your groups."
      text="Try again. If it keeps happening, restart your phone."
      primary={{ label: 'Try again', onPress: onRetry }}
      quiet={{ label: 'Get help', onPress: () => void openPage(LINKS.contact) }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
