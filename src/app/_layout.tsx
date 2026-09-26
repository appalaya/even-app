// Must stay the first import: installs crypto.getRandomValues before anything can call @even/core.
import '@/polyfills';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { runStartupSelfCheck } from '@/selfCheck';
import { ThemeProvider, useTheme } from '@/theme';

if (__DEV__) runStartupSelfCheck();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { tokens, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
