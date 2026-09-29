/**
 * End to end against a real Even server (skipped unless EVEN_E2E_SERVER_URL is set), e.g. the Python reference:
 *
 *   cd ../even-server/python && EVEN_DB_PATH=/tmp/even-e2e.db EVEN_MAX_BATCH=5 EVEN_MAX_PAGE=7 \
 *     EVEN_RATE_REQUESTS_PER_MINUTE=100000 EVEN_RATE_WRITES_PER_MINUTE=100000 \
 *     EVEN_RATE_GROUP_CREATES_PER_MINUTE=100000 .venv/bin/even-server
 *   EVEN_E2E_SERVER_URL=http://127.0.0.1:8787 npx vitest run src/services/sync
 *
 * Two "devices" (two stores, one secret) converge through the server; then the server copy is deleted and both
 * self-heal through the epoch rule; then a pending delete is paid with its stored token after Leave. Runs on the
 * fake and on the real store. Keys are derived for the canonical https form of the URL; the server only checks
 * base64url(SHA-256(token)) == groupId, so the scheme it is reached over does not matter.
 */
import { b64urlEncode } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeSecrets } from '../testing/fakeSecrets';
import { Events, groupKeys, groupRow, writeLocal, type GroupKeys } from '../testing/fixtures';
import { openTestStore, STORE_KINDS, type StoreKind, type TestStore } from '../testing/testStore';
import { createSyncEngine, type SyncEngineHandle } from './engine';
import { HttpTransport } from './httpTransport';
import { createInfoCache } from './info';
import type { SyncResult } from './types';
import { groupUsage } from './usage';

const SERVER = process.env.EVEN_E2E_SERVER_URL;

interface Device {
  name: string;
  store: TestStore;
  secrets: FakeSecrets;
  engine: SyncEngineHandle;
}

const opened: TestStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
});

function transport(url = SERVER ?? ''): HttpTransport {
  return new HttpTransport(url, { allowInsecureLocal: true, timeoutMs: 10_000 });
}

/** The engine asks for a canonical https origin; reach the same loopback server over http. */
function transportForOrigin(origin: string): HttpTransport {
  return transport(origin.replace(/^https:/, 'http:'));
}

/**
 * The same server under a second canonical origin (127.0.0.1 ↔ localhost): a different origin derives a different
 * token and group id, which is all a move needs to exercise re-encryption against a real server.
 */
function otherOrigin(): string {
  const url = SERVER ?? '';
  const swapped = url.includes('127.0.0.1')
    ? url.replace('127.0.0.1', 'localhost')
    : url.replace('localhost', '127.0.0.1');
  return transport(swapped).origin;
}

async function device(kind: StoreKind, name: string, keys: GroupKeys): Promise<Device> {
  const store = await openTestStore(kind);
  opened.push(store);
  const secrets = new FakeSecrets();
  secrets.add(keys.secret);
  await store.upsertGroup(groupRow(keys, { createdAt: Date.now() }));
  const engine = createSyncEngine({
    store,
    secrets,
    transportFor: transportForOrigin,
    infoCache: createInfoCache(),
    log: () => undefined,
  });
  return { name, store, secrets, engine };
}

function synced(result: SyncResult): Extract<SyncResult, { outcome: 'synced' }> {
  if (result.outcome !== 'synced') throw new Error(`expected synced: ${JSON.stringify(result)}`);
  return result;
}

/** Every envelope id the server holds for the group, and its epoch. */
async function serverContents(keys: GroupKeys): Promise<{ ids: string[]; epoch: string | null }> {
  const t = transportForOrigin(keys.serverUrl);
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

async function ids(d: Device, localId: string): Promise<string[]> {
  return (await d.store.dump(localId)).map((r) => r.id).sort();
}

describe.skipIf(SERVER === undefined).each(STORE_KINDS)('end to end on the %s store', (kind) => {
  it(
    'two devices converge, then self-heal after the server copy is deleted',
    { timeout: 60_000 },
    async () => {
      const origin = transport().origin;
      const keys = groupKeys(origin);
      const info = await transport().info();
      const ev = new Events(Date.now());

      // Device A creates the group and writes more than one batch and one page.
      const a = await device(kind, 'A', keys);
      await writeLocal(a.store, keys, ev.created('E2E trip', 'CAD'));
      await writeLocal(a.store, keys, ev.member('Maya'));
      for (let i = 0; i < 12; i++) await writeLocal(a.store, keys, ev.expense(`A${i}`, 100 + i));
      const first = synced(await a.engine.syncGroup(keys.localId, { trigger: 'foreground' }));
      expect(first).toMatchObject({ pushed: 14, pulled: 0, epochResets: 0 });

      // Device B joins with the same secret and pulls everything.
      const b = await device(kind, 'B', keys);
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
        expect(await ids(d, keys.localId)).toEqual([...server.ids].sort());
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
        expect(await ids(d, keys.localId)).toEqual([...after.ids].sort());
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

  it(
    'moves both devices to another origin, re-encrypted, then deletes the old copy',
    { timeout: 30_000 },
    async () => {
      const from = groupKeys(transport().origin);
      const to = groupKeys(otherOrigin(), from.secret);
      expect(to.groupId).not.toBe(from.groupId);
      const ev = new Events(Date.now());
      const a = await device(kind, 'A', from);
      await writeLocal(a.store, from, ev.created('Moving', 'EUR'));
      for (let i = 0; i < 6; i++) await writeLocal(a.store, from, ev.expense(`M${i}`));
      synced(await a.engine.syncGroup(from.localId, { trigger: 'foreground' }));
      const b = await device(kind, 'B', from);
      synced(await b.engine.syncGroup(from.localId, { trigger: 'first_open' }));
      const before = (await serverContents(from)).ids.sort();
      expect(before).toHaveLength(7);

      const movedA = await a.engine.moveServer(from.localId, to.serverUrl);
      expect(movedA).toMatchObject({ outcome: 'moved', dropped: 0, sync: { outcome: 'synced' } });
      await writeLocal(b.store, from, ev.expense('B before following'));
      const movedB = await b.engine.moveServer(from.localId, to.serverUrl);
      expect(movedB).toMatchObject({ outcome: 'moved', sync: { outcome: 'synced', pulled: 0 } });
      synced(await a.engine.syncGroup(from.localId, { trigger: 'pull_to_refresh' }));

      const after = await serverContents(to);
      expect(after.ids).toHaveLength(8);
      for (const d of [a, b]) {
        expect(await ids(d, from.localId)).toEqual([...after.ids].sort());
        expect(await d.store.getGroup(from.localId)).toMatchObject({
          serverUrl: to.serverUrl,
          epoch: after.epoch,
          cursor: 8,
          lastSyncError: null,
        });
        expect((await d.store.countByStatus(from.localId)).byStatus.ok).toBe(8);
      }

      expect(await a.engine.deleteServerCopy(from.localId, from.serverUrl)).toEqual({
        outcome: 'deleted',
      });
      expect(await serverContents(from)).toEqual({ ids: [], epoch: null });
      expect((await serverContents(to)).ids).toHaveLength(8);
      a.engine.dispose();
      b.engine.dispose();
    },
  );

  it('pays a pending delete with its stored token after Leave', { timeout: 30_000 }, async () => {
    const origin = transport().origin;
    const keys = groupKeys(origin);
    const ev = new Events(Date.now());
    const a = await device(kind, 'A', keys);
    await writeLocal(a.store, keys, ev.created('Leaving', 'EUR'));
    synced(await a.engine.syncGroup(keys.localId, { trigger: 'foreground' }));
    expect((await serverContents(keys)).ids).toHaveLength(1);

    // The debt is recorded with the token, then the group and its secret go (Leave).
    await a.store.pendingDeletes.add({
      localId: keys.localId,
      serverUrl: origin,
      authToken: b64urlEncode(keys.token),
    });
    await a.store.deleteGroup(keys.localId);
    await a.secrets.deleteSecret(keys.localId);

    expect(await a.engine.syncAll({ trigger: 'foreground' })).toEqual([]);
    expect(await serverContents(keys)).toEqual({ ids: [], epoch: null });
    expect(await a.store.pendingDeletes.list()).toEqual([]);
    a.engine.dispose();
  });

  it('reports a URL that is not an Even server', async () => {
    await expect(transport(`${SERVER}/not-even`).info()).rejects.toMatchObject({
      code: 'not_an_even_server',
    });
  });
});
