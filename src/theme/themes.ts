import type { AvatarPalette, Theme } from './tokens';

/**
 * Avatar palette: twelve hues 30° apart in OKLCH (L ≈ 0.52, C ≤ 0.11), anchored so that clay (index 0) and
 * steel (index 7) sit on the wheel exactly. Every entry passes 4.5:1 with white text (lowest: 5.22, index 4).
 * Shared by light and dark: the contrast that matters is with the white initials, not with the canvas.
 *
 * Canvas check: clay and steel match the boards exactly. The boards also draw eight other avatar fills that are
 * near-hue variants of this wheel rather than its entries (rose #9E4A5A, mustard #8A6A1F, moss #4E7038, lagoon
 * #2B6C70, indigo #4B56A0, violet #6A539A, plum #85508A and a second plum #9A4876). They do not add up to twelve
 * (two sit on the plum slot), so the palette is left as designed; the owner decides (see the kit report).
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

/**
 * v1's only theme: spruce on warm neutrals. Every neutral below is the value the canvas boards use (light boards
 * and their dark twins, compared position by position), so the kit renders what is drawn.
 */
export const even: Theme = {
  id: 'even',
  name: 'Even',
  light: {
    background: '#F6F5F1',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceInset: '#F6F5F1',
    fill: '#F3F2EE',
    fillMuted: '#EFEEE9',
    tile: '#F2F1EC',
    segmentTrack: '#ECEBE6',
    barTrack: '#F0EFEA',
    disabledFill: '#E6E5E0',
    text: '#161715',
    textSecondary: '#595B56',
    textMuted: '#6B6D67',
    textDisabled: '#A3A59F',
    onDisabledFill: '#8A8C86',
    glyph: '#8A8C86',
    border: '#E3E2DC',
    outline: '#DEDDD7',
    outlineDashed: '#CFCEC8',
    separator: '#ECEBE6',
    separatorInset: '#E7E6E0',
    grabber: '#D6D5CF',
    scrim: 'rgba(22,23,21,0.34)',
    accent: '#1F6B5A',
    onAccent: '#FFFFFF',
    accentSoft: '#1F6B5A1A',
    accentBar: '#1F6B5A8C',
    attention: '#9A5A0B',
    onAvatar: '#FFFFFF',
    switchThumb: '#FFFFFF',
    switchOff: '#E7E6E0',
    segmentShadow: 'rgba(22,23,21,0.10)',
    switchShadow: 'rgba(0,0,0,0.20)',
    avatar,
  },
  dark: {
    background: '#0E100F',
    surface: '#1A1C1B',
    surfaceRaised: '#3A3D3B',
    surfaceInset: '#232625',
    fill: '#252827',
    fillMuted: '#2A2D2B',
    tile: '#252827',
    segmentTrack: '#262927',
    barTrack: '#2A2D2B',
    disabledFill: '#262927',
    text: '#F1F1ED',
    textSecondary: '#A9ACA6',
    textMuted: '#8F928C',
    textDisabled: '#5E615C',
    onDisabledFill: '#6E716C',
    glyph: '#7E817B',
    border: '#2E3230',
    outline: '#3A3D3B',
    outlineDashed: '#464A47',
    separator: '#2A2D2B',
    separatorInset: '#2E3230',
    grabber: '#4A4D4B',
    scrim: 'rgba(0,0,0,0.60)',
    accent: '#74C1AB',
    onAccent: '#0B1A16',
    accentSoft: '#74C1AB29',
    accentBar: '#74C1AB8C',
    attention: '#E3A857',
    onAvatar: '#FFFFFF',
    switchThumb: '#FFFFFF',
    switchOff: '#3A3D3B',
    segmentShadow: 'rgba(0,0,0,0)',
    switchShadow: 'rgba(0,0,0,0.30)',
    avatar,
  },
};

export const DEFAULT_THEME_ID = 'even';

export const themes: Readonly<Record<string, Theme>> = { even };

/** The theme with this id, or undefined for an unknown or absent id (callers fall back per the resolution order). */
export function findTheme(id: string | null | undefined): Theme | undefined {
  return id != null && Object.hasOwn(themes, id) ? themes[id] : undefined;
}
