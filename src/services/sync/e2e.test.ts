/**
 * End to end against a real Even server (skipped unless EVEN_E2E_SERVER_URL is set), e.g. the Python reference:
 *
 *   cd ../even-server/python && EVEN_DB_PATH=/tmp/even-e2e.db EVEN_MAX_BATCH=5 EVEN_MAX_PAGE=7 \
 *     EVEN_RATE_REQUESTS_PER_MINUTE=100000 EVEN_RATE_WRITES_PER_MINUTE=100000 \
 *     EVEN_RATE_GROUP_CREATES_PER_MINUTE=100000 .venv/bin/even-server
 *   EVEN_E2E_SERVER_URL=http://127.0.0.1:8787 npx vitest run src/services/sync
 *
 * Two "devices" (two fake stores, one secret) converge through the server; then the server copy is deleted and
 * both self-heal through the epoch rule. Keys are derived for the canonical https form of the URL; the server
 * only checks base64url(SHA-256(token)) == groupId, so the scheme it is reached over does not matter.
 */
import { describe, expect, it } from 'vitest';

import { createFakeStore, type FakeStore } from '../testing/fakeStore';
import { FakeSecrets } from '../testing/fakeSecrets';
import { Events, groupKeys, groupRow, writeLocal, type GroupKeys } from '../testing/fixtures';
import { createSyncEngine, type SyncEngineHandle } from './engine';
import { HttpTransport } from './httpTransport';
import { createInfoCache } from './info';
import type { SyncResult } from './types';
import { groupUsage } from './usage';

const SERVER = process.env.EVEN_E2E_SERVER_URL;

interface Device {
  name: string;
  store: FakeStore;
  engine: SyncEngineHandle;
}

function transport(url = SERVER ?? ''): HttpTransport {
  return new HttpTransport(url, { allowInsecureLocalhost: true, timeoutMs: 10_000 });
}

async function device(name: string, keys: GroupKeys): Promise<Device> {
  const store = createFakeStore();
  const secrets = new FakeSecrets();
  secrets.add(keys.secret);
  await store.upsertGroup(groupRow(keys, { createdAt: Date.now() }));
  const engine = createSyncEngine({
    store,
    secrets,
    transportFor: () => transport(),
    infoCache: createInfoCache(),
    log: () => undefined,
  });
  return { name, store, engine };
}

function synced(result: SyncResult): Extract<SyncResult, { outcome: 'synced' }> {
  if (result.outcome !== 'synced') throw new Error(`expected synced: ${JSON.stringify(result)}`);
  return result;
}

/** Every envelope id the server holds for the group, and its epoch. */
async function serverContents(keys: GroupKeys): Promise<{ ids: string[]; epoch: string | null }> {
  const t = transport();
  const ids: string[] = [];
  let since = 0;
  let epoch: string | null = null;
  for (;;) {
    const page = await t.pull(keys.groupId, keys.token, since, 1000);
    ids.push(...page.events.map((e) => e.id));
    epoch = page.epoch;
    since = page.next;
    if (!page.more) return { ids, epoch };
  }
}

function ids(d: Device, localId: string): string[] {
  return d.store
    .dump(localId)
    .map((r) => r.id)
    .sort();
}

describe.skipIf(SERVER === undefined)('end to end against a real server', () => {
  it(
    'two devices converge, then self-heal after the server copy is deleted',
    { timeout: 60_000 },
    async () => {
      const origin = transport().origin;
      const keys = groupKeys(origin);
      const info = await transport().info();
      const ev = new Events(Date.now());

      // Device A creates the group and writes more than one batch and one page.
      const a = await device('A', keys);
      await writeLocal(a.store, keys, ev.created('E2E trip', 'CAD'));
      await writeLocal(a.store, keys, ev.member('Maya'));
      for (let i = 0; i < 12; i++) await writeLocal(a.store, keys, ev.expense(`A${i}`, 100 + i));
      const first = synced(await a.engine.syncGroup(keys.localId, { trigger: 'foreground' }));
      expect(first).toMatchObject({ pushed: 14, pulled: 0, epochResets: 0 });

      // Device B joins with the same secret and pulls everything.
      const b = await device('B', keys);
      const joined = synced(await b.engine.syncGroup(keys.localId, { trigger: 'first_open' }));
      expect(joined.pulled).toBe(14);
      expect(joined.newOkIds).toHaveLength(14);
      expect(await b.store.getGroup(keys.localId)).toMatchObject({
        nameCache: 'E2E trip',
        currencyCache: 'CAD',
        cursor: 14,
      });

      // Both write while apart, then sync in turn.
      for (let i = 0; i < 3; i++) await writeLocal(b.store, keys, ev.expense(`B${i}`));
      for (let i = 0; i < 2; i++) await writeLocal(a.store, keys, ev.expense(`A+${i}`));
      synced(await a.engine.syncGroup(keys.localId, { trigger: 'local_write' }));
      synced(await b.engine.syncGroup(keys.localId, { trigger: 'local_write' }));
      synced(await a.engine.syncGroup(keys.localId, { trigger: 'pull_to_refresh' }));

      const server = await serverContents(keys);
      expect(server.ids).toHaveLength(19);
      for (const d of [a, b]) {
        expect(ids(d, keys.localId)).toEqual([...server.ids].sort());
        const counts = await d.store.countByStatus(keys.localId);
        expect(counts).toMatchObject({ outbox: 0, rejected: 0 });
        expect(counts.byStatus.ok).toBe(19);
        expect(await d.store.getGroup(keys.localId)).toMatchObject({
          epoch: server.epoch,
          cursor: 19,
        });
      }
      const usage = await groupUsage(a.store, keys.localId, info);
      expect(usage.events).toBe(19);

      // The server loses the group. A (with a new write) and B (with nothing to push) both heal.
      await transport().delete(keys.groupId, keys.token);
      expect((await serverContents(keys)).epoch).toBeNull();
      await writeLocal(a.store, keys, ev.expense('After delete'));
      const healedA = synced(
        await a.engine.syncGroup(keys.localId, { trigger: 'pull_to_refresh' }),
      );
      expect(healedA.epochResets).toBe(1);
      const healedB = synced(
        await b.engine.syncGroup(keys.localId, { trigger: 'pull_to_refresh' }),
      );
      expect(healedB).toMatchObject({ epochResets: 1, pulled: 1 });

      const after = await serverContents(keys);
      expect(after.epoch).not.toBeNull();
      expect(after.epoch).not.toBe(server.epoch);
      expect(after.ids).toHaveLength(20);
      for (const d of [a, b]) {
        expect(ids(d, keys.localId)).toEqual([...after.ids].sort());
        expect(await d.store.getGroup(keys.localId)).toMatchObject({
          epoch: after.epoch,
          cursor: 20,
          lastSyncError: null,
          epochResetsThisCycle: 0,
        });
        expect((await d.store.countByStatus(keys.localId)).outbox).toBe(0);
      }
      a.engine.dispose();
      b.engine.dispose();
    },
  );

  it('reports a URL that is not an Even server', async () => {
    await expect(transport(`${SERVER}/not-even`).info()).rejects.toMatchObject({
      code: 'not_an_even_server',
    });
  });
});
