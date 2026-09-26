import { describe, expect, it } from 'vitest';

import type { KeypadKey } from '@/components/Keypad';

import { applyKey, entryToMinor, minorToEntry } from './amountEntry';

const type = (keys: string, exponent = 2, max?: number) =>
  [...keys].reduce(
    (text, k) => applyKey(text, (k === '<' ? 'delete' : k) as KeypadKey, exponent, max),
    '',
  );

describe('keypad entry', () => {
  it('builds amounts in minor units without floating arithmetic', () => {
    expect(entryToMinor(type('36'), 2)).toBe(3600);
    expect(entryToMinor(type('36.5'), 2)).toBe(3650);
    expect(entryToMinor(type('.05'), 2)).toBe(5);
    expect(entryToMinor(type('0.1'), 3)).toBe(100);
    expect(entryToMinor(type('1234'), 0)).toBe(1234);
  });

  it('ignores digits past the exponent, a second point, and a point without minor units', () => {
    expect(type('1.234')).toBe('1.23');
    expect(type('1..5')).toBe('1.5');
    expect(type('12.5', 0)).toBe('125');
  });

  it('collapses leading zeros and deletes one key at a time', () => {
    expect(type('005')).toBe('5');
    expect(type('36.5<<')).toBe('36');
    expect(type('<')).toBe('');
  });

  it('refuses a key that would pass the maximum', () => {
    expect(type('100.01', 2, 10_000)).toBe('100.0');
    expect(entryToMinor(type('100', 2, 10_000), 2)).toBe(10_000);
    expect(entryToMinor(type('99999999999'), 2)).toBe(9_999_999_999_00);
    expect(type('100000000001')).toBe('10000000000');
  });

  it('round-trips a stored amount back into entry text', () => {
    expect(minorToEntry(3600, 2)).toBe('36');
    expect(minorToEntry(3650, 2)).toBe('36.5');
    expect(minorToEntry(5, 2)).toBe('0.05');
    expect(minorToEntry(1234, 0)).toBe('1234');
    expect(minorToEntry(0, 2)).toBe('');
    for (const n of [1, 10, 99, 100, 101, 123_456, 1_000_000_000_000]) {
      expect(entryToMinor(minorToEntry(n, 2), 2)).toBe(n);
      expect(entryToMinor(minorToEntry(n, 3), 3)).toBe(n);
    }
  });
});
