/**
 * The engine against the REAL store (sqliteStore.ts on node:sqlite), to prove the fake and the real store agree
 * on what the engine relies on: insert-or-ignore with ack/seq, the outbox, page + cursor atomicity, the epoch
 * reset, quarantine, and the row validation rules (readable rows are strict v1 envelopes, junk is bounded).
 */
import { newId } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { openNodeStore } from '../storage/nodeDriver';
import type { SqliteStore } from '../storage/sqliteStore';
import type { Store } from '../storage/types';
import { FakeClock } from '../testing/fakeClock';
import { FakeSecrets } from '../testing/fakeSecrets';
import { FakeServer } from '../testing/fakeTransport';
import {
  Events,
  groupKeys,
  groupRow,
  sealFor,
  writeLocal,
  type GroupKeys,
} from '../testing/fixtures';
import { createSyncEngine, type SyncEngineHandle } from './engine';
import type { ServerInfo, SyncResult } from './types';

const opened: SqliteStore[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
});

/** Wraps a store (and every `tx` it hands out) so a test can throw from any method. */
function withFault(store: Store, fault: (method: string) => void): Store {
  return new Proxy(store, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === 'transaction') {
        return <T>(fn: (tx: Store) => Promise<T>) =>
          target.transaction((tx) => fn(withFault(tx, fault)));
      }
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        fault(String(property));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

interface Device {
  store: SqliteStore;
  engine: SyncEngineHandle;
}

async function setup(limits: Partial<ServerInfo['limits']> = {}) {
  const clock = new FakeClock();
  const server = new FakeServer(limits);
  const keys = groupKeys();
  const ev = new Events(clock.now());
  let fault: (method: string) => void = () => undefined;

  async function device(): Promise<Device> {
    const store = await openNodeStore();
    opened.push(store);
    await store.upsertGroup(groupRow(keys, { createdAt: clock.now() }));
    const secrets = new FakeSecrets();
    secrets.add(keys.secret);
    const engine = createSyncEngine({
      store: withFault(store, (method) => fault(method)),
      secrets,
      transportFor: () => server.transport(),
      now: clock.now,
      sleep: clock.sleep,
      schedule: clock.schedule,
      log: () => undefined,
    });
    return { store, engine };
  }

  return {
    clock,
    server,
    keys,
    ev,
    device,
    setFault: (f: (method: string) => void) => {
      fault = f;
    },
  };
}

function synced(result: SyncResult): Extract<SyncResult, { outcome: 'synced' }> {
  if (result.outcome !== 'synced') throw new Error(`expected synced: ${JSON.stringify(result)}`);
  return result;
}

async function writeMany(store: Store, keys: GroupKeys, ev: Events, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await writeLocal(store, keys, ev.expense(`Item ${i}`)));
  return ids;
}

const foreground = { trigger: 'foreground' } as const;
const refresh = { trigger: 'pull_to_refresh' } as const;

describe('sync engine on the SQLite store', () => {
  it('two devices converge, with acks, seq, cursor, and the name cache', async () => {
    const h = await setup({ max_batch: 2, max_page: 3 });
    const a = await h.device();
    await writeLocal(a.store, h.keys, h.ev.created('Real store', 'EUR'));
    await writeMany(a.store, h.keys, h.ev, 4);
    expect(synced(await a.engine.syncGroup(h.keys.localId, foreground)).pushed).toBe(5);

    const b = await h.device();
    const joined = synced(await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }));
    expect(joined).toMatchObject({ pulled: 5, epochResets: 0 });
    expect(await b.store.getGroup(h.keys.localId)).toMatchObject({
      nameCache: 'Real store',
      currencyCache: 'EUR',
      cursor: 5,
    });

    await writeMany(b.store, h.keys, h.ev, 2);
    synced(await b.engine.syncGroup(h.keys.localId, foreground));
    synced(await a.engine.syncGroup(h.keys.localId, foreground));

    for (const d of [a, b]) {
      const counts = await d.store.countByStatus(h.keys.localId);
      expect(counts).toMatchObject({ outbox: 0, rejected: 0 });
      expect(counts.byStatus.ok).toBe(7);
      expect((await d.store.getGroup(h.keys.localId))?.cursor).toBe(7);
      expect((await d.store.listEnvelopes(h.keys.localId)).map((r) => r.id).sort()).toEqual(
        h.server
          .stored(h.keys.groupId)
          .map((e) => e.id)
          .sort(),
      );
    }
  });

  it('self-heals a deleted server copy through the epoch rule (changed and null epochs)', async () => {
    const h = await setup();
    const a = await h.device();
    const ids = await writeMany(a.store, h.keys, h.ev, 3);
    synced(await a.engine.syncGroup(h.keys.localId, foreground));

    h.server.wipe(h.keys.groupId);
    expect(synced(await a.engine.syncGroup(h.keys.localId, refresh)).epochResets).toBe(1); // null epoch
    h.server.wipe(h.keys.groupId);
    ids.push(...(await writeMany(a.store, h.keys, h.ev, 1)));
    expect(synced(await a.engine.syncGroup(h.keys.localId, refresh)).epochResets).toBe(1); // new epoch

    expect(
      h.server
        .stored(h.keys.groupId)
        .map((e) => e.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect(await a.store.getGroup(h.keys.localId)).toMatchObject({
      epoch: h.server.groups.get(h.keys.groupId)?.epoch,
      cursor: 4,
      epochResetsThisCycle: 0,
    });
  });

  it('keeps a quarantined row out of the outbox across an epoch reset', async () => {
    const h = await setup();
    const a = await h.device();
    const ids = await writeMany(a.store, h.keys, h.ev, 3);
    h.server.failNext('push', { code: 'invalid_envelope', index: 0 });
    synced(await a.engine.syncGroup(h.keys.localId, foreground));
    h.server.wipe(h.keys.groupId);
    synced(await a.engine.syncGroup(h.keys.localId, refresh));

    expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual(ids.slice(1));
    expect(await a.store.countByStatus(h.keys.localId)).toMatchObject({ outbox: 0, rejected: 1 });
  });

  it('commits each page with its cursor: a throw mid-page leaves both unchanged', async () => {
    const h = await setup({ max_page: 2 });
    const b = await h.device();
    await writeMany(b.store, h.keys, h.ev, 5);
    synced(await b.engine.syncGroup(h.keys.localId, foreground));

    const a = await h.device();
    let cursorWrites = 0;
    h.setFault((method) => {
      if (method === 'setCursor' && ++cursorWrites === 2) throw new Error('disk full');
    });
    expect(await a.engine.syncGroup(h.keys.localId, foreground)).toMatchObject({
      error: 'local_error',
    });
    expect((await a.store.listEnvelopes(h.keys.localId)).length).toBe(2);
    expect((await a.store.getGroup(h.keys.localId))?.cursor).toBe(2);

    h.setFault(() => undefined);
    expect(synced(await a.engine.syncGroup(h.keys.localId, refresh)).pulled).toBe(3);
    expect((await a.store.getGroup(h.keys.localId))?.cursor).toBe(5);
  });

  it('stores every pulled status the real store accepts, oversized junk included', async () => {
    const h = await setup();
    const g = h.keys.groupId;
    const bad = h.ev.expense('Bad split');
    if (bad.type === 'expense.added') bad.expense.split = { [h.ev.by]: 1 };
    h.server.injectRaw(g, sealFor(h.keys, h.ev.expense('Good')));
    h.server.injectRaw(g, sealFor(h.keys, bad));
    h.server.injectRaw(g, sealFor(h.keys, { ...h.ev.expense('Future'), sv: 2 }));
    h.server.injectRaw(g, sealFor(groupKeys(), h.ev.expense('Other group')));
    h.server.injectRaw(g, { ...sealFor(h.keys, h.ev.expense('v2')), v: 2 });
    h.server.injectRaw(g, { id: newId(), v: 1, n: 'x', c: 'A'.repeat(50_000) });
    h.server.injectRaw(g, { id: newId(), junk: true });

    const a = await h.device();
    const result = synced(await a.engine.syncGroup(h.keys.localId, foreground));

    expect(result.pulled).toBe(7);
    expect((await a.store.countByStatus(h.keys.localId)).byStatus).toEqual({
      ok: 1,
      invalid: 1,
      unsupported_body: 1,
      undecryptable: 3,
      unsupported_envelope: 1,
    });
  });
});
