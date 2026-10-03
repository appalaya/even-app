/**
 * The sync engine's suite. Everything that touches a store runs twice, on the fake and on the real store
 * (sqliteStore.ts over node:sqlite), through the same instrumented wrapper (testing/testStore.ts), so the two
 * cannot drift apart on anything the engine relies on.
 */
import {
  b64urlEncode,
  groupIdForToken,
  LIMITS,
  newId,
  open,
  parseEvent,
  type Envelope,
} from '@even/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GroupLifecycle } from '../storage/types';
import { FakeClock, settle } from '../testing/fakeClock';
import { FakeSecrets } from '../testing/fakeSecrets';
import { FakeServer, type ScriptedFailure } from '../testing/fakeTransport';
import {
  Events,
  groupKeys,
  groupRow,
  sealFor,
  TEST_SERVER,
  writeLocal,
  type GroupKeys,
} from '../testing/fixtures';
import { openTestStore, STORE_KINDS, type StoreKind, type TestStore } from '../testing/testStore';
import {
  classifyPulled,
  CLIENT_MAX_BATCH,
  CLIENT_MAX_PAGE,
  createSyncEngine,
  decideEpoch,
  DEFAULT_TUNING,
  isUnsupportedBody,
  MAX_JUNK_TEXT_LENGTH,
  receivedPairs,
  UNKNOWN_EPOCH,
  type SyncEngineHandle,
  type SyncTuning,
} from './engine';
import { DecodeCache } from './decodeCache';
import { SyncError } from './errors';
import type { ServerInfo, StoredEnvelope, SyncEvent, SyncResult, Transport } from './types';

interface Device {
  store: TestStore;
  secrets: FakeSecrets;
  engine: SyncEngineHandle;
  /** What the engine's pulls opened (the app shares it with the derived state). */
  decodeCache: DecodeCache;
  events: SyncEvent[];
  /** Every log line, with its detail. */
  logs: string[];
}

interface Harness extends Device {
  clock: FakeClock;
  /** The group's current server, at TEST_SERVER. */
  server: FakeServer;
  keys: GroupKeys;
  ev: Events;
  device(): Promise<Device>;
  /** Another server, reachable at `url` by every device's engine. */
  addServer(url: string): FakeServer;
}

interface SetupOptions {
  limits?: Partial<ServerInfo['limits']>;
  tuning?: Partial<SyncTuning>;
}

const opened: TestStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((store) => store.close()));
});

async function setupWith(kind: StoreKind, options: SetupOptions = {}): Promise<Harness> {
  const clock = new FakeClock();
  const server = new FakeServer(options.limits, clock.now);
  const servers = new Map<string, FakeServer>([[TEST_SERVER, server]]);
  const keys = groupKeys();
  const ev = new Events(clock.now());

  async function device(): Promise<Device> {
    const store = await openTestStore(kind);
    opened.push(store);
    const secrets = new FakeSecrets();
    secrets.add(keys.secret);
    await store.upsertGroup(groupRow(keys, { createdAt: clock.now() }));
    const events: SyncEvent[] = [];
    const logs: string[] = [];
    const decodeCache = new DecodeCache();
    const engine = createSyncEngine({
      store,
      secrets,
      decodeCache,
      transportFor: (url) => {
        const target = servers.get(url);
        if (target === undefined) throw new Error(`no fake server at ${url}`);
        return target.transport();
      },
      now: clock.now,
      sleep: clock.sleep,
      schedule: clock.schedule,
      log: (message, detail) =>
        logs.push(detail === undefined ? message : `${message} ${String(detail)}`),
      ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
    });
    engine.subscribe((event) => events.push(event));
    return { store, secrets, engine, decodeCache, events, logs };
  }

  function addServer(url: string): FakeServer {
    const added = new FakeServer(options.limits, clock.now);
    servers.set(url, added);
    return added;
  }

  return { ...(await device()), clock, server, keys, ev, device, addServer };
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
const refresh = { trigger: 'pull_to_refresh' } as const;
const OLD = 'https://old.test';
const NEW = 'https://new.test';

/**
 * The exact plaintext text of an envelope: what `open` decodes from the bytes and hands to `JSON.parse`, before
 * any parsing can change it. Fails if `open` stops calling `JSON.parse` exactly once.
 */
function plaintextOf(key: Uint8Array, groupId: string, envelope: Envelope): string {
  const parse = vi.spyOn(JSON, 'parse');
  try {
    open({ key, groupId, envelope });
    expect(parse).toHaveBeenCalledTimes(1);
    return parse.mock.calls[0]?.[0] as string;
  } finally {
    parse.mockRestore();
  }
}

/** `JSON.rawJSON` (Node 21+, not yet in TypeScript's lib): `JSON.stringify` emits `text` as it is. */
function rawJson(text: string): unknown {
  return (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON(text);
}

/** Gives the group a copy on another server, like the one a move away from it leaves behind. */
async function copyOn(h: Harness, url: string): Promise<{ other: FakeServer; keys: GroupKeys }> {
  const other = h.addServer(url);
  const keys = groupKeys(url, h.keys.secret);
  await other.transport().push(keys.groupId, keys.token, [sealFor(keys, h.ev.expense('Old copy'))]);
  return { other, keys };
}

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

describe('receivedPairs', () => {
  const ids = ['a', 'b', 'c'].map((c) => c.repeat(22));
  const R = 1_760_000_000_000;

  it('pairs one R per envelope sent, in request order, keeping only usable values', () => {
    expect(receivedPairs(ids, [R, R, R - 5])).toEqual([
      [ids[0], R],
      [ids[1], R],
      [ids[2], R - 5],
    ]);
    expect(receivedPairs(ids, [R, 0.5, LIMITS.tsMax])).toEqual([[ids[0], R]]);
  });

  it('gives nothing for a server without the list, or a list of another length', () => {
    expect(receivedPairs(ids, undefined)).toEqual([]);
    expect(receivedPairs(ids, [R, R])).toEqual([]);
    expect(receivedPairs(ids, [R, R, R, R])).toEqual([]);
  });
});

describe('classifyPulled and received_at', () => {
  const keys = groupKeys();
  const ev = new Events();

  it("takes the server's R off before checking the envelope, and keeps it when usable", () => {
    const envelope = sealFor(keys, ev.expense('Dinner'));
    const R = 1_760_000_000_000;
    const ok = classifyPulled({ ...envelope, seq: 4, received_at: R }, keys.key, keys.groupId);
    expect(ok?.row).toMatchObject({ status: 'ok', seq: 4, receivedAt: R });
    expect(JSON.parse(ok?.row.envelope ?? '')).toEqual(envelope);
    for (const bad of [R + 0.5, LIMITS.tsMax, 'soon', null]) {
      const row = classifyPulled({ ...envelope, seq: 4, received_at: bad }, keys.key, keys.groupId);
      expect(row?.row).toMatchObject({ status: 'ok', receivedAt: null });
    }
    expect(classifyPulled({ ...envelope, seq: 4 }, keys.key, keys.groupId)?.row).toMatchObject({
      status: 'ok',
      receivedAt: null,
    });
  });

  it('ignores every other key a server adds, and is junk only when id, v, n and c are not an envelope', () => {
    const envelope = sealFor(keys, ev.expense('Dinner'));
    const extra = {
      ...envelope,
      seq: 4,
      received_at: 1_760_000_000_000,
      flags: ['new'],
      extra: { a: 1 },
    };
    const classified = classifyPulled(extra, keys.key, keys.groupId);
    expect(classified?.row).toMatchObject({ status: 'ok', seq: 4, receivedAt: 1_760_000_000_000 });
    // Stored as the four fields alone, the form every other path keeps.
    expect(classified?.row.envelope).toBe(
      JSON.stringify({ id: envelope.id, v: envelope.v, n: envelope.n, c: envelope.c }),
    );
    expect(classified?.event?.type).toBe('expense.added');
    // A missing or malformed field is still junk, extra keys or not.
    const { n: _n, ...noNonce } = extra;
    expect(classifyPulled(noNonce, keys.key, keys.groupId)?.row.status).toBe('undecryptable');
    expect(
      classifyPulled({ ...extra, c: 'not base64url!' }, keys.key, keys.groupId)?.row.status,
    ).toBe('undecryptable');
    expect(classifyPulled({ ...extra, v: 2 }, keys.key, keys.groupId)?.row.status).toBe(
      'unsupported_envelope',
    );
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

describe.each(STORE_KINDS)('engine on the %s store', (kind) => {
  const setup = (options?: SetupOptions) => setupWith(kind, options);

  describe('happy path', () => {
    it('pushes the outbox, pulls its own events back acked with seq, and records success', async () => {
      const h = await setup();
      const ids = await writeMany(h, 3);

      const result = expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

      expect(result).toMatchObject({ pushed: 3, pulled: 0, epochResets: 0, newOkIds: [] });
      expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual(ids);
      const rows = await h.store.dump(h.keys.localId);
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

    it('delivers one device’s events to another, as remote ok rows with ts, each opened once', async () => {
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
      const rows = await b.store.dump(h.keys.localId);
      expect(rows.every((r) => r.origin === 'remote' && r.acked && r.status === 'ok')).toBe(true);
      expect(rows.every((r) => typeof r.ts === 'number')).toBe(true);
      // Each pulled envelope went into the decode cache as it was opened, so the derive that follows opens none of
      // them again; the name cache is the derived state's to keep (the lifecycle check), not a pass of the engine's.
      expect(b.decodeCache.size(h.keys.localId)).toBe(3);
      for (const row of rows) {
        const decoded = b.decodeCache.get(h.keys.localId, row.id, row.envelope, h.keys.groupId);
        expect(decoded?.event?.ts).toBe(row.ts);
      }
      expect(await b.store.getGroup(h.keys.localId)).toMatchObject({
        nameCache: null,
        currencyCache: null,
        cursor: 3,
      });
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
      expect((await h.store.dump(h.keys.localId)).every((r) => r.acked && r.seq !== null)).toBe(
        true,
      );
    });

    it('after a reset, pushes the pinned creation alone, before a backdated duplicate the ts order puts first', async () => {
      const h = await setup();
      const backdated = await writeLocal(h.store, h.keys, {
        ...h.ev.created('Pwned', 'EUR'),
        ts: LIMITS.tsMin,
        at: LIMITS.tsMin,
      });
      const creation = await writeLocal(h.store, h.keys, h.ev.created('Banff 2026', 'CAD'));
      await writeMany(h, 3);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      expect(await h.store.pinCreation(h.keys.localId, creation)).toBe(true);

      h.server.wipe(h.keys.groupId); // idle expiry, a Leave that deleted the copy, a DELETE
      h.server.requests.length = 0;
      await h.clock.sleep(1_000);
      expect(await h.engine.syncGroup(h.keys.localId, foreground)).toMatchObject({
        outcome: 'synced',
        epochResets: 1,
      });

      const pushes = h.server.requests.filter((r) => r.op === 'push').map((r) => r.ids);
      expect(pushes[0]).toEqual([creation]);
      expect(pushes[1]?.[0]).toBe(backdated);
      const arrivals = h.server.receivedAt(h.keys.groupId);
      expect(arrivals.get(creation) as number).toBeLessThan(arrivals.get(backdated) as number);
      expect((await h.store.countByStatus(h.keys.localId)).outbox).toBe(0);
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
      const rejected = (await h.store.dump(h.keys.localId)).filter(
        (r) => r.pushState === 'rejected',
      );
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
      const rejected = (await h.store.dump(h.keys.localId)).filter(
        (r) => r.pushState === 'rejected',
      );
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
      expect((await h.store.dump(h.keys.localId)).find((r) => r.id === v2.id)?.pushState).toBe(
        'rejected',
      );
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
      expect(
        (await h.store.dump(h.keys.localId)).filter((r) => r.origin === 'remote'),
      ).toHaveLength(3);
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
      expect(
        (await h.store.dump(h.keys.localId)).filter((r) => r.origin === 'remote'),
      ).toHaveLength(2);

      // An automatic trigger still pulls, without pushing to the paused server.
      await writeMany(h, 1, b.store);
      await b.engine.syncGroup(h.keys.localId, foreground);
      const pushesBefore = h.server.pushSizes().length;
      await h.clock.advance(60_000);
      expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
      expect(h.server.pushSizes()).toHaveLength(pushesBefore);
      expect(
        (await h.store.dump(h.keys.localId)).filter((r) => r.origin === 'remote'),
      ).toHaveLength(3);
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
      expect(await h.store.dump(h.keys.localId)).toHaveLength(2);
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

      const rows = new Map((await h.store.dump(h.keys.localId)).map((r) => [r.id, r]));
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
      expect(row(ids.unknownType)).toMatchObject({
        status: 'unsupported_body',
        ts: unknownType.ts,
      });
      expect(row(ids.notObject)).toMatchObject({ status: 'invalid', ts: null });
      expect(row(ids.wrongKey)).toMatchObject({ status: 'undecryptable', ts: null });
      expect(row(ids.v2)).toMatchObject({ status: 'unsupported_envelope', ts: null });
      expect(row(ids.junk)).toMatchObject({ status: 'undecryptable', ts: null });
      // A key the protocol does not name is ignored (PROTOCOL.md §11), not junk: the envelope is its four fields.
      expect(row(ids.extraField)).toMatchObject({ status: 'ok', ts: good.ts });
      expect(Object.keys(JSON.parse(row(ids.extraField)?.envelope ?? '{}')).sort()).toEqual([
        'c',
        'id',
        'n',
        'v',
      ]);
      expect(rows.size).toBe(9);
      expect(result.newOkIds).toEqual([bySeq.get(ids.ok), bySeq.get(ids.extraField)]);
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
      const rows = new Map((await h.store.dump(h.keys.localId)).map((r) => [r.id, r]));
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

    it('caps unsupported_envelope rows per group, keeping the newest', async () => {
      const h = await setup({ tuning: { unsupportedEnvelopeKeep: 2 } });
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const future = { ...sealFor(h.keys, h.ev.expense(`v2 ${i}`)), v: 2 };
        h.server.injectRaw(h.keys.groupId, future);
        ids.push(future.id);
      }
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const kept = (await h.store.dump(h.keys.localId))
        .filter((r) => r.status === 'unsupported_envelope')
        .map((r) => r.id);
      expect(kept.sort()).toEqual(ids.slice(2).sort());
      expect(h.store.calls).toContain('pruneUnsupportedEnvelopes');
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

  describe('the server\'s read allowance (design.md "Migrations", v5)', () => {
    it('re-pulling several large groups waits out each 429 for every group on that server, and finishes', async () => {
      const h = await setup();
      const groups = [h.keys, groupKeys(), groupKeys()];
      const transport = h.server.transport();
      for (const [i, keys] of groups.entries()) {
        if (i > 0) {
          h.secrets.add(keys.secret);
          await h.store.upsertGroup(groupRow(keys, { createdAt: h.clock.now() + i }));
        }
        const ev = new Events(h.clock.now());
        for (let batch = 0; batch < 24; batch++) {
          const envelopes = Array.from({ length: 25 }, () => sealFor(keys, ev.expense('Item')));
          await transport.push(keys.groupId, keys.token, envelopes);
        }
      }
      // The public server's rule, scaled down: a read costs one unit per started 100 rows, 8 units a minute per
      // address, and a read past that is a 429 with Retry-After: 60.
      const allowance = 8;
      let window = -1;
      let used = 0;
      const requests: { at: number; op: string; limited: boolean }[] = [];
      h.server.onRequest = (request) => {
        const at = h.clock.now();
        if (request.op !== 'pull') {
          requests.push({ at, op: request.op, limited: false });
          return;
        }
        const current = Math.floor(at / 60_000);
        if (current !== window) {
          window = current;
          used = 0;
        }
        const left = h.server
          .stored(request.groupId ?? '')
          .filter((e) => e.seq > (request.since ?? 0)).length;
        const rows = Math.min(request.limit ?? 0, h.server.info.limits.max_page, left);
        const units = Math.max(1, Math.ceil(rows / 100));
        const limited = used + units > allowance;
        requests.push({ at, op: request.op, limited });
        if (limited) {
          throw new SyncError('rate_limited', 'fake: read allowance', {
            status: 429,
            retryAfterMs: 60_000,
          });
        }
        used += units;
      };
      const start = h.clock.now();

      await h.engine.syncAll(foreground);
      const done = async () => {
        for (const keys of groups) {
          const row = await h.store.getGroup(keys.localId);
          if (row?.cursor !== 600) return false;
        }
        return true;
      };
      for (let minute = 0; minute < 10 && !(await done()); minute++) await h.clock.advance(60_000);

      expect(await done()).toBe(true);
      for (const keys of groups) {
        expect((await h.store.countByStatus(keys.localId)).byStatus.ok).toBe(600);
      }
      // A few minutes, not a spin: after a 429 no request reaches the server, for any group, until its Retry-After
      // has run (the other groups' cycles end at once and retry then).
      const limited = requests.flatMap((r, i) => (r.limited ? [i] : []));
      expect(limited.length).toBeGreaterThan(0);
      for (const i of limited) {
        const t = requests[i]?.at ?? 0;
        expect(requests.slice(i + 1).filter((r) => r.at < t + 60_000)).toEqual([]);
      }
      expect(h.clock.now() - start).toBeLessThan(6 * 60_000);
    });
  });

  describe('a hostile server (review M2)', () => {
    const bounds: Partial<SyncTuning> = {
      pullEntriesPerCycle: 60,
      undecryptableKeep: 5,
      unsupportedEnvelopeKeep: 5,
    };

    /** An engine over the fake server, except for pulls, which `pull` answers. */
    function engineWith(h: Harness, pull: Transport['pull']): SyncEngineHandle {
      const transport = h.server.transport();
      return createSyncEngine({
        store: h.store,
        secrets: h.secrets,
        transportFor: () => ({ ...transport, pull }),
        now: h.clock.now,
        sleep: h.clock.sleep,
        schedule: h.clock.schedule,
        log: () => undefined,
        tuning: bounds,
      });
    }

    type Shape = 'unknown v' | 'unopenable' | 'empty';
    function pageOf(h: Harness, shape: Shape, since: number, limit: number): StoredEnvelope[] {
      if (shape === 'empty') return [];
      const other = groupKeys();
      return Array.from({ length: limit }, (_, i) => {
        const envelope =
          shape === 'unknown v'
            ? { ...sealFor(h.keys, h.ev.expense(`x${i}`)), v: 2 }
            : sealFor(other, h.ev.expense(`x${i}`));
        return { ...envelope, seq: since + i + 1 } as unknown as StoredEnvelope;
      });
    }

    it('sends at most 100 per append and asks for at most 1,000 per page, whatever it publishes', async () => {
      const h = await setup({ limits: { max_batch: 1_000_000, max_page: 1_000_000 } });
      await writeMany(h, 250);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      expect(h.server.pushSizes()).toEqual([100, 100, 50]);

      const b = await h.device();
      const joined = expectSynced(
        await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }),
      );
      expect(joined.pulled).toBe(250);
      const limits = h.server.requests.filter((r) => r.op === 'pull').map((r) => r.limit);
      expect(new Set(limits)).toEqual(new Set([CLIENT_MAX_PAGE]));
      expect([CLIENT_MAX_BATCH, CLIENT_MAX_PAGE]).toEqual([100, 1_000]);
      expect(DEFAULT_TUNING).toMatchObject({
        pullEntriesPerCycle: 20_000,
        undecryptableKeep: 1_000,
        unsupportedEnvelopeKeep: 1_000,
      });
    });

    it.each<Shape>(['unknown v', 'unopenable', 'empty'])(
      'ends a cycle whose pages (%s) say more forever, and keeps the caps page by page',
      async (shape) => {
        const h = await setup({ limits: { max_page: 10 } });
        const sinces: number[] = [];
        let mostKept = 0;
        const engine = engineWith(h, async (_groupId, _token, since, limit) => {
          sinces.push(since);
          const { byStatus } = await h.store.countByStatus(h.keys.localId);
          mostKept = Math.max(mostKept, byStatus.undecryptable, byStatus.unsupported_envelope);
          const events = pageOf(h, shape, since, limit);
          return { events, next: since + Math.max(1, events.length), more: true, epoch: 'e' };
        });

        const failed = expectFailed(await engine.syncGroup(h.keys.localId, foreground));

        expect(failed.error).toBe('server_error');
        expect(sinces).toHaveLength(6); // each page is charged the 10 it asked for: 6 × 10 = 60
        expect(mostKept).toBeLessThanOrEqual(5);
        const { byStatus } = await h.store.countByStatus(h.keys.localId);
        expect(byStatus.undecryptable + byStatus.unsupported_envelope).toBe(
          shape === 'empty' ? 0 : 5,
        );
        // What was pulled is committed: the next cycle carries on from there.
        const cursor = (await h.store.getGroup(h.keys.localId))?.cursor;
        expect(cursor).toBe(shape === 'empty' ? 6 : 60);
        expectFailed(await engine.syncGroup(h.keys.localId, manual));
        expect(sinces[6]).toBe(cursor);
        expect(sinces).toHaveLength(12);
      },
    );

    it('a page bigger than asked for is charged what it brought', async () => {
      const h = await setup({ limits: { max_page: 10 } });
      const sinces: number[] = [];
      const engine = engineWith(h, async (_groupId, _token, since) => {
        sinces.push(since);
        const events = pageOf(h, 'unknown v', since, 30);
        return { events, next: since + events.length, more: true, epoch: 'e' };
      });
      expect(expectFailed(await engine.syncGroup(h.keys.localId, foreground)).error).toBe(
        'server_error',
      );
      expect(sinces).toEqual([0, 30]);
    });

    it('a whole group pulled before and after one epoch reset fits a budget of twice the group', async () => {
      const h = await setup({ limits: { max_page: 2 }, tuning: { pullEntriesPerCycle: 20 } });
      await writeMany(h, 10);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const b = await h.device();
      let pulls = 0;
      h.server.onRequest = (request) => {
        // The epoch changes as B asks for the last page: the whole group comes again after the reset.
        if (request.op === 'pull' && ++pulls === 5) h.server.setEpoch(h.keys.groupId);
      };
      const joined = expectSynced(
        await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }),
      );
      expect(joined.epochResets).toBe(1);
      expect(pulls).toBe(10);
      expect((await b.store.countByStatus(h.keys.localId)).byStatus.ok).toBe(10);
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
      // One MAX(ts) per group, not a scan of every envelope.
      expect(h.store.calls.filter((c) => c === 'latestTs')).toHaveLength(3);
      expect(h.store.calls).not.toContain('listEnvelopes');

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

      expect(await h.engine.syncGroup(h.keys.localId, manual)).toMatchObject({
        reason: 'in_flight',
      });
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

  describe('converging', () => {
    it('two devices converge, with acks, seq and cursor', async () => {
      const h = await setup({ limits: { max_batch: 2, max_page: 3 } });
      await writeLocal(h.store, h.keys, h.ev.created('Real store', 'EUR'));
      await writeMany(h, 4);
      expect(expectSynced(await h.engine.syncGroup(h.keys.localId, foreground)).pushed).toBe(5);

      const b = await h.device();
      const joined = expectSynced(
        await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }),
      );
      expect(joined).toMatchObject({ pulled: 5, epochResets: 0 });
      expect(await b.store.getGroup(h.keys.localId)).toMatchObject({ cursor: 5 });

      await writeMany(h, 2, b.store);
      expectSynced(await b.engine.syncGroup(h.keys.localId, foreground));
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

      const onServer = h.server
        .stored(h.keys.groupId)
        .map((e) => e.id)
        .sort();
      for (const d of [h, b]) {
        const counts = await d.store.countByStatus(h.keys.localId);
        expect(counts).toMatchObject({ outbox: 0, rejected: 0 });
        expect(counts.byStatus.ok).toBe(7);
        expect((await d.store.getGroup(h.keys.localId))?.cursor).toBe(7);
        expect((await d.store.listEnvelopes(h.keys.localId)).map((r) => r.id).sort()).toEqual(
          onServer,
        );
      }
    });

    it('self-heals a deleted server copy twice: through a null epoch, then a new one', async () => {
      const h = await setup();
      const ids = await writeMany(h, 3);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

      h.server.wipe(h.keys.groupId);
      expect(expectSynced(await h.engine.syncGroup(h.keys.localId, refresh)).epochResets).toBe(1);
      h.server.wipe(h.keys.groupId);
      ids.push(...(await writeMany(h, 1)));
      expect(expectSynced(await h.engine.syncGroup(h.keys.localId, refresh)).epochResets).toBe(1);

      expect(
        h.server
          .stored(h.keys.groupId)
          .map((e) => e.id)
          .sort(),
      ).toEqual([...ids].sort());
      expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
        epoch: h.server.groups.get(h.keys.groupId)?.epoch,
        cursor: 4,
        epochResetsThisCycle: 0,
      });
    });

    it('keeps a quarantined row out of the outbox across an epoch reset', async () => {
      const h = await setup();
      const ids = await writeMany(h, 3);
      h.server.failNext('push', { code: 'invalid_envelope', index: 0 });
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      h.server.wipe(h.keys.groupId);
      expectSynced(await h.engine.syncGroup(h.keys.localId, refresh));

      expect(h.server.stored(h.keys.groupId).map((e) => e.id)).toEqual(ids.slice(1));
      expect(await h.store.countByStatus(h.keys.localId)).toMatchObject({ outbox: 0, rejected: 1 });
    });
  });

  describe('received_at (design.md "Ordering", "Local storage")', () => {
    const receivedOf = async (store: TestStore, localId: string) =>
      new Map((await store.dump(localId)).map((r) => [r.id, r.receivedAt]));

    it('stores R from the push response and from every pulled page, one value per request', async () => {
      const h = await setup();
      const first = await writeMany(h, 2);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const r1 = h.server.receivedAt(h.keys.groupId).get(first[0]!);
      expect(typeof r1).toBe('number');
      await h.clock.sleep(5_000);
      const second = await writeMany(h, 1);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const r2 = h.server.receivedAt(h.keys.groupId).get(second[0]!) as number;
      expect(r2).toBeGreaterThan(r1 as number);
      const mine = await receivedOf(h.store, h.keys.localId);
      expect([mine.get(first[0]!), mine.get(first[1]!), mine.get(second[0]!)]).toEqual([
        r1,
        r1,
        r2,
      ]);
      // The push response alone supplies it, before any pull brings the envelope back.
      const pushOnly = await writeMany(h, 1);
      h.server.failNext('pull', { code: 'server_error' }, 3);
      await h.engine.syncGroup(h.keys.localId, foreground);
      expect((await receivedOf(h.store, h.keys.localId)).get(pushOnly[0]!)).toBe(
        h.server.receivedAt(h.keys.groupId).get(pushOnly[0]!),
      );

      // Another device pulls the same values: the envelopes are ok rows, not junk for an extra field.
      const b = await h.device();
      expectSynced(await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }));
      const theirs = await receivedOf(b.store, h.keys.localId);
      for (const [id, r] of h.server.receivedAt(h.keys.groupId)) expect(theirs.get(id)).toBe(r);
      expect((await b.store.dump(h.keys.localId)).every((r) => r.status === 'ok')).toBe(true);
    });

    it('a duplicate push reports the stored R, which overwrites what the phone held', async () => {
      const h = await setup();
      const shared = sealFor(h.keys, h.ev.expense('Shared'));
      await h.server.transport().push(h.keys.groupId, h.keys.token, [shared]);
      const stored = h.server.receivedAt(h.keys.groupId).get(shared.id);
      await h.clock.sleep(60_000);
      await h.store.insertEvents(h.keys.localId, [
        {
          id: shared.id,
          origin: 'remote',
          acked: false,
          seq: null,
          ts: 1_760_000_000_500,
          envelope: JSON.stringify(shared),
          status: 'ok',
          receivedAt: h.clock.now(),
        },
      ]);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      expect((await receivedOf(h.store, h.keys.localId)).get(shared.id)).toBe(stored);
    });

    it('is cleared with seq on an epoch reset, and the re-push assigns the new epoch its own', async () => {
      const h = await setup();
      const ids = await writeMany(h, 3);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const before = await receivedOf(h.store, h.keys.localId);
      h.server.wipe(h.keys.groupId);
      await h.clock.sleep(3_600_000);
      // The pull finds the copy gone and resets; the re-push after it gets no answer, so the cycle stops there.
      h.server.onRequest = (request) => {
        if (request.op === 'push') throw new SyncError('network', 'offline');
      };
      expectFailed(await h.engine.syncGroup(h.keys.localId, manual));
      const cleared = await h.store.dump(h.keys.localId);
      expect(cleared.map((r) => [r.acked, r.seq, r.receivedAt])).toEqual(
        ids.map(() => [false, null, null]),
      );
      h.server.onRequest = null;
      expectSynced(await h.engine.syncGroup(h.keys.localId, manual));
      const after = await receivedOf(h.store, h.keys.localId);
      for (const id of ids) {
        expect(after.get(id)).toBe(h.server.receivedAt(h.keys.groupId).get(id));
        expect(after.get(id)).toBeGreaterThan(before.get(id) as number);
      }
    });

    it('a move clears it and the new server assigns its own', async () => {
      const h = await setup();
      const ids = await writeMany(h, 2);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const next = h.addServer(NEW);
      await h.clock.sleep(60_000);
      const moved = await h.engine.moveServer(h.keys.localId, NEW);
      expect(moved).toMatchObject({ outcome: 'moved', sync: { outcome: 'synced' } });
      const newKeys = groupKeys(NEW, h.keys.secret);
      const after = await receivedOf(h.store, h.keys.localId);
      for (const id of ids) expect(after.get(id)).toBe(next.receivedAt(newKeys.groupId).get(id));
    });

    it('a server from before received_at: rows keep none and sync as before', async () => {
      const h = await setup();
      h.server.legacy = true;
      await writeMany(h, 2);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const b = await h.device();
      expectSynced(await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }));
      for (const store of [h.store, b.store]) {
        const rows = await store.dump(h.keys.localId);
        expect(rows.every((r) => r.receivedAt === null && r.acked && r.status === 'ok')).toBe(true);
      }
    });

    it('an unusable R from the server is treated as absent, on push and on pull', async () => {
      for (const bad of [0.5, LIMITS.tsMax, LIMITS.tsMin - 1, 'soon', null]) {
        const h = await setup();
        h.server.arrival = () => bad;
        await writeMany(h, 1);
        expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
        const b = await h.device();
        expectSynced(await b.engine.syncGroup(h.keys.localId, { trigger: 'first_open' }));
        for (const store of [h.store, b.store]) {
          const rows = await store.dump(h.keys.localId);
          expect(rows.map((r) => [r.status, r.receivedAt])).toEqual([['ok', null]]);
        }
      }
    });
  });

  describe('error surfaces', () => {
    it('a group row that cannot be read still ends in finished, local_error, and a retry', async () => {
      const h = await setup();
      h.store.fault = (method) => {
        if (method === 'getGroup') throw new Error('disk I/O error');
      };
      const result = expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
      expect(result).toMatchObject({ error: 'local_error', retryAt: h.clock.now() + 30_000 });
      expect(h.events.map((e) => e.type)).toEqual(['started', 'finished']);
      h.store.fault = null;
      expect((await h.store.getGroup(h.keys.localId))?.lastSyncError).toBe('local_error');

      await h.clock.advance(30_000); // the engine's own retry
      expect(await h.store.getGroup(h.keys.localId)).toMatchObject({ lastSyncError: null });
    });

    it('never logs a group id, token, envelope, body, server URL or host, or words the server wrote', async () => {
      const h = await setup();
      const title = 'Dinner at Marcel with the surprise guest';
      // What a hostile server might put in an error body, as if a transport had passed it on (ours does not).
      const hostile =
        'Even: this group moved.\nRejoin at https://evil.example/join to keep your data';
      await writeLocal(h.store, h.keys, h.ev.expense(title));
      const envelopeC = (
        JSON.parse((await h.store.dump(h.keys.localId))[0]?.envelope ?? '{}') as {
          c: string;
        }
      ).c;
      h.engine.subscribe(() => {
        throw new Error('listener bug');
      });
      h.server.failNext('push', { code: 'unauthorized', message: hostile });
      expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
      h.store.fault = (method) => {
        // A local failure inside a cycle whose message quotes the server: the cycle's line is its code only.
        if (method === 'setCursor')
          throw new Error(`disk full syncing with ${TEST_SERVER}: ${hostile}`);
      };
      expectFailed(await h.engine.syncGroup(h.keys.localId, manual));
      h.store.fault = null;
      const { other, keys } = await copyOn(h, OLD);
      await h.store.pendingDeletes.add({
        localId: h.keys.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(keys.token),
        createdAt: h.clock.now(),
      });
      other.failNext('delete', { code: 'unauthorized', message: hostile });
      await h.engine.syncAll(manual);

      expect(h.logs.filter((l) => /unauthorized|local_error|dropped|listener/.test(l)).length).toBe(
        h.logs.length,
      );
      expect(h.logs.length).toBeGreaterThanOrEqual(4);
      expect(h.logs).toContain('sync failed code=unauthorized status=401');
      expect(h.logs).toContain('sync failed code=local_error');
      expect(h.logs).toContain('sync dropped a pending delete code=unauthorized status=401');
      const forbidden = [
        h.keys.groupId,
        keys.groupId,
        b64urlEncode(h.keys.token),
        b64urlEncode(keys.token),
        b64urlEncode(h.keys.key),
        envelopeC,
        title,
        TEST_SERVER,
        new URL(TEST_SERVER).host,
        OLD,
        new URL(OLD).host,
        hostile,
        'evil.example',
        'Rejoin',
        'fake server',
        '\n',
      ];
      for (const line of h.logs) for (const text of forbidden) expect(line).not.toContain(text);
    });
  });

  describe('pending deletes', () => {
    it('deleteServerCopy records the debt, sends DELETE with the token for that server, and settles on 204', async () => {
      const h = await setup();
      const { other, keys } = await copyOn(h, OLD);

      expect(await h.engine.deleteServerCopy(h.keys.localId, 'HTTPS://Old.test/')).toEqual({
        outcome: 'deleted',
      });

      expect(other.requests.filter((r) => r.op === 'delete')).toEqual([
        { op: 'delete', groupId: keys.groupId },
      ]);
      expect(groupIdForToken(keys.token)).toBe(keys.groupId);
      expect(other.groups.has(keys.groupId)).toBe(false);
      expect(h.store.calls.filter((c) => c.startsWith('pendingDeletes.'))).toEqual([
        'pendingDeletes.add',
        'pendingDeletes.remove',
      ]);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
    });

    it('refuses the server an active group syncs through, a bad URL, and a missing secret', async () => {
      const h = await setup();
      h.addServer(OLD);
      expect(await h.engine.deleteServerCopy(h.keys.localId, TEST_SERVER)).toEqual({
        outcome: 'failed',
        error: 'current_server',
      });
      expect(await h.engine.deleteServerCopy(h.keys.localId, 'http://old.test')).toEqual({
        outcome: 'failed',
        error: 'invalid_url',
      });
      h.secrets.items.clear();
      expect(await h.engine.deleteServerCopy(h.keys.localId, OLD)).toEqual({
        outcome: 'failed',
        error: 'no_secret',
      });
      expect(h.server.requests).toEqual([]);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
    });

    it('Leave in order (rows, then the copy on the current server, then the secret) deletes the copy', async () => {
      const h = await setup();
      await writeMany(h, 2);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      expect(h.server.groups.has(h.keys.groupId)).toBe(true);

      await h.store.deleteGroup(h.keys.localId);
      expect(await h.engine.deleteServerCopy(h.keys.localId, TEST_SERVER)).toEqual({
        outcome: 'deleted',
      });
      await h.secrets.deleteSecret(h.keys.localId);

      expect(h.server.groups.has(h.keys.groupId)).toBe(false);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
    });

    it('keeps the debt when the server is unreachable, and pays it with the stored token after Leave', async () => {
      const h = await setup();
      const { other, keys } = await copyOn(h, OLD);
      other.offline = true;
      expect(await h.engine.deleteServerCopy(h.keys.localId, OLD)).toEqual({ outcome: 'pending' });
      expect(await h.store.pendingDeletes.list()).toEqual([
        {
          localId: h.keys.localId,
          serverUrl: OLD,
          authToken: b64urlEncode(keys.token),
          createdAt: h.clock.now(),
          attempts: 1,
        },
      ]);

      // Leave: the row and the secret go; the debt stays.
      await h.store.deleteGroup(h.keys.localId);
      await h.secrets.deleteSecret(h.keys.localId);
      other.offline = false;
      expect(await h.engine.syncAll(foreground)).toEqual([]);

      expect(other.groups.has(keys.groupId)).toBe(false);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
    });

    it.each<[string, 'kept' | 'paid' | 'dropped', ScriptedFailure]>([
      ['no response', 'kept', { code: 'network' }],
      ['500', 'kept', { code: 'server_error' }],
      ['429', 'kept', { code: 'rate_limited', retryAfterMs: 60_000 }],
      ['503 over_budget', 'kept', { code: 'over_budget', retryAfterMs: 60_000 }],
      ['404', 'paid', { code: 'not_an_even_server', status: 404 }],
      ['401', 'dropped', { code: 'unauthorized' }],
      ['410', 'dropped', { code: 'group_blocked' }],
      ['405', 'dropped', { code: 'not_an_even_server', status: 405 }],
    ])('a DELETE answered with %s: the debt is %s', async (_answer, expected, failure) => {
      const h = await setup();
      const { other, keys } = await copyOn(h, OLD);
      const debt = {
        localId: h.keys.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(keys.token),
        createdAt: h.clock.now(),
      };
      await h.store.pendingDeletes.add(debt);
      other.failNext('delete', failure);

      await h.engine.syncAll(foreground);

      expect(other.requests.filter((r) => r.op === 'delete')).toHaveLength(1);
      expect(await h.store.pendingDeletes.list()).toEqual(
        expected === 'kept' ? [{ ...debt, attempts: 1 }] : [],
      );
      expect(h.logs.some((l) => l.includes('dropped a pending delete'))).toBe(
        expected === 'dropped',
      );
    });

    it('gives a debt up at its 20th failed attempt; the copy stays until the server expires it (review L3)', async () => {
      const h = await setup();
      expect(DEFAULT_TUNING).toMatchObject({
        debtMaxAttempts: 20,
        debtMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
      });
      const { other, keys } = await copyOn(h, OLD);
      await h.store.pendingDeletes.add({
        localId: h.keys.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(keys.token),
        createdAt: h.clock.now(),
      });
      other.failNext('delete', { code: 'server_error' }, 20);

      for (let i = 1; i < 20; i++) await h.engine.syncAll(foreground);
      expect(await h.store.pendingDeletes.list()).toMatchObject([{ attempts: 19 }]);
      expect(h.logs.some((l) => l.includes('gave up'))).toBe(false);

      await h.engine.syncAll(foreground);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
      expect(other.requests.filter((r) => r.op === 'delete')).toHaveLength(20);
      expect(h.logs).toContain('sync gave up a pending delete code=server_error status=500');
      expect(other.groups.has(keys.groupId)).toBe(true);
    });

    it('gives a debt up at its first failed attempt 30 days after it was recorded, and still pays one that answers', async () => {
      const h = await setup();
      const day = 24 * 60 * 60 * 1000;
      const { other, keys } = await copyOn(h, OLD);
      const debt = {
        localId: h.keys.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(keys.token),
        createdAt: h.clock.now() - 30 * day + 1,
      };
      await h.store.pendingDeletes.add(debt);
      other.offline = true;

      await h.engine.syncAll(foreground);
      expect(await h.store.pendingDeletes.list()).toEqual([{ ...debt, attempts: 1 }]);
      await h.clock.advance(1);
      await h.engine.syncAll(foreground);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
      expect(h.logs).toContain('sync gave up a pending delete code=network');
      expect(other.groups.has(keys.groupId)).toBe(true);

      // Older than that, a server that answers is still paid: the age only ends a failing debt.
      other.offline = false;
      await h.store.pendingDeletes.add({ ...debt, createdAt: h.clock.now() - 40 * day });
      await h.engine.syncAll(foreground);
      expect(await h.store.pendingDeletes.list()).toEqual([]);
      expect(other.groups.has(keys.groupId)).toBe(false);
    });

    it('a group cycle pays that group’s debts before pushing; syncAll tries each debt once', async () => {
      const h = await setup();
      const mine = await copyOn(h, OLD);
      const stranger = groupKeys(OLD); // a group this phone left long ago
      const strangerDebt = {
        localId: stranger.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(stranger.token),
        createdAt: h.clock.now(),
      };
      const myDebt = {
        localId: h.keys.localId,
        serverUrl: OLD,
        authToken: b64urlEncode(mine.keys.token),
        createdAt: h.clock.now(),
      };
      await h.store.pendingDeletes.add(strangerDebt);
      await h.store.pendingDeletes.add(myDebt);
      await writeMany(h, 1);
      const order: string[] = [];
      mine.other.onRequest = (r) => order.push(`old:${r.op}:${r.groupId}`);
      h.server.onRequest = (r) => order.push(`current:${r.op}`);

      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));

      expect(order).toEqual([
        `old:delete:${mine.keys.groupId}`,
        'current:info',
        'current:push',
        'current:pull',
      ]);
      expect(await h.store.pendingDeletes.list()).toEqual([{ ...strangerDebt, attempts: 0 }]);

      // Unpaid debts are tried once by syncAll, and not again by the group cycles it runs.
      await h.store.pendingDeletes.add(myDebt);
      mine.other.failNext('delete', { code: 'network' }, 10);
      order.length = 0;
      await h.engine.syncAll(manual);
      expect(order.filter((o) => o.startsWith('old:'))).toEqual([
        `old:delete:${stranger.groupId}`,
        `old:delete:${mine.keys.groupId}`,
      ]);
      expect(await h.store.pendingDeletes.list()).toHaveLength(2);
    });
  });

  describe('moveServer', () => {
    it('re-encrypts the readable log for the new group id, drops the unreadable, and pushes it all', async () => {
      const h = await setup();
      await writeLocal(h.store, h.keys, h.ev.created('Banff 2026', 'CAD'));
      await writeMany(h, 2);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const b = await h.device();
      await writeMany(h, 2, b.store);
      expectSynced(await b.engine.syncGroup(h.keys.localId, foreground));
      // Unreadable entries on the old server: another group's ciphertext and a future envelope version.
      h.server.injectRaw(h.keys.groupId, sealFor(groupKeys(), h.ev.expense('Elsewhere')));
      h.server.injectRaw(h.keys.groupId, { ...sealFor(h.keys, h.ev.expense('Future')), v: 2 });
      expectSynced(await h.engine.syncGroup(h.keys.localId, refresh));
      const before = new Map((await h.store.dump(h.keys.localId)).map((r) => [r.id, r]));
      expect(before.size).toBe(7);

      const next = h.addServer(NEW);
      const moved = groupKeys(NEW, h.keys.secret);
      // A debt to delete the copy on the new home must not survive the move (it would wipe that copy).
      await h.store.pendingDeletes.add({
        localId: h.keys.localId,
        serverUrl: NEW,
        authToken: b64urlEncode(moved.token),
        createdAt: h.clock.now(),
      });
      h.events.length = 0;

      const result = await h.engine.moveServer(h.keys.localId, ' HTTPS://New.test/ ');

      expect(result).toMatchObject({
        localId: h.keys.localId,
        outcome: 'moved',
        serverUrl: NEW,
        dropped: 2,
        sync: { outcome: 'synced', pushed: 5, epochResets: 0 },
      });
      expect(h.events.map((e) => `${e.type}:${e.trigger}`)).toEqual([
        'started:server_move',
        'finished:server_move',
      ]);
      const rows = await h.store.dump(h.keys.localId);
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        const old = before.get(row.id);
        if (old === undefined) throw new Error(`row ${row.id} appeared from nowhere`);
        expect(row.envelope).not.toBe(old.envelope);
        const body = parseEvent(
          open({ key: h.keys.key, groupId: moved.groupId, envelope: JSON.parse(row.envelope) }),
        );
        const oldBody = parseEvent(
          open({ key: h.keys.key, groupId: h.keys.groupId, envelope: JSON.parse(old.envelope) }),
        );
        expect(body).not.toBeNull();
        expect(body).toEqual(oldBody);
        expect(row).toMatchObject({ origin: old.origin, ts: old.ts, status: 'ok', acked: true });
      }
      expect(
        next
          .stored(moved.groupId)
          .map((e) => e.id)
          .sort(),
      ).toEqual(rows.map((r) => r.id).sort());
      expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
        serverUrl: NEW,
        epoch: next.groups.get(moved.groupId)?.epoch,
        cursor: 5,
        lastSyncError: null,
      });
      expect(await h.store.pendingDeletes.list()).toEqual([]);
      expect(next.requests.some((r) => r.op === 'delete')).toBe(false);

      // B follows; both read the same log from the new server.
      expect(await b.engine.moveServer(h.keys.localId, NEW)).toMatchObject({
        outcome: 'moved',
        dropped: 0,
        sync: { outcome: 'synced' },
      });
      expect(next.stored(moved.groupId)).toHaveLength(5);
      expect((await b.store.dump(h.keys.localId)).map((r) => r.id).sort()).toEqual(
        rows.map((r) => r.id).sort(),
      );
    });

    it('re-encrypts an unsupported body byte for byte, integer literals past 2^53 included', async () => {
      const h = await setup();
      await writeMany(h, 1);
      // A newer client's event (sv 2) holding 2^60 and 2^60 + 1 as literals. The second is not a double, so
      // opening, parsing, and sealing it again would change the body.
      const future = {
        ...h.ev.expense('Future'),
        sv: 2,
        big: rawJson('1152921504606846976'),
        bigger: rawJson('1152921504606846977'),
      };
      const sealed = sealFor(h.keys, future);
      const text = plaintextOf(h.keys.key, h.keys.groupId, sealed);
      expect(text).toContain('"big":1152921504606846976,"bigger":1152921504606846977');
      h.server.injectRaw(h.keys.groupId, sealed);
      expectSynced(await h.engine.syncGroup(h.keys.localId, foreground));
      const rowOf = async () =>
        (await h.store.dump(h.keys.localId)).find((r) => r.id === sealed.id);
      expect(await rowOf()).toMatchObject({ status: 'unsupported_body' });
      const next = h.addServer(NEW);
      const moved = groupKeys(NEW, h.keys.secret);

      expect(await h.engine.moveServer(h.keys.localId, NEW)).toMatchObject({
        outcome: 'moved',
        dropped: 0,
        sync: { outcome: 'synced', pushed: 2 },
      });

      const row = await rowOf();
      expect(row).toMatchObject({ status: 'unsupported_body', acked: true });
      const envelope = JSON.parse(row?.envelope ?? '') as Envelope;
      expect(envelope).toMatchObject({ id: sealed.id, v: 1 });
      expect(envelope.n).not.toBe(sealed.n);
      expect(plaintextOf(h.keys.key, moved.groupId, envelope)).toBe(text);
      const pushed = next.stored(moved.groupId).find((e) => e.id === sealed.id);
      expect(pushed).toMatchObject(envelope);
    });

    it('moves a blocked group and makes it active again', async () => {
      const h = await setup();
      await writeMany(h, 1);
      h.server.blocked.add(h.keys.groupId);
      expectFailed(await h.engine.syncGroup(h.keys.localId, foreground));
      expect((await h.store.getGroup(h.keys.localId))?.state).toBe('blocked');
      h.addServer(NEW);

      expect(await h.engine.moveServer(h.keys.localId, NEW)).toMatchObject({
        outcome: 'moved',
        sync: { outcome: 'synced', pushed: 1 },
      });
      expect(await h.store.getGroup(h.keys.localId)).toMatchObject({
        state: 'active',
        serverUrl: NEW,
        lastSyncError: null,
      });
    });

    it('refuses a bad URL, the same server, closed and hidden groups, and a missing secret, changing nothing', async () => {
      const h = await setup();
      await writeMany(h, 2);
      h.addServer(NEW);
      const refused = (error: string) => ({ localId: h.keys.localId, outcome: 'failed', error });

      expect(await h.engine.moveServer(h.keys.localId, 'http://new.test')).toEqual(
        refused('invalid_url'),
      );
      expect(await h.engine.moveServer(h.keys.localId, `${TEST_SERVER}/`)).toEqual(
        refused('same_server'),
      );
      const stranger = groupKeys();
      expect(await h.engine.moveServer(stranger.localId, NEW)).toEqual({
        localId: stranger.localId,
        outcome: 'failed',
        error: 'not_found',
      });
      for (const state of ['closed', 'hidden'] as const) {
        await h.store.setGroupState(h.keys.localId, state);
        expect(await h.engine.moveServer(h.keys.localId, NEW)).toEqual(refused('not_movable'));
      }
      await h.store.setGroupState(h.keys.localId, 'active');
      h.secrets.items.clear();
      expect(await h.engine.moveServer(h.keys.localId, NEW)).toEqual(refused('no_secret'));

      expect(h.store.calls).not.toContain('setServer');
      expect(await h.store.getGroup(h.keys.localId)).toMatchObject({ serverUrl: TEST_SERVER });
    });

    it('waits for a running cycle, skips syncs asked for meanwhile, and covers them with its own push', async () => {
      const h = await setup();
      await writeMany(h, 1);
      const next = h.addServer(NEW);
      const release = h.server.hold();
      const running = h.engine.syncGroup(h.keys.localId, foreground);
      await settle();

      const move = h.engine.moveServer(h.keys.localId, NEW);
      expect(await h.engine.syncGroup(h.keys.localId, refresh)).toEqual({
        localId: h.keys.localId,
        outcome: 'skipped',
        reason: 'in_flight',
      });
      expect(await h.engine.moveServer(h.keys.localId, NEW)).toMatchObject({
        outcome: 'failed',
        error: 'in_flight',
      });
      await writeMany(h, 1); // written while the move waits: must reach the new server too
      release();

      expectSynced(await running);
      expect(await move).toMatchObject({ outcome: 'moved', sync: { outcome: 'synced' } });
      expect(next.stored(groupKeys(NEW, h.keys.secret).groupId)).toHaveLength(2);
    });

    it('a readable row that no longer opens fails the move as local_error and changes nothing', async () => {
      const h = await setup();
      await writeMany(h, 1);
      // Sealed for another server's group id but stored as readable: what a write racing an older move leaves.
      const stray = sealFor(
        groupKeys('https://elsewhere.test', h.keys.secret),
        h.ev.expense('Stray'),
      );
      await h.store.insertEvents(h.keys.localId, [
        {
          id: stray.id,
          origin: 'local',
          acked: false,
          seq: null,
          ts: h.clock.now(),
          envelope: JSON.stringify(stray),
          status: 'ok',
        },
      ]);
      h.addServer(NEW);
      const before = await h.store.dump(h.keys.localId);

      expect(await h.engine.moveServer(h.keys.localId, NEW)).toEqual({
        localId: h.keys.localId,
        outcome: 'failed',
        error: 'local_error',
      });
      expect(await h.store.dump(h.keys.localId)).toEqual(before);
      expect((await h.store.getGroup(h.keys.localId))?.serverUrl).toBe(TEST_SERVER);
      expect(h.logs.some((l) => l.includes('could not move'))).toBe(true);
    });
  });
});
