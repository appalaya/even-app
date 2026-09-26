import type { AvatarPalette, Theme } from './tokens';

/**
 * Avatar palette: twelve hues 30° apart in OKLCH (L ≈ 0.52, C ≤ 0.11), anchored so that clay (index 0) and
 * steel (index 7) sit on the wheel exactly. Every entry passes 4.5:1 with white text (lowest: 5.22, index 4).
 * Shared by light and dark: the contrast that matters is with the white initials, not with the canvas.
 */
const avatar: AvatarPalette = [
  '#A0553B', // clay
  '#945912', // ochre
  '#7C6702', // mustard
  '#5B7323', // moss
  '#277B4C', // fern
  '#08796F', // teal
  '#087689', // lagoon
  '#336A8E', // steel
  '#5762A8', // indigo
  '#78579C', // violet
  '#8F4F82', // plum
  '#9C4B61', // rose
];

/** v1's only theme: spruce on warm neutrals. */
export const even: Theme = {
  id: 'even',
  name: 'Even',
  light: {
    background: '#F6F5F1',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    text: '#141513',
    textMuted: '#6B6E6A',
    border: '#D9D7CF',
    separator: '#E7E5DF',
    accent: '#1F6B5A',
    onAccent: '#FFFFFF',
    accentSoft: '#DCEBE5',
    attention: '#9A5A0B',
    avatar,
  },
  dark: {
    background: '#0E100F',
    surface: '#171917',
    surfaceRaised: '#1F221F',
    text: '#F1F1EE',
    textMuted: '#9A9D98',
    border: '#2E322E',
    separator: '#232623',
    accent: '#74C1AB',
    onAccent: '#0E100F',
    accentSoft: '#1B3A32',
    attention: '#E3A857',
    avatar,
  },
};

export const DEFAULT_THEME_ID = 'even';

export const themes: Readonly<Record<string, Theme>> = { even };

/** The theme with this id, or undefined for an unknown or absent id (callers fall back per the resolution order). */
export function findTheme(id: string | null | undefined): Theme | undefined {
  return id != null && Object.hasOwn(themes, id) ? themes[id] : undefined;
}
