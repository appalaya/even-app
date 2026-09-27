// The contact page's module (contact-lib.js) against @even/core and the Worker's request rules, in Node. Its own
// config because the root one's `include` covers src/** and web/worker/** only; from the repository root:
//
//   npx vitest run --config web/vitest.config.mts
//
// scripts/check.mjs runs the known-answer part as well, so CI covers the derivation either way.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  // As in the root vitest.config.mts: Vite's TypeScript transform cannot follow the root tsconfig's `extends`.
  tsconfig: './node_modules/expo/tsconfig.base.json',
  test: {
    include: ['web/*.test.ts'],
    environment: 'node',
  },
});
