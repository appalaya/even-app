/**
 * Once per phone: deletes the production copies of the groups that seeds made before they moved to the dev server,
 * through the app's own "Also delete this group's copy" path (the sync engine records the debt with its token, then
 * sends the DELETE, and retries it later if the server does not answer). `even://dev/cleanup` runs it
 * (src/app/dev/cleanup.tsx); the seed refuses to run while this phone holds a group on production.
 *
 * What it reaches:
 * - the groups this phone holds on production (`productionHoldings`): each row is left with its copy there deleted;
 *   a keychain entry without a row has its copy deleted and is removed;
 * - every fixed seed key, past and present: a fixed key is the same production group on every phone, so its copy is
 *   deleted whether or not this phone ever seeded it.
 * A group made with a random secret that an earlier seed has since removed cannot be reached by anyone; the server
 * deletes it after its retention period.
 *
 * Production is sent nothing but these DELETEs. The protocol answers 204 whether or not a copy was there
 * (PROTOCOL.md §6.4), so "deleted" means the copy is gone now, not that one existed.
 */
import { deriveLocal, deriveServer, PROTOCOL, utf8Encode } from '@even/core';

import type { DeleteServerCopyResult } from '../services/sync/types';
import type { AppServices } from '../state';
import { productionHoldings } from './devServer';

/** The unified seed's group keys (src/dev/seed.ts `buildScenario`, `buildCopyScenario`). */
const SCENARIO_KEYS = [
  'banff',
  'banff-unreadable',
  'banff-syncing',
  'banff-stale',
  'banff-update',
  'banff-closed',
  'banff-moved',
  'banff-alldone',
  'banff-even',
  'banff-archived',
  'whistler',
  'banff-invite',
  'banff-new',
  'banff-new-expenses',
  'banff-unclaimed',
  'banff-unclaimed-own',
  'banff-unclaimed-two',
  'banff-detail',
  'banff-owed',
  'banff-settled',
  'banff-collision',
  'banff-currency',
] as const;

/** The keys of src/dev/seedB.ts, the Group seed before the unified one. */
const SEED_B_KEYS = [
  'banff',
  'banff-unreadable',
  'banff-syncing',
  'banff-stale',
  'banff-update',
  'banff-closed',
  'banff-moved',
  'banff-alldone',
  'banff-even',
  'banff-archived',
  'whistler',
  'banff-invite',
  'banff-new',
  'banff-detail',
] as const;

/**
 * The text of every fixed seed secret there has been: the current seed's, and those of seedB/seedC/seedD before
 * it (git history). Each secret is the text padded with '.' and cut at 32 bytes.
 */
export const SEED_SECRET_TEXTS: readonly string[] = [
  ...SCENARIO_KEYS.map((key) => `even-dev-seed/${key}`),
  'even-dev-seed/sheets-banff',
  'even-dev-seed/settings-banff-2026',
  ...SEED_B_KEYS.map((key) => `even-dev-seed-b/${key}`),
  'even-dev-seed-c/banff',
  'even-dev-seed-d/banff-2026',
];

export function fixedSecret(text: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode(text.padEnd(32, '.').slice(0, 32)));
  return bytes;
}

export interface CleanupLine {
  /** What the group is: its seed key, or "this phone's group" with its name. */
  label: string;
  /** The group's id on the production server (PROTOCOL.md §2), which is what the DELETE named. */
  groupId: string;
  outcome: DeleteServerCopyResult['outcome'];
  /** The engine's code for a failure. */
  error?: string;
}

/** Runs the cleanup (see the file comment). Returns one line per production group id it asked to delete. */
export async function cleanupProduction(s: AppServices): Promise<CleanupLine[]> {
  const production = PROTOCOL.defaultServer;
  const lines: CleanupLine[] = [];
  const done = new Set<string>();
  const record = (label: string, secret: Uint8Array, result: DeleteServerCopyResult) => {
    lines.push({
      label,
      groupId: deriveServer(secret, production).groupId,
      outcome: result.outcome,
      ...(result.outcome === 'failed' ? { error: result.error } : {}),
    });
  };

  // The groups this phone holds on production: rows through Leave, keychain entries by their own delete.
  for (const held of await productionHoldings(s)) {
    const secret = await s.secrets.getSecret(held.localId);
    if (secret === null) continue;
    done.add(held.localId);
    if (held.hasRow) {
      const row = await s.store.getGroup(held.localId);
      const label = `this phone's group ${row?.nameCache ?? '(no name)'}`;
      const left = await s.groups.leaveGroup(held.localId, { deleteServerCopy: true });
      record(label, secret, left.serverCopy ?? { outcome: 'failed', error: 'local_error' });
    } else {
      record(
        "this phone's keychain entry",
        secret,
        await s.groups.deleteServerCopy(held.localId, production),
      );
      await s.secrets.deleteSecret(held.localId);
    }
  }

  // Every fixed seed key. A key this phone still holds on another server keeps its secret; one it does not hold
  // gets its secret only for as long as the delete takes, as the engine derives the token from it.
  for (const text of SEED_SECRET_TEXTS) {
    const secret = fixedSecret(text);
    const { localId } = deriveLocal(secret);
    if (done.has(localId)) continue;
    done.add(localId);
    const held = (await s.secrets.getSecret(localId)) !== null;
    if (!held) await s.secrets.setSecret(localId, secret, production);
    try {
      record(text, secret, await s.groups.deleteServerCopy(localId, production));
    } finally {
      if (!held) await s.secrets.deleteSecret(localId);
    }
  }
  return lines;
}
