import type { TextStyle } from 'react-native';

/**
 * The type scale the canvas uses, transcribed from the artboards' inline styles (font-size / line-height /
 * weight / letter-spacing, in points). The system font throughout (-apple-system on the boards, SF on iOS).
 *
 * Sizes and line heights follow the iOS Dynamic Type defaults (Large Title 34/41, Title 3 20/25, Body 17/22,
 * Callout 16/21, Subhead 15/20, Footnote 13/18), so `allowFontScaling` scales them the way the OS scales its own.
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

/** `ui-monospace` resolves to SF Mono on iOS (invite link and code field on the canvas). */
export const monoFamily = 'ui-monospace';

export const typography = {
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
} as const satisfies Record<string, TextStyle>;

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
export const avatarType = {
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

export type AvatarSize = keyof typeof avatarType;
