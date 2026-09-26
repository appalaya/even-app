import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, isB64url, utf8Decode, utf8Encode } from './encoding.js';

const bytes = (...xs: number[]) => new Uint8Array(xs);

describe('b64urlEncode / b64urlDecode', () => {
  it.each([
    [[], ''],
    [[0x66], 'Zg'],
    [[0x66, 0x6f], 'Zm8'],
    [[0x66, 0x6f, 0x6f], 'Zm9v'],
    [[0x66, 0x6f, 0x6f, 0x62], 'Zm9vYg'],
    [[0x66, 0x6f, 0x6f, 0x62, 0x61], 'Zm9vYmE'],
    [[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], 'Zm9vYmFy'],
    [[0xfb, 0xff], '-_8'],
    [[0xfb, 0xef, 0xbe], '----'],
    [[0xff, 0xff, 0xff], '____'],
    [[0x00, 0x00, 0x00], 'AAAA'],
  ])('%j <-> %s (RFC 4648 vectors, url alphabet, no padding)', (input, text) => {
    expect(b64urlEncode(bytes(...input))).toBe(text);
    expect(Array.from(b64urlDecode(text))).toEqual(input);
  });

  it('encodes 16 bytes to 22 chars, 24 to 32, 32 to 43', () => {
    expect(b64urlEncode(new Uint8Array(16))).toHaveLength(22);
    expect(b64urlEncode(new Uint8Array(24))).toHaveLength(32);
    expect(b64urlEncode(new Uint8Array(32))).toHaveLength(43);
    expect(b64urlEncode(new Uint8Array(8192))).toHaveLength(10923);
  });

  it('round-trips arbitrary bytes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (input) => {
        const text = b64urlEncode(input);
        expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
        expect(text.length % 4).not.toBe(1);
        expect(isB64url(text)).toBe(true);
        expect(b64urlDecode(text)).toEqual(input);
      }),
      { numRuns: 500 },
    );
  });

  it('agrees with a reference encoder (property)', () => {
    const reference = (b: Uint8Array) =>
      btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    fc.assert(fc.property(fc.uint8Array({ maxLength: 200 }), (b) => b64urlEncode(b) === reference(b)), { numRuns: 300 });
  });

  it('encodes views at their own offset', () => {
    const buffer = bytes(1, 2, 0xfb, 0xff, 3);
    expect(b64urlEncode(buffer.subarray(2, 4))).toBe('-_8');
  });

  it.each([
    ['padding', 'Zg=='],
    ['single padding', 'Zm8='],
    ['standard alphabet +', 'ab+c'],
    ['standard alphabet /', 'ab/c'],
    ['space', 'Zm9 v'],
    ['newline', 'Zm9v\n'],
    ['non-ASCII', 'Zm9vé'],
    ['dot', 'Zm9v.'],
    ['impossible length 1', 'A'],
    ['impossible length 5', 'AAAAA'],
  ])('rejects %s', (_label, text) => {
    expect(() => b64urlDecode(text)).toThrow();
    expect(isB64url(text)).toBe(false);
  });

  it('rejects non-strings at runtime', () => {
    expect(() => b64urlDecode(123 as unknown as string)).toThrow(TypeError);
  });

  it('accepts non-zero trailing pad bits (RFC 4648 §3.5 leniency) and decodes them to the canonical bytes', () => {
    expect(Array.from(b64urlDecode('-_9'))).toEqual([0xfb, 0xff]);
    expect(isB64url('-_9')).toBe(true);
    expect(b64urlEncode(b64urlDecode('-_9'))).toBe('-_8');
  });
});

describe('isB64url', () => {
  it('checks exact length when given', () => {
    expect(isB64url('abc', 3)).toBe(true);
    expect(isB64url('abc', 4)).toBe(false);
    expect(isB64url('abcd', 3)).toBe(false);
    expect(isB64url('', 0)).toBe(true);
    expect(isB64url('')).toBe(true);
  });

  it('rejects a requested length no byte string can have', () => {
    expect(isB64url('AAAAA', 5)).toBe(false);
  });

  it('rejects padding and foreign characters even at the right length', () => {
    expect(isB64url('Zg==', 4)).toBe(false);
    expect(isB64url('ab+c', 4)).toBe(false);
    expect(isB64url('ab/c', 4)).toBe(false);
  });

  it('returns false for non-strings instead of throwing', () => {
    for (const value of [null, undefined, 42, {}, [], () => 'x']) {
      expect(isB64url(value as unknown as string)).toBe(false);
    }
  });
});

describe('utf8', () => {
  it('round-trips text including astral characters (property)', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => {
      // Lone surrogates are not representable in UTF-8; `binary` units generate valid code points only.
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }));
  });

  it('encodes known sequences', () => {
    expect(Array.from(utf8Encode('é€😀'))).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
    expect(Array.from(utf8Encode('even/v1'))).toEqual([101, 118, 101, 110, 47, 118, 49]);
  });

  it('rejects malformed UTF-8 instead of substituting U+FFFD', () => {
    expect(() => utf8Decode(bytes(0xff))).toThrow();
    expect(() => utf8Decode(bytes(0xc3))).toThrow();
    expect(() => utf8Decode(bytes(0xed, 0xa0, 0x80))).toThrow(); // encoded surrogate
  });

  it('preserves a leading BOM', () => {
    expect(utf8Decode(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('﻿A');
  });
});
