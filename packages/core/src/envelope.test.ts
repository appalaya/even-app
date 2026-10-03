/**
 * The envelope tests (`testing/envelopeSuite.ts`), once per AEAD implementation available in Node: @noble (the
 * default and reference), node:crypto's ChaCha20-Poly1305 under an HChaCha20 subkey (independent of @noble), and a
 * stand-in that wrongly refuses some valid envelopes (the reference's second opinion must make every answer the
 * reference's). The development crypto harness runs the same suite on a phone with the native implementation
 * installed.
 */
import * as fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nobleAead, setAead, type Aead } from './aead.js';
import { envelopeSuite } from './testing/envelopeSuite.js';
import { nodeAead } from './testing/nodeAead.js';

/**
 * A stand-in for a native implementation with false negatives: it refuses every third envelope it is asked to open,
 * valid or not, alone or in a batch. Every envelope test must still pass on it, because envelope.ts opens what the
 * installed implementation refuses again with @noble, and only @noble's refusal counts.
 */
function refusingSometimes(): Aead {
  let calls = 0;
  const refuse = () => ++calls % 3 === 0;
  return {
    name: 'refuses every third (stand-in)',
    seal: nobleAead.seal,
    open: (k, n, a, s) => (refuse() ? null : nobleAead.open(k, n, a, s)),
    openMany: (k, items) => items.map((item) => (refuse() ? null : nobleAead.open(k, item.nonce, item.aad, item.sealed))),
  };
}

const IMPLEMENTATIONS: readonly Aead[] = [nobleAead, nodeAead, refusingSometimes()];

for (const impl of IMPLEMENTATIONS) {
  describe(`envelopes on ${impl.name}`, () => {
    // The suite seals some fixtures while it is collected and the rest while it runs: install the implementation for
    // both, and put @noble back after each.
    setAead(impl);
    beforeAll(() => setAead(impl));
    afterAll(() => setAead(null));
    envelopeSuite({ describe, it, expect }, fc);
    setAead(null);
  });
}
