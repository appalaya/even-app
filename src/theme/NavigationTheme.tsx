import { DarkTheme, DefaultTheme, ThemeProvider as RouterThemeProvider } from 'expo-router';
import { useMemo, type ReactNode } from 'react';

import { useTheme } from './ThemeProvider';

/**
 * Even's canvas for the native views React Navigation paints itself. The native stack fills its
 * UINavigationController's view with the navigation theme's `background` (react-native-screens'
 * `nativeContainerStyle`), and iOS 27's push and pop draw both screens as rounded cards over that view. Left at React
 * Navigation's default theme it was light grey (#F2F2F2) in dark mode too: a light rim and corners around the cards
 * for the whole transition. Wrap each `Stack` in this, inside the `ThemeProvider` whose tokens it should follow.
 */
export function NavigationTheme({ children }: { children: ReactNode }) {
  const { tokens, scheme } = useTheme();
  const value = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: tokens.background } };
  }, [scheme, tokens.background]);
  return <RouterThemeProvider value={value}>{children}</RouterThemeProvider>;
}
