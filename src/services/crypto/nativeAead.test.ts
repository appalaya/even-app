import { aead, deriveLocal, deriveServer, nobleAead, open, seal, type Event } from '@even/core';
import { STABLELIB } from '@even/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  aeadStatus,
  installNativeAead,
  nativeAeadFrom,
  resetNativeAeadForTests,
  SELF_TEST_VECTOR,
  selfTestAead,
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

describe('selfTestAead', () => {
  it('passes @noble against itself and a correct module', () => {
    expect(selfTestAead(nobleAead)).toBeNull();
    expect(selfTestAead(nativeAeadFrom(goodNative()))).toBeNull();
  });

  it('catches an implementation that only fails the random cross-check (a different construction past 512 bytes)', () => {
    const odd = nativeAeadFrom(
      goodNative({
        seal: (k, n, a, p, out) => {
          out.set(nobleAead.seal(k, n, a, p));
          if (p.length > 512) out[600] = (out[600] ?? 0) ^ 1;
          return true;
        },
      }),
    );
    expect(selfTestAead(odd)).toBe('cross-check');
  });
});

describe('nativeAeadFrom', () => {
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
