import { Platform, type TextStyle } from 'react-native';

/**
 * The type scale the canvas uses, transcribed from the artboards' inline styles (font-size / line-height /
 * weight / letter-spacing, in points). The system font on iOS (-apple-system on the boards, SF on the phone); Inter
 * on Android (`androidFace` below).
 *
 * Sizes and line heights follow the iOS Dynamic Type defaults (Large Title 34/41, Title 3 20/25, Body 17/22,
 * Callout 16/21, Subhead 15/20, Footnote 13/18), so `allowFontScaling` scales them the way the OS scales its own
 * (Android's font size setting too).
 * A variant carries the weight the canvas uses most for it; `AppText`'s `weight` overrides it.
 */

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export type FontWeightName = keyof typeof fontWeight;

/** Money and every other column of figures: tabular so digits line up and do not jitter while typing. */
export const tabularNums = { fontVariant: ['tabular-nums'] } as const satisfies TextStyle;

/**
 * The invite link and the code field on the canvas (`ui-monospace`). iOS resolves `ui-monospace` to SF Mono; Android
 * has no family by that name and drew these in the sans face, so it takes its own `monospace`.
 */
export const monoFamily = Platform.OS === 'android' ? 'monospace' : 'ui-monospace';

/**
 * Android draws Inter (the OFL release, bundled from `assets/fonts` by app.json's `expo-font` entry as the families
 * `Inter` and `InterDisplay`, Regular to Bold, so `fontWeight` picks the face). iOS keeps the system font and gets
 * nothing here.
 *
 * Inter has two cuts: Text for reading sizes and Display, drawn tighter for large ones. Its optical-size axis runs
 * from 14 (Text) to 32 (Display); a style takes the cut its size is nearer to, so Display from 24 pt up (the big
 * number, the amount, large titles, the keypad), Text below. Tabular figures (`tabularNums`) are Inter's `tnum`.
 */
const INTER_DISPLAY_FROM = 24;

function androidFace(fontSize: number | undefined): TextStyle {
  if (Platform.OS !== 'android') return {};
  return { fontFamily: (fontSize ?? 0) >= INTER_DISPLAY_FROM ? 'InterDisplay' : 'Inter' };
}

/** Adds the Android face to every style that names no family of its own (the mono styles keep theirs). */
function withAndroidFace<T extends Record<string | number, TextStyle>>(styles: T): T {
  if (Platform.OS !== 'android') return styles;
  const faced: Record<string | number, TextStyle> = {};
  for (const [key, style] of Object.entries(styles)) {
    faced[key] =
      style.fontFamily === undefined ? { ...style, ...androidFace(style.fontSize) } : style;
  }
  return faced as T;
}

export const typography = withAndroidFace({
  /** 34/41 bold, −0.4: "Groups", "Settings". */
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.4 },
  /** 34/41 bold, −0.8: the "Even" wordmark in the header of Groups (empty) and behind Create / Join sheets. */
  wordmark: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.8 },
  /** 44/48 bold, −1.2: the wordmark beside the mark (AppIcon board lockup). */
  wordmarkLockup: { fontSize: 44, lineHeight: 48, fontWeight: '700', letterSpacing: -1.2 },
  /** 56/64 semibold, −1.5, tabular: the big number on Group. */
  display: { fontSize: 56, lineHeight: 64, fontWeight: '600', letterSpacing: -1.5, ...tabularNums },
  /** 60/68 semibold, −1.5, tabular: the amount being entered (Add expense, Settle). */
  amount: { fontSize: 60, lineHeight: 68, fontWeight: '600', letterSpacing: -1.5, ...tabularNums },
  /** 44/52 semibold, −1: "You're even". */
  displayText: { fontSize: 44, lineHeight: 52, fontWeight: '600', letterSpacing: -1 },
  /** 28/34 bold, −0.3: an expense's title on Expense detail. */
  heading: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3 },
  /** 28/34 bold, −0.5: "Even" under the mark on About. */
  appName: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  /** 28/34 semibold, −0.5, tabular: the amount while the title is being typed (Add expense, keyboard up). */
  amountCompact: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.5,
    ...tabularNums,
  },
  /** 30/36 bold, −0.5: the group name on Join. */
  title1: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  /** 24/30 bold, −0.3: "Join Banff 2026?" (code read). */
  title2: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  /** 22/28 bold, −0.3: a confirm sheet's question ("Regenerate the invite link?"). */
  title3: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  /** 20/25 semibold: card and sheet titles ("Invite your group", "Done adding"), the group-name field. */
  headline: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  /** 17/22: nav bar, buttons (semibold), inputs, group-card titles (semibold). */
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' },
  /** 16/21: list rows. */
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400' },
  /** 16/23: a paragraph in a sheet or an empty card. */
  calloutLoose: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  /** 15/20: secondary rows, pills, banners, section headers on Group (semibold). */
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' },
  /** 15/21: activity lines and short paragraphs. */
  subheadLoose: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  /** 14/19: the second line of an expense row and a group card ("Maya paid", "4 people"). */
  footnote: { fontSize: 14, lineHeight: 19, fontWeight: '400' },
  /** 14/18: segmented control labels (medium; semibold when selected). */
  segment: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  /** 13/18: captions, footnotes under a card, field labels (medium), settings section headers (semibold). */
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** 13/16 semibold: initials on a small avatar, the "+N" chip. */
  captionTight: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  /** 13/18 medium, +0.6 tracking: the currency code under the amount being entered. */
  currencyCode: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0.6 },
  /** 15/20 medium: the currency code beside the big number on Group. */
  currencyInline: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
  /** 26/32: keypad digits. */
  keypad: { fontSize: 26, lineHeight: 32, fontWeight: '400' },
  /** 14/20 mono: the invite link in Group settings. */
  mono: { fontSize: 14, lineHeight: 20, fontWeight: '400', fontFamily: monoFamily },
  /** 15/22 mono: the pasted code on Join with code. */
  monoLoose: { fontSize: 15, lineHeight: 22, fontWeight: '400', fontFamily: monoFamily },
} as const satisfies Record<string, TextStyle>);

export type TypographyVariant = keyof typeof typography;

/** Emoji sizes as drawn (font-size/line-height): tile glyphs, chips, the emoji grid. */
export const emojiType = {
  /** 20/24: the 40 pt expense tile and a category tile. */
  tile: { fontSize: 20, lineHeight: 24 },
  /** 18/22: the category chip, a category bar row. */
  chip: { fontSize: 18, lineHeight: 22 },
  /** 26/30: a cell of the emoji picker. */
  grid: { fontSize: 26, lineHeight: 30 },
} as const satisfies Record<string, TextStyle>;

/**
 * Avatar glyph sizes per diameter, as drawn: initials and emoji. The canvas draws avatars at 24, 26, 28, 30,
 * 32, 36, 56 and 72 pt. Emoji at 24 and 26 are not drawn anywhere; they take the 28 pt size scaled down (noted in
 * the kit report).
 */
const avatarGlyphs = {
  24: { initials: { fontSize: 13, lineHeight: 16 }, emoji: { fontSize: 13, lineHeight: 16 } },
  26: { initials: { fontSize: 13, lineHeight: 16 }, emoji: { fontSize: 14, lineHeight: 16 } },
  28: { initials: { fontSize: 13, lineHeight: 16 }, emoji: { fontSize: 15, lineHeight: 18 } },
  30: { initials: { fontSize: 13, lineHeight: 16 }, emoji: { fontSize: 17, lineHeight: 20 } },
  32: { initials: { fontSize: 13, lineHeight: 16 }, emoji: { fontSize: 18, lineHeight: 20 } },
  36: { initials: { fontSize: 15, lineHeight: 18 }, emoji: { fontSize: 20, lineHeight: 22 } },
  /** Join, "I'm not listed": initials 22/26 as drawn; the emoji is not drawn and scales between 36 and 72. */
  56: { initials: { fontSize: 22, lineHeight: 26 }, emoji: { fontSize: 30, lineHeight: 36 } },
  72: { initials: { fontSize: 28, lineHeight: 34 }, emoji: { fontSize: 38, lineHeight: 44 } },
} as const satisfies Record<number, { initials: TextStyle; emoji: TextStyle }>;

/** `avatarGlyphs`, with the Android face on the initials (the emoji draw from the system's emoji font). */
export const avatarType = Object.fromEntries(
  Object.entries(avatarGlyphs).map(([size, glyphs]) => [
    size,
    { ...glyphs, initials: { ...glyphs.initials, ...androidFace(glyphs.initials.fontSize) } },
  ]),
) as unknown as typeof avatarGlyphs;

export type AvatarSize = keyof typeof avatarType;
