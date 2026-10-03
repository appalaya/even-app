import { xchacha20 } from '@noble/ciphers/chacha.js';
import { afterEach, describe, expect, it } from 'vitest';
import { aead, nobleAead, onAeadDisagreement, setAead, type Aead } from './aead.js';
import { EnvelopeError, open, openMany, resealEnvelope, seal } from './envelope.js';
import { deriveLocal, deriveServer } from './keys.js';
import { aeadCrossCheck, aeadVectorChecks, type CheckReport } from './testing/aeadConformance.js';
import { bytesToHex, hexToBytes } from './testing/bytes.js';
import { hchacha20, nodeAead } from './testing/nodeAead.js';
import { HCHACHA20, WYCHEPROOF } from './testing/xchachaVectors.js';
import type { Event } from './types.js';

afterEach(() => {
  setAead(null);
  onAeadDisagreement(null);
});

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

  it('an implementation that throws on open gets @noble’s answer: the body, or undecryptable, never another error', () => {
    const env = seal({ key, groupId, body });
    setAead({
      ...nobleAead,
      name: 'throwing',
      open: () => {
        throw new Error('native module went away');
      },
    });
    expect(open({ key, groupId, envelope: env })).toEqual(body);
    let caught: unknown;
    try {
      open({ key, groupId, envelope: { ...env, id: 'AAAAAAAAAAAAAAAAAAAAAA' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as EnvelopeError).code).toBe('undecryptable');
  });

  describe('a refusal from a non-reference implementation is checked with @noble', () => {
    const bodies = ['Banff', 'Jasper', 'Canmore', 'Field'].map((name) => ({ ...body, name }));
    const envelopes = bodies.map((b) => seal({ key, groupId, body: b }));
    /** Nonce of the one valid envelope the stand-in wrongly refuses. */
    const refused = envelopes[1]!.n;
    const nonceOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
    /** @noble's own open, taken before any test counts calls to it. */
    const referenceOpen = nobleAead.open;
    let nobleOpens = 0;

    /** A stand-in native AEAD with one false negative: it refuses envelopes[1], alone or in a batch. */
    function wronglyRefusing(): Aead {
      return {
        name: 'false-negative',
        seal: nobleAead.seal,
        open: (k, n, a, s) => (nonceOf(n) === refused ? null : referenceOpen(k, n, a, s)),
        openMany: (k, items) =>
          items.map((item) => (nonceOf(item.nonce) === refused ? null : referenceOpen(k, item.nonce, item.aad, item.sealed))),
      };
    }

    function countingNoble(): void {
      nobleOpens = 0;
      const original = nobleAead.open;
      (nobleAead as { open: Aead['open'] }).open = (k, n, a, s) => {
        nobleOpens += 1;
        return original(k, n, a, s);
      };
      afterRestore.push(() => {
        (nobleAead as { open: Aead['open'] }).open = original;
      });
    }
    const afterRestore: (() => void)[] = [];
    afterEach(() => {
      for (const restore of afterRestore.splice(0)) restore();
    });

    it('open gives the reference answer, asking @noble only about the refusal', () => {
      setAead(wronglyRefusing());
      countingNoble();
      expect(envelopes.map((envelope) => open({ key, groupId, envelope }))).toEqual(bodies);
      expect(nobleOpens).toBe(1);
    });

    it('openMany gives the reference answer for every envelope, asking @noble only about the refusal', () => {
      setAead(wronglyRefusing());
      countingNoble();
      const outcomes = openMany({ key, groupId, envelopes });
      expect(outcomes.map((o) => (o.ok ? o.body : o.error.code))).toEqual(bodies);
      expect(nobleOpens).toBe(1);
      setAead(null);
      expect(openMany({ key, groupId, envelopes })).toEqual(outcomes);
    });

    it('resealEnvelope carries the refused envelope over too', () => {
      setAead(wronglyRefusing());
      const resealed = resealEnvelope({ key, groupId, newKey: key, newGroupId: groupId, envelope: envelopes[1]! });
      setAead(null);
      expect(open({ key, groupId, envelope: resealed })).toEqual(bodies[1]);
    });

    it('never accepts what @noble refuses: a forgery stays undecryptable, alone and in a batch', () => {
      setAead({ ...wronglyRefusing(), open: () => null, openMany: (_k, items) => items.map(() => null) });
      const forged = { ...envelopes[0]!, id: envelopes[2]!.id };
      const outcomes = openMany({ key, groupId, envelopes: [forged, envelopes[0]!] });
      expect(outcomes.map((o) => (o.ok ? 'ok' : o.error.code))).toEqual(['undecryptable', 'ok']);
      expect(() => open({ key, groupId, envelope: forged })).toThrow(EnvelopeError);
    });

    it('reports each disagreement (once per open, once per batch), and never a refusal both share', () => {
      const reports: string[] = [];
      onAeadDisagreement((name) => reports.push(name));
      setAead(wronglyRefusing());
      envelopes.forEach((envelope) => open({ key, groupId, envelope }));
      expect(reports).toEqual(['false-negative']);
      openMany({ key, groupId, envelopes: [...envelopes, envelopes[1]!] });
      expect(reports).toEqual(['false-negative', 'false-negative']);
      const forged = { ...envelopes[0]!, id: envelopes[2]!.id };
      expect(() => open({ key, groupId, envelope: forged })).toThrow(EnvelopeError);
      openMany({ key, groupId, envelopes: [forged] });
      expect(reports).toHaveLength(2);
      onAeadDisagreement(() => {
        throw new Error('a listener that throws');
      });
      expect(open({ key, groupId, envelope: envelopes[1]! })).toEqual(bodies[1]);
    });

    it('with @noble installed, a refusal is not asked twice', () => {
      countingNoble();
      expect(() => open({ key, groupId, envelope: { ...envelopes[0]!, id: envelopes[2]!.id } })).toThrow(EnvelopeError);
      expect(nobleOpens).toBe(1);
    });
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

  it('seal and resealEnvelope refuse an implementation whose output is not the padded plaintext plus a 16-byte tag', () => {
    const sealed = seal({ key, groupId, body });
    const changes = [
      (s: Uint8Array) => s.subarray(0, s.length - 1),
      (s: Uint8Array) => Uint8Array.of(...s, 0),
      () => new Uint8Array(0),
    ];
    for (const change of changes) {
      setAead({ ...nobleAead, name: 'odd-length', seal: (k, n, a, p) => change(nobleAead.seal(k, n, a, p)) });
      const message = 'aead: the sealed length is not the padded length plus the tag';
      expect(() => seal({ key, groupId, body })).toThrow(message);
      expect(() => resealEnvelope({ key, groupId, newKey: key, newGroupId: groupId, envelope: sealed })).toThrow(message);
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
