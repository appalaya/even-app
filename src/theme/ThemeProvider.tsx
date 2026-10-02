import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { even, findTheme } from './themes';
import type { AppearancePreference, ColorScheme, Theme, ThemeTokens } from './tokens';

export interface ResolvedTheme {
  /** The resolved tokens for the current scheme. This is what components read. */
  tokens: ThemeTokens;
  scheme: ColorScheme;
  theme: Theme;
}

interface ThemeContextValue extends ResolvedTheme {
  /** Carried so a nested (group) provider can fall back to the app theme and inherit Appearance. */
  appThemeId: string | null;
  appearance: AppearancePreference;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The Appearance choice the root provider last applied. AppError (the root layout's error boundary) draws in it once
 * the layout, and the preference it read, are gone: the native override `Appearance.setColorScheme` leaves in place
 * does not reach `useColorScheme`.
 */
let appliedAppearance: AppearancePreference = 'system';

export function lastAppliedAppearance(): AppearancePreference {
  return appliedAppearance;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * The group's theme (a future `group.themed` event). Set on the provider that wraps a group screen.
   * Unknown ids fall through to the app theme.
   */
  groupThemeId?: string | null;
  /** The app theme (a `prefs` row, later). Inherited from the parent provider when omitted. */
  appThemeId?: string | null;
  /**
   * App settings → Appearance (a `prefs` row, later). Inherited when omitted; `system` at the root.
   * On the root provider a concrete choice is also applied to native UI through `Appearance.setColorScheme`.
   */
  appearance?: AppearancePreference;
}

/**
 * Resolution order (design.md "Theme tokens"): group theme → app theme → `even`; light or dark from the
 * Appearance setting, deferring to the system appearance when it is `system`.
 */
export function ThemeProvider({
  children,
  groupThemeId,
  appThemeId,
  appearance,
}: ThemeProviderProps) {
  const parent = useContext(ThemeContext);
  const isRoot = parent === null;
  const system = useColorScheme();

  const resolvedAppThemeId = appThemeId !== undefined ? appThemeId : (parent?.appThemeId ?? null);
  const resolvedAppearance = appearance ?? parent?.appearance ?? 'system';

  useEffect(() => {
    if (!isRoot || appearance === undefined) return;
    appliedAppearance = appearance;
    // 'auto' removes the override and follows the system again (RN 0.88).
    Appearance.setColorScheme(appearance === 'system' ? 'auto' : appearance);
  }, [isRoot, appearance]);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = findTheme(groupThemeId) ?? findTheme(resolvedAppThemeId) ?? even;
    const scheme: ColorScheme =
      resolvedAppearance === 'system' ? (system === 'dark' ? 'dark' : 'light') : resolvedAppearance;
    return {
      theme,
      scheme,
      tokens: theme[scheme],
      appThemeId: resolvedAppThemeId,
      appearance: resolvedAppearance,
    };
  }, [groupThemeId, resolvedAppThemeId, resolvedAppearance, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The resolved theme for this subtree. Throws outside a ThemeProvider, which is a wiring bug. */
export function useTheme(): ResolvedTheme {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme() must be used inside <ThemeProvider>');
  return value;
}
