import { afterEach, describe, expect, it, vi } from 'vitest';
import { isId, newId, randomBytes } from './ids.js';

describe('randomBytes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the requested length', () => {
    for (const n of [0, 1, 16, 24, 32, 1000]) expect(randomBytes(n)).toHaveLength(n);
  });

  it('fills requests larger than the 65536-byte getRandomValues quota', () => {
    const out = randomBytes(200_000);
    expect(out).toHaveLength(200_000);
    // Each 64 KiB chunk is filled: the last kilobyte is not all zeros.
    expect(out.subarray(199_000).some((b) => b !== 0)).toBe(true);
  });

  it('uses globalThis.crypto.getRandomValues', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    randomBytes(16);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses a CSPRNG that fills nothing', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T,>(a: T) => a);
    expect(() => randomBytes(32)).toThrow(/all zeros/);
  });

  it('rejects invalid lengths', () => {
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => randomBytes(n)).toThrow(RangeError);
  });
});

describe('newId', () => {
  it('is 22 base64url characters', () => {
    for (let i = 0; i < 100; i++) {
      const id = newId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(isId(id)).toBe(true);
    }
  });

  it('is unique over 10k draws', () => {
    const ids = new Set(Array.from({ length: 10_000 }, newId));
    expect(ids.size).toBe(10_000);
  });

  it('uses the whole alphabet (not time-ordered, not hex)', () => {
    const chars = new Set(Array.from({ length: 2000 }, newId).join(''));
    expect(chars.size).toBe(64);
  });
});

describe('isId', () => {
  it('accepts 22 characters from [A-Za-z0-9_-]', () => {
    expect(isId('Q2bYbA1t6Gq9pD7Zk0xM3w')).toBe(true);
    expect(isId('AAAAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(isId('__________------------')).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['21 chars', 'AAAAAAAAAAAAAAAAAAAAA'],
    ['23 chars', 'AAAAAAAAAAAAAAAAAAAAAAA'],
    ['plus', 'AAAAAAAAAAAAAAAAAAAAA+'],
    ['slash', 'AAAAAAAAAAAAAAAAAAAAA/'],
    ['padding', 'AAAAAAAAAAAAAAAAAAAA=='],
    ['space', 'AAAAAAAAAAA AAAAAAAAAA'],
    ['non-ASCII', 'AAAAAAAAAAAAAAAAAAAAAé'],
    ['43-char token', 'Bth1dhK4nn2tJ_RNu2DTi0ZWWiCKyPXtYFJsoUA4TA8'],
  ])('rejects %s', (_label, text) => {
    expect(isId(text)).toBe(false);
  });

  it('returns false for non-strings', () => {
    for (const value of [null, undefined, 22, {}, ['AAAAAAAAAAAAAAAAAAAAAA']]) {
      expect(isId(value as unknown as string)).toBe(false);
    }
  });
});
