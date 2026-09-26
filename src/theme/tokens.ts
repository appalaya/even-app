/**
 * Semantic colour tokens (design.md "Theme tokens"). Components never contain a literal colour; they read
 * these from `useTheme()`. Adding a theme is adding a `Theme` object in `themes.ts`.
 */

/** Twelve avatar backgrounds. `MemberState.color` from @even/core is an index into this tuple. */
export type AvatarPalette = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export interface ThemeTokens {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  separator: string;
  accent: string;
  onAccent: string;
  /** Soft accent: bars, chips. */
  accentSoft: string;
  /** Banners. Never used for money. */
  attention: string;
  /** Every entry carries white initials at 4.5:1 or better. */
  avatar: AvatarPalette;
}

export interface Theme {
  id: string;
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** Resolved light or dark. */
export type ColorScheme = 'light' | 'dark';

/** App settings → Appearance (a `prefs` row later). `system` defers to the OS appearance. */
export type AppearancePreference = 'system' | 'light' | 'dark';
