import type { AvatarPalette, Theme } from './tokens';

/**
 * Avatar palette, exactly as the Palette board draws it: twelve colours 30° apart in OKLCH hue at lightness 0.515
 * and chroma 0.10 (Teal and Lagoon 0.09, the sRGB limit); Clay and Steel keep their earlier hexes, within 5° of
 * their slots. Each passes 4.5:1 with white initials. A member's colour is the same hex in light and dark.
 *
 * FROZEN ORDER. Core `memberColor(memberId)` (FNV-1a mod `AVATAR_COLOR_COUNT`) yields an index into this tuple and
 * that index is what every device stores and shows, so the order below IS everyone's colour. Reordering, inserting
 * or removing an entry changes the colour of every member of every group. Change a hex if you must (the member
 * keeps their slot); never the order. `avatarPalette.test.ts` pins it.
 */
export const avatarPalette: AvatarPalette = [
  '#964D60', // 0 Rose
  '#A0553B', // 1 Clay
  '#8E5A1F', // 2 Ochre
  '#7A6610', // 3 Olive
  '#5B712B', // 4 Moss
  '#2F784D', // 5 Pine
  '#04786E', // 6 Teal
  '#047487', // 7 Lagoon
  '#336A8E', // 8 Steel
  '#5762A1', // 9 Indigo
  '#755896', // 10 Violet
  '#8A507E', // 11 Plum
];

/** The Palette board's names for `avatarPalette`, index for index. */
export const avatarNames = [
  'Rose',
  'Clay',
  'Ochre',
  'Olive',
  'Moss',
  'Pine',
  'Teal',
  'Lagoon',
  'Steel',
  'Indigo',
  'Violet',
  'Plum',
] as const;

/**
 * v1's only theme: spruce on warm neutrals. Every value below is the Palette board's token table, or where that
 * table is silent, the value the screen boards draw (light boards and their dark twins, compared position by
 * position), so the kit renders what is drawn.
 */
export const even: Theme = {
  id: 'even',
  name: 'Even',
  light: {
    background: '#F6F5F1',
    surface: '#FFFFFF',
    segmentThumb: '#FFFFFF',
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
    iconMuted: '#8A8C86',
    border: '#E3E2DC',
    outline: '#DEDDD7',
    outlineDashed: '#CFCEC8',
    separator: '#ECEBE6',
    separatorInset: '#E7E6E0',
    separatorTint: 'rgba(22,23,21,0.07)',
    avatarOnChip: '#ECEBE6',
    outlineStrong: '#BDBCB6',
    grabber: '#D6D5CF',
    scrim: 'rgba(22,23,21,0.34)',
    accent: '#1F6B5A',
    accentPressed: '#17574A',
    onAccent: '#FFFFFF',
    accentSoft: '#1F6B5A1A',
    accentBar: '#1F6B5A8C',
    attention: '#9A5A0B',
    danger: '#B23A30',
    rowPressed: '#ECEBE6',
    fillPressed: '#E3E2DC',
    onAvatar: '#FFFFFF',
    switchThumb: '#FFFFFF',
    switchOff: '#DEDDD7',
    segmentShadow: 'rgba(22,23,21,0.10)',
    switchShadow: 'rgba(0,0,0,0.20)',
    avatar: avatarPalette,
  },
  dark: {
    background: '#0E100F',
    surface: '#1A1C1B',
    segmentThumb: '#3A3D3B',
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
    iconMuted: '#7E817B',
    border: '#2E3230',
    outline: '#3A3D3B',
    outlineDashed: '#464A47',
    separator: '#2A2D2B',
    separatorInset: '#2E3230',
    separatorTint: 'rgba(255,255,255,0.08)',
    avatarOnChip: '#2E3230',
    outlineStrong: '#5A5E5B',
    grabber: '#4A4D4B',
    scrim: 'rgba(0,0,0,0.60)',
    accent: '#74C1AB',
    accentPressed: '#5FA893',
    onAccent: '#0B1A16',
    accentSoft: '#74C1AB29',
    accentBar: '#74C1AB8C',
    attention: '#E3A857',
    danger: '#F0A097',
    rowPressed: '#2A2D2B',
    fillPressed: '#3A3D3B',
    onAvatar: '#FFFFFF',
    switchThumb: '#FFFFFF',
    switchOff: '#3A3D3B',
    segmentShadow: 'rgba(0,0,0,0)',
    switchShadow: 'rgba(0,0,0,0.30)',
    avatar: avatarPalette,
  },
};

export const DEFAULT_THEME_ID = 'even';

export const themes: Readonly<Record<string, Theme>> = { even };

/** The theme with this id, or undefined for an unknown or absent id (callers fall back per the resolution order). */
export function findTheme(id: string | null | undefined): Theme | undefined {
  return id != null && Object.hasOwn(themes, id) ? themes[id] : undefined;
}
