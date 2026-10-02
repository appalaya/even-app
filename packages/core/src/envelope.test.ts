/**
 * The envelope tests (`testing/envelopeSuite.ts`), once per AEAD implementation available in Node: @noble (the
 * default and reference) and node:crypto's ChaCha20-Poly1305 under an HChaCha20 subkey (independent of @noble). The
 * development crypto harness runs the same suite on a phone with the native implementation installed.
 */
import * as fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nobleAead, setAead, type Aead } from './aead.js';
import { envelopeSuite } from './testing/envelopeSuite.js';
import { nodeAead } from './testing/nodeAead.js';

const IMPLEMENTATIONS: readonly Aead[] = [nobleAead, nodeAead];

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
