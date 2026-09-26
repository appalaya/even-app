import { envelopeStoredSize, newId } from '@even/core';
import { describe, expect, it } from 'vitest';

import { createFakeStore } from '../testing/fakeStore';
import { FAKE_LIMITS } from '../testing/fakeTransport';
import { Events, groupKeys, groupRow, sealFor, writeLocal } from '../testing/fixtures';
import type { ServerInfo } from './types';
import { groupUsage } from './usage';

function info(limits: Partial<ServerInfo['limits']>): ServerInfo {
  return { protocol: [1], limits: { ...FAKE_LIMITS, ...limits }, retention_days: 365, push: false };
}

describe('groupUsage', () => {
  it('sums stored sizes (decoded c + 64) against both caps and warns at 80%', async () => {
    const store = createFakeStore();
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

  it('is zero for an empty group', async () => {
    const store = createFakeStore();
    const keys = groupKeys();
    await store.upsertGroup(groupRow(keys));
    await writeLocal(store, keys, new Events().created()); // another group's rows do not count
    const usage = await groupUsage(store, groupKeys().localId, info({}));
    expect(usage).toMatchObject({ bytes: 0, events: 0, fraction: 0, warn: false });
  });
});
