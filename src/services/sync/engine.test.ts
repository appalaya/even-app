import { newId } from '@even/core';
import { describe, expect, it } from 'vitest';

import type { GroupLifecycle } from '../storage/types';
import { FakeClock, settle } from '../testing/fakeClock';
import { FakeSecrets } from '../testing/fakeSecrets';
import { createFakeStore, type FakeStore } from '../testing/fakeStore';
import { FakeServer } from '../testing/fakeTransport';
import {
  Events,
  groupKeys,
  groupRow,
  sealFor,
  writeLocal,
  type GroupKeys,
} from '../testing/fixtures';
import {
  createSyncEngine,
  decideEpoch,
  isUnsupportedBody,
  MAX_JUNK_TEXT_LENGTH,
  UNKNOWN_EPOCH,
  type SyncEngineHandle,
  type SyncTuning,
} from './engine';
import type { ServerInfo, SyncEvent, SyncResult } from './types';

interface Device {
  store: FakeStore;
  secrets: FakeSecrets;
  engine: SyncEngineHandle;
  events: SyncEvent[];
  logs: string[];
}

interface Harness extends Device {
  clock: FakeClock;
  server: FakeServer;
  keys: GroupKeys;
  ev: Events;
  device(): Promise<Device>;
}

async function setup(
  options: { limits?: Partial<ServerInfo['limits']>; tuning?: Partial<SyncTuning> } = {},
): Promise<Harness> {
  const clock = new FakeClock();
  const server = new FakeServer(options.limits);
  const keys = groupKeys();
  const ev = new Events(clock.now());

  async function device(): Promise<Device> {
    const store = createFakeStore();
    const secrets = new FakeSecrets();
    secrets.add(keys.secret);
    await store.upsertGroup(groupRow(keys, { createdAt: clock.now() }));
    const events: SyncEvent[] = [];
    const logs: string[] = [];
    const engine = createSyncEngine({
      store,
      secrets,
      transportFor: () => server.transport(),
      now: clock.now,
      sleep: clock.sleep,
      schedule: clock.schedule,
      log: (message) => logs.push(message),
      ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    });
    engine.subscribe((event) => events.push(event));
    return { store, secrets, engine, events, logs };
  }

  return { ...(await device()), clock, server, keys, ev, device };
}

async function writeMany(h: Harness, count: number, store = h.store): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++)
    ids.push(await writeLocal(store, h.keys, h.ev.expense(`Item ${i}`)));
  return ids;
}

function expectSynced(result: SyncResult): Extract<SyncResult, { outcome: 'synced' }> {
  if (result.outcome !== 'synced')
    throw new Error(`expected synced, got ${JSON.stringify(result)}`);
  return result;
}

function expectFailed(result: SyncResult): Extract<SyncResult, { outcome: 'failed' }> {
  if (result.outcome !== 'failed')
    throw new Error(`expected failed, got ${JSON.stringify(result)}`);
  return result;
}

const manual = { trigger: 'manual' } as const;
const foreground = { trigger: 'foreground' } as const;

describe('decideEpoch', () => {
  it('adopts the first epoch, and after an unknown-epoch reset, without resetting', () => {
    expect(decideEpoch(null, 'e1', 0)).toEqual({ kind: 'adopt', epoch: 'e1' });
    expect(decideEpoch(UNKNOWN_EPOCH, 'e2', 1)).toEqual({ kind: 'adopt', epoch: 'e2' });
    expect(decideEpoch(null, null, 0)).toEqual({ kind: 'same' });
    expect(decideEpoch(UNKNOWN_EPOCH, null, 1)).toEqual({ kind: 'same' });
  });

  it('resets once per cycle on a change or a null, then is unstable', () => {
    expect(decideEpoch('e1', 'e1', 0)).toEqual({ kind: 'same' });
    expect(decideEpoch('e1', 'e2', 0)).toEqual({ kind: 'reset', epoch: 'e2' });
    expect(decideEpoch('e1', null, 0)).toEqual({ kind: 'reset', epoch: UNKNOWN_EPOCH });
    expect(decideEpoch('e1', 'e2', 1)).toEqual({ kind: 'unstable' });
    expect(decideEpoch('e1', null, 1)).toEqual({ kind: 'unstable' });
  });
});

describe('isUnsupportedBody', () => {
  it('is a later sv, or sv 1 with an unknown type', () => {
    expect(isUnsupportedBody({ sv: 2, type: 'expense.added' })).toBe(true);
    expect(isUnsupportedBody({ sv: 1, type: 'poll.added' })).toBe(true);
    expect(isUnsupportedBody({ sv: 1, type: 'expense.added' })).toBe(false);
    expect(isUnsupportedBody({ sv: 0, type: 'poll.added' })).toBe(false);
    expect(isUnsupportedBody({ sv: '2' })).toBe(false);
    expect(isUnsupportedBody('text')).toBe(false);
  });
});

describe('happy path', () => {
  it('pushes the outbox, pulls its own events back acked with seq, and records success', async () => {
    const h = await setup();
    const ids = await writeMany(h, 3);

    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result).toMatchObject({ pushed: 3, pulled: 0, epochResets: 0, newOkIds: [] });
    expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual(ids);
    const rows = h.store.dump(h.keys.localId);
    expect(rows.every((r) => r.acked && r.origin === 'local' && r.status === 'ok')).toBe(true);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const group = await h.store.getGroup(h.keys.localId);
    expect(group).toMatchObject({
      epoch: h.server.groups.get(h.keys.groupId)?.epoch,
      cursor: 3,
      lastSyncedAt: result.at,
      lastSyncError: null,
      epochResetsThisCycle: 0,
    });
    // Push before pull (PROTOCOL.md §10).
    expect(h.server.requests.map((r) => r.op)).toEqual(['info', 'push', 'pull']);
  });

  it('delivers one device’s events to another, as remote ok rows with ts, and caches the name', async () => {
    const h = await setup();
    await writeLocal(h.store, h.keys, h.ev.created('Banff 2026', 'CAD'));
    await writeMany(h, 2);
    await h.engine.syncGroup(h.keys.localId, foreground);

    const b = await h.device();
    const result = expectSynced(
      await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }),
    );

    expect(result.pulled).toBe(3);
    expect(result.newOkIds).toHaveLength(3);
    const rows = b.store.dump(h.keys.localId);
    expect(rows.every((r) => r.origin === 'remote' && r.acked && r.status === 'ok')).toBe(true);
    expect(rows.every((r) => typeof r.ts === 'number')).toBe(true);
    expect(await b.store.getGroup(h.keys.localId)).toMatchObject({
      nameCache: 'Banff 2026',
      currencyCache: 'CAD',
      cursor: 3,
    });

    // B renames; A picks the new name up.
    await writeLocal(b.store, h.keys, h.ev.renamed('Banff 2027'));
    await b.engine.syncGroup(h.keys.localId, foreground);
    await h.engine.syncGroup(h.keys.localId, foreground);
    expect((await h.store.getGroup(h.keys.localId))?.nameCache).toBe('Banff 2027');
  });

  it('acks duplicates: a 200 acknowledges every envelope in the batch', async () => {
    const h = await setup();
    const shared = sealFor(h.keys, h.ev.expense('Shared'));
    // The server already holds `shared` (another device pushed the same envelope, e.g. from a group file).
    await h.server.transport().push(h.keys.groupId, h.keys.token, [shared]);
    await h.store.insertEvents(h.keys.localId, [
      {
        id: shared.id,
        origin: 'remote',
        acked: false,
        seq: null,
        ts: 1,
        envelope: JSON.stringify(shared),
        status: 'ok',
      },
    ]);
    await writeMany(h, 1);

    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result.pushed).toBe(2);
    expect(h.server.stored(h.keys.groupId)).toHaveLength(2);
    expect((await h.store.countByStatus(h.keys.localId)).outbox).toBe(0);
  });
});

describe('epoch rule', () => {
  it('adopts the epoch on the first sync without a reset', async () => {
    const h = await setup();
    await writeMany(h, 2);
    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result.epochResets).toBe(0);
    expect(h.store.calls).not.toContain('resetAcked');
    expect((await h.store.getGroup(h.keys.localId))?.epoch).toBe(
      h.server.groups.get(h.keys.groupId)?.epoch,
    );
  });

  it('on a changed epoch resets once, re-pushes the whole log, and succeeds', async () => {
    const h = await setup();
    const before = await writeMany(h, 3);
    await h.engine.syncGroup(h.keys.localId, foreground);
    const oldEpoch = (await h.store.getGroup(h.keys.localId))?.epoch;

    h.server.wipe(h.keys.groupId); // expiry or an accidental delete
    const later = await writeMany(h, 1);
    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result.epochResets).toBe(1);
    const newEpoch = h.server.groups.get(h.keys.groupId)?.epoch;
    expect(newEpoch).not.toBe(oldEpoch);
    expect(new Set(h.server.stored(h.keys.groupId).map((e) => e.id))).toEqual(
      new Set([...before, ...later]),
    );
    expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
      epoch: newEpoch,
      cursor: 4,
      epochResetsThisCycle: 0,
      lastSyncError: null,
    });
    expect(h.store.dump(h.keys.localId).every((r) => r.acked && r.seq !== null)).toBe(true);
  });

  it('treats a null epoch where one is stored as a change: resets via unknown, then adopts', async () => {
    const h = await setup();
    const ids = await writeMany(h, 3);
    await h.engine.syncGroup(h.keys.localId, foreground);
    h.server.wipe(h.keys.groupId);

    // Nothing to push, so the pull sees the missing group (epoch null) first.
    const setSyncStates: unknown[] = [];
    h.store.fault = (method, args) => {
      if (method === 'setSyncState') setSyncStates.push(args[1]);
    };
    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result.epochResets).toBe(1);
    expect(setSyncStates[0]).toEqual({ epoch: UNKNOWN_EPOCH, epochResetsThisCycle: 1 });
    expect(
      h.server
        .stored(h.keys.groupId)
        .map((e) => e.id)
        .sort(),
    ).toEqual([...ids].sort());
    expect((await h.store.getGroup(h.keys.localId))?.epoch).toBe(
      h.server.groups.get(h.keys.groupId)?.epoch,
    );
  });

  it('stops with epoch_unstable when the epoch changes twice in one cycle, and recovers later', async () => {
    const h = await setup();
    await writeMany(h, 2);
    await h.engine.syncGroup(h.keys.localId, foreground);
    await writeMany(h, 1);

    h.server.onRequest = (request) => {
      if (request.op === 'push') h.server.setEpoch(h.keys.groupId);
    };
    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result.error).toBe('epoch_unstable');
    expect(h.server.pushSizes()).toEqual([2, 1, 3]); // first sync; the new write (reset); the re-push (unstable)
    expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
      lastSyncError: 'epoch_unstable',
      epochResetsThisCycle: 0,
    });

    h.server.onRequest = null;
    const again = expectSynced(await h.engine.syncGroup(h.keys.localId, manual));
    expect(again.epochResets).toBe(1);
    expect((await h.store.getGroup(h.keys.localId))?.epoch).toBe(
      h.server.groups.get(h.keys.groupId)?.epoch,
    );
  });

  it('applies the epoch rule to a pulled page before committing it', async () => {
    const h = await setup();
    await writeMany(h, 2);
    await h.engine.syncGroup(h.keys.localId, foreground);
    const b = await h.device();
    await writeMany(h, 3, b.store);
    await b.engine.syncGroup(h.keys.localId, foreground);

    h.server.onRequest = (request) => {
      if (request.op === 'pull') h.server.setEpoch(h.keys.groupId, 'flipped-epoch-000000000');
    };
    const inserts: number[] = [];
    h.store.fault = (method, args) => {
      if (method === 'insertEvents') inserts.push((args[1] as unknown[]).length);
    };
    const result = expectSynced(
      await h.engine.syncGroup(h.keys.localId, { trigger: 'pull_to_refresh' }),
    );
    expect(result.epochResets).toBe(1);
    // The flipped page was discarded; after the reset the next pull committed from cursor 0.
    const pulls = h.server.requests.filter((r) => r.op === 'pull').map((r) => r.since);
    expect(pulls.slice(-2)).toEqual([2, 0]);
    expect(inserts).toEqual([5]);
  });
});

describe('push errors', () => {
  it('quarantines the envelope at index on invalid_envelope and pushes the rest', async () => {
    const h = await setup();
    const ids = await writeMany(h, 3);
    h.server.failNext('push', { code: 'invalid_envelope', index: 1 });

    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result.pushed).toBe(2);
    expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual([ids[0], ids[2]]);
    const rejected = h.store.dump(h.keys.localId).filter((r) => r.pushState === 'rejected');
    expect(rejected.map((r) => r.id)).toEqual([ids[1]]);
    expect(await h.store.countByStatus(h.keys.localId)).toMatchObject({ outbox: 0, rejected: 1 });
  });

  it('quarantines local rows that are not sendable envelopes without a request', async () => {
    const h = await setup({ limits: { max_event_bytes: 256 } });
    const ok = await writeLocal(h.store, h.keys, h.ev.renamed('Fits')); // seals to 256 bytes
    const big = await writeLocal(h.store, h.keys, h.ev.expense('x'.repeat(80)));
    const junkId = newId();
    await h.store.insertEvents(h.keys.localId, [
      {
        id: junkId,
        origin: 'remote',
        acked: false,
        seq: null,
        ts: 5,
        envelope: '{"id":1}',
        status: 'undecryptable',
      },
    ]);

    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual([ok]);
    const rejected = h.store.dump(h.keys.localId).filter((r) => r.pushState === 'rejected');
    expect(rejected.map((r) => r.id).sort()).toEqual([big, junkId].sort());
    expect(h.server.pushSizes()).toEqual([1]);
  });

  it('quarantines a kept envelope of another version on 415 instead of stopping', async () => {
    const h = await setup();
    const ids = await writeMany(h, 2);
    const v2 = { ...sealFor(h.keys, h.ev.expense('future')), v: 2 };
    await h.store.insertEvents(h.keys.localId, [
      {
        id: v2.id,
        origin: 'remote',
        acked: false,
        seq: null,
        ts: 1,
        envelope: JSON.stringify(v2),
        status: 'unsupported_envelope',
      },
    ]);

    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual(ids);
    expect(h.store.dump(h.keys.localId).find((r) => r.id === v2.id)?.pushState).toBe('rejected');
  });

  it('refreshes /v1/info on invalid_request, re-batches with the new limits, and retries', async () => {
    const h = await setup();
    await writeMany(h, 5);
    let first = true;
    h.server.onRequest = (request) => {
      if (request.op === 'push' && first) {
        first = false;
        h.server.info.limits.max_batch = 2; // the server's limit shrank since we cached it
        h.server.failNext('push', { code: 'invalid_request' });
      }
    };

    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(h.server.requests.filter((r) => r.op === 'info')).toHaveLength(2);
    expect(h.server.pushSizes()).toEqual([5, 2, 2, 1]);
    expect(h.server.stored(h.keys.groupId)).toHaveLength(5);
  });

  it('treats a second invalid_request after the refresh as a 5xx', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.server.failNext('push', { code: 'invalid_request' }, 2);

    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(h.server.requests.filter((r) => r.op === 'info')).toHaveLength(2);
    expect(h.clock.sleeps).toEqual([500]);
    expect(h.server.pushSizes()).toEqual([1, 1, 1]);
  });

  it('halves the batch on the third consecutive 5xx for the same batch', async () => {
    const h = await setup({ limits: { max_batch: 4 } });
    await writeMany(h, 8);
    h.server.failNext('push', { code: 'server_error' }, 3);

    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(h.server.pushSizes()).toEqual([4, 4, 4, 2, 2, 2, 2]);
    expect(h.clock.sleeps).toEqual([500, 1000, 2000]);
    expect(h.server.stored(h.keys.groupId)).toHaveLength(8);
  });

  it('retries two 5xx in the cycle without halving', async () => {
    const h = await setup({ limits: { max_batch: 4 } });
    await writeMany(h, 4);
    h.server.failNext('push', { code: 'server_error' }, 2);
    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(h.server.pushSizes()).toEqual([4, 4, 4]);
  });

  it('gives up after six consecutive 5xx and backs off', async () => {
    const h = await setup({ limits: { max_batch: 8 } });
    await writeMany(h, 8);
    h.server.failNext('push', { code: 'server_error' }, 10);

    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result).toMatchObject({ error: 'server_error', retryAt: h.clock.now() + 30_000 });
    expect(h.server.pushSizes()).toEqual([8, 8, 8, 4, 4, 4]);
    expect(h.server.requests.some((r) => r.op === 'pull')).toBe(false);
  });

  it('stops pushing on group_full but still pulls, and records the error without backoff', async () => {
    const h = await setup({ limits: { max_group_events: 4 } });
    const b = await h.device();
    await writeMany(h, 3, b.store);
    await b.engine.syncGroup(h.keys.localId, foreground);
    await writeMany(h, 2); // 3 + 2 > 4

    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result).toEqual({
      localId: h.keys.localId,
      outcome: 'failed',
      error: 'group_full',
      retryAt: null,
    });
    expect(h.store.dump(h.keys.localId).filter((r) => r.origin === 'remote')).toHaveLength(3);
    expect((await h.store.countByStatus(h.keys.localId)).outbox).toBe(2);
    expect((await h.store.getGroup(h.keys.localId))?.lastSyncError).toBe('group_full');
    // No backoff: the next automatic trigger still runs (and still pulls).
    expect((await h.engine.syncGroup(h.keys.localId, foreground)).outcome).toBe('failed');
  });

  it('sets the group blocked on 410 and never syncs it again', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.server.blocked.add(h.keys.groupId);

    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result).toMatchObject({ error: 'group_blocked', retryAt: null });
    expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
      state: 'blocked',
      lastSyncError: 'group_blocked',
    });
    const requests = h.server.requests.length;
    expect(await h.engine.syncGroup(h.keys.localId, manual)).toEqual({
      localId: h.keys.localId,
      outcome: 'skipped',
      reason: 'not_active',
    });
    expect(h.server.requests).toHaveLength(requests);
    expect(h.clock.pending()).toEqual([]);
  });

  it('records unauthorized, logs it, and backs off', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.server.failNext('push', { code: 'unauthorized' });
    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result).toMatchObject({ error: 'unauthorized', retryAt: h.clock.now() + 30_000 });
    expect(h.logs.some((m) => m.includes('unauthorized'))).toBe(true);
    expect(h.server.requests.some((r) => r.op === 'pull')).toBe(false);
  });

  it('honours a long Retry-After on 429 for every trigger, then retries on its own', async () => {
    const h = await setup();
    await writeMany(h, 2);
    h.server.failNext('push', { code: 'rate_limited', retryAfterMs: 120_000 });
    const start = h.clock.now();

    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result).toMatchObject({ error: 'rate_limited', retryAt: start + 120_000 });

    await h.clock.advance(60_000);
    expect(await h.engine.syncGroup(h.keys.localId, foreground)).toMatchObject({
      reason: 'backoff',
    });
    expect(await h.engine.syncGroup(h.keys.localId, manual)).toMatchObject({ reason: 'backoff' });
    expect(h.server.pushSizes()).toEqual([2]);

    await h.clock.advance(60_000); // the engine's own retry fires at retryAt
    expect(h.server.pushSizes()).toEqual([2, 2]);
    expect((await h.store.getGroup(h.keys.localId))?.lastSyncError).toBeNull();
  });

  it('waits out a short Retry-After inside the cycle', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.server.failNext('push', { code: 'rate_limited', retryAfterMs: 1_000 });
    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(h.clock.sleeps).toEqual([1_000]);
  });

  it('pauses pushes on 503 over_budget while pulls go on', async () => {
    const h = await setup();
    const b = await h.device();
    await writeMany(h, 2, b.store);
    await b.engine.syncGroup(h.keys.localId, foreground);
    await writeMany(h, 1);
    h.server.failNext('push', { code: 'over_budget', retryAfterMs: 3_600_000 });

    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result).toMatchObject({ error: 'over_budget', retryAt: h.clock.now() + 3_600_000 });
    expect(h.store.dump(h.keys.localId).filter((r) => r.origin === 'remote')).toHaveLength(2);

    // An automatic trigger still pulls, without pushing to the paused server.
    await writeMany(h, 1, b.store);
    await b.engine.syncGroup(h.keys.localId, foreground);
    const pushesBefore = h.server.pushSizes().length;
    await h.clock.advance(60_000);
    expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(h.server.pushSizes()).toHaveLength(pushesBefore);
    expect(h.store.dump(h.keys.localId).filter((r) => r.origin === 'remote')).toHaveLength(3);
  });

  it('fails with not_an_even_server when /v1/info is not an Even server', async () => {
    const h = await setup();
    h.server.failNext('info', { code: 'not_an_even_server' });
    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result.error).toBe('not_an_even_server');
  });

  it('fails with no_secret, without retrying, when the secret is missing', async () => {
    const h = await setup();
    h.secrets.items.clear();
    const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(result).toMatchObject({ error: 'no_secret', retryAt: null });
    expect(h.server.requests).toEqual([]);
  });
});

describe('pull', () => {
  it('commits each page and its cursor together: a throw mid-page changes neither', async () => {
    const h = await setup({ limits: { max_page: 2 } });
    const b = await h.device();
    await writeMany(h, 5, b.store);
    await b.engine.syncGroup(h.keys.localId, foreground);

    let cursorWrites = 0;
    h.store.fault = (method) => {
      if (method === 'setCursor' && ++cursorWrites === 2) throw new Error('disk full');
    };
    const failed = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
    expect(failed.error).toBe('local_error');
    // Page 1 committed (2 rows, cursor 2); page 2 rolled back entirely.
    expect(h.store.dump(h.keys.localId)).toHaveLength(2);
    expect((await h.store.getGroup(h.keys.localId))?.cursor).toBe(2);

    h.store.fault = null;
    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, manual));
    expect(result.pulled).toBe(3);
    expect((await h.store.getGroup(h.keys.localId))?.cursor).toBe(5);
    const sinces = h.server.requests.filter((r) => r.op === 'pull').map((r) => r.since);
    expect(sinces.slice(-2)).toEqual([2, 4]);
  });

  it('assigns a status to every malformed, unsupported, undecryptable, and invalid envelope', async () => {
    const h = await setup();
    const g = h.keys.groupId;
    const other = groupKeys();
    const good = h.ev.expense('Dinner');
    const bad = h.ev.expense('Bad split');
    if (bad.type === 'expense.added') bad.expense.split = { [h.ev.by]: 1 }; // does not sum to amount
    const futureSv = { ...h.ev.expense('Future'), sv: 2 };
    const unknownType = {
      sv: 1,
      type: 'poll.added',
      ts: 1_760_000_000_500,
      at: 1,
      by: newId(),
      dev: newId(),
    };

    const ids = {
      ok: h.server.injectRaw(g, sealFor(h.keys, good)),
      invalid: h.server.injectRaw(g, sealFor(h.keys, bad)),
      futureSv: h.server.injectRaw(g, sealFor(h.keys, futureSv)),
      unknownType: h.server.injectRaw(g, sealFor(h.keys, unknownType)),
      notObject: h.server.injectRaw(g, sealFor(h.keys, 'just a string')),
      wrongKey: h.server.injectRaw(g, sealFor(other, good)),
      v2: h.server.injectRaw(g, { ...sealFor(h.keys, good), v: 2 }),
      junk: h.server.injectRaw(g, { id: newId(), v: 1, n: 'short', c: 'AAAA' }),
      extraField: h.server.injectRaw(g, { ...sealFor(h.keys, good), extra: true }),
    };
    h.server.injectRaw(g, { id: 'not-an-id' }); // no usable id: dropped
    const bySeq = new Map(h.server.stored(g).map((e) => [e.seq, e.id]));

    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    const rows = new Map(h.store.dump(h.keys.localId).map((r) => [r.id, r]));
    const row = (seq: number) => rows.get(bySeq.get(seq) ?? '');
    expect(row(ids.ok)).toMatchObject({
      status: 'ok',
      ts: good.ts,
      acked: true,
      origin: 'remote',
      seq: ids.ok,
    });
    expect(row(ids.invalid)).toMatchObject({ status: 'invalid', ts: bad.ts });
    expect(row(ids.futureSv)).toMatchObject({ status: 'unsupported_body', ts: futureSv.ts });
    expect(row(ids.unknownType)).toMatchObject({ status: 'unsupported_body', ts: unknownType.ts });
    expect(row(ids.notObject)).toMatchObject({ status: 'invalid', ts: null });
    expect(row(ids.wrongKey)).toMatchObject({ status: 'undecryptable', ts: null });
    expect(row(ids.v2)).toMatchObject({ status: 'unsupported_envelope', ts: null });
    expect(row(ids.junk)).toMatchObject({ status: 'undecryptable', ts: null });
    expect(row(ids.extraField)).toMatchObject({ status: 'undecryptable' });
    expect(rows.size).toBe(9);
    expect(result.newOkIds).toEqual([bySeq.get(ids.ok)]);
    expect(h.store.calls).toContain('pruneUndecryptable');
    // Stored text is the envelope without `seq`.
    expect(Object.keys(JSON.parse(row(ids.ok)?.envelope ?? '{}')).sort()).toEqual([
      'c',
      'id',
      'n',
      'v',
    ]);
  });

  it('stores an oversized junk item bounded, so it cannot fail its page', async () => {
    const h = await setup();
    const before = h.server.injectRaw(h.keys.groupId, sealFor(h.keys, h.ev.expense('Before')));
    const huge = h.server.injectRaw(h.keys.groupId, {
      id: newId(),
      v: 1,
      n: 'x',
      c: 'A'.repeat(50_000),
    });
    const quotes = h.server.injectRaw(h.keys.groupId, {
      id: newId(),
      blob: '\u0000'.repeat(10_000),
    });
    const after = h.server.injectRaw(h.keys.groupId, sealFor(h.keys, h.ev.expense('After')));
    const bySeq = new Map(h.server.stored(h.keys.groupId).map((e) => [e.seq, e.id]));

    const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

    expect(result.pulled).toBe(4);
    const rows = new Map(h.store.dump(h.keys.localId).map((r) => [r.id, r]));
    for (const seq of [huge, quotes]) {
      const junk = rows.get(bySeq.get(seq) ?? '');
      expect(junk?.status).toBe('undecryptable');
      expect(junk?.envelope.length).toBeLessThanOrEqual(MAX_JUNK_TEXT_LENGTH);
      expect(JSON.parse(junk?.envelope ?? '')).toMatchObject({
        id: bySeq.get(seq),
        truncated: true,
      });
    }
    expect(rows.get(bySeq.get(before) ?? '')?.status).toBe('ok');
    expect(rows.get(bySeq.get(after) ?? '')?.status).toBe('ok');
  });

  it('caps undecryptable rows per group', async () => {
    const h = await setup({ tuning: { undecryptableKeep: 2 } });
    const other = groupKeys();
    for (let i = 0; i < 4; i++) {
      h.server.injectRaw(h.keys.groupId, sealFor(other, h.ev.expense(`x${i}`)));
    }
    expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
    expect((await h.store.countByStatus(h.keys.localId)).byStatus.undecryptable).toBe(2);
  });

  it('stops a pull that reports more without progress', async () => {
    const h = await setup();
    const transport = h.server.transport();
    const engine = createSyncEngine({
      store: h.store,
      secrets: h.secrets,
      transportFor: () => ({
        ...transport,
        pull: async () => ({ events: [], next: 0, more: true, epoch: 'e' }),
      }),
      now: h.clock.now,
      sleep: h.clock.sleep,
      schedule: h.clock.schedule,
      log: () => undefined,
    });
    expect(await engine.syncGroup(h.keys.localId, foreground)).toMatchObject({
      error: 'server_error',
    });
  });
});

describe('which groups sync', () => {
  it.each<GroupLifecycle>(['closed', 'hidden', 'blocked'])(
    'never syncs a %s group',
    async (state) => {
      const h = await setup();
      await writeMany(h, 1);
      await h.store.setGroupState(h.keys.localId, state);

      for (const trigger of ['foreground', 'manual', 'pull_to_refresh', 'first_open'] as const) {
        expect(await h.engine.syncGroup(h.keys.localId, { trigger })).toMatchObject({
          reason: 'not_active',
        });
      }
      expect(await h.engine.syncAll(foreground)).toEqual([]);
      h.engine.requestSync(h.keys.localId);
      await h.clock.advance(2_000);
      expect(h.server.requests).toEqual([]);
      expect(h.events).toEqual([]);
    },
  );

  it('syncAll runs active groups in order, and one failure does not stop the others', async () => {
    const h = await setup();
    const second = groupKeys();
    h.secrets.add(second.secret);
    await h.store.upsertGroup(groupRow(second, { createdAt: h.clock.now() + 1 }));
    const third = groupKeys();
    await h.store.upsertGroup(groupRow(third, { createdAt: h.clock.now() + 2 })); // no secret
    await writeMany(h, 1);

    const results = await h.engine.syncAll(foreground);

    expect(results.map((r) => [r.localId, r.outcome])).toEqual([
      [h.keys.localId, 'synced'],
      [second.localId, 'synced'],
      [third.localId, 'failed'],
    ]);
    expect(
      h.events.map(
        (e) =>
          `${e.type}:${e.localId === h.keys.localId ? 'A' : e.localId === second.localId ? 'B' : 'C'}`,
      ),
    ).toEqual(['started:A', 'finished:A', 'started:B', 'finished:B', 'started:C', 'finished:C']);
  });

  it('background syncs only groups with an event dated within 30 days, and respects the deadline', async () => {
    const h = await setup();
    await writeMany(h, 1); // recent
    const stale = groupKeys();
    h.secrets.add(stale.secret);
    await h.store.upsertGroup(groupRow(stale, { createdAt: h.clock.now() + 1 }));
    const old = new Events(h.clock.now() - 31 * 24 * 60 * 60 * 1000);
    await writeLocal(h.store, stale, old.expense('Old'));
    const empty = groupKeys();
    h.secrets.add(empty.secret);
    await h.store.upsertGroup(groupRow(empty, { createdAt: h.clock.now() + 2 }));

    const results = await h.engine.syncAll({ trigger: 'background' });
    expect(results.map((r) => r.localId)).toEqual([h.keys.localId]);

    const late = await h.engine.syncAll({ trigger: 'background', deadline: h.clock.now() });
    expect(late).toEqual([{ localId: h.keys.localId, outcome: 'skipped', reason: 'deadline' }]);
  });
});

describe('triggers', () => {
  it('coalesces local writes within 1 s into one cycle', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.engine.requestSync(h.keys.localId);
    await h.clock.advance(500);
    await writeMany(h, 1);
    h.engine.requestSync(h.keys.localId);
    await h.clock.advance(999);
    expect(h.server.pushSizes()).toEqual([]);
    await h.clock.advance(1);
    expect(h.server.pushSizes()).toEqual([2]);
    expect(h.events.filter((e) => e.type === 'started')).toEqual([
      { type: 'started', localId: h.keys.localId, trigger: 'local_write' },
    ]);
  });

  it('a manual tap within 10 s of a success replays the spinner without a request', async () => {
    const h = await setup();
    await h.engine.syncGroup(h.keys.localId, foreground);
    const requests = h.server.requests.length;
    h.events.length = 0;

    await h.clock.advance(9_000);
    const result = await h.engine.syncGroup(h.keys.localId, manual);

    expect(result).toEqual({ localId: h.keys.localId, outcome: 'skipped', reason: 'debounced' });
    expect(h.events).toEqual([
      { type: 'started', localId: h.keys.localId, trigger: 'manual' },
      { type: 'finished', localId: h.keys.localId, trigger: 'manual', result },
    ]);
    expect(h.server.requests).toHaveLength(requests);

    await h.clock.advance(1_000);
    expectSynced(await h.engine.syncGroup(h.keys.localId, manual));
    expect(h.server.requests.length).toBeGreaterThan(requests);
  });

  it('ignores manual taps during a sync; other triggers share the running cycle', async () => {
    const h = await setup();
    await writeMany(h, 1);
    const release = h.server.hold();
    const running = h.engine.syncGroup(h.keys.localId, foreground);
    await settle();

    expect(await h.engine.syncGroup(h.keys.localId, manual)).toMatchObject({ reason: 'in_flight' });
    const shared = h.engine.syncGroup(h.keys.localId, { trigger: 'pull_to_refresh' });
    release();
    const [a, b] = await Promise.all([running, shared]);
    expect(b).toBe(a);
    expect(h.events.filter((e) => e.type === 'started')).toHaveLength(1);
  });

  it('a write during a sync runs the cycle again after it', async () => {
    const h = await setup();
    await writeMany(h, 1);
    const release = h.server.hold();
    const running = h.engine.syncGroup(h.keys.localId, foreground);
    await settle();

    await writeMany(h, 1);
    h.engine.requestSync(h.keys.localId);
    await h.clock.advance(1_000); // the debounce fires while the first cycle is still in flight
    release();
    await running;
    await settle();

    expect(h.events.filter((e) => e.type === 'started').map((e) => e.trigger)).toEqual([
      'foreground',
      'local_write',
    ]);
    expect(h.server.stored(h.keys.groupId)).toHaveLength(2);
  });

  it('backs off 30 s → 2 m → 10 m for automatic triggers, bypassed by manual and refresh, reset on success', async () => {
    const h = await setup();
    await writeMany(h, 1);
    h.server.offline = true;

    const retryIn = async (trigger: 'foreground' | 'manual' | 'pull_to_refresh') => {
      const r = expectFailed(await h.engine.syncGroup(h.keys.localId, { trigger }));
      expect(r.error).toBe('network');
      return (r.retryAt ?? 0) - h.clock.now();
    };

    expect(await retryIn('foreground')).toBe(30_000);
    await h.clock.advance(10_000);
    expect(await h.engine.syncGroup(h.keys.localId, foreground)).toMatchObject({
      reason: 'backoff',
    });
    expect(await h.engine.syncGroup(h.keys.localId, { trigger: 'local_write' })).toMatchObject({
      reason: 'backoff',
    });
    expect(await retryIn('manual')).toBe(120_000);
    expect(await retryIn('pull_to_refresh')).toBe(600_000);
    expect(await retryIn('manual')).toBe(600_000);
    expect(h.clock.pending()).toEqual([h.clock.now() + 600_000]); // one scheduled retry

    h.server.offline = false;
    expectSynced(await h.engine.syncGroup(h.keys.localId, manual));
    expect(h.clock.pending()).toEqual([]);
    h.server.offline = true;
    await h.clock.advance(20_000);
    expect(await retryIn('foreground')).toBe(30_000);
  });

  it('emits started then finished with the result for every cycle', async () => {
    const h = await setup();
    await writeMany(h, 1);
    const ok = await h.engine.syncGroup(h.keys.localId, { trigger: 'pull_to_refresh' });
    h.server.offline = true;
    await writeMany(h, 1);
    await h.clock.advance(10_000); // past the manual-tap debounce
    const failed = await h.engine.syncGroup(h.keys.localId, manual);

    expect(h.events).toEqual([
      { type: 'started', localId: h.keys.localId, trigger: 'pull_to_refresh' },
      { type: 'finished', localId: h.keys.localId, trigger: 'pull_to_refresh', result: ok },
      { type: 'started', localId: h.keys.localId, trigger: 'manual' },
      { type: 'finished', localId: h.keys.localId, trigger: 'manual', result: failed },
    ]);
  });

  it('unsubscribes, and survives a throwing listener', async () => {
    const h = await setup();
    const seen: string[] = [];
    const off = h.engine.subscribe((e) => seen.push(e.type));
    h.engine.subscribe(() => {
      throw new Error('boom');
    });
    await h.engine.syncGroup(h.keys.localId, foreground);
    off();
    await h.engine.syncGroup(h.keys.localId, { trigger: 'pull_to_refresh' });
    expect(seen).toEqual(['started', 'finished']);
    expect(h.logs.filter((m) => m.includes('listener'))).toHaveLength(4);
  });

  it('dispose cancels pending timers', async () => {
    const h = await setup();
    h.engine.requestSync(h.keys.localId);
    h.engine.dispose();
    await h.clock.advance(5_000);
    expect(h.server.requests).toEqual([]);
  });
});
