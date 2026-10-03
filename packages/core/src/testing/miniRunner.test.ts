import { xchacha20 } from '@noble/ciphers/chacha.js';
import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { nobleAead, setAead } from '../aead.js';
import { envelopeSuite } from './envelopeSuite.js';
import { createMiniRunner } from './miniRunner.js';
import { nodeAead } from './nodeAead.js';

afterEach(() => setAead(null));

/** What the phone does: collect the suite with an implementation installed, then run it. */
function runSuite(impl: Parameters<typeof setAead>[0]) {
  setAead(impl);
  const runner = createMiniRunner();
  envelopeSuite(runner.api, fc);
  return runner.run();
}

describe('createMiniRunner', () => {
  it('runs the whole envelope suite green on @noble and on node:crypto', () => {
    for (const impl of [nobleAead, nodeAead]) {
      const result = runSuite(impl);
      expect(result.failures).toEqual([]);
      expect(result.passed).toBeGreaterThan(75);
    }
  });

  it('fails the envelope suite for an AEAD that accepts forgeries', () => {
    // Decrypts whatever it is given, tag or no tag: a forgery under the right key stream then reads as a body.
    const result = runSuite({
      ...nobleAead,
      name: 'forgeries',
      open: (k, n, a, s) => nobleAead.open(k, n, a, s) ?? xchacha20(k, n, s.slice(0, s.length - 16), undefined, 1),
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.failures.some((f) => f.includes('tampering'))).toBe(true);
  });

  // Its opens are masked by the reference's second opinion (envelope.ts asks @noble about every refusal), so it is
  // what it seals that gives it away; the startup self-test refuses such a module before it is ever installed.
  it('fails the envelope suite for an AEAD that is not the XChaCha construction', () => {
    const result = runSuite({
      ...nobleAead,
      name: 'other-nonce',
      seal: (k, n, a, p) => nobleAead.seal(k, n.slice().reverse(), a, p),
      open: (k, n, a, s) => nobleAead.open(k, n.slice().reverse(), a, s),
    });
    expect(result.failures.some((f) => f.includes('serialises the body with JSON.stringify'))).toBe(true);
  });

  it('implements its matchers like Vitest’s, both ways', () => {
    const runner = createMiniRunner();
    const { it: t, expect: e } = runner.api;
    t('pass', () => {
      e(Uint8Array.of(1, 2)).toEqual(Uint8Array.of(1, 2));
      e({ a: 1, b: [1, { c: 2 }] }).toEqual({ a: 1, b: [1, { c: 2 }] });
      e({ a: 1, b: 2 }).toMatchObject({ a: 1 });
      e(() => {
        throw new RangeError('x');
      }).toThrow(RangeError);
      e(() => 1).not.toThrow();
      e('abc').toMatch(/b/);
      e([1, 2]).toHaveLength(2);
      e(2).toBeGreaterThan(1);
      e(1).toBeLessThan(2);
      e(2).toBeLessThanOrEqual(2);
      e(new RangeError('x')).toBeInstanceOf(Error);
      e(1).not.toBe(2);
    });
    t('fail toEqual', () => e(Uint8Array.of(1)).toEqual(Uint8Array.of(2)));
    t('fail toThrow kind', () =>
      e(() => {
        throw new TypeError('x');
      }).toThrow(RangeError),
    );
    t('fail not.toThrow', () =>
      e(() => {
        throw new Error('x');
      }).not.toThrow(),
    );
    t('fail toMatchObject', () => e({ a: 1 }).toMatchObject({ a: 2 }));
    const result = runner.run();
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(4);
  });
});
