/**
 * Semantic colour tokens (design.md "Theme tokens"). Components never contain a literal colour; they read
 * these from `useTheme()`. Adding a theme is adding a `Theme` object in `themes.ts`.
 *
 * Every value is transcribed from the design canvas (light and dark artboards). The comment on each token names
 * where the canvas uses it, so a later theme knows what it is recolouring.
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
  /** Screen canvas behind cards; sticky footers. */
  background: string;
  /** Cards, list groups, sheets, banners. */
  surface: string;
  /** Raised above a track: the selected segment of a segmented control. */
  surfaceRaised: string;
  /** Grouped list inside a sheet (Done adding, Join). Equals `background` in light. */
  surfaceInset: string;
  /** Inputs, pills, category tiles, member chips, the list inside the Split sheet. */
  fill: string;
  /** The round close button in a sheet header. */
  fillMuted: string;
  /** The 40 pt category tile at the start of an expense row. */
  tile: string;
  /** Segmented control track. */
  segmentTrack: string;
  /** Category bar and usage meter track. */
  barTrack: string;
  /** Disabled button fill ("Join" before a code is complete, "Share link" while preparing). */
  disabledFill: string;

  text: string;
  /** Subtitles, field labels, section headers, unselected segments, "You owe". */
  textSecondary: string;
  /** Captions: dates, currency code, footnotes, the sync line, "settled". */
  textMuted: string;
  /** A disabled text action ("Done" in Split while the split is unbalanced). */
  textDisabled: string;
  /** Label on `disabledFill`. */
  onDisabledFill: string;
  /** Chevrons, the sync glyph at rest, the dashed "not done" outline, the hollow sync dot, placeholders. */
  glyph: string;

  /** Outlined rows, cards and banners ("Archived · 2", the archive offer, a read code). */
  border: string;
  /** Outline of the shares stepper; the track of the small progress ring. */
  outline: string;
  /** Dashed outline of the "+ extra" field. */
  outlineDashed: string;
  /** Hairlines inside a card on `surface`; emoji-avatar backdrop and the "+N" chip on `surface`. */
  separator: string;
  /** Hairlines inside a list on `fill` or `surfaceInset`; emoji-avatar backdrop there. */
  separatorInset: string;
  /** The sheet grabber. */
  grabber: string;
  /** Dims the screen behind a sheet. */
  scrim: string;

  accent: string;
  onAccent: string;
  /** Soft accent: tinted buttons, chips, the "I'm done" pill, selected tiles (the canvas's `accentTint`). */
  accentSoft: string;
  /** Category bar fill (the accent at 55 %). */
  accentBar: string;
  /** Banners. Never used for money. (No canvas board uses it yet; banners there are neutral.) */
  attention: string;

  /** Initials on an avatar colour. */
  onAvatar: string;
  /** Switch thumb. */
  switchThumb: string;
  /** Switch track when off. Not drawn on the canvas (only the on state is); see the kit report. */
  switchOff: string;
  /** Shadow under the selected segment (`0 1px 3px`). Transparent in dark, where the canvas draws none. */
  segmentShadow: string;
  /** Shadow under the switch thumb (`0 1px 3px`). */
  switchShadow: string;

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
