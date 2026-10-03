#!/usr/bin/env node
// Release bundles leave out the development crypto harness and its test vectors (pre-launch review, crypto track
// should-fix (d)). Exports the iOS and Android production bundles exactly as `expo export` makes them (NODE_ENV
// production, so metro.config.js blocks src/dev/ and src/app/dev/; release builds embed the same with
// `expo export:embed --dev false`), then reads every bundle as bytes (Hermes bytecode keeps its strings readable)
// and fails if any holds one of the markers below. A marker every app bundle must hold guards against checking an
// empty or unreadable file. Run from the repository root: node scripts/check-release-bundle.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Names and strings only the harness, @even/core/testing or the vectors contain. Minified bundles drop most
 *  identifiers, so the strings are what catches them there; the names catch an unminified bundle. */
const FORBIDDEN = [
  'cryptoHarness',
  'xchachaVectors',
  '[crypto-harness]',
  'even-crypto-harness.db',
  'Wycheproof',
  'envelope tests (envelopeSuite)',
  'aeadCrossCheck',
];
/** The native AEAD's startup line (src/services/crypto/nativeAead.ts), in every app bundle. */
const REQUIRED = 'self-test passed in';

const out = mkdtempSync(join(tmpdir(), 'even-release-bundle-'));
try {
  const run = spawnSync(
    'npx',
    ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--output-dir', out],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    },
  );
  if (run.status !== 0) {
    console.error(`::error::expo export failed (exit ${run.status})`);
    process.exit(1);
  }
  const bundles = readdirSync(join(out, '_expo', 'static', 'js'), {
    recursive: true,
    encoding: 'utf8',
  })
    .filter((name) => /\.(hbc|js)$/.test(name))
    .map((name) => join(out, '_expo', 'static', 'js', name));
  if (bundles.length < 2) {
    console.error(`::error::expected an iOS and an Android bundle, found ${bundles.length}`);
    process.exit(1);
  }
  let failed = false;
  for (const file of bundles) {
    const bytes = readFileSync(file).toString('latin1');
    const found = FORBIDDEN.filter((marker) => bytes.includes(marker));
    const name = file.slice(out.length + 1);
    if (found.length > 0) {
      console.error(`::error::${name} holds development-only code: ${found.join(', ')}`);
      failed = true;
    } else if (!bytes.includes(REQUIRED)) {
      console.error(`::error::${name} does not hold "${REQUIRED}"; is it an app bundle?`);
      failed = true;
    } else {
      console.log(`${name}: none of ${FORBIDDEN.length} development-only markers`);
    }
  }
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(out, { recursive: true, force: true });
}
