/**
 * The envelope tests (seal, open, resealEnvelope, pad, the structural checks), written against `SuiteApi` so they run
 * unchanged under Vitest in Node (`envelope.test.ts`, once per AEAD implementation) and on a phone through
 * `createMiniRunner` (the development crypto harness, with the native implementation installed). Whatever `setAead`
 * installed is what `seal` and `open` use while the suite runs; the few direct @noble calls below are the reference
 * the installed implementation is checked against, as an independent oracle.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import type * as FastCheck from 'fast-check';
import { LIMITS } from '../constants.js';
import { b64urlDecode, b64urlEncode, utf8Encode } from '../encoding.js';
import { aadFor, EnvelopeError, envelopeShape, envelopeStoredSize, isEnvelope, open, pad, resealEnvelope, seal, unpad } from '../envelope.js';
import type { EnvelopeErrorCode } from '../envelope.js';
import { newId, randomBytes } from '../ids.js';
import { deriveLocal, deriveServer } from '../keys.js';
import type { Envelope, EventOf } from '../types.js';
import type { SuiteApi } from './suiteApi.js';

/** Registers the envelope tests with `t`; `fc` is fast-check (passed in so this file has no test-runner import). */
export function envelopeSuite(t: SuiteApi, fc: typeof FastCheck): void {
  const { describe, it, expect } = t;
  const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
  const { encryptionKey: KEY } = deriveLocal(SECRET);
  const { groupId: GROUP } = deriveServer(SECRET, 'https://sync.even.appalaya.com');

  const BODY: EventOf<'group.renamed'> = {
    sv: 1,
    type: 'group.renamed',
    name: 'Banff 2026',
    ts: 1_767_225_600_000,
    at: 1_767_225_600_000,
    by: 'AAAAAAAAAAAAAAAAAAAAAA',
    dev: 'BBBBBBBBBBBBBBBBBBBBBB',
  };

  /**
   * Computed independently: Node's IETF chacha20-poly1305 with a hand-written HChaCha20 (checked against the
   * draft-irtf-cfrg-xchacha-03 test vector), manual 7816-4 padding and manual AAD. Key = encryptionKey of SECRET,
   * groupId = its groupId on the default server, nonce = 0xa0…0xb7.
   */
  const VECTOR: Envelope = {
    id: 'Q2bYbA1t6Gq9pD7Zk0xM3w',
    v: 1,
    n: 'oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3',
    c: 'f9jNZ3OVWHdySi5cD7218LFkCwzywbG28VrrAz11KzmKeTAVsQ4pXvDjg8B233CzCD3BUZrYhg80KupwadVsRZEeuSHruNH-lN4yFkhBpKFsHDOUBTjvjT2QYqNG3VEwxLpHxCRHSv6ayxfTt7KKsoPklpeKDh6LY930hTRxMpaPITJJkl6cGtDMzLAR3M-NKypaAGdDgb0Pv6vc59yK2Hg6-6pr14M2M3UB1y4j7EaUVUbMQxXQiGghqMj_V3P1cdgmIwIE9z6X3k1sI3zlsykRJApHe9U1V0HvpoOFjPF8a3lyfWDbcOwqJF4bmiyNMYfkXpC6t8ZWx_PakimaZQ',
  };

  function expectCode(fn: () => unknown, code: EnvelopeErrorCode): void {
    let caught: unknown;
    try {
      fn();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as EnvelopeError).code).toBe(code);
  }

  /** Replace the character at `index` with a different alphabet character. Mid-string characters carry 6 full bits. */
  function flipChar(text: string, index: number): string {
    const ch = text[index] === 'A' ? 'B' : 'A';
    return text.slice(0, index) + ch + text.slice(index + 1);
  }

  /** Seal arbitrary padded bytes directly, bypassing `pad`, to exercise open's post-decryption checks. */
  function sealRaw(padded: Uint8Array, id = newId()): Envelope {
    const nonce = randomBytes(24);
    const c = xchacha20poly1305(KEY, nonce, aadFor(GROUP, 1, id)).encrypt(padded);
    return { id, v: 1, n: b64urlEncode(nonce), c: b64urlEncode(c) };
  }

  /** A body whose JSON is exactly `n` bytes. */
  function bodyOfJsonLength(n: number): EventOf<'group.renamed'> {
    const base = { ...BODY, name: '' };
    const overhead = JSON.stringify(base).length;
    return { ...base, name: 'x'.repeat(n - overhead) };
  }

  describe('pad / unpad', () => {
    it('round-trips every length 0..600 with the right size class', () => {
      for (let n = 0; n <= 600; n++) {
        const plain = randomBytes(n);
        const padded = pad(plain);
        expect((padded.length + LIMITS.tagLength) % LIMITS.padBlock).toBe(0);
        expect(padded.length).toBeGreaterThan(n);
        expect(padded.length - n).toBeLessThanOrEqual(LIMITS.padBlock);
        expect(padded[n]).toBe(0x80);
        expect(padded.subarray(n + 1).every((b) => b === 0)).toBe(true);
        expect(unpad(padded)).toEqual(plain);
      }
    });

    it('round-trips arbitrary bytes, including trailing zeros and 0x80s (property)', () => {
      const tricky = fc.array(fc.constantFrom(0x00, 0x80, 0xff, 0x01), { maxLength: 300 }).map((a) => Uint8Array.from(a));
      fc.assert(
        fc.property(fc.oneof(fc.uint8Array({ maxLength: 2000 }), tricky), (plain) => {
          const padded = pad(plain);
          expect((padded.length + 16) % 256).toBe(0);
          expect(unpad(padded)).toEqual(plain);
        }),
        { numRuns: 500 },
      );
    });

    for (const [n, expected] of [
      [0, 240],
      [239, 240],
      [240, 496],
      [495, 496],
      [496, 752],
      [8175, 8176],
    ] as const) {
      it(`pads ${n} bytes to ${expected}`, () => {
        expect(pad(new Uint8Array(n))).toHaveLength(expected);
      });
    }

    it('accepts the maximum plaintext (8175) and refuses 8176 with too_large', () => {
      expect(pad(new Uint8Array(LIMITS.maxPlaintextBytes))).toHaveLength(8176);
      expectCode(() => pad(new Uint8Array(LIMITS.maxPlaintextBytes + 1)), 'too_large');
    });

    it('rejects padding without the 0x80 marker as undecryptable', () => {
      expectCode(() => unpad(new Uint8Array(0)), 'undecryptable');
      expectCode(() => unpad(new Uint8Array(240)), 'undecryptable');
      expectCode(() => unpad(Uint8Array.of(0x41, 0x42, 0x00)), 'undecryptable');
      expectCode(() => unpad(Uint8Array.of(0x41, 0x80, 0x01)), 'undecryptable');
    });

    it('strips only the last 0x80 marker', () => {
      expect(Array.from(unpad(Uint8Array.of(0x80, 0x80, 0x00)))).toEqual([0x80]);
      expect(Array.from(unpad(Uint8Array.of(0x80)))).toEqual([]);
    });
  });

  describe('aadFor', () => {
    it('is UTF-8("even/v1|" + groupId + "|" + v + "|" + id)', () => {
      expect(new TextDecoder().decode(aadFor('G', 1, 'I'))).toBe('even/v1|G|1|I');
      expect(Array.from(aadFor(GROUP, 1, VECTOR.id))).toEqual(Array.from(utf8Encode(`even/v1|${GROUP}|1|${VECTOR.id}`)));
    });
  });

  describe('seal', () => {
    it('produces a structurally valid v1 envelope with exactly id, v, n, c', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      expect(Object.keys(env)).toEqual(['id', 'v', 'n', 'c']);
      expect(env.v).toBe(1);
      expect(env.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(env.n).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(isEnvelope(env)).toBe(true);
    });

    it('uses the given id', () => {
      expect(seal({ key: KEY, groupId: GROUP, body: BODY, id: VECTOR.id }).id).toBe(VECTOR.id);
    });

    it('refuses an invalid id', () => {
      expectCode(() => seal({ key: KEY, groupId: GROUP, body: BODY, id: 'short' }), 'malformed');
    });

    it('refuses a key that is not 32 bytes', () => {
      expect(() => seal({ key: new Uint8Array(16), groupId: GROUP, body: BODY })).toThrow(RangeError);
    });

    it('draws a fresh nonce and id for each seal of the same body', () => {
      const a = seal({ key: KEY, groupId: GROUP, body: BODY });
      const b = seal({ key: KEY, groupId: GROUP, body: BODY });
      expect(a.n).not.toBe(b.n);
      expect(a.c).not.toBe(b.c);
      expect(a.id).not.toBe(b.id);
      const c = seal({ key: KEY, groupId: GROUP, body: BODY, id: a.id });
      expect(c.n).not.toBe(a.n);
    });

    it('keeps the ciphertext a multiple of 256 and at most 8192 bytes', () => {
      for (const n of [150, 239, 240, 241, 1000, 4096, 8000, 8175]) {
        const env = seal({ key: KEY, groupId: GROUP, body: bodyOfJsonLength(n) });
        const len = b64urlDecode(env.c).length;
        expect(len % 256).toBe(0);
        expect(len).toBeLessThanOrEqual(8192);
        expect(len).toBe(Math.ceil((n + 17) / 256) * 256);
      }
    });

    it('throws too_large when the JSON body exceeds 8175 bytes', () => {
      expect(() => seal({ key: KEY, groupId: GROUP, body: bodyOfJsonLength(8175) })).not.toThrow();
      expectCode(() => seal({ key: KEY, groupId: GROUP, body: bodyOfJsonLength(8176) }), 'too_large');
    });

    it('measures the limit in UTF-8 bytes, not UTF-16 units', () => {
      const base = { ...BODY, name: '' };
      const room = LIMITS.maxPlaintextBytes - JSON.stringify(base).length;
      const body = { ...base, name: '€'.repeat(Math.floor(room / 3)) + 'x'.repeat(room % 3) }; // 3 UTF-8 bytes per €
      expect(utf8Encode(JSON.stringify(body))).toHaveLength(8175);
      expect(JSON.stringify(body).length).toBeLessThan(3000);
      expect(() => seal({ key: KEY, groupId: GROUP, body })).not.toThrow();
      expectCode(() => seal({ key: KEY, groupId: GROUP, body: { ...body, name: `${body.name}x` } }), 'too_large');
    });

    it('serialises the body with JSON.stringify (no whitespace)', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      const padded = xchacha20poly1305(KEY, b64urlDecode(env.n), aadFor(GROUP, 1, env.id)).decrypt(b64urlDecode(env.c));
      expect(new TextDecoder().decode(unpad(padded))).toBe(JSON.stringify(BODY));
    });
  });

  describe('open', () => {
    it('opens the independent known-answer vector', () => {
      expect(isEnvelope(VECTOR)).toBe(true);
      expect(open({ key: KEY, groupId: GROUP, envelope: VECTOR })).toEqual(BODY);
    });

    it('round-trips seal -> open', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      expect(open({ key: KEY, groupId: GROUP, envelope: env })).toEqual(BODY);
    });

    it('round-trips non-ASCII and the largest body', () => {
      const emoji = { ...BODY, name: 'Café 🏔️ Banff — 2026' };
      expect(open({ key: KEY, groupId: GROUP, envelope: seal({ key: KEY, groupId: GROUP, body: emoji }) })).toEqual(emoji);
      const big = bodyOfJsonLength(8175);
      expect(open({ key: KEY, groupId: GROUP, envelope: seal({ key: KEY, groupId: GROUP, body: big }) })).toEqual(big);
    });

    it('survives a JSON round trip of the envelope (as stored in SQLite / sent over HTTP)', () => {
      const env = JSON.parse(JSON.stringify(seal({ key: KEY, groupId: GROUP, body: BODY }))) as Envelope;
      expect(open({ key: KEY, groupId: GROUP, envelope: env })).toEqual(BODY);
    });

    describe('tampering', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });

      it('a changed ciphertext character -> undecryptable', () => {
        for (const i of [0, 10, 100, 300]) {
          expectCode(() => open({ key: KEY, groupId: GROUP, envelope: { ...env, c: flipChar(env.c, i) } }), 'undecryptable');
        }
      });

      it('a truncated or extended ciphertext -> undecryptable', () => {
        const bytes = b64urlDecode(env.c);
        const shorter = { ...env, c: b64urlEncode(bytes.subarray(0, bytes.length - 1)) };
        const longer = { ...env, c: b64urlEncode(Uint8Array.of(...bytes, 0)) };
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: shorter }), 'undecryptable');
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: longer }), 'undecryptable');
      });

      it('a changed nonce -> undecryptable', () => {
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: { ...env, n: flipChar(env.n, 5) } }), 'undecryptable');
      });

      it('a changed id (replay under another id) -> undecryptable', () => {
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: { ...env, id: newId() } }), 'undecryptable');
      });

      it('another groupId (replay into another group or server) -> undecryptable', () => {
        const other = deriveServer(SECRET, 'https://home.example.net:8443/even').groupId;
        expectCode(() => open({ key: KEY, groupId: other, envelope: env }), 'undecryptable');
      });

      it('another key -> undecryptable', () => {
        expectCode(() => open({ key: randomBytes(32), groupId: GROUP, envelope: env }), 'undecryptable');
      });

      it('v relabelled to another positive integer -> unsupported_envelope, before any decryption', () => {
        for (const v of [2, 99]) {
          const relabelled = { ...env, v } as unknown as Envelope;
          // Even with the wrong key: the version check happens first.
          expectCode(() => open({ key: randomBytes(32), groupId: GROUP, envelope: relabelled }), 'unsupported_envelope');
        }
      });

      // Changed in the integration review: v = 0 used to be unsupported_envelope. `open` now shares envelopeShape with
      // the sync engine, whose rule is "any positive integer v"; no envelope version is ≤ 0, so such a v is malformed.
      it('v relabelled to 0 or a negative integer -> malformed', () => {
        for (const v of [0, -1]) {
          expectCode(() => open({ key: KEY, groupId: GROUP, envelope: { ...env, v } as unknown as Envelope }), 'malformed');
        }
      });
    });

    describe('post-decryption failures', () => {
      it('authentic ciphertext without a padding marker -> undecryptable', () => {
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: sealRaw(new Uint8Array(240)) }), 'undecryptable');
      });

      it('authentic ciphertext with invalid UTF-8 -> undecryptable', () => {
        const padded = pad(Uint8Array.of(0x22, 0xff, 0x22));
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: sealRaw(padded) }), 'undecryptable');
      });

      it('authentic ciphertext with non-JSON text -> undecryptable', () => {
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: sealRaw(pad(utf8Encode('{not json'))) }), 'undecryptable');
        expectCode(() => open({ key: KEY, groupId: GROUP, envelope: sealRaw(pad(new Uint8Array(0))) }), 'undecryptable');
      });

      it('returns any JSON value unvalidated (validation is parseEvent’s job)', () => {
        expect(open({ key: KEY, groupId: GROUP, envelope: sealRaw(pad(utf8Encode('[1,"x",null]'))) })).toEqual([1, 'x', null]);
        expect(open({ key: KEY, groupId: GROUP, envelope: sealRaw(pad(utf8Encode('42'))) })).toBe(42);
      });

      it('accepts an authentic ciphertext that is not 256-aligned (§3 binds producers, not readers)', () => {
        const padded = Uint8Array.of(...utf8Encode('{"a":1}'), 0x80); // 8 bytes -> 24-byte ciphertext
        const env = sealRaw(padded);
        expect(isEnvelope(env)).toBe(true);
        expect(open({ key: KEY, groupId: GROUP, envelope: env })).toEqual({ a: 1 });
      });
    });

    it('throws malformed for structurally invalid input, before decrypting', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      const bad: unknown[] = [null, undefined, 'x', [], {}, { ...env, extra: 1 }, { ...env, v: '1' }, { ...env, v: 1.5 }, { ...env, id: 'x' }];
      for (const envelope of bad) expectCode(() => open({ key: KEY, groupId: GROUP, envelope: envelope as Envelope }), 'malformed');
    });

    it('prefers malformed over unsupported_envelope when both apply (as the server does)', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      expectCode(() => open({ key: KEY, groupId: GROUP, envelope: { ...env, v: 2, id: 'short' } as unknown as Envelope }), 'malformed');
    });
  });

  describe('resealEnvelope', () => {
    const NEW_KEY = deriveLocal(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)).encryptionKey;
    const NEW_GROUP = deriveServer(SECRET, 'https://home.example.net:8443/even').groupId;

    /** Decrypts and unpads by hand: the plaintext bytes exactly as sealed, with no decoding or parsing. */
    function plaintextOf(key: Uint8Array, groupId: string, env: Envelope): Uint8Array {
      const cipher = xchacha20poly1305(key, b64urlDecode(env.n), aadFor(groupId, env.v, env.id));
      return unpad(cipher.decrypt(b64urlDecode(env.c)));
    }

    /**
     * An unsupported body a JSON round trip would change: odd whitespace, a key order and spacing JSON.stringify would
     * not produce, 2^60 and 2^60 + 1 as integer literals (the second is not a double), an exponent, -0, and an escape.
     */
    const ODD_TEXT =
      '{ "sv" : 2,\n\t"type":"poll.added" ,  "big": 1152921504606846976, "bigger":1152921504606846977,\r\n' +
      '  "exp": 1.0e3, "neg": -0, "s": "\\u00e9 é"   }\n';
    const ODD_BYTES = utf8Encode(ODD_TEXT);

    it('is byte-exact: the new envelope holds the same plaintext bytes, whitespace and big integers included', () => {
      expect(JSON.stringify(JSON.parse(ODD_TEXT))).not.toBe(ODD_TEXT); // a JSON round trip would lose it
      const original = sealRaw(pad(ODD_BYTES));

      const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: original });

      const bytes = plaintextOf(NEW_KEY, NEW_GROUP, resealed);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(ODD_TEXT);
      expect(Array.from(bytes)).toEqual(Array.from(ODD_BYTES));
      expect(isEnvelope(resealed)).toBe(true);
      expect(Object.keys(resealed)).toEqual(['id', 'v', 'n', 'c']);
      expect(resealed.id).toBe(original.id);
      expect(resealed.v).toBe(original.v);
      expect(resealed.n).not.toBe(original.n);
      expect(b64urlDecode(resealed.c)).toHaveLength(b64urlDecode(original.c).length);
      // open under the new keys accepts it (and parses as open always does).
      expect(open({ key: NEW_KEY, groupId: NEW_GROUP, envelope: resealed })).toMatchObject({ sv: 2, type: 'poll.added' });
    });

    it('re-encrypts for a new group id only (a move), a new key only, or both', () => {
      const original = sealRaw(pad(ODD_BYTES));
      for (const [newKey, newGroupId] of [[KEY, NEW_GROUP], [NEW_KEY, GROUP], [NEW_KEY, NEW_GROUP]] as const) {
        const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey, newGroupId, envelope: original });
        expect(Array.from(plaintextOf(newKey, newGroupId, resealed))).toEqual(Array.from(ODD_BYTES));
        expect(resealed.id).toBe(original.id);
      }
    });

    it('the resealed envelope no longer opens under the old key and group id', () => {
      const original = seal({ key: KEY, groupId: GROUP, body: BODY });
      const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: original });
      expectCode(() => open({ key: KEY, groupId: GROUP, envelope: resealed }), 'undecryptable');
      expectCode(() => open({ key: KEY, groupId: NEW_GROUP, envelope: resealed }), 'undecryptable');
      expectCode(() => open({ key: NEW_KEY, groupId: GROUP, envelope: resealed }), 'undecryptable');
      expect(open({ key: NEW_KEY, groupId: NEW_GROUP, envelope: resealed })).toEqual(BODY);
    });

    it('reseals to the same key and group id with a fresh nonce', () => {
      const original = sealRaw(pad(ODD_BYTES));
      const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: KEY, newGroupId: GROUP, envelope: original });
      expect(resealed.id).toBe(original.id);
      expect(resealed.n).not.toBe(original.n);
      expect(resealed.c).not.toBe(original.c);
      expect(Array.from(plaintextOf(KEY, GROUP, resealed))).toEqual(Array.from(ODD_BYTES));
    });

    it('carries any authentic plaintext over unread, even bytes open would reject as not UTF-8 JSON', () => {
      for (const plain of [Uint8Array.of(0x22, 0xff, 0x22), utf8Encode('{not json'), new Uint8Array(0)]) {
        const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: sealRaw(pad(plain)) });
        expect(Array.from(plaintextOf(NEW_KEY, NEW_GROUP, resealed))).toEqual(Array.from(plain));
      }
    });

    it('re-pads to the 256-byte size class, whatever the incoming alignment', () => {
      const unaligned = sealRaw(Uint8Array.of(...utf8Encode('{"a":1}'), 0x80)); // 24-byte ciphertext
      const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: unaligned });
      expect(b64urlDecode(resealed.c)).toHaveLength(256);
      expect(open({ key: NEW_KEY, groupId: NEW_GROUP, envelope: resealed })).toEqual({ a: 1 });
    });

    it('keeps arbitrary plaintext bytes exactly (property)', () => {
      fc.assert(
        fc.property(fc.uint8Array({ maxLength: 2000 }), (plain) => {
          const resealed = resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: sealRaw(pad(plain)) });
          expect(Array.from(plaintextOf(NEW_KEY, NEW_GROUP, resealed))).toEqual(Array.from(plain));
        }),
        { numRuns: 100 },
      );
    });

    it('throws malformed for structurally invalid input, before decrypting', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      const bad: unknown[] = [null, undefined, 'x', [], {}, { ...env, extra: 1 }, { ...env, v: '1' }, { ...env, v: 0 }, { ...env, id: 'x' }, { ...env, c: '' }];
      for (const envelope of bad) {
        expectCode(
          () => resealEnvelope({ key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: envelope as Envelope }),
          'malformed',
        );
      }
    });

    it('throws unsupported_envelope for another version and undecryptable for the wrong key, group id, or tampering', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      const args = { key: KEY, groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP };
      expectCode(() => resealEnvelope({ ...args, envelope: { ...env, v: 2 } as unknown as Envelope }), 'unsupported_envelope');
      expectCode(() => resealEnvelope({ ...args, key: NEW_KEY, envelope: env }), 'undecryptable');
      expectCode(() => resealEnvelope({ ...args, groupId: NEW_GROUP, envelope: env }), 'undecryptable');
      expectCode(() => resealEnvelope({ ...args, envelope: { ...env, c: flipChar(env.c, 10) } }), 'undecryptable');
      expectCode(() => resealEnvelope({ ...args, envelope: sealRaw(new Uint8Array(240)) }), 'undecryptable'); // no pad marker
    });

    it('refuses a current or new key that is not 32 bytes', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      expect(() => resealEnvelope({ key: new Uint8Array(16), groupId: GROUP, newKey: NEW_KEY, newGroupId: NEW_GROUP, envelope: env })).toThrow(RangeError);
      expect(() => resealEnvelope({ key: KEY, groupId: GROUP, newKey: new Uint8Array(31), newGroupId: NEW_GROUP, envelope: env })).toThrow(RangeError);
    });
  });

  describe('isEnvelope', () => {
    const real = seal({ key: KEY, groupId: GROUP, body: BODY });
    const withC = (bytes: number): Envelope => ({ ...real, c: b64urlEncode(new Uint8Array(bytes)) });

    it('accepts a real envelope and the vector', () => {
      expect(isEnvelope(real)).toBe(true);
      expect(isEnvelope(VECTOR)).toBe(true);
    });

    it('accepts decoded c lengths 17 and 8192, rejects 16 and 8193', () => {
      expect(isEnvelope(withC(16))).toBe(false);
      expect(isEnvelope(withC(17))).toBe(true);
      expect(isEnvelope(withC(18))).toBe(true);
      expect(isEnvelope(withC(8192))).toBe(true);
      expect(isEnvelope(withC(8193))).toBe(false);
      expect(isEnvelope(withC(0))).toBe(false);
    });

    it('treats v = 2 as not an Envelope (the type says v: 1), while open reports it as unsupported_envelope', () => {
      const v2 = { ...real, v: 2 };
      expect(isEnvelope(v2)).toBe(false);
      expectCode(() => open({ key: KEY, groupId: GROUP, envelope: v2 as unknown as Envelope }), 'unsupported_envelope');
    });

    const { id, v, n, c } = real;
    for (const [label, value] of [
      ['extra key', { id, v, n, c, seq: 1 }],
      ['missing id', { v, n, c }],
      ['missing v', { id, n, c }],
      ['missing n', { id, v, c }],
      ['missing c', { id, v, n }],
      ['id 21 chars', { id: id.slice(1), v, n, c }],
      ['id 23 chars', { id: `${id}A`, v, n, c }],
      ['id bad charset', { id: `${id.slice(1)}+`, v, n, c }],
      ['id not a string', { id: 1, v, n, c }],
      ['v as string', { id, v: '1', n, c }],
      ['v as float', { id, v: 1.5, n, c }],
      ['v = 2', { id, v: 2, n, c }],
      ['v null', { id, v: null, n, c }],
      ['n 31 chars', { id, v, n: n.slice(1), c }],
      ['n 33 chars', { id, v, n: `${n}A`, c }],
      ['n bad charset', { id, v, n: `${n.slice(1)}/`, c }],
      ['c with padding', { id, v, n, c: `${c}==` }],
      ['c bad charset', { id, v, n, c: `${c.slice(1)}+` }],
      ['c empty', { id, v, n, c: '' }],
      ['c not a string', { id, v, n, c: 42 }],
    ] as [string, unknown][]) {
      it(`rejects ${label}`, () => {
        expect(isEnvelope(value)).toBe(false);
      });
    }

    it('rejects a c whose length % 4 === 1', () => {
      const text = 'A'.repeat(4 * 100 + 1);
      expect(isEnvelope({ ...real, c: text })).toBe(false);
    });

    it('never throws on weird input', () => {
      const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
      const getterThrows = { id, v, n, get c(): string { throw new Error('boom'); } };
      for (const value of [null, undefined, 0, 1, 'x', true, [], [id, v, n, c], () => real, Symbol('x'), new Map(), hostile, getterThrows, Object.create(null)]) {
        expect(() => isEnvelope(value)).not.toThrow();
        expect(isEnvelope(value)).toBe(false);
      }
    });

    it('accepts a null-prototype object with the right fields (e.g. from a JSON reviver)', () => {
      const bare = Object.assign(Object.create(null) as object, real);
      expect(isEnvelope(bare)).toBe(true);
    });
  });

  describe('envelopeShape', () => {
    const real = seal({ key: KEY, groupId: GROUP, body: BODY });

    it('accepts a v1 envelope and reports its version', () => {
      expect(envelopeShape(real)).toEqual({ ok: true, v: 1 });
      expect(envelopeShape(VECTOR)).toEqual({ ok: true, v: 1 });
    });

    it('accepts any positive integer v, so the sync engine can keep unknown versions (PROTOCOL §10)', () => {
      for (const v of [2, 3, 99, Number.MAX_SAFE_INTEGER]) {
        expect(envelopeShape({ ...real, v })).toEqual({ ok: true, v });
        expect(isEnvelope({ ...real, v })).toBe(false); // isEnvelope stays strict for v = 1
      }
    });

    it('rejects a v that is not a positive safe integer', () => {
      for (const v of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1', null, undefined, true]) {
        expect(envelopeShape({ ...real, v })).toEqual({ ok: false });
      }
    });

    it('applies the same structural rules as isEnvelope, whatever the version', () => {
      const { id, n, c } = real;
      for (const v of [1, 2]) {
        expect(envelopeShape({ id, v, n, c, seq: 1 })).toEqual({ ok: false });
        expect(envelopeShape({ id: id.slice(1), v, n, c })).toEqual({ ok: false });
        expect(envelopeShape({ id, v, n: n.slice(1), c })).toEqual({ ok: false });
        expect(envelopeShape({ id, v, n, c: b64urlEncode(new Uint8Array(16)) })).toEqual({ ok: false });
        expect(envelopeShape({ id, v, n, c: b64urlEncode(new Uint8Array(8193)) })).toEqual({ ok: false });
        expect(envelopeShape({ id, v, n, c: b64urlEncode(new Uint8Array(17)) })).toEqual({ ok: true, v });
      }
    });

    it('never throws on weird input', () => {
      const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
      const getterThrows = { id: real.id, n: real.n, c: real.c, get v(): number { throw new Error('boom'); } };
      for (const value of [null, undefined, 0, 'x', [], () => real, Symbol('x'), new Map(), hostile, getterThrows]) {
        expect(envelopeShape(value)).toEqual({ ok: false });
      }
    });
  });

  describe('envelopeStoredSize', () => {
    it('is decoded length of c + 64', () => {
      const env = seal({ key: KEY, groupId: GROUP, body: BODY });
      expect(envelopeStoredSize(env)).toBe(b64urlDecode(env.c).length + 64);
      expect(envelopeStoredSize(VECTOR)).toBe(256 + 64);
      for (const bytes of [17, 18, 19, 20, 255, 256, 8192]) {
        expect(envelopeStoredSize({ ...VECTOR, c: b64urlEncode(new Uint8Array(bytes)) })).toBe(bytes + 64);
      }
    });
  });
}
