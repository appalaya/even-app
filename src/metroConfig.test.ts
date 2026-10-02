/// <reference types="node" />
/**
 * metro.config.js under each NODE_ENV (pre-launch review L8): a production bundle (`expo export`, and
 * `expo export:embed --dev false`, which release builds run; both set NODE_ENV before loading the config) blocks
 * src/dev/ and src/app/dev/, and a development one keeps them. Each value loads the config in its own Node process,
 * since the config reads NODE_ENV once, when it is required.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The config's blockList as regex sources and flags, loaded with this NODE_ENV. */
function blockListUnder(nodeEnv: 'production' | 'development'): RegExp[] {
  const script = `
    const config = require(${JSON.stringify(join(ROOT, 'metro.config.js'))});
    const list = [].concat(config.resolver.blockList ?? []);
    process.stdout.write(JSON.stringify(list.map((r) => [r.source, r.flags])));
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (run.status !== 0) throw new Error(`metro.config.js failed to load: ${run.stderr}`);
  return (JSON.parse(run.stdout) as [string, string][]).map(
    ([source, flags]) => new RegExp(source, flags),
  );
}

const blocked = (list: readonly RegExp[], file: string) =>
  list.some((re) => re.test(join(ROOT, file)));

/** Every non-test source file under `dir`, relative to the project root. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name))
    .map((name) => join(dir, name));
}

const DEV_ONLY = [...sourcesUnder('src/dev'), ...sourcesUnder('src/app/dev')];
const SHIPPED = [
  'src/app/_layout.tsx',
  'src/app/index.tsx',
  'src/app/+native-intent.ts',
  'src/app/group/[id]/index.tsx',
  'src/state/groups.ts',
  'src/services/sync/engine.ts',
  'packages/core/src/index.ts',
  'src/devices.ts', // a name that only starts like the folder
  'src/app/devtools.tsx',
];

describe('metro.config.js blocks the dev seed and routes from production bundles only (review L8)', () => {
  const production = blockListUnder('production');
  const development = blockListUnder('development');

  it('production blocks every file under src/dev/ and src/app/dev/', () => {
    expect(DEV_ONLY).toContain('src/dev/seed.ts');
    expect(DEV_ONLY).toContain('src/app/dev/seed.tsx');
    expect(DEV_ONLY).toContain('src/app/dev/kit.tsx');
    for (const file of DEV_ONLY) expect(blocked(production, file), file).toBe(true);
  });

  it('development keeps them, and neither blocks anything that ships', () => {
    for (const file of DEV_ONLY) expect(blocked(development, file), file).toBe(false);
    for (const file of SHIPPED) {
      expect(blocked(production, file), file).toBe(false);
      expect(blocked(development, file), file).toBe(false);
    }
    // The dev server's data folder stays blocked in both.
    expect(blocked(production, '.dev/sync-server/db.sqlite')).toBe(true);
    expect(blocked(development, '.dev/sync-server/db.sqlite')).toBe(true);
  });

  it('nothing outside the two folders imports from them, so blocking them breaks no import', () => {
    const outside = readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name))
      .map((name) => join('src', name))
      .filter((file) => !DEV_ONLY.includes(file));
    for (const file of outside) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const [, spec] of text.matchAll(/(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g)) {
        if (spec === undefined) continue;
        const target = spec.startsWith('@/')
          ? join('src', spec.slice(2))
          : spec.startsWith('.')
            ? relative(ROOT, join(ROOT, dirname(file), spec))
            : spec;
        expect(
          target.startsWith('src/dev/') || target.startsWith('src/app/dev/'),
          `${file} imports ${spec}`,
        ).toBe(false);
      }
    }
  });
});
