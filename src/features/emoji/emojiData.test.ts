import { isSingleEmoji } from '@even/core';
import { describe, expect, it } from 'vitest';

import { catalogueEmoji, searchEmoji, SUGGESTED } from './emojiData';

describe('emoji data', () => {
  it('suggests the board grid: 42 single emoji, 6 rows of 7', () => {
    expect(SUGGESTED).toHaveLength(42);
    for (const e of SUGGESTED) expect(isSingleEmoji(e)).toBe(true);
    expect(new Set(SUGGESTED).size).toBe(42);
  });

  it('holds only single emoji in the catalogue', () => {
    for (const e of catalogueEmoji()) expect(isSingleEmoji(e), e).toBe(true);
  });

  it('searches by word prefix', () => {
    expect(searchEmoji('')).toEqual(SUGGESTED);
    expect(searchEmoji('evergreen')).toEqual(['🌲']);
    expect(searchEmoji('bir')).toContain('🦉');
    expect(searchEmoji('heart love')).toEqual(['❤️']);
    expect(searchEmoji('zzzz')).toEqual([]);
  });

  it('offers an emoji typed into the search', () => {
    expect(searchEmoji('🦖')).toEqual(['🦖']);
  });
});
