// App tests (src/**): storage, secrets, sync. Node environment; SQLite through node:sqlite (nodeDriver.ts).
// Also the landing site's Worker script (web/worker/**): its handler with stubbed bindings, and the contact page's
// browser-side derivation (web/*.test.ts) checked against @even/core, in the same Node run.
// packages/core keeps its own config; `npm test` runs both. `.mts` because the root package is CommonJS
// (no "type": "module") and Vite warns that it will stop loading ESM config from a CommonJS `.ts`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite's TypeScript transform (oxc) cannot resolve the root tsconfig's `extends: "expo/tsconfig.base"`
  // (expo's package exports map it to a path without `.json`; tsc retries with the extension, oxc does not).
  // Point it at the file itself: the same compiler options the app builds with, minus type-only strictness.
  tsconfig: './node_modules/expo/tsconfig.base.json',
  resolve: {
    // Mirrors tsconfig "paths". @even/core resolves through the npm workspace link.
    alias: { '@/': fileURLToPath(new URL('./src/', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'web/worker/**/*.test.ts', 'web/*.test.ts'],
    environment: 'node',
  },
});
