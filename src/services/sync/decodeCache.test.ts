import { describe, expect, it } from 'vitest';

import { DecodeCache, type Decoded } from './decodeCache';

const entry = (text: string, groupId = 'g1'): Decoded => ({
  text,
  groupId,
  event: null,
  type: 'expense.added',
});

describe('DecodeCache', () => {
  it('answers only for the exact text and group id an envelope was opened from', () => {
    const cache = new DecodeCache();
    cache.put('L', 'e1', entry('{"a":1}'));
    expect(cache.get('L', 'e1', '{"a":1}', 'g1')?.type).toBe('expense.added');
    expect(cache.get('L', 'e1', '{"a":2}', 'g1')).toBeUndefined();
    expect(cache.get('L', 'e1', '{"a":1}', 'g2')).toBeUndefined();
    expect(cache.get('M', 'e1', '{"a":1}', 'g1')).toBeUndefined();
  });

  it('carries an entry across a byte-exact re-encryption, but only from the text and group it holds', () => {
    const cache = new DecodeCache();
    cache.put('L', 'e1', entry('old'));
    cache.resealed('L', 'e1', { text: 'other', groupId: 'g1' }, { text: 'new', groupId: 'g2' });
    expect(cache.get('L', 'e1', 'new', 'g2')).toBeUndefined();
    cache.resealed('L', 'e1', { text: 'old', groupId: 'g9' }, { text: 'new', groupId: 'g2' });
    expect(cache.get('L', 'e1', 'new', 'g2')).toBeUndefined();
    cache.resealed('L', 'e1', { text: 'old', groupId: 'g1' }, { text: 'new', groupId: 'g2' });
    expect(cache.get('L', 'e1', 'new', 'g2')?.type).toBe('expense.added');
    expect(cache.get('L', 'e1', 'old', 'g1')).toBeUndefined();
  });

  it('retains what a derive saw and what was put since its mark; drop forgets the group', () => {
    const cache = new DecodeCache();
    cache.put('L', 'seen', entry('a'));
    cache.put('L', 'gone', entry('b'));
    const mark = cache.mark();
    cache.put('L', 'pulled meanwhile', entry('c'));
    cache.retain('L', new Set(['seen']), mark);
    expect(cache.size('L')).toBe(2);
    expect(cache.get('L', 'gone', 'b', 'g1')).toBeUndefined();
    expect(cache.get('L', 'pulled meanwhile', 'c', 'g1')).toBeDefined();
    cache.drop('L');
    expect(cache.size('L')).toBe(0);
  });
});
