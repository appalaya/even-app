/// <reference types="node" />
/**
 * The pre-launch review's large-group harness (docs/review-2026-10-01.md H3 and "The 10,000-event group"), recreated
 * so each change can be measured before and after. Skipped unless `EVEN_PERF` is set:
 *
 *   EVEN_PERF=1 npx vitest run src/state/largeGroup.perf.test.ts --silent=false                      # V8, JIT
 *   EVEN_PERF=1 npx vitest run src/state/largeGroup.perf.test.ts --silent=false --execArgv=--jitless # Hermes stand-in
 *
 * `EVEN_PERF_EVENTS` sets the size (default 10,000). The log is `src/dev/largeGroup.ts`'s mix, sealed with core,
 * stored through the real `SqliteStore` on node:sqlite, and read through the app's own services (`createAppServices`)
 * against the fake server, with a self-hosted server's larger caps so 10,000 events fit and the public server's
 * batch and page sizes.
 *
 * Each stage reports its time and its longest block: the longest stretch in which no timer could fire, which is
 * what a frame waits for. node:sqlite and the fake server answer synchronously, so here every SQL statement and
 * every request first yields once, as expo-sqlite (its own thread) and `fetch` do in the app; without that a whole
 * sync would read as one block.
 */
import {
  deriveLocal,
  deriveServer,
  encodeInvite,
  makeInvite,
  newSecret,
  seal,
  type Envelope,
} from '@even/core';
import { describe, expect, it } from 'vitest';

import { largeGroup, type LargeGroup } from '../dev/largeGroup';
import { createMemorySecrets, type MemorySecrets } from '../services/secrets/memorySecrets';
import { createDriver, type SqlConnection } from '../services/storage/driver';
import { openNodeConnection } from '../services/storage/nodeDriver';
import { openSqliteStore, type SqliteStore } from '../services/storage/sqliteStore';
import type { NewEventRow } from '../services/storage/types';
import type { Transport } from '../services/sync/types';
import { FakeClock } from '../services/testing/fakeClock';
import { FakeServer } from '../services/testing/fakeTransport';
import { GroupStateStore, type GroupListSnapshot } from './groupState';
import { createAppServices, type AppServices } from './services';

const RUN = process.env.EVEN_PERF !== undefined;
const EVENTS = Number(process.env.EVEN_PERF_EVENTS ?? 10_000);
const MODE = process.execArgv.includes('--jitless') ? 'V8 --jitless' : 'V8 with JIT';
const DAY = 24 * 60 * 60 * 1000;
const SERVER = 'https://sync.test';
const OTHER_SERVER = 'https://other.test';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** node:sqlite, answering a turn later, as expo-sqlite does from its own thread. */
function asyncConnection(inner: SqlConnection): SqlConnection {
  return {
    exec: async (sql) => {
      await turn();
      return inner.exec(sql);
    },
    run: async (sql, params) => {
      await turn();
      return inner.run(sql, params);
    },
    all: async (sql, params) => {
      await turn();
      return inner.all(sql, params);
    },
    close: () => inner.close(),
  };
}

/** The fake server, answering a turn later, as `fetch` does. */
function asyncTransport(inner: Transport): Transport {
  return {
    info: async () => (await turn(), inner.info()),
    push: async (...args) => (await turn(), inner.push(...args)),
    pull: async (...args) => (await turn(), inner.pull(...args)),
    delete: async (...args) => (await turn(), inner.delete(...args)),
  };
}

function openStore(): Promise<SqliteStore> {
  return openSqliteStore(createDriver(asyncConnection(openNodeConnection())));
}

interface Measured<T> {
  value: T;
  ms: number;
  blockMs: number;
}

/** Times `fn` and the longest stretch during it in which no timer could fire. */
async function measure<T>(fn: () => Promise<T> | T): Promise<Measured<T>> {
  let last = performance.now();
  let block = 0;
  let running = true;
  const tick = (): void => {
    const now = performance.now();
    block = Math.max(block, now - last);
    last = now;
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const start = performance.now();
  const value = await fn();
  const ms = performance.now() - start;
  running = false;
  tick();
  return { value, ms, blockMs: block };
}

interface Sealed {
  secret: Uint8Array;
  localId: string;
  envelopes: Envelope[];
  rows: NewEventRow[];
}

function sealGroup(group: LargeGroup, serverUrl: string): Sealed {
  const secret = newSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, serverUrl);
  const envelopes = group.entries.map(({ id, event }) => seal({ key, groupId, body: event, id }));
  const rows = envelopes.map((envelope, i) => ({
    id: envelope.id,
    origin: 'remote' as const,
    acked: true,
    seq: i + 1,
    ts: group.entries[i]?.event.ts ?? null,
    envelope: JSON.stringify(envelope),
    status: 'ok' as const,
  }));
  return { secret, localId, envelopes, rows };
}

async function storeGroup(
  store: SqliteStore,
  group: LargeGroup,
  sealed: Sealed,
  createdAt: number,
): Promise<void> {
  await store.upsertGroup({
    localId: sealed.localId,
    serverUrl: SERVER,
    epoch: null,
    cursor: sealed.rows.length,
    myMemberId: group.members[4]?.id ?? null,
    nameCache: group.name,
    currencyCache: group.currency,
    createdAt,
    lastSyncedAt: createdAt,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
    creationId: null,
  });
  await store.insertEvents(sealed.localId, sealed.rows);
}

describe.skipIf(!RUN)(`a ${EVENTS.toLocaleString('en-US')}-event group, ${MODE}`, () => {
  it('opens, lists, joins, moves, rotates and meters it', { timeout: 30 * 60_000 }, async () => {
    const table: { stage: string; ms: number; blockMs: number | null }[] = [];
    const row = (stage: string, m: { ms: number; blockMs?: number }) =>
      table.push({ stage, ms: m.ms, blockMs: m.blockMs ?? null });

    const clock = new FakeClock();
    const servers = new Map<string, FakeServer>();
    for (const url of [SERVER, OTHER_SERVER]) {
      servers.set(url, new FakeServer({ max_group_bytes: 1 << 30, max_group_events: 1_000_000 }));
    }
    const server = (url: string): FakeServer => {
      const found = servers.get(url);
      if (found === undefined) throw new Error(`no fake server at ${url}`);
      return found;
    };
    const opened: { services: AppServices; store: SqliteStore }[] = [];
    const device = async (): Promise<{
      services: AppServices;
      store: SqliteStore;
      secrets: MemorySecrets;
    }> => {
      const store = await openStore();
      const secrets = createMemorySecrets();
      const services = await createAppServices({
        store,
        secrets,
        transportFor: (url) => asyncTransport(server(url).transport()),
        now: clock.now,
        sleep: clock.sleep,
        schedule: clock.schedule,
        log: () => undefined,
        locale: 'en-US',
      });
      await services.idle();
      opened.push({ services, store });
      return { services, store, secrets };
    };

    const now = clock.now();
    const group = largeGroup({ events: EVENTS, end: now - 10 * DAY });

    // ----- seal and store -----
    const sealing = await measure(() => sealGroup(group, SERVER));
    row(`seal ${EVENTS}`, sealing);
    const sealed = sealing.value;
    const bytes = sealed.envelopes.reduce((sum, e) => sum + Math.floor((e.c.length * 3) / 4), 0);

    const store = await openStore();
    row(
      `insertEvents ${EVENTS}`,
      await measure(() => storeGroup(store, group, sealed, now - 70 * DAY)),
    );

    // ----- open: decrypt + validate + reduce + balances -----
    const secrets = new Map<string, Uint8Array>([[sealed.localId, sealed.secret]]);
    const deps = {
      store,
      secrets: { getSecret: async (id: string) => secrets.get(id) ?? null },
      engine: { subscribe: () => () => undefined },
      locale: 'en-US',
      log: () => undefined,
    };
    const opening = new GroupStateStore(deps);
    const cold = await measure(() => opening.get(sealed.localId));
    expect(cold.value?.state?.expenses.size).toBeGreaterThan(EVENTS / 2);
    row('GroupStateStore.get, cold', cold);
    opening.invalidate(sealed.localId);
    row('re-derive, nothing new', await measure(() => opening.get(sealed.localId)));
    opening.dispose();

    // ----- the Groups list: this group (older) and four small ones with newer activity -----
    for (let i = 0; i < 4; i += 1) {
      const small = largeGroup({
        events: 150,
        end: now - i * DAY,
        seed: 100 + i,
        name: `Trip ${i}`,
      });
      const s = sealGroup(small, SERVER);
      secrets.set(s.localId, s.secret);
      await storeGroup(store, small, s, now - 30 * DAY);
    }
    const listing = new GroupStateStore(deps);
    let firstRowsAt: number | null = null;
    let allRowsAt: number | null = null;
    let newestAt: number | null = null;
    const started = performance.now();
    const listed = await measure(
      () =>
        new Promise<GroupListSnapshot>((resolve) => {
          const unsubscribe = listing.subscribeList(() => {
            const snapshot = listing.peekList();
            if (snapshot.status !== 'ready') return;
            const t = performance.now() - started;
            if (firstRowsAt === null && snapshot.rows.length === 5) firstRowsAt = t;
            if (newestAt === null && snapshot.rows[0]?.memberCount != null) newestAt = t;
            if (snapshot.rows.length === 5 && snapshot.rows.every((r) => r.memberCount !== null)) {
              allRowsAt = t;
              unsubscribe();
              resolve(snapshot);
            }
          });
        }),
    );
    expect(listed.value.rows.map((r) => r.name)).toEqual([
      'Trip 0',
      'Trip 1',
      'Trip 2',
      'Trip 3',
      group.name,
    ]);
    row('Groups list: five rows on screen', { ms: firstRowsAt ?? Number.NaN });
    row('Groups list: newest group filled', { ms: newestAt ?? Number.NaN });
    row('Groups list: every group filled', {
      ms: allRowsAt ?? Number.NaN,
      blockMs: listed.blockMs,
    });
    listing.dispose();
    await store.close();

    // ----- join: first sync of every page, name cache, lifecycle -----
    const { groupId, authToken } = deriveServer(sealed.secret, SERVER);
    const transport = server(SERVER).transport();
    const batch = server(SERVER).info.limits.max_batch;
    for (let i = 0; i < sealed.envelopes.length; i += batch) {
      await transport.push(groupId, authToken, sealed.envelopes.slice(i, i + batch));
    }
    const b = await device();
    const code = encodeInvite(
      makeInvite(sealed.secret, SERVER, { g: group.name, cur: group.currency }),
    );
    const join = await measure(async () => {
      const result = await b.services.groups.joinInvite(code);
      await b.services.idle();
      return result;
    });
    expect(join.value.kind).toBe('joined');
    expect((await b.services.groupState.get(sealed.localId))?.state?.expenses.size).toBe(
      cold.value?.state?.expenses.size,
    );
    row('join: first sync, name cache, lifecycle', join);

    // ----- usage meter -----
    const usage = await measure(() => b.services.groups.usage(sealed.localId));
    expect(usage.value?.usage.events).toBe(EVENTS);
    row('usage meter (groups.usage)', usage);

    // ----- move: reseal every envelope, then the full push; then the lifecycle's derive -----
    await b.store.setMyMember(sealed.localId, group.members[4]?.id ?? null);
    b.services.groupState.invalidate(sealed.localId);
    await b.services.groupState.get(sealed.localId);
    const move = await measure(async () => {
      const result = await b.services.engine.moveServer(sealed.localId, OTHER_SERVER);
      const moved = performance.now();
      await b.services.idle();
      await b.services.groupState.get(sealed.localId);
      return { result, derivedMs: performance.now() - moved };
    });
    expect(move.value.result.outcome).toBe('moved');
    row('engine.moveServer (reseal all, full push)', {
      ms: move.ms - move.value.derivedMs,
      blockMs: move.blockMs,
    });
    row('  then the derive after the move', { ms: move.value.derivedMs });

    // ----- rotation: reseal every envelope into a new group, push it, close the old one -----
    const rotate = await measure(async () => {
      const result = await b.services.groups.rotateInvite(sealed.localId);
      await b.services.idle();
      return result;
    });
    expect(rotate.value.localId).not.toBe(sealed.localId);
    row('groups.rotateInvite (reseal all, push, close)', rotate);

    for (const d of opened) {
      d.services.dispose();
      await d.store.close();
    }
    const cell = (n: number | null) => (n === null ? '' : Math.round(n).toLocaleString('en-US'));
    const lines = [
      `${EVENTS.toLocaleString('en-US')} events, ${MODE}, ${(bytes / EVENTS).toFixed(0)} B ciphertext/event; ` +
        `types ${JSON.stringify(group.counts)}`,
      '| Stage | ms | longest block, ms |',
      '|---|---:|---:|',
      ...table.map((r) => `| ${r.stage} | ${cell(r.ms)} | ${cell(r.blockMs)} |`),
    ];
    console.log(lines.join('\n'));
  });
});
