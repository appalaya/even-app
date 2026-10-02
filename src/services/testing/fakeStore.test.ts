import { newId } from '@even/core';
import { describe, expect, it } from 'vitest';

import type { NewEventRow } from '../storage/types';
import { createFakeStore, type FakeStore } from './fakeStore';
import { Events, groupKeys, groupRow, sealFor, type GroupKeys } from './fixtures';

const ev = new Events();

async function setup(): Promise<{ store: FakeStore; keys: GroupKeys; L: string }> {
  const store = createFakeStore();
  const keys = groupKeys();
  await store.upsertGroup(groupRow(keys));
  return { store, keys, L: keys.localId };
}

function row(keys: GroupKeys, id: string, overrides: Partial<NewEventRow> = {}): NewEventRow {
  return {
    id,
    origin: 'local',
    acked: false,
    seq: null,
    ts: 1,
    envelope: JSON.stringify(sealFor(keys, ev.expense('x'), id)),
    status: 'ok',
    ...overrides,
  };
}

const idOf = (c: string) => c.repeat(22);

describe('FakeStore honours the Store contract', () => {
  it('insert-or-ignore: an acked duplicate acks and raises seq, never replacing content or lowering seq', async () => {
    const { store, keys, L } = await setup();
    const a = newId();
    const first = row(keys, a);
    expect(await store.insertEvents(L, [first])).toEqual({ inserted: [a], acked: 0 });
    expect(await store.insertEvents(L, [row(keys, a)])).toEqual({ inserted: [], acked: 0 });
    const result = await store.insertEvents(L, [
      row(keys, a, { acked: true, seq: 4, origin: 'remote', status: 'invalid', ts: 9 }),
    ]);
    expect(result).toEqual({ inserted: [], acked: 1 });
    expect(store.dump(L)).toEqual([
      { ...first, localId: L, acked: true, seq: 4, pushState: 'pending' },
    ]);
    // Never un-acked, never lowered, and a null seq keeps the stored one.
    expect(await store.insertEvents(L, [row(keys, a, { acked: true, seq: 2 })])).toEqual({
      inserted: [],
      acked: 0,
    });
    await store.insertEvents(L, [row(keys, a, { acked: true, seq: null })]);
    expect(store.dump(L)[0]).toMatchObject({ acked: true, seq: 4 });
    await store.insertEvents(L, [row(keys, a, { acked: true, seq: 7 })]);
    expect(store.dump(L)[0]?.seq).toBe(7);
  });

  it('validates rows like the SQLite store, all or nothing, and needs the group row', async () => {
    const { store, keys, L } = await setup();
    const good = row(keys, newId());
    await expect(store.insertEvents(L, [good, row(keys, newId(), { ts: null })])).rejects.toThrow(
      'needs a ts',
    );
    await expect(
      store.insertEvents(L, [row(keys, newId(), { envelope: '{"id":1}', status: 'invalid' })]),
    ).rejects.toThrow('v1 envelope');
    await expect(
      store.insertEvents(L, [
        row(keys, newId(), { envelope: `"${'x'.repeat(16_384)}"`, status: 'undecryptable' }),
      ]),
    ).rejects.toThrow('too long');
    await expect(store.insertEvents(L, [{ ...good, id: newId() }])).rejects.toThrow('id differs');
    expect(store.dump(L)).toEqual([]);
    await expect(store.insertEvents(groupKeys().localId, [good])).rejects.toThrow('no group');
    // Junk of any JSON shape is fine as undecryptable.
    await store.insertEvents(L, [
      row(keys, newId(), { envelope: '{"junk":1}', status: 'undecryptable', ts: null }),
    ]);
  });

  it('outbox: unacked and pending, by ts with null last, then id', async () => {
    const { store, keys, L } = await setup();
    await store.insertEvents(L, [
      row(keys, idOf('c'), { ts: null, status: 'undecryptable' }),
      row(keys, idOf('b'), { ts: 2 }),
      row(keys, idOf('a'), { ts: 2 }),
      row(keys, idOf('d'), { ts: 1, acked: true }),
      row(keys, idOf('e'), { ts: 0, pushState: 'rejected' }),
    ]);
    expect((await store.outbox(L, 10)).map((r) => r.id[0])).toEqual(['a', 'b', 'c']);
    expect(await store.outbox(L, 1)).toHaveLength(1);
  });

  it('resetAcked keeps rejected rows rejected unless asked', async () => {
    const { store, keys, L } = await setup();
    await store.insertEvents(L, [
      row(keys, idOf('a'), { acked: true, seq: 1 }),
      row(keys, idOf('b')),
    ]);
    await store.markRejected(L, [idOf('b')]);
    await store.resetAcked(L);
    expect(store.dump(L).map((r) => [r.acked, r.seq, r.pushState])).toEqual([
      [false, null, 'pending'],
      [false, null, 'rejected'],
    ]);
    await store.resetAcked(L, { clearRejected: true });
    expect(store.dump(L).every((r) => r.pushState === 'pending')).toBe(true);
  });

  it('rolls a transaction back on throw; a nested one is a savepoint', async () => {
    const { store, keys, L } = await setup();
    await expect(
      store.transaction(async (tx) => {
        await tx.insertEvents(L, [row(keys, newId())]);
        await tx.setCursor(L, 9);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(store.dump(L)).toEqual([]);
    expect((await store.getGroup(L))?.cursor).toBe(0);

    await store.transaction(async (tx) => {
      await tx.setCursor(L, 1);
      await tx
        .transaction(async (inner) => {
          await inner.setCursor(L, 2);
          throw new Error('inner');
        })
        .catch(() => undefined);
    });
    expect((await store.getGroup(L))?.cursor).toBe(1);
  });

  it('matches the SQLite store on latestTs, listGroups order, setServer refusals, and debt tokens', async () => {
    const { store, keys, L } = await setup();
    expect(await store.latestTs(L)).toBeNull();
    await store.insertEvents(L, [
      row(keys, idOf('a'), { ts: 5 }),
      row(keys, idOf('b'), { ts: null, status: 'undecryptable' }),
      row(keys, idOf('c'), { ts: 9, status: 'invalid' }),
    ]);
    expect(await store.latestTs(L)).toBe(9);

    // Same createdAt: ties break on localId, as `ORDER BY created_at, local_id` does.
    const others = [groupKeys(), groupKeys()];
    for (const k of others) await store.upsertGroup(groupRow(k));
    expect((await store.listGroups()).map((g) => g.localId)).toEqual(
      [L, ...others.map((k) => k.localId)].sort(),
    );

    // A re-encryption must cover exactly the readable rows; a refusal changes nothing.
    const env = (id: string) => sealFor(keys, ev.expense('x'), id);
    const before = store.dump(L);
    for (const bad of [
      [{ id: idOf('a'), envelope: env(idOf('a')) }], // misses c
      [idOf('a'), idOf('c'), idOf('b')].map((id) => ({ id, envelope: env(id) })), // b is not readable
      [
        { id: idOf('a'), envelope: env(idOf('c')) },
        { id: idOf('c'), envelope: env(idOf('c')) },
      ],
    ]) {
      await expect(store.setServer(L, 'https://other.test', bad)).rejects.toThrow();
    }
    expect(store.dump(L)).toEqual(before);

    await expect(
      store.pendingDeletes.add({
        localId: L,
        serverUrl: 'https://other.test',
        authToken: 'short',
        createdAt: 0,
      }),
    ).rejects.toThrow('authToken');
  });

  it('prunes the oldest undecryptable rows by insertion order', async () => {
    const { store, keys, L } = await setup();
    const ids = ['a', 'b', 'c'].map(idOf);
    for (const id of ids) {
      await store.insertEvents(L, [row(keys, id, { status: 'undecryptable', ts: null })]);
    }
    expect(await store.pruneUndecryptable(L, 1)).toBe(2);
    expect(store.dump(L).map((r) => r.id)).toEqual([ids[2]]);
  });
});
