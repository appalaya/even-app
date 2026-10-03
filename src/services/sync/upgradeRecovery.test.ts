/**
 * Recovery from the builds before `received_at` (design.md "Migrations", v5). Once the server half went live, those
 * builds took every pulled envelope carrying `received_at` for junk: `classifyPulled` stripped only `seq`, so the
 * extra key failed `envelopeShape`, the row was stored `undecryptable` (its text the envelope with the server's
 * fields) and the cursor moved past it. The server still holds every event. Upgrading must bring them back on its
 * own: v5 sets every cursor to 0, the next sync pulls the whole log again, each readable envelope replaces the junk
 * row of its id, and every row gets its R. Unsent writes stay unsent and are pushed as usual. Both stores: the real
 * one upgraded from an actual v4 database, the fake one from its v4 state.
 */
import { open, parseEvent, type Envelope } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { SqlDriver } from '../storage/driver';
import { storedSizeOfText } from '../storage/envelopeSize';
import { openNodeDriver } from '../storage/nodeDriver';
import { migrate, MIGRATIONS } from '../storage/schema';
import { envelopeText, openSqliteStore } from '../storage/sqliteStore';
import type { GroupRow, NewEventRow, Store } from '../storage/types';
import { FakeClock } from '../testing/fakeClock';
import { FakeSecrets } from '../testing/fakeSecrets';
import { createFakeStore } from '../testing/fakeStore';
import { FakeServer } from '../testing/fakeTransport';
import { Events, groupKeys, groupRow, sealFor, TEST_SERVER } from '../testing/fixtures';
import { STORE_KINDS, type StoreKind } from '../testing/testStore';
import { createSyncEngine } from './engine';
import type { StoredEnvelope } from './types';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

/** What a build before received_at stored for a pulled envelope that carried it (its `classifyPulled`). */
function junkRowOf(pulled: StoredEnvelope): NewEventRow {
  const { seq, ...rest } = pulled as unknown as Record<string, unknown>;
  const full = JSON.stringify(rest);
  const id = pulled.id;
  return {
    id,
    origin: 'remote',
    acked: true,
    seq: seq as number,
    ts: null,
    envelope:
      full.length <= 4096
        ? full
        : JSON.stringify({ id, truncated: true, raw: full.slice(0, 2048) }),
    status: 'undecryptable',
  };
}

/** A schema-v4 store holding `group` and `rows` as the old build left them, and how to open it as this build does. */
async function storeAtV4(
  kind: StoreKind,
  group: GroupRow,
  rows: readonly NewEventRow[],
): Promise<() => Promise<Store>> {
  if (kind === 'fake') {
    const fake = createFakeStore({ schemaVersion: 4 });
    await fake.upsertGroup(group);
    await fake.insertEvents(group.localId, rows);
    return async () => {
      await fake.migrate();
      return fake;
    };
  }
  const driver: SqlDriver = openNodeDriver();
  await migrate(driver, MIGRATIONS.slice(0, 4));
  const columns = Object.keys(group).length;
  await driver.run(
    `INSERT INTO groups (local_id, server_url, epoch, cursor, my_member_id, name_cache, currency_cache, created_at,
       last_synced_at, last_sync_error, state, epoch_resets_this_cycle) VALUES (${new Array(columns).fill('?').join(', ')})`,
    [
      group.localId,
      group.serverUrl,
      group.epoch,
      group.cursor,
      group.myMemberId,
      group.nameCache,
      group.currencyCache,
      group.createdAt,
      group.lastSyncedAt,
      group.lastSyncError,
      group.state,
      group.epochResetsThisCycle,
    ],
  );
  for (const r of rows) {
    await driver.run(
      `INSERT INTO events (local_id, id, origin, acked, seq, ts, envelope, status, push_state, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        group.localId,
        r.id,
        r.origin,
        r.acked ? 1 : 0,
        r.seq,
        r.ts,
        r.envelope,
        r.status,
        r.pushState ?? 'pending',
        storedSizeOfText(r.envelope),
      ],
    );
  }
  return async () => {
    const store = await openSqliteStore(driver);
    closers.push(() => store.close());
    return store;
  };
}

describe.each(STORE_KINDS)(
  'upgrading the %s store from a build that junked received_at',
  (kind) => {
    it('re-pulls the whole log: the real rows replace the junk, every row gets its R, the cursor ends past them', async () => {
      const clock = new FakeClock();
      const server = new FakeServer({}, clock.now);
      const keys = groupKeys(TEST_SERVER);
      const ev = new Events(clock.now());
      const transport = server.transport();

      // Before the server half: this phone's own write and another phone's, both stored properly.
      const mine = sealFor(keys, ev.created('Banff 2026', 'CAD'));
      const before = sealFor(keys, ev.expense('Dinner'));
      await transport.push(keys.groupId, keys.token, [mine, before]);
      // After it: three more from the other phone (one large), which the old build junked; one more it pruned.
      const after = [
        sealFor(keys, ev.expense('Gas')),
        sealFor(keys, ev.expense('Groceries')),
        sealFor(keys, { ...ev.expense('Lift tickets'), note: 'x'.repeat(5_000) }),
        sealFor(keys, ev.expense('Pruned')),
      ];
      await clock.advance(60_000);
      await transport.push(keys.groupId, keys.token, after);
      const served = server.stored(keys.groupId);
      expect(served.every((e) => typeof e.received_at === 'number')).toBe(true);
      const epoch = server.groups.get(keys.groupId)?.epoch ?? null;

      // The old build's rows: two proper ones, three junk (the large one truncated), none for the pruned one, and a
      // write of its own not pushed yet.
      const unsent = sealFor(keys, ev.expense('Unsent'));
      const proper = (e: Envelope, seq: number, origin: 'local' | 'remote'): NewEventRow => ({
        id: e.id,
        origin,
        acked: true,
        seq,
        ts: (
          parseEvent(open({ key: keys.key, groupId: keys.groupId, envelope: e })) as { ts: number }
        ).ts,
        envelope: envelopeText(e),
        status: 'ok',
      });
      const junk = served.slice(2, 5).map(junkRowOf);
      expect(junk[2]?.envelope).toContain('"truncated":true');
      const rows: NewEventRow[] = [
        proper(mine, 1, 'local'),
        proper(before, 2, 'remote'),
        ...junk,
        {
          id: unsent.id,
          origin: 'local',
          acked: false,
          seq: null,
          ts: (
            parseEvent(open({ key: keys.key, groupId: keys.groupId, envelope: unsent })) as {
              ts: number;
            }
          ).ts,
          envelope: envelopeText(unsent),
          status: 'ok',
        },
      ];
      const openUpgraded = await storeAtV4(kind, groupRow(keys, { epoch, cursor: 6 }), rows);

      const store = await openUpgraded();
      expect(await store.getGroup(keys.localId)).toMatchObject({ cursor: 0, epoch });
      expect((await store.countByStatus(keys.localId)).outbox).toBe(1); // the unsent write is still to send

      const secrets = new FakeSecrets();
      secrets.add(keys.secret);
      const engine = createSyncEngine({
        store,
        secrets,
        transportFor: () => server.transport(),
        now: clock.now,
        sleep: clock.sleep,
        schedule: clock.schedule,
      });
      const result = await engine.syncGroup(keys.localId, { trigger: 'foreground' });
      expect(result).toMatchObject({ outcome: 'synced', pushed: 1, epochResets: 0 });

      const arrivals = server.receivedAt(keys.groupId);
      const stored = await store.listEnvelopes(keys.localId);
      expect(stored).toHaveLength(7);
      expect(stored.filter((r) => r.status !== 'ok')).toEqual([]);
      for (const row of stored) {
        expect(row.receivedAt).toBe(arrivals.get(row.id));
        const event = parseEvent(
          open({
            key: keys.key,
            groupId: keys.groupId,
            envelope: JSON.parse(row.envelope) as Envelope,
          }),
        );
        expect(event?.ts).toBe(row.ts);
      }
      expect(stored.find((r) => r.id === mine.id)?.origin).toBe('local');
      for (const e of after) {
        expect(stored.find((r) => r.id === e.id)?.envelope).toBe(envelopeText(e));
      }
      expect(await store.getGroup(keys.localId)).toMatchObject({
        cursor: server.groups.get(keys.groupId)?.seq,
        epoch,
      });
      expect((await store.countByStatus(keys.localId)).outbox).toBe(0);
      expect(server.stored(keys.groupId).map((e) => e.id)).toContain(unsent.id);
      // Only the unsent write was pushed: nothing already stored went up again.
      expect(server.pushSizes()).toEqual([2, 4, 1]);
      engine.dispose();
    });
  },
);
