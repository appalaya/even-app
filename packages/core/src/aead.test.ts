import { xchacha20 } from '@noble/ciphers/chacha.js';
import { afterEach, describe, expect, it } from 'vitest';
import { aead, nobleAead, setAead, type Aead } from './aead.js';
import { EnvelopeError, open, openMany, resealEnvelope, seal } from './envelope.js';
import { deriveLocal, deriveServer } from './keys.js';
import { aeadCrossCheck, aeadVectorChecks, type CheckReport } from './testing/aeadConformance.js';
import { bytesToHex, hexToBytes } from './testing/bytes.js';
import { hchacha20, nodeAead } from './testing/nodeAead.js';
import { HCHACHA20, WYCHEPROOF } from './testing/xchachaVectors.js';
import type { Event } from './types.js';

afterEach(() => setAead(null));

function expectClean(reports: readonly CheckReport[]): void {
  for (const r of reports) {
    expect(r.failures, r.name).toEqual([]);
    expect(r.failed, r.name).toBe(0);
    expect(r.passed, r.name).toBeGreaterThan(0);
  }
}

describe('the vector set', () => {
  it('is all of Wycheproof: 315 tests, 246 valid', () => {
    expect(WYCHEPROOF).toHaveLength(315);
    expect(WYCHEPROOF.filter((row) => row[6] === 1)).toHaveLength(246);
    expect(new Set(WYCHEPROOF.map((row) => row[0])).size).toBe(315);
  });

  it('HChaCha20 matches draft-irtf-cfrg-xchacha-03 §2.2.1 (the node:crypto implementation’s subkey)', () => {
    expect(bytesToHex(hchacha20(hexToBytes(HCHACHA20.key), hexToBytes(HCHACHA20.nonce)))).toBe(HCHACHA20.subkey);
  });
});

describe.each([nobleAead, nodeAead])('$name', (impl) => {
  it('passes every known-answer vector, batched and through offset views', () => {
    expectClean(aeadVectorChecks(impl));
  });
});

describe('cross-checks', () => {
  it('node:crypto against @noble: 2,000 random cases, plaintexts 0..8192 bytes, both directions, forgeries refused', () => {
    expectClean([aeadCrossCheck(nodeAead, nobleAead, { cases: 2000, seed: 20261002 })]);
  });

  it('@noble against node:crypto, another seed', () => {
    expectClean([aeadCrossCheck(nobleAead, nodeAead, { cases: 500, seed: 7 })]);
  });

  // The checks must be able to fail, or a phone reporting "0 failed" proves nothing.
  const broken: Record<string, Aead> = {
    'seal changes a byte': {
      ...nobleAead,
      name: 'broken-seal',
      seal: (k, n, a, p) => {
        const out = nobleAead.seal(k, n, a, p);
        out[0] = (out[0] ?? 0) ^ 1;
        return out;
      },
    },
    'open ignores the tag': {
      ...nobleAead,
      name: 'broken-open',
      open: (k, n, a, s) => nobleAead.open(k, n, a, s) ?? xchacha20(k, n, s.slice(0, s.length - 16), undefined, 1),
    },
    'openMany drops an answer': {
      ...nobleAead,
      name: 'broken-batch',
      openMany: (k, items) => nobleAead.openMany(k, items).slice(1),
    },
    'aad ignored': {
      ...nobleAead,
      name: 'broken-aad',
      seal: (k, n, _a, p) => nobleAead.seal(k, n, new Uint8Array(0), p),
      open: (k, n, _a, s) => nobleAead.open(k, n, new Uint8Array(0), s),
    },
  };
  for (const [what, impl] of Object.entries(broken)) {
    it(`catches an implementation whose ${what}`, () => {
      const reports = [...aeadVectorChecks(impl), aeadCrossCheck(impl, nobleAead, { cases: 40, seed: 3 })];
      expect(reports.reduce((sum, r) => sum + r.failed, 0)).toBeGreaterThan(0);
    });
  }
});

describe('setAead', () => {
  const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
  const { encryptionKey: key } = deriveLocal(SECRET);
  const { groupId } = deriveServer(SECRET, 'https://sync.even.appalaya.com');
  const body: Event = { sv: 1, type: 'group.renamed', name: 'Banff', ts: 1_767_225_600_000, at: 1_767_225_600_000, by: 'AAAAAAAAAAAAAAAAAAAAAA', dev: 'BBBBBBBBBBBBBBBBBBBBBB' };

  function counting(): Aead & { seals: number; opens: number } {
    const impl = {
      ...nobleAead,
      name: 'counting',
      seals: 0,
      opens: 0,
      seal: (k: Uint8Array, n: Uint8Array, a: Uint8Array, p: Uint8Array) => {
        impl.seals += 1;
        return nobleAead.seal(k, n, a, p);
      },
      open: (k: Uint8Array, n: Uint8Array, a: Uint8Array, s: Uint8Array) => {
        impl.opens += 1;
        return nobleAead.open(k, n, a, s);
      },
    };
    return impl;
  }

  it('defaults to @noble and goes back to it on null', () => {
    expect(aead()).toBe(nobleAead);
    setAead(nodeAead);
    expect(aead()).toBe(nodeAead);
    setAead(null);
    expect(aead()).toBe(nobleAead);
  });

  it('is what seal, open and resealEnvelope use', () => {
    const impl = counting();
    setAead(impl);
    const env = seal({ key, groupId, body });
    expect(open({ key, groupId, envelope: env })).toEqual(body);
    resealEnvelope({ key, groupId, newKey: key, newGroupId: groupId, envelope: env });
    expect(impl.seals).toBe(2);
    expect(impl.opens).toBe(2);
  });

  it('envelopes sealed under one implementation open under the other, byte for byte', () => {
    setAead(nodeAead);
    const env = seal({ key, groupId, body });
    setAead(nobleAead);
    expect(open({ key, groupId, envelope: env })).toEqual(body);
    const back = seal({ key, groupId, body });
    setAead(nodeAead);
    expect(open({ key, groupId, envelope: back })).toEqual(body);
  });

  it('an implementation that throws on open is a failed open (undecryptable), never another error', () => {
    const env = seal({ key, groupId, body });
    setAead({
      ...nobleAead,
      name: 'throwing',
      open: () => {
        throw new Error('native module went away');
      },
    });
    let caught: unknown;
    try {
      open({ key, groupId, envelope: env });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as EnvelopeError).code).toBe('undecryptable');
  });

  it('openMany makes one batch call, and opens one by one if that call throws or miscounts', () => {
    const envelopes = [seal({ key, groupId, body }), seal({ key, groupId, body: { ...body, name: 'Jasper' } })];
    let batches = 0;
    let singles = 0;
    const base = {
      ...nobleAead,
      name: 'batch-counting',
      open: (k: Uint8Array, n: Uint8Array, a: Uint8Array, s: Uint8Array) => {
        singles += 1;
        return nobleAead.open(k, n, a, s);
      },
    };
    setAead({ ...base, openMany: (k, items) => ((batches += 1), nobleAead.openMany(k, items)) });
    expect(openMany({ key, groupId, envelopes }).map((o) => o.ok)).toEqual([true, true]);
    expect([batches, singles]).toEqual([1, 0]);

    for (const broken of [
      () => {
        throw new Error('JSI went away');
      },
      () => [null],
    ]) {
      batches = 0;
      singles = 0;
      setAead({ ...base, openMany: () => ((batches += 1), broken()) });
      const outcomes = openMany({ key, groupId, envelopes });
      expect(outcomes.map((o) => (o.ok ? (o.body as Event & { name: string }).name : o.error.code))).toEqual(['Banff', 'Jasper']);
      expect([batches, singles]).toEqual([1, 2]);
    }
  });

  it('nobleAead refuses a wrong-size key or nonce on seal, and answers null on open', () => {
    const k = new Uint8Array(32);
    const n = new Uint8Array(24);
    expect(() => nobleAead.seal(new Uint8Array(31), n, new Uint8Array(0), new Uint8Array(1))).toThrow(RangeError);
    expect(() => nobleAead.seal(k, new Uint8Array(12), new Uint8Array(0), new Uint8Array(1))).toThrow(RangeError);
    const sealed = nobleAead.seal(k, n, new Uint8Array(0), new Uint8Array(1));
    expect(nobleAead.open(k, new Uint8Array(12), new Uint8Array(0), sealed)).toBeNull();
    expect(nobleAead.open(k, n, new Uint8Array(0), sealed.subarray(0, 15))).toBeNull();
  });
});
