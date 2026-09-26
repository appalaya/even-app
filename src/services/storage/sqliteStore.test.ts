import { newId, PROTOCOL } from '@even/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SqlDriver } from './driver';
import { isStoreError, type StoreErrorCode } from './errors';
import { openNodeDriver } from './nodeDriver';
import {
  envelopeText,
  MAX_ENVELOPE_TEXT_LENGTH,
  openSqliteStore,
  type SqliteStore,
} from './sqliteStore';
import { localRow, makeEnvelope, makeGroup, newLocalId, pulledRow } from './testFixtures';
import type { EventStatus, GroupRow, NewEventRow, ReadableEnvelope } from './types';

const T0 = 1_760_000_000_000;
const OTHER_SERVER = 'https://sync.example.org';

let db: SqlDriver;
let store: SqliteStore;
let group: GroupRow;
let g: string;

beforeEach(async () => {
  db = openNodeDriver();
  store = await openSqliteStore(db);
  group = makeGroup();
  g = group.localId;
  await store.upsertGroup(group);
});

afterEach(async () => {
  await store.close();
});

interface RawEvent {
  id: string;
  origin: string;
  acked: number;
  seq: number | null;
  ts: number | null;
  envelope: string;
  status: string;
  push_state: string;
}

async function raw(localId = g): Promise<Map<string, RawEvent>> {
  const rows = await db.all<RawEvent>(
    'SELECT id, origin, acked, seq, ts, envelope, status, push_state FROM events WHERE local_id = ?',
    [localId],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function rawOne(id: string, localId = g): Promise<RawEvent | undefined> {
  return (await raw(localId)).get(id);
}

function rejectsWith(promise: Promise<unknown>, code: StoreErrorCode) {
  return expect(promise).rejects.toSatisfy((e) => isStoreError(e, code));
}

// ---------- groups ----------

describe('groups', () => {
  it('round-trips every column', async () => {
    const full = makeGroup({
      epoch: 'e1',
      cursor: 42,
      myMemberId: newId(),
      nameCache: 'Lisbon',
      currencyCache: 'EUR',
      createdAt: T0 + 5,
      lastSyncedAt: T0 + 6,
      lastSyncError: 'group_full',
      state: 'blocked',
      epochResetsThisCycle: 1,
      serverUrl: OTHER_SERVER,
    });
    await store.upsertGroup(full);
    expect(await store.getGroup(full.localId)).toEqual(full);
  });

  it('returns null for an unknown group', async () => {
    expect(await store.getGroup(newLocalId())).toBeNull();
  });

  it('lists by createdAt, then localId', async () => {
    const later = makeGroup({ createdAt: T0 + 10 });
    const earlier = makeGroup({ createdAt: T0 - 10 });
    const tieA = makeGroup({ createdAt: T0 + 5, localId: 'A'.repeat(43) });
    const tieB = makeGroup({ createdAt: T0 + 5, localId: 'B'.repeat(43) });
    for (const row of [later, tieB, earlier, tieA]) await store.upsertGroup(row);
    expect((await store.listGroups()).map((r) => r.localId)).toEqual([
      earlier.localId,
      g,
      tieA.localId,
      tieB.localId,
      later.localId,
    ]);
  });

  it('upsert replaces every column of an existing row and keeps its events', async () => {
    await store.insertEvents(g, [localRow(T0)]);
    const replaced: GroupRow = {
      ...group,
      serverUrl: OTHER_SERVER,
      epoch: 'x',
      cursor: 9,
      myMemberId: newId(),
      nameCache: null,
      currencyCache: null,
      createdAt: T0 + 1,
      lastSyncedAt: T0 + 2,
      lastSyncError: 'network',
      state: 'closed',
      epochResetsThisCycle: 1,
    };
    await store.upsertGroup(replaced);
    expect(await store.getGroup(g)).toEqual(replaced);
    expect((await raw()).size).toBe(1);
  });

  it('moves through every lifecycle state', async () => {
    for (const state of ['closed', 'hidden', 'blocked', 'active'] as const) {
      await store.setGroupState(g, state);
      expect((await store.getGroup(g))?.state).toBe(state);
    }
  });

  it('sets the cursor, including back to 0', async () => {
    await store.setCursor(g, 500);
    expect((await store.getGroup(g))?.cursor).toBe(500);
    await store.setCursor(g, 0);
    expect((await store.getGroup(g))?.cursor).toBe(0);
  });

  it('patches sync state, leaving omitted fields unchanged', async () => {
    await store.setSyncState(g, {
      epoch: 'e1',
      lastSyncedAt: T0,
      lastSyncError: 'network',
      epochResetsThisCycle: 1,
    });
    await store.setSyncState(g, { lastSyncError: null });
    await store.setSyncState(g, { epoch: undefined });
    await store.setSyncState(g, {});
    const row = await store.getGroup(g);
    expect(row).toMatchObject({
      epoch: 'e1',
      lastSyncedAt: T0,
      lastSyncError: null,
      epochResetsThisCycle: 1,
    });
    await store.setSyncState(g, { epoch: null, epochResetsThisCycle: 0 });
    expect(await store.getGroup(g)).toMatchObject({
      epoch: null,
      epochResetsThisCycle: 0,
      lastSyncedAt: T0,
    });
  });

  it('refuses sync-state fields it does not own', async () => {
    await rejectsWith(store.setSyncState(g, { cursor: 3 } as never), 'invalid_argument');
    await rejectsWith(store.setSyncState(g, { epochResetsThisCycle: 2 }), 'invalid_argument');
  });

  it('sets and clears the claimed member', async () => {
    const member = newId();
    await store.setMyMember(g, member);
    expect((await store.getGroup(g))?.myMemberId).toBe(member);
    await store.setMyMember(g, null);
    expect((await store.getGroup(g))?.myMemberId).toBeNull();
    await rejectsWith(store.setMyMember(g, 'maya'), 'invalid_argument');
  });

  it('updates name and currency caches independently', async () => {
    await store.setNameCache(g, { name: 'Renamed' });
    expect(await store.getGroup(g)).toMatchObject({ nameCache: 'Renamed', currencyCache: 'CAD' });
    await store.setNameCache(g, { currency: 'EUR' });
    expect(await store.getGroup(g)).toMatchObject({ nameCache: 'Renamed', currencyCache: 'EUR' });
    await store.setNameCache(g, { name: null, currency: null });
    expect(await store.getGroup(g)).toMatchObject({ nameCache: null, currencyCache: null });
    await rejectsWith(store.setNameCache(g, { currency: 'euro' }), 'invalid_argument');
  });

  it('throws group_not_found from every updater when the group is missing', async () => {
    const missing = newLocalId();
    await rejectsWith(store.setGroupState(missing, 'closed'), 'group_not_found');
    await rejectsWith(store.setCursor(missing, 1), 'group_not_found');
    await rejectsWith(store.setSyncState(missing, { epoch: 'e' }), 'group_not_found');
    await rejectsWith(store.setSyncState(missing, {}), 'group_not_found');
    await rejectsWith(store.setMyMember(missing, null), 'group_not_found');
    await rejectsWith(store.setNameCache(missing, { name: 'x' }), 'group_not_found');
    await rejectsWith(store.setNameCache(missing, {}), 'group_not_found');
    await rejectsWith(store.setServer(missing, OTHER_SERVER, []), 'group_not_found');
    await rejectsWith(store.insertEvents(missing, [localRow(T0)]), 'group_not_found');
    await rejectsWith(store.insertEvents(missing, []), 'group_not_found');
  });

  it('deleteGroup removes the row and its events only', async () => {
    const other = makeGroup();
    await store.upsertGroup(other);
    await store.insertEvents(g, [localRow(T0), pulledRow(1, T0 + 1)]);
    await store.insertEvents(other.localId, [localRow(T0)]);
    await store.pendingDeletes.add({ localId: g, serverUrl: OTHER_SERVER });
    await store.deleteGroup(g);
    expect(await store.getGroup(g)).toBeNull();
    expect((await raw()).size).toBe(0);
    expect((await raw(other.localId)).size).toBe(1);
    expect(await store.pendingDeletes.list()).toEqual([{ localId: g, serverUrl: OTHER_SERVER }]);
    await store.deleteGroup(g); // idempotent
  });

  it('validates group rows', async () => {
    const bad: Partial<GroupRow>[] = [
      { localId: 'short' },
      { serverUrl: 'http://sync.example.org' },
      { serverUrl: 'https://Sync.Example.org/' },
      { cursor: -1 },
      { cursor: 1.5 },
      { myMemberId: 'not-an-id' },
      { currencyCache: 'eur' },
      { state: 'archived' as never },
      { epochResetsThisCycle: 2 },
      { createdAt: Number.NaN },
      { nameCache: 42 as never },
    ];
    for (const override of bad) {
      await rejectsWith(store.upsertGroup(makeGroup(override)), 'invalid_argument');
    }
    expect(await store.listGroups()).toEqual([group]);
  });
});

// ---------- insertEvents ----------

describe('insertEvents', () => {
  it('inserts new rows and reports their ids in input order', async () => {
    const rows = [localRow(T0 + 2), localRow(T0 + 1), pulledRow(7, T0 + 3)];
    const result = await store.insertEvents(g, rows);
    expect(result).toEqual({ inserted: rows.map((r) => r.id), acked: 0 });
    const stored = await raw();
    expect(stored.get(rows[0]!.id)).toEqual({
      id: rows[0]!.id,
      origin: 'local',
      acked: 0,
      seq: null,
      ts: T0 + 2,
      envelope: rows[0]!.envelope,
      status: 'ok',
      push_state: 'pending',
    });
    expect(stored.get(rows[2]!.id)).toMatchObject({ origin: 'remote', acked: 1, seq: 7 });
  });

  it('stores the envelope text exactly as given', async () => {
    const id = newId();
    const env = makeEnvelope(id);
    const text = `{"c":"${env.c}","n":"${env.n}","v":1,"id":"${id}"}`; // different key order, still v1
    await store.insertEvents(g, [localRow(T0, { id, envelope: text })]);
    expect((await rawOne(id))?.envelope).toBe(text);
  });

  it('ignores an unacked duplicate entirely', async () => {
    const original = localRow(T0);
    await store.insertEvents(g, [original]);
    const dup = localRow(T0 + 99, { id: original.id, origin: 'remote', status: 'invalid' });
    expect(await store.insertEvents(g, [dup])).toEqual({ inserted: [], acked: 0 });
    expect(await rawOne(original.id)).toMatchObject({
      origin: 'local',
      acked: 0,
      seq: null,
      ts: T0,
      envelope: original.envelope,
      status: 'ok',
    });
  });

  it('acks an existing row from an acked duplicate, never touching its content', async () => {
    const original = localRow(T0);
    await store.insertEvents(g, [original]);
    const pulled = pulledRow(12, T0 + 50, { id: original.id, status: 'invalid' });
    expect(await store.insertEvents(g, [pulled])).toEqual({ inserted: [], acked: 1 });
    expect(await rawOne(original.id)).toEqual({
      id: original.id,
      origin: 'local',
      acked: 1,
      seq: 12,
      ts: T0,
      envelope: original.envelope,
      status: 'ok',
      push_state: 'pending',
    });
  });

  it('never lowers a seq, and keeps it when the duplicate has none', async () => {
    const row = pulledRow(20, T0);
    await store.insertEvents(g, [row]);
    expect((await store.insertEvents(g, [pulledRow(5, T0, { id: row.id })])).acked).toBe(0);
    expect((await rawOne(row.id))?.seq).toBe(20);
    expect((await store.insertEvents(g, [pulledRow(30, T0, { id: row.id })])).acked).toBe(1);
    expect((await rawOne(row.id))?.seq).toBe(30);
    await store.resetAcked(g);
    expect(
      (await store.insertEvents(g, [{ ...pulledRow(1, T0, { id: row.id }), seq: null }])).acked,
    ).toBe(1);
    expect(await rawOne(row.id)).toMatchObject({ acked: 1, seq: null });
  });

  it('does not count a duplicate that changes nothing', async () => {
    const row = pulledRow(3, T0);
    await store.insertEvents(g, [row]);
    expect(await store.insertEvents(g, [pulledRow(3, T0, { id: row.id })])).toEqual({
      inserted: [],
      acked: 0,
    });
  });

  it('applies duplicates within one call in order', async () => {
    const first = localRow(T0);
    const result = await store.insertEvents(g, [
      first,
      localRow(T0 + 1, { id: first.id }),
      pulledRow(4, T0, { id: first.id }),
      pulledRow(2, T0, { id: first.id }),
    ]);
    expect(result).toEqual({ inserted: [first.id], acked: 1 });
    expect(await rawOne(first.id)).toMatchObject({ origin: 'local', acked: 1, seq: 4 });
  });

  it('honours an explicit pushState', async () => {
    const row = localRow(T0, { pushState: 'rejected' });
    await store.insertEvents(g, [row]);
    expect((await rawOne(row.id))?.push_state).toBe('rejected');
  });

  it('accepts every status with a fitting envelope', async () => {
    const junk = {
      id: newId(),
      origin: 'remote',
      acked: true,
      seq: 1,
      ts: null,
      status: 'undecryptable',
    } as const;
    const rows: NewEventRow[] = [
      localRow(T0),
      pulledRow(2, null, { status: 'invalid' }),
      pulledRow(3, T0, { status: 'unsupported_body' }),
      pulledRow(4, null), // undecryptable, well-formed v1 (AEAD failure)
      { ...junk, envelope: '"not an envelope"' },
      { ...junk, id: newId(), envelope: '{"id":"x","v":1}' },
      (() => {
        const id = newId();
        return pulledRow(5, null, {
          id,
          status: 'unsupported_envelope',
          envelope: envelopeText({ ...makeEnvelope(id), v: 2 as 1 }),
        });
      })(),
    ];
    const result = await store.insertEvents(g, rows);
    expect(result.inserted).toHaveLength(rows.length);
  });

  it('rejects rows that break the structural rules, writing nothing', async () => {
    const id = newId();
    const env = makeEnvelope(id);
    const good = localRow(T0);
    const bad: NewEventRow[] = [
      localRow(T0, { id: 'short' }),
      localRow(T0, { origin: 'server' as never }),
      localRow(T0, { status: 'fine' as never }),
      localRow(T0, { acked: 1 as never }),
      localRow(T0, { seq: -1 }),
      localRow(T0, { ts: 1.5 }),
      localRow(null as never),
      localRow(T0, { pushState: 'sent' as never }),
      localRow(T0, { envelope: 'not json' }),
      localRow(T0, { id, envelope: JSON.stringify({ ...env, seq: 3 }) }), // pulled StoredEnvelope, seq not stripped
      localRow(T0, { envelope: envelopeText(makeEnvelope()) }), // envelope id ≠ row id
      localRow(T0, { id, envelope: envelopeText({ ...env, v: 2 as 1 }), status: 'ok' }),
      localRow(T0, { id, envelope: envelopeText(env), status: 'unsupported_envelope' }),
      pulledRow(1, null, { id, envelope: envelopeText(makeEnvelope()) }), // undecryptable but well-formed with another id
      pulledRow(1, null, { envelope: `"${'x'.repeat(MAX_ENVELOPE_TEXT_LENGTH)}"` }),
    ];
    for (const row of bad) {
      await rejectsWith(store.insertEvents(g, [good, row]), 'invalid_argument');
    }
    expect((await raw()).size).toBe(0);
  });

  it('handles pages larger than one statement', async () => {
    const rows = Array.from({ length: 1_234 }, (_, i) => pulledRow(i + 1, T0 + i));
    const result = await store.insertEvents(g, rows);
    expect(result.inserted).toEqual(rows.map((r) => r.id));
    await store.resetAcked(g);
    const again = await store.insertEvents(
      g,
      rows.map((r, i) => ({ ...r, seq: 5_000 + i })),
    );
    expect(again).toEqual({ inserted: [], acked: 1_234 });
    const stored = await raw();
    expect([...stored.values()].every((r) => r.acked === 1 && r.seq === 5_000 + (r.ts! - T0))).toBe(
      true,
    );
  });
});

// ---------- outbox, ack, rejected, reset ----------

describe('outbox', () => {
  it('orders by ts (null last) then id, and excludes acked and rejected rows', async () => {
    const [a, b, c] = ['C', 'A', 'B'].map((ch) => ch.repeat(22));
    const rows = [
      localRow(T0 + 5, { id: a }),
      localRow(T0 + 5, { id: b }),
      localRow(T0 + 1, { id: c }),
      pulledRow(1, T0), // acked: not in the outbox
      localRow(T0 + 2, { pushState: 'rejected' }),
      { ...pulledRow(2, null), acked: false }, // unreadable, unacked: last
    ];
    await store.insertEvents(g, rows);
    const outbox = await store.outbox(g, 100);
    expect(outbox.map((r) => r.id)).toEqual([c, b, a, rows[5]!.id]);
    expect(outbox[0]).toEqual({ id: c, ts: T0 + 1, envelope: rows[2]!.envelope });
  });

  it('respects the limit', async () => {
    await store.insertEvents(
      g,
      Array.from({ length: 10 }, (_, i) => localRow(T0 + i)),
    );
    expect(await store.outbox(g, 3)).toHaveLength(3);
    expect(await store.outbox(g, 0)).toEqual([]);
    await rejectsWith(store.outbox(g, -1), 'invalid_argument');
  });

  it('is scoped to the group', async () => {
    const other = makeGroup();
    await store.upsertGroup(other);
    await store.insertEvents(other.localId, [localRow(T0)]);
    expect(await store.outbox(g, 10)).toEqual([]);
  });
});

describe('ack, markRejected, resetAcked', () => {
  it('ack sets acked and leaves seq unknown; unknown ids are ignored', async () => {
    const rows = [localRow(T0), localRow(T0 + 1)];
    await store.insertEvents(g, rows);
    await store.ack(g, [rows[0]!.id, newId()]);
    expect(await rawOne(rows[0]!.id)).toMatchObject({ acked: 1, seq: null });
    expect((await store.outbox(g, 10)).map((r) => r.id)).toEqual([rows[1]!.id]);
    await store.ack(g, []);
  });

  it('ack handles batches beyond one statement', async () => {
    const rows = Array.from({ length: 1_500 }, (_, i) => localRow(T0 + i));
    await store.insertEvents(g, rows);
    await store.ack(
      g,
      rows.map((r) => r.id),
    );
    expect(await store.outbox(g, 10_000)).toEqual([]);
  });

  it('markRejected takes rows out of the outbox and counts them', async () => {
    const rows = [localRow(T0), localRow(T0 + 1)];
    await store.insertEvents(g, rows);
    await store.markRejected(g, [rows[1]!.id]);
    expect((await store.outbox(g, 10)).map((r) => r.id)).toEqual([rows[0]!.id]);
    expect(await store.countByStatus(g)).toMatchObject({ outbox: 1, rejected: 1 });
  });

  it('resetAcked re-queues everything except rejected rows', async () => {
    const rows = [pulledRow(1, T0), localRow(T0 + 1), localRow(T0 + 2)];
    await store.insertEvents(g, rows);
    await store.ack(g, [rows[1]!.id]);
    await store.markRejected(g, [rows[2]!.id]);
    await store.resetAcked(g);
    const stored = await raw();
    expect([...stored.values()].map((r) => [r.acked, r.seq])).toEqual([
      [0, null],
      [0, null],
      [0, null],
    ]);
    expect(stored.get(rows[2]!.id)?.push_state).toBe('rejected');
    expect((await store.outbox(g, 10)).map((r) => r.id)).toEqual([rows[0]!.id, rows[1]!.id]);
  });

  it('resetAcked with clearRejected re-queues rejected rows too', async () => {
    const row = localRow(T0);
    await store.insertEvents(g, [row]);
    await store.markRejected(g, [row.id]);
    await store.resetAcked(g, { clearRejected: true });
    expect((await store.outbox(g, 10)).map((r) => r.id)).toEqual([row.id]);
  });

  it('only touches the given group', async () => {
    const other = makeGroup();
    await store.upsertGroup(other);
    const mine = pulledRow(1, T0);
    const theirs = pulledRow(1, T0, { id: mine.id });
    await store.insertEvents(g, [mine]);
    await store.insertEvents(other.localId, [theirs]);
    await store.resetAcked(g);
    expect((await rawOne(mine.id, other.localId))?.acked).toBe(1);
  });
});

// ---------- setServer ----------

describe('setServer', () => {
  async function seedMixed() {
    const rows = {
      ok: localRow(T0 + 1),
      okAcked: pulledRow(3, T0 + 2),
      invalid: pulledRow(4, null, { status: 'invalid' as const }),
      unsupportedBody: pulledRow(5, T0 + 3, { status: 'unsupported_body' as const }),
      undecryptable: pulledRow(6, null),
      unsupportedEnvelope: (() => {
        const id = newId();
        return pulledRow(7, null, {
          id,
          status: 'unsupported_envelope' as const,
          envelope: envelopeText({ ...makeEnvelope(id), v: 2 as 1 }),
        });
      })(),
      rejected: localRow(T0 + 4, { pushState: 'rejected' }),
    };
    await store.insertEvents(g, Object.values(rows));
    await store.setCursor(g, 7);
    await store.setSyncState(g, { epoch: 'old-epoch' });
    return rows;
  }

  function reencrypt(ids: string[]): ReadableEnvelope[] {
    return ids.map((id) => ({ id, envelope: makeEnvelope(id) }));
  }

  it('re-encrypts readable rows, drops unreadable ones, and resets sync state', async () => {
    const rows = await seedMixed();
    const readableIds = [
      rows.ok,
      rows.okAcked,
      rows.invalid,
      rows.unsupportedBody,
      rows.rejected,
    ].map((r) => r.id);
    const fresh = reencrypt(readableIds);
    await store.setGroupState(g, 'blocked');

    await store.setServer(g, OTHER_SERVER, fresh);

    const after = await store.getGroup(g);
    expect(after).toMatchObject({
      serverUrl: OTHER_SERVER,
      cursor: 0,
      epoch: null,
      state: 'active',
    });
    const stored = await raw();
    expect([...stored.keys()].sort()).toEqual([...readableIds].sort());
    for (const { id, envelope } of fresh) {
      expect(stored.get(id)).toMatchObject({
        envelope: envelopeText(envelope),
        acked: 0,
        seq: null,
        push_state: 'pending',
      });
    }
    // Content columns survive.
    expect(stored.get(rows.ok.id)).toMatchObject({ origin: 'local', ts: T0 + 1, status: 'ok' });
    expect(stored.get(rows.invalid.id)).toMatchObject({
      origin: 'remote',
      ts: null,
      status: 'invalid',
    });
    // The whole readable log is in the outbox for the new server.
    expect((await store.outbox(g, 100)).map((r) => r.id).sort()).toEqual([...readableIds].sort());
    expect((await store.listReadable(g)).map((r) => r.envelope)).toEqual(
      expect.arrayContaining(fresh.map((f) => f.envelope)),
    );
  });

  it('keeps a closed or hidden group in its state', async () => {
    await store.setGroupState(g, 'closed');
    await store.setServer(g, OTHER_SERVER, []);
    expect((await store.getGroup(g))?.state).toBe('closed');
  });

  it('throws, changing nothing, when a readable row is missing from the re-encryption', async () => {
    const rows = await seedMixed();
    const before = await raw();
    const groupBefore = await store.getGroup(g);
    await rejectsWith(
      store.setServer(
        g,
        OTHER_SERVER,
        reencrypt([rows.ok.id, rows.okAcked.id, rows.invalid.id, rows.unsupportedBody.id]),
      ),
      'incomplete_reencryption',
    );
    expect(await raw()).toEqual(before);
    expect(await store.getGroup(g)).toEqual(groupBefore);
  });

  it('throws when the re-encryption names rows that are not readable rows of the group', async () => {
    const rows = await seedMixed();
    const readable = [rows.ok, rows.okAcked, rows.invalid, rows.unsupportedBody, rows.rejected].map(
      (r) => r.id,
    );
    await rejectsWith(
      store.setServer(g, OTHER_SERVER, reencrypt([...readable, rows.undecryptable.id])),
      'incomplete_reencryption',
    );
    await rejectsWith(
      store.setServer(g, OTHER_SERVER, reencrypt([...readable, newId()])),
      'incomplete_reencryption',
    );
  });

  it('validates its arguments before touching the database', async () => {
    const row = localRow(T0);
    await store.insertEvents(g, [row]);
    const env = makeEnvelope(row.id);
    await rejectsWith(
      store.setServer(g, 'http://insecure.example', reencrypt([row.id])),
      'invalid_argument',
    );
    await rejectsWith(
      store.setServer(g, OTHER_SERVER, [{ id: row.id, envelope: { ...env, v: 2 as 1 } }]),
      'invalid_argument',
    );
    await rejectsWith(
      store.setServer(g, OTHER_SERVER, [{ id: row.id, envelope: makeEnvelope() }]),
      'invalid_argument',
    );
    await rejectsWith(
      store.setServer(g, OTHER_SERVER, [
        { id: row.id, envelope: env },
        { id: row.id, envelope: env },
      ]),
      'invalid_argument',
    );
    expect((await store.getGroup(g))?.serverUrl).toBe(PROTOCOL.defaultServer);
  });

  it('handles logs larger than one statement', async () => {
    const rows = Array.from({ length: 800 }, (_, i) => pulledRow(i + 1, T0 + i));
    await store.insertEvents(g, rows);
    const fresh = reencrypt(rows.map((r) => r.id));
    await store.setServer(g, OTHER_SERVER, fresh);
    const stored = await raw();
    expect(fresh.every((f) => stored.get(f.id)?.envelope === envelopeText(f.envelope))).toBe(true);
    expect((await store.countByStatus(g)).outbox).toBe(800);
  });

  it('does not touch other groups', async () => {
    const other = makeGroup();
    await store.upsertGroup(other);
    const theirs = pulledRow(1, null);
    await store.insertEvents(other.localId, [theirs]);
    await store.setServer(g, OTHER_SERVER, []);
    expect(await rawOne(theirs.id, other.localId)).toMatchObject({
      acked: 1,
      status: 'undecryptable',
    });
    expect((await store.getGroup(other.localId))?.serverUrl).toBe(PROTOCOL.defaultServer);
  });
});

// ---------- reading ----------

describe('reading the log', () => {
  it('listReadable returns parsed ok/invalid/unsupported_body envelopes in log order', async () => {
    const rows = [
      pulledRow(1, T0 + 3),
      pulledRow(2, null, { status: 'invalid' }),
      pulledRow(3, T0 + 1, { status: 'unsupported_body' }),
      pulledRow(4, null), // undecryptable: excluded
    ];
    await store.insertEvents(g, rows);
    const readable = await store.listReadable(g);
    expect(readable.map((r) => r.id)).toEqual([rows[2]!.id, rows[0]!.id, rows[1]!.id]);
    expect(readable[0]!.envelope).toEqual(JSON.parse(rows[2]!.envelope));
  });

  it('listReadable reports a tampered row instead of returning garbage', async () => {
    const row = localRow(T0);
    await store.insertEvents(g, [row]);
    await db.run('UPDATE events SET envelope = ? WHERE id = ?', ['{"id":"x"}', row.id]);
    await rejectsWith(store.listReadable(g), 'corrupt_row');
  });

  it('listEnvelopes returns every status in log order', async () => {
    const rows = [
      pulledRow(1, null),
      localRow(T0 + 2),
      pulledRow(2, T0 + 1, { status: 'unsupported_body' }),
    ];
    await store.insertEvents(g, rows);
    expect(await store.listEnvelopes(g)).toEqual([
      {
        id: rows[2]!.id,
        origin: 'remote',
        ts: T0 + 1,
        envelope: rows[2]!.envelope,
        status: 'unsupported_body',
      },
      { id: rows[1]!.id, origin: 'local', ts: T0 + 2, envelope: rows[1]!.envelope, status: 'ok' },
      {
        id: rows[0]!.id,
        origin: 'remote',
        ts: null,
        envelope: rows[0]!.envelope,
        status: 'undecryptable',
      },
    ]);
  });

  it('countByStatus counts statuses, the outbox, and rejections', async () => {
    expect(await store.countByStatus(g)).toEqual({
      byStatus: {
        ok: 0,
        undecryptable: 0,
        invalid: 0,
        unsupported_envelope: 0,
        unsupported_body: 0,
      },
      outbox: 0,
      rejected: 0,
    });
    const rows = [
      localRow(T0),
      localRow(T0 + 1),
      localRow(T0 + 2, { pushState: 'rejected' }),
      pulledRow(1, T0),
      pulledRow(2, null),
      pulledRow(3, null),
      pulledRow(4, null, { status: 'invalid' }),
    ];
    await store.insertEvents(g, rows);
    expect(await store.countByStatus(g)).toEqual({
      byStatus: {
        ok: 4,
        undecryptable: 2,
        invalid: 1,
        unsupported_envelope: 0,
        unsupported_body: 0,
      },
      outbox: 2,
      rejected: 1,
    });
  });
});

// ---------- pruneUndecryptable ----------

describe('pruneUndecryptable', () => {
  it('keeps the most recently inserted undecryptable rows, whatever their seq', async () => {
    const batches = [
      [pulledRow(50, null), pulledRow(40, null)],
      [pulledRow(30, null), pulledRow(1, T0)],
      [pulledRow(10, null), pulledRow(2, null, { status: 'invalid' })],
    ];
    for (const batch of batches) await store.insertEvents(g, batch);
    await store.resetAcked(g); // seq is gone; order must come from insertion
    expect(await store.pruneUndecryptable(g, 2)).toBe(2);
    const left = await raw();
    expect([...left.keys()].sort()).toEqual(
      [batches[1]![0]!.id, batches[1]![1]!.id, batches[2]![0]!.id, batches[2]![1]!.id].sort(),
    );
    expect(await store.pruneUndecryptable(g, 2)).toBe(0);
  });

  it('keep 0 clears every undecryptable row and nothing else', async () => {
    const other = makeGroup();
    await store.upsertGroup(other);
    await store.insertEvents(g, [pulledRow(1, null), pulledRow(2, null), localRow(T0)]);
    await store.insertEvents(other.localId, [pulledRow(1, null)]);
    expect(await store.pruneUndecryptable(g, 0)).toBe(2);
    expect((await store.countByStatus(g)).byStatus).toMatchObject({ ok: 1, undecryptable: 0 });
    expect((await store.countByStatus(other.localId)).byStatus.undecryptable).toBe(1);
  });

  it('caps at 1000 like the sync engine uses it', async () => {
    await store.insertEvents(
      g,
      Array.from({ length: 1_010 }, (_, i) => pulledRow(i + 1, null)),
    );
    expect(await store.pruneUndecryptable(g, 1_000)).toBe(10);
    expect((await store.countByStatus(g)).byStatus.undecryptable).toBe(1_000);
  });
});

// ---------- prefs and pending deletes ----------

describe('prefs', () => {
  it('gets, sets, overwrites, and deletes', async () => {
    expect(await store.getPref('me.name')).toBeNull();
    await store.setPref('me.name', 'Maya');
    await store.setPref('me.emoji', '🦊');
    expect(await store.getPref('me.name')).toBe('Maya');
    await store.setPref('me.name', 'Maya K');
    expect(await store.getPref('me.name')).toBe('Maya K');
    await store.setPref('me.name', null);
    expect(await store.getPref('me.name')).toBeNull();
    expect(await store.getPref('me.emoji')).toBe('🦊');
    await store.setPref('appearance', '');
    expect(await store.getPref('appearance')).toBe('');
  });

  it('refuses unknown keys and non-string values', async () => {
    await rejectsWith(store.getPref('secret' as never), 'invalid_argument');
    await rejectsWith(store.setPref('theme', 3 as never), 'invalid_argument');
  });
});

describe('pendingDeletes', () => {
  it('adds without duplicates, lists in order, and removes', async () => {
    const other = newLocalId();
    await store.pendingDeletes.add({ localId: g, serverUrl: OTHER_SERVER });
    await store.pendingDeletes.add({ localId: other, serverUrl: PROTOCOL.defaultServer });
    await store.pendingDeletes.add({ localId: g, serverUrl: OTHER_SERVER });
    await store.pendingDeletes.add({ localId: g, serverUrl: PROTOCOL.defaultServer });
    expect(await store.pendingDeletes.list()).toEqual([
      { localId: g, serverUrl: OTHER_SERVER },
      { localId: other, serverUrl: PROTOCOL.defaultServer },
      { localId: g, serverUrl: PROTOCOL.defaultServer },
    ]);
    await store.pendingDeletes.remove({ localId: g, serverUrl: OTHER_SERVER });
    await store.pendingDeletes.remove({ localId: g, serverUrl: OTHER_SERVER });
    expect(await store.pendingDeletes.list()).toHaveLength(2);
  });

  it('does not need a group row (the debt outlives Leave)', async () => {
    const gone = newLocalId();
    await store.pendingDeletes.add({ localId: gone, serverUrl: OTHER_SERVER });
    expect(await store.pendingDeletes.list()).toEqual([{ localId: gone, serverUrl: OTHER_SERVER }]);
  });

  it('validates entries', async () => {
    await rejectsWith(
      store.pendingDeletes.add({ localId: 'x', serverUrl: OTHER_SERVER }),
      'invalid_argument',
    );
    await rejectsWith(
      store.pendingDeletes.add({ localId: g, serverUrl: 'sync.example.org' }),
      'invalid_argument',
    );
    await rejectsWith(
      store.pendingDeletes.remove({ localId: g, serverUrl: `${OTHER_SERVER}/` }),
      'invalid_argument',
    );
  });
});

// ---------- transactions ----------

describe('transaction', () => {
  it('commits a pulled page and its cursor together', async () => {
    const page = [pulledRow(1, T0), pulledRow(2, T0 + 1)];
    const inserted = await store.transaction(async (tx) => {
      const result = await tx.insertEvents(g, page);
      await tx.setCursor(g, 2);
      return result.inserted;
    });
    expect(inserted).toHaveLength(2);
    expect((await store.getGroup(g))?.cursor).toBe(2);
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.insertEvents(g, [pulledRow(1, T0)]);
        await tx.setCursor(g, 1);
        await tx.setPref('me.name', 'Maya');
        throw new Error('network dropped mid-page');
      }),
    ).rejects.toThrow('network dropped mid-page');
    expect((await raw()).size).toBe(0);
    expect((await store.getGroup(g))?.cursor).toBe(0);
    expect(await store.getPref('me.name')).toBeNull();
  });

  it('a page committed after Leave fails as a whole instead of leaving ciphertext behind', async () => {
    await store.deleteGroup(g);
    await rejectsWith(
      store.transaction(async (tx) => {
        await tx.insertEvents(g, [pulledRow(1, T0)]);
        await tx.setCursor(g, 1);
      }),
      'group_not_found',
    );
    expect((await db.all('SELECT id FROM events')).length).toBe(0);
  });

  it('nested calls reuse the outer transaction; a caught nested failure undoes only its own writes', async () => {
    const kept = localRow(T0);
    const undone = localRow(T0 + 1);
    await store.transaction(async (tx) => {
      await tx.insertEvents(g, [kept]);
      await expect(
        tx.transaction(async (inner) => {
          await inner.insertEvents(g, [undone]);
          await inner.setCursor(g, 99);
          throw new Error('inner');
        }),
      ).rejects.toThrow('inner');
      await tx.setCursor(g, 1);
    });
    expect([...(await raw()).keys()]).toEqual([kept.id]);
    expect((await store.getGroup(g))?.cursor).toBe(1);
  });

  it('multi-statement methods are atomic inside a transaction too', async () => {
    const good = localRow(T0);
    await store.transaction(async (tx) => {
      await tx.insertEvents(g, [good]);
      await expect(tx.setServer(g, OTHER_SERVER, [])).rejects.toSatisfy((e) =>
        isStoreError(e, 'incomplete_reencryption'),
      );
    });
    expect(await rawOne(good.id)).toBeDefined();
    expect((await store.getGroup(g))?.serverUrl).toBe(PROTOCOL.defaultServer);
  });

  it('refuses a transaction store after it ended', async () => {
    let leaked: Parameters<Parameters<SqliteStore['transaction']>[0]>[0] | undefined;
    await store.transaction(async (tx) => {
      leaked = tx;
    });
    await rejectsWith(leaked!.getGroup(g), 'transaction_misuse');
  });

  it('concurrent writers queue behind a transaction instead of joining it', async () => {
    const outside = localRow(T0 + 1);
    const failing = store.transaction(async (tx) => {
      await tx.insertEvents(g, [localRow(T0)]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('abort');
    });
    const write = store.insertEvents(g, [outside]);
    await expect(failing).rejects.toThrow('abort');
    await write;
    expect([...(await raw()).keys()]).toEqual([outside.id]);
  });
});

// ---------- validation ----------

describe('id validation', () => {
  /** Counts statements reaching SQLite, to prove invalid input never does. */
  function countingStore() {
    let statements = 0;
    const counted = new Proxy(db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (['run', 'all', 'get', 'transaction'].includes(prop as string)) {
          return (...args: unknown[]) => {
            statements += 1;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
    return { s: new (store.constructor as typeof SqliteStore)(counted), count: () => statements };
  }

  const badLocalIds: unknown[] = [
    '',
    'a'.repeat(42),
    'a'.repeat(44),
    `${'a'.repeat(42)}=`,
    `${'a'.repeat(42)}/`,
    "'; DROP TABLE events; --".padEnd(43, 'a'),
    42,
    null,
    undefined,
  ];
  const badIds: unknown[] = [
    '',
    'a'.repeat(21),
    'a'.repeat(23),
    `${'a'.repeat(21)}+`,
    "x' OR '1'='1".padEnd(22, 'a'),
    7,
    null,
  ];

  it('rejects malformed local ids in every method, before any SQL', async () => {
    const { s, count } = countingStore();
    for (const bad of badLocalIds) {
      const id = bad as string;
      const calls: Promise<unknown>[] = [
        s.getGroup(id),
        s.setGroupState(id, 'active'),
        s.setServer(id, OTHER_SERVER, []),
        s.setCursor(id, 0),
        s.setSyncState(id, {}),
        s.setMyMember(id, null),
        s.setNameCache(id, {}),
        s.deleteGroup(id),
        s.insertEvents(id, []),
        s.outbox(id, 1),
        s.ack(id, []),
        s.markRejected(id, []),
        s.resetAcked(id),
        s.listEnvelopes(id),
        s.listReadable(id),
        s.countByStatus(id),
        s.pruneUndecryptable(id, 0),
        s.pendingDeletes.add({ localId: id, serverUrl: OTHER_SERVER }),
        s.pendingDeletes.remove({ localId: id, serverUrl: OTHER_SERVER }),
      ];
      for (const call of calls) await rejectsWith(call, 'invalid_argument');
    }
    expect(count()).toBe(0);
  });

  it('rejects malformed event and member ids, before any SQL', async () => {
    const { s, count } = countingStore();
    for (const bad of badIds) {
      const id = bad as string;
      await rejectsWith(s.ack(g, [newId(), id]), 'invalid_argument');
      await rejectsWith(s.markRejected(g, [id]), 'invalid_argument');
      await rejectsWith(
        s.insertEvents(g, [localRow(T0), { ...localRow(T0), id }]),
        'invalid_argument',
      );
      if (id !== null) await rejectsWith(s.setMyMember(g, id), 'invalid_argument'); // null clears the claim
      await rejectsWith(
        s.setServer(g, OTHER_SERVER, [{ id, envelope: makeEnvelope() }]),
        'invalid_argument',
      );
    }
    await rejectsWith(s.ack(g, 'not-an-array' as never), 'invalid_argument');
    await rejectsWith(s.insertEvents(g, {} as never), 'invalid_argument');
    await rejectsWith(s.pruneUndecryptable(g, -1), 'invalid_argument');
    await rejectsWith(s.resetAcked(g, { clearRejected: 'yes' as never }), 'invalid_argument');
    expect(count()).toBe(0);
  });

  it('stores ids that look like SQL as plain values', async () => {
    // Every base64url character is legal; the point is that values are bound, not interpolated.
    const id = '--_-_OR_1_1_-_DROP_--_';
    await store.insertEvents(g, [localRow(T0, { id })]);
    expect((await store.outbox(g, 10)).map((r) => r.id)).toEqual([id]);
  });
});

// Keep the EventStatus import honest if the union grows.
const _statuses: Record<EventStatus, true> = {
  ok: true,
  undecryptable: true,
  invalid: true,
  unsupported_envelope: true,
  unsupported_body: true,
};
void _statuses;
