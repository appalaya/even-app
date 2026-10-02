import { envelopeStoredSize, newId, resealEnvelope } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { openTestStore, STORE_KINDS, type TestStore } from '../testing/testStore';
import { FAKE_LIMITS } from '../testing/fakeTransport';
import { Events, groupKeys, groupRow, sealFor, writeLocal } from '../testing/fixtures';
import type { ServerInfo } from './types';
import { groupUsage } from './usage';

function info(limits: Partial<ServerInfo['limits']>): ServerInfo {
  return { protocol: [1], limits: { ...FAKE_LIMITS, ...limits }, retention_days: 365, push: false };
}

const opened: TestStore[] = [];
afterEach(async () => {
  while (opened.length > 0) await opened.pop()?.close();
});

describe.each(STORE_KINDS)('groupUsage on the %s store', (kind) => {
  async function storeOf(): Promise<TestStore> {
    const store = await openTestStore(kind);
    opened.push(store);
    return store;
  }

  it('sums stored sizes (decoded c + 64) against both caps and warns at 80%', async () => {
    const store = await storeOf();
    const keys = groupKeys();
    await store.upsertGroup(groupRow(keys));
    const ev = new Events();
    const envelopes = [sealFor(keys, ev.created()), sealFor(keys, ev.expense('Dinner'))];
    for (const envelope of envelopes) {
      await store.insertEvents(keys.localId, [
        {
          id: envelope.id,
          origin: 'local',
          acked: false,
          seq: null,
          ts: 1,
          envelope: JSON.stringify(envelope),
          status: 'ok',
        },
      ]);
    }
    await store.insertEvents(keys.localId, [
      {
        id: newId(),
        origin: 'remote',
        acked: true,
        seq: 9,
        ts: null,
        envelope: '{"junk":true}',
        status: 'undecryptable',
      },
    ]);
    const bytes = envelopes.reduce((sum, e) => sum + envelopeStoredSize(e), 0);

    const low = await groupUsage(
      store,
      keys.localId,
      info({ max_group_bytes: bytes * 10, max_group_events: 100 }),
    );
    expect(low).toMatchObject({
      bytes,
      events: 2,
      bytesFraction: 0.1,
      eventsFraction: 0.02,
      fraction: 0.1,
      warn: false,
    });

    const high = await groupUsage(
      store,
      keys.localId,
      info({ max_group_bytes: bytes * 10, max_group_events: 2.5 }),
    );
    expect(high).toMatchObject({ eventsFraction: 0.8, fraction: 0.8, warn: true });
  });

  it('reads one SQL sum, not the envelopes, and follows a re-encryption', async () => {
    const store = await storeOf();
    const keys = groupKeys();
    await store.upsertGroup(groupRow(keys));
    const ev = new Events();
    const ids = [
      await writeLocal(store, keys, ev.created()),
      await writeLocal(store, keys, ev.expense('Dinner')),
    ];
    store.calls.length = 0;
    const before = await groupUsage(store, keys.localId, info({}));
    expect(store.calls).toEqual(['usage']);
    const other = groupKeys('https://other.test', keys.secret);
    const readable = await store.listReadable(keys.localId);
    await store.setServer(
      keys.localId,
      other.serverUrl,
      readable.map(({ id, envelope }) => ({
        id,
        envelope: resealEnvelope({
          key: keys.key,
          groupId: keys.groupId,
          newKey: keys.key,
          newGroupId: other.groupId,
          envelope,
        }),
      })),
    );
    const after = await groupUsage(store, keys.localId, info({}));
    expect(after).toEqual(before);
    expect(after.events).toBe(ids.length);
  });

  it('is zero for an empty group', async () => {
    const store = await storeOf();
    const keys = groupKeys();
    await store.upsertGroup(groupRow(keys));
    await writeLocal(store, keys, new Events().created()); // another group's rows do not count
    const usage = await groupUsage(store, groupKeys().localId, info({}));
    expect(usage).toMatchObject({ bytes: 0, events: 0, fraction: 0, warn: false });
  });
});
