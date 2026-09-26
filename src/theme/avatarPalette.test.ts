import { AVATAR_COLOR_COUNT, memberColor } from '@even/core';
import { describe, expect, it } from 'vitest';

import { avatarNames, avatarPalette, themes } from './themes';

/**
 * The avatar palette's order is everyone's colour: core `memberColor` stores an index into it. This pins the
 * Palette board's twelve, in order, so a reorder fails here before it recolours every member of every group.
 */
describe('avatar palette', () => {
  it('is the Palette board, in order', () => {
    expect(avatarPalette).toEqual([
      '#964D60',
      '#A0553B',
      '#8E5A1F',
      '#7A6610',
      '#5B712B',
      '#2F784D',
      '#04786E',
      '#047487',
      '#336A8E',
      '#5762A1',
      '#755896',
      '#8A507E',
    ]);
    expect(avatarNames).toEqual([
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
    ]);
  });

  it('covers every index core can produce, the same hex in both schemes', () => {
    expect(avatarPalette).toHaveLength(AVATAR_COLOR_COUNT);
    expect(memberColor('any member id')).toBeLessThan(avatarPalette.length);
    for (const theme of Object.values(themes)) {
      expect(theme.light.avatar).toHaveLength(AVATAR_COLOR_COUNT);
      expect(theme.dark.avatar).toEqual(theme.light.avatar);
    }
  });
});
