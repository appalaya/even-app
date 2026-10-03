import {
  aead,
  deriveLocal,
  deriveServer,
  nobleAead,
  open,
  openMany,
  seal,
  type Event,
} from '@even/core';
import { STABLELIB } from '@even/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  aeadStatus,
  fingerprint,
  installNativeAead,
  nativeAeadFrom,
  MAX_PADDED_BYTES,
  NATIVE_BATCH_ITEMS,
  resetNativeAeadForTests,
  SELF_TEST_DIGESTS,
  SELF_TEST_VECTOR,
  selfTestAead,
  selfTestCases,
  type NativeCrypto,
} from './nativeAead';

afterEach(() => resetNativeAeadForTests());

/** A stand-in for modules/even-crypto that does the right thing, through @noble, in place. */
function goodNative(overrides: Partial<NativeCrypto> = {}): NativeCrypto {
  return {
    info: () => ({ library: 'stand-in', version: '1.0' }),
    seal: (k, n, a, p, out) => {
      const sealed = nobleAead.seal(k, n, a, p);
      if (sealed.length !== out.length) return false;
      out.set(sealed);
      return true;
    },
    open: (k, n, a, s, out) => {
      const plain = nobleAead.open(k, n, a, s);
      if (plain === null || plain.length !== out.length) {
        out.fill(0);
        return false;
      }
      out.set(plain);
      return true;
    },
    openMany: (k, input, lengths, out, opened) => packedOpenMany(k, input, lengths, out, opened),
    ...overrides,
  };
}

/** The native batch layout, done in JavaScript as the modules do it natively (EvenCryptoModule.swift / .kt). */
function packedOpenMany(
  key: Uint8Array,
  input: Uint8Array,
  lengths: Int32Array,
  out: Uint8Array,
  opened: Uint8Array,
  open: (
    k: Uint8Array,
    n: Uint8Array,
    a: Uint8Array,
    s: Uint8Array,
  ) => Uint8Array | null = nobleAead.open,
): number {
  const count = opened.length;
  if (key.length !== 32 || lengths.length !== count * 2) return -1;
  let inputTotal = 0;
  let outTotal = 0;
  for (let i = 0; i < count; i++) {
    const [aadLength, sealedLength] = [lengths[2 * i] ?? -1, lengths[2 * i + 1] ?? -1];
    if (aadLength < 0 || sealedLength < 16) return -1;
    inputTotal += 24 + aadLength + sealedLength;
    outTotal += sealedLength - 16;
  }
  if (inputTotal !== input.length || outTotal !== out.length) return -1;
  let inAt = 0;
  let outAt = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const [aadLength, sealedLength] = [lengths[2 * i]!, lengths[2 * i + 1]!];
    const nonce = input.subarray(inAt, inAt + 24);
    const aad = input.subarray(inAt + 24, inAt + 24 + aadLength);
    const sealed = input.subarray(inAt + 24 + aadLength, inAt + 24 + aadLength + sealedLength);
    const plain = open(key, nonce, aad, sealed);
    opened[i] = plain === null ? 0 : 1;
    if (plain !== null) {
      out.set(plain, outAt);
      n += 1;
    }
    inAt += 24 + aadLength + sealedLength;
    outAt += sealedLength - 16;
  }
  return n;
}

/** The bytes a view covers, read from the start of its buffer instead: a module that ignores byteOffset. */
const fromBufferStart = (view: Uint8Array): Uint8Array =>
  new Uint8Array(view.buffer, 0, view.length);

const BODY: Event = {
  sv: 1,
  type: 'group.renamed',
  name: 'Banff',
  ts: 1_767_225_600_000,
  at: 1_767_225_600_000,
  by: 'AAAAAAAAAAAAAAAAAAAAAA',
  dev: 'BBBBBBBBBBBBBBBBBBBBBB',
};

describe('the self-test vector', () => {
  it('is draft-irtf-cfrg-xchacha-03 §A.3.1, as in the vector set, and @noble passes it', () => {
    const [, key, nonce, aad, msg, sealed] = STABLELIB[0] ?? [];
    expect(SELF_TEST_VECTOR).toEqual({ key, nonce, aad, msg, sealed });
    expect(selfTestAead(nobleAead)).toBeNull();
  });
});

describe('installNativeAead', () => {
  it('installs a module that passes, and envelopes cross between it and @noble', () => {
    const lines: string[] = [];
    const status = installNativeAead(goodNative(), (line) => lines.push(line));
    expect(status).toMatchObject({ kind: 'native', name: 'stand-in 1.0' });
    expect(aead().name).toBe('stand-in 1.0');
    expect(lines).toEqual([
      expect.stringMatching(
        /^\[even\] crypto: native stand-in 1\.0, self-test passed in [\d.]+ ms$/,
      ),
    ]);

    const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
    const { encryptionKey: key } = deriveLocal(secret);
    const { groupId } = deriveServer(secret, 'https://sync.even.appalaya.com');
    const sealedNatively = seal({ key, groupId, body: BODY });
    resetNativeAeadForTests();
    expect(open({ key, groupId, envelope: sealedNatively })).toEqual(BODY);
  });

  it('keeps @noble when the module is not in the build', () => {
    const lines: string[] = [];
    expect(installNativeAead(null, (line) => lines.push(line))).toEqual({
      kind: 'js',
      reason: 'unavailable',
    });
    expect(aead()).toBe(nobleAead);
    expect(lines).toEqual(['[even] crypto: @noble (no native module in this build)']);
  });

  it('decides once per process', () => {
    const lines: string[] = [];
    const first = installNativeAead(null, (line) => lines.push(line));
    expect(installNativeAead(goodNative(), (line) => lines.push(line))).toBe(first);
    expect(aeadStatus()).toBe(first);
    expect(lines).toHaveLength(1);
  });

  const broken: [string, Partial<NativeCrypto>, string][] = [
    [
      'a seal that changes a byte',
      {
        seal: (k, n, a, p, out) => {
          out.set(nobleAead.seal(k, n, a, p));
          out[0] = (out[0] ?? 0) ^ 1;
          return true;
        },
      },
      'vector-seal',
    ],
    [
      'an open that does not check the tag',
      {
        open: (k, n, a, s, out) => {
          out.set(nobleAead.open(k, n, a, s) ?? new Uint8Array(out.length));
          return true;
        },
      },
      'forgery-opened',
    ],
    [
      'a module that ignores byteOffset',
      {
        seal: (k, n, a, p, out) => {
          out.set(
            nobleAead.seal(
              fromBufferStart(k),
              fromBufferStart(n),
              fromBufferStart(a),
              fromBufferStart(p),
            ),
          );
          return true;
        },
      },
      'offsets',
    ],
    [
      'a module that throws',
      {
        open: () => {
          throw new Error('JSI went away');
        },
      },
      'threw',
    ],
    [
      'a batch that ignores the tag',
      {
        openMany: (k, input, lengths, out, opened) =>
          packedOpenMany(
            k,
            input,
            lengths,
            out,
            opened,
            (key, n, a, sealed) =>
              nobleAead.open(key, n, a, sealed) ?? new Uint8Array(sealed.length - 16),
          ),
      },
      'batch',
    ],
    ['a batch that refuses every layout', { openMany: () => -1 }, 'batch'],
    [
      'a module whose info throws',
      {
        info: () => {
          throw new Error('no info');
        },
      },
      'threw',
    ],
  ];
  for (const [what, overrides, code] of broken) {
    it(`keeps @noble for ${what}, and logs fixed words (${code})`, () => {
      const lines: string[] = [];
      const status = installNativeAead(goodNative(overrides), (line) => lines.push(line));
      expect(status).toEqual({ kind: 'js', reason: 'self-test', code });
      expect(aead()).toBe(nobleAead);
      expect(lines).toEqual([
        `[even] crypto: @noble, the native module failed its self-test (${code})`,
      ]);
    });
  }
});

describe('a native false negative after install', () => {
  const secret = Uint8Array.from({ length: 32 }, (_, i) => 3 * i);
  const { encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, 'https://sync.even.appalaya.com');
  const bodies = ['Banff', 'Jasper', 'Field'].map((name) => ({ ...BODY, name }));
  const envelopes = bodies.map((body) => seal({ key, groupId, body }));
  /** A module that passes the self-test but refuses envelopes[1] (its nonce), alone or in a batch. */
  const refusing = () => {
    const nonce = Uint8Array.from(Buffer.from(envelopes[1]!.n, 'base64url'));
    const isIt = (n: Uint8Array) => n.length === nonce.length && n.every((b, i) => b === nonce[i]);
    return goodNative({
      open: (k, n, a, s, out) => {
        if (isIt(n)) return false;
        const plain = nobleAead.open(k, n, a, s);
        if (plain === null) return false;
        out.set(plain);
        return true;
      },
      openMany: (k, input, lengths, out, opened) =>
        packedOpenMany(k, input, lengths, out, opened, (kk, n, a, s) =>
          isIt(n) ? null : nobleAead.open(kk, n, a, s),
        ),
    });
  };

  it('gives @noble’s answer, goes back to @noble for good, and logs one fixed line', () => {
    const lines: string[] = [];
    installNativeAead(refusing(), (line) => lines.push(line));
    expect(aeadStatus()).toMatchObject({ kind: 'native' });
    expect(open({ key, groupId, envelope: envelopes[0]! })).toEqual(bodies[0]);
    expect(open({ key, groupId, envelope: envelopes[1]! })).toEqual(bodies[1]);
    expect(aead()).toBe(nobleAead);
    expect(aeadStatus()).toEqual({ kind: 'js', reason: 'disagreed', name: 'stand-in 1.0' });
    expect(open({ key, groupId, envelope: envelopes[1]! })).toEqual(bodies[1]);
    expect(lines).toEqual([
      expect.stringMatching(/^\[even\] crypto: native stand-in 1\.0, self-test passed/),
      '[even] crypto: @noble from now on, the native module refused an envelope @noble opens',
    ]);
  });

  it('does the same from inside a batch, and answers every item as @noble does', () => {
    const lines: string[] = [];
    installNativeAead(refusing(), (line) => lines.push(line));
    const outcomes = openMany({ key, groupId, envelopes });
    expect(outcomes.map((o) => (o.ok ? o.body : o.error.code))).toEqual(bodies);
    expect(aead()).toBe(nobleAead);
    expect(lines).toHaveLength(2);
  });

  it('does not switch for a refusal @noble shares (a forgery)', () => {
    installNativeAead(refusing(), () => undefined);
    const forged = { ...envelopes[0]!, id: envelopes[2]!.id };
    expect(() => open({ key, groupId, envelope: forged })).toThrow();
    expect(aeadStatus()).toMatchObject({ kind: 'native' });
    expect(aead().name).toBe('stand-in 1.0');
  });
});

describe('selfTestAead', () => {
  it('passes @noble against itself and a correct module', () => {
    expect(selfTestAead(nobleAead)).toBeNull();
    expect(selfTestAead(nativeAeadFrom(goodNative()))).toBeNull();
  });

  /** A stand-in whose seal is @noble's except when `wrong(plaintext length, key)` says so, then one byte differs. */
  function sealsWrongFor(wrong: (length: number, key: Uint8Array) => boolean) {
    return nativeAeadFrom(
      goodNative({
        seal: (k, n, a, p, out) => {
          out.set(nobleAead.seal(k, n, a, p));
          if (wrong(p.length, k)) out[out.length - 20] = (out[out.length - 20] ?? 0) ^ 1;
          return true;
        },
      }),
    );
  }

  it('catches a seal that differs at only one of 63, 64, 65, 4095, 4096, 4097 bytes', () => {
    for (const size of [63, 64, 65, 4095, 4096, 4097]) {
      expect(selfTestAead(sealsWrongFor((length) => length === size))).toBe('sizes');
    }
  });

  it('catches a seal that differs only at the largest padded body (8,176 bytes)', () => {
    expect(selfTestAead(sealsWrongFor((length) => length === MAX_PADDED_BYTES))).toBe('max-size');
  });

  it('catches a seal that differs only for a size that only the batch has', () => {
    expect(selfTestAead(sealsWrongFor((length) => length === 1007))).toBe('large-batch');
  });

  it('catches a seal that differs only for the random 752-byte case', () => {
    const batchKey = selfTestCases().batch[0]!.key.join();
    expect(
      selfTestAead(sealsWrongFor((length, key) => length === 752 && key.join() !== batchKey)),
    ).toBe('cross-check');
  });

  it('catches a batch that accepts a forgery late in a large batch', () => {
    const late = nativeAeadFrom(
      goodNative({
        openMany: (k, input, lengths, out, opened) => {
          const count = packedOpenMany(k, input, lengths, out, opened);
          if (opened.length > 40 && count >= 0 && opened[42] === 0) {
            opened[42] = 1; // claims the forged item 42 opened
            return count + 1;
          }
          return count;
        },
      }),
    );
    expect(selfTestAead(late)).toBe('large-batch');
  });

  it('catches an open that a key with one byte changed still opens', () => {
    const lenient = nativeAeadFrom(
      goodNative({
        open: (k, n, a, s, out) => {
          const plain = nobleAead.open(k, n, a, s) ?? nobleAead.open(flip(k, 13), n, a, s);
          if (plain === null) return false;
          out.set(plain);
          return true;
        },
      }),
    );
    expect(selfTestAead(lenient)).toBe('wrong-key-opened');
  });

  it('fingerprints the same bytes the same at any offset, and differs for one changed byte', () => {
    const bytes = Uint8Array.from({ length: 4099 }, (_, i) => (i * 7) & 0xff);
    const big = new Uint8Array(4105);
    big.set(bytes, 3);
    expect(fingerprint(big.subarray(3, 3 + 4099))).toBe(fingerprint(bytes));
    expect(fingerprint(bytes)).toBe(fingerprintAgain(bytes));
    expect(fingerprint(flip(bytes, 4098))).not.toBe(fingerprint(bytes));
    expect(fingerprint(flip(bytes, 0))).not.toBe(fingerprint(bytes));
  });

  it('has @noble’s fingerprints of every deterministic case', () => {
    const { sizes, batch } = selfTestCases();
    const noble = (c: {
      key: Uint8Array;
      nonce: Uint8Array;
      aad: Uint8Array;
      plaintext: Uint8Array;
    }) => fingerprintAgain(nobleAead.seal(c.key, c.nonce, c.aad, c.plaintext));
    expect(sizes.map(noble)).toEqual(SELF_TEST_DIGESTS.sizes);
    expect(batch.map(noble)).toEqual(SELF_TEST_DIGESTS.batch);
    expect(batch).toHaveLength(64);
    expect(Math.max(...batch.map((c) => c.plaintext.length))).toBe(MAX_PADDED_BYTES);
    expect(new Set(batch.map((c) => c.key.join())).size).toBe(1);
    expect([...sizes, ...batch].every((c) => c.aad.length === 75)).toBe(true);
  });
});

/** The module's fingerprint written out again here (FNV-1a over little-endian words, then bytes), not trusted. */
function fingerprintAgain(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  const whole = bytes.length - (bytes.length % 4);
  for (let i = 0; i < whole; i += 4) {
    const word =
      (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
    h = Math.imul(h ^ word, 0x01000193);
  }
  for (let i = whole; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
}

function flip(bytes: Uint8Array, at: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 1;
  return copy;
}

describe('nativeAeadFrom', () => {
  it('opens a large batch in native calls of at most 200 items, in order', () => {
    const calls: number[] = [];
    const native = nativeAeadFrom(
      goodNative({
        openMany: (k, input, lengths, out, opened) => {
          calls.push(opened.length);
          return packedOpenMany(k, input, lengths, out, opened);
        },
      }),
    );
    const key = new Uint8Array(32).fill(9);
    const items = Array.from({ length: 450 }, (_, i) => {
      const nonce = new Uint8Array(24).fill(i % 251);
      const aad = Uint8Array.of(i & 0xff, i >> 8);
      const plain = new Uint8Array(i % 40).fill(i % 7);
      return { nonce, aad, sealed: nobleAead.seal(key, nonce, aad, plain), plain };
    });
    items[201]!.sealed[0] = (items[201]!.sealed[0] ?? 0) ^ 1;
    const answers = native.openMany(key, items);
    expect(NATIVE_BATCH_ITEMS).toBe(200);
    expect(calls).toEqual([200, 200, 50]);
    expect(answers).toHaveLength(450);
    answers.forEach((answer, i) => {
      if (i === 201) expect(answer).toBeNull();
      else expect(answer).toEqual(items[i]!.plain);
    });
  });

  it('answers null, not a throw, for wrong lengths on open, and refuses them on seal', () => {
    const native = nativeAeadFrom(goodNative());
    const key = new Uint8Array(32);
    const nonce = new Uint8Array(24);
    expect(native.open(key, nonce, new Uint8Array(0), new Uint8Array(15))).toBeNull();
    expect(
      native.open(new Uint8Array(31), nonce, new Uint8Array(0), new Uint8Array(16)),
    ).toBeNull();
    expect(() =>
      native.seal(key, new Uint8Array(12), new Uint8Array(0), new Uint8Array(0)),
    ).toThrow(RangeError);
  });

  it('throws when the module refuses a seal, so a broken module can never yield an unsealed envelope', () => {
    const native = nativeAeadFrom(goodNative({ seal: () => false }));
    expect(() =>
      native.seal(new Uint8Array(32), new Uint8Array(24), new Uint8Array(0), new Uint8Array(1)),
    ).toThrow();
  });
});
