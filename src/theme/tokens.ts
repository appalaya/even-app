/**
 * Semantic colour tokens (design.md "Theme tokens"). Components never contain a literal colour; they read
 * these from `useTheme()`. Adding a theme is adding a `Theme` object in `themes.ts`.
 *
 * Every value is transcribed from the design canvas (light and dark artboards). The comment on each token names
 * where the canvas uses it, so a later theme knows what it is recolouring.
 */

/**
 * Twelve avatar backgrounds. `MemberState.color` (core `memberColor`, FNV-1a mod 12) is an index into this tuple,
 * so the ORDER IS FROZEN: reordering, inserting or removing an entry recolours every member of every group on
 * every device. A theme may change a hex (a member keeps their slot); it may never move one.
 */
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
  /**
   * The selected segment of a segmented control, and nothing else (Palette board: `segmentThumb`). #3A3D3B in
   * dark is this thumb only; dark fields and chips are `fill` (#252827).
   */
  segmentThumb: string;
  /** Grouped list inside a sheet (Done adding, Join). Equals `background` in light. */
  surfaceInset: string;
  /** Fields, chips, pills, category tiles, keypad-sheet rows, the list inside the Split sheet. */
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
  /** Captions: dates, currency code, footnotes, the sync line, "settled"; placeholder text in every field. */
  textMuted: string;
  /** A disabled text action ("Done" in Split while the split is unbalanced). */
  textDisabled: string;
  /** Label on `disabledFill`. */
  onDisabledFill: string;
  /** Chevrons, the sync glyph at rest, the dashed "not done" outline, the hollow sync dot (Palette: `iconMuted`). */
  iconMuted: string;

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
  /** Hairlines inside the soft-accent card (the settle list once everyone is done; Group, everyone done). */
  separatorTint: string;
  /**
   * Emoji-avatar backdrop inside a toggle chip on `fill` (RegenerateInvite, "Remove someone?"): the board draws
   * `separator` in light and `separatorInset` in dark.
   */
  avatarOnChip: string;
  /** The dashed outline of something not chosen yet: the "Category" chip, the "Choose" circle on Settle. */
  outlineStrong: string;
  /** The sheet grabber. */
  grabber: string;
  /** Dims the screen behind a sheet. */
  scrim: string;

  accent: string;
  /** The primary button while pressed (States board). */
  accentPressed: string;
  /** Label and glyph on `accent` (and on `accentPressed`). */
  onAccent: string;
  /** Soft accent: tinted buttons, chips, the "I'm done" pill, selected tiles (the canvas's `accentTint`). */
  accentSoft: string;
  /** Category bar fill (the accent at 55 %). */
  accentBar: string;
  /** Banners. Never used for money. (No canvas board uses it yet; banners there are neutral.) */
  attention: string;
  /**
   * Destructive text actions: Delete on Expense detail, "Leave anyway", "Delete the copy on <old host>" (Expense
   * detail and Group settings, extra states boards). Never used for money or for errors (errors are `text`).
   */
  danger: string;

  /** A pressable list row while pressed, on `surface` (States board: the settle row). */
  rowPressed: string;
  /** A pill or chip on `fill` while pressed (States board: "Paid by You"). */
  fillPressed: string;

  /** Initials on an avatar colour. */
  onAvatar: string;
  /** Switch thumb. */
  switchThumb: string;
  /** Switch track when off (States board). */
  switchOff: string;
  /** Shadow under the selected segment (`0 1px 3px`). Transparent in dark, where the canvas draws none. */
  segmentShadow: string;
  /** Shadow under the switch thumb (`0 1px 3px`). */
  switchShadow: string;

  /** Every entry carries white initials at 4.5:1 or better. Frozen order: see `AvatarPalette`. */
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
