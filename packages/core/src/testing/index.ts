/**
 * `@even/core/testing`: what checks an AEAD implementation, for core's own tests and the app's development crypto
 * harness (src/dev/). Nothing the app ships imports it, so release bundles leave it out (metro.config.js drops
 * src/dev/ there). Node-only helpers (`nodeAead.ts`) are deliberately not exported here.
 */
export * from './aeadConformance.js';
export * from './bytes.js';
export * from './envelopeSuite.js';
export * from './miniRunner.js';
export * from './suiteApi.js';
export * from './xchachaVectors.js';
