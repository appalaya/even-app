/**
 * The Groups rows publish as each group is derived (pre-launch review H3), so launch does not wait for the sum of
 * every group's decrypt: first every row at once from SQL alone (the cached name, no count or net yet), then each
 * group filled in, newest activity first, ending on the same rows as a list built from every derived state.
 */
import { deriveLocal, deriveServer, newSecret, seal } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { largeGroup } from '../dev/largeGroup';
import { STORE_KINDS } from '../services/testing/testStore';
import { GroupStateStore, type GroupListRow } from './groupState';
import { createWorld, SERVER, type Device, type World } from './testHarness';

const DAY = 86_400_000;

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

/** A group on `d` whose newest event is `daysAgo` old, cached under `cachedName` (the log names it `name`). */
async function groupOn(
  d: Device,
  events: number,
  daysAgo: number,
  name: string,
  cachedName: string,
): Promise<string> {
  const now = world?.clock.now() ?? Date.now();
  const group = largeGroup({ events, end: now - daysAgo * DAY, name, seed: events + daysAgo });
  const secret = newSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, SERVER);
  await d.secrets.setSecret(localId, secret, SERVER);
  await d.store.upsertGroup({
    localId,
    serverUrl: SERVER,
    epoch: null,
    cursor: 0,
    myMemberId: group.members[0]?.id ?? null,
    nameCache: cachedName,
    currencyCache: 'CAD',
    createdAt: now - 90 * DAY,
    lastSyncedAt: now,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
  });
  await d.store.insertEvents(
    localId,
    group.entries.map(({ id, event }) => ({
      id,
      origin: 'remote' as const,
      acked: true,
      seq: null,
      ts: event.ts,
      envelope: JSON.stringify(seal({ key, groupId, body: event, id })),
      status: 'ok' as const,
    })),
  );
  return localId;
}

describe.each(STORE_KINDS)('the Groups rows on the %s store', (kind) => {
  it('show at once as placeholders, then fill in newest first, ending as derived', async () => {
    world = await createWorld(kind);
    const a = await world.device('A');
    const old = await groupOn(a, 600, 20, 'Old trip', 'Old trip');
    const mid = await groupOn(a, 120, 5, 'Mid trip', 'Mid trip (cached)');
    const fresh = await groupOn(a, 110, 1, 'New trip', 'New trip');

    const state = new GroupStateStore({
      store: a.store,
      secrets: a.secrets,
      engine: { subscribe: () => () => undefined },
      locale: 'en-US',
      log: () => undefined,
    });
    const snapshots: (readonly GroupListRow[])[] = [];
    const done = new Promise<void>((resolve) => {
      state.subscribeList(() => {
        const snapshot = state.peekList();
        if (snapshot.status !== 'ready') return;
        snapshots.push(snapshot.rows);
        if (snapshot.rows.every((r) => r.memberCount !== null)) resolve();
      });
    });
    await done;

    // First: every row, from SQL alone, newest first by its latest event.
    const first = snapshots[0] ?? [];
    expect(first.map((r) => r.localId)).toEqual([fresh, mid, old]);
    expect(first.map((r) => r.name)).toEqual(['New trip', 'Mid trip (cached)', 'Old trip']);
    expect(first.every((r) => r.memberCount === null && r.myNet === null)).toBe(true);

    // Then filled one by one, newest first.
    const filledAt = (id: string) =>
      snapshots.findIndex((rows) => rows.find((r) => r.localId === id)?.memberCount != null);
    expect(filledAt(fresh)).toBeLessThan(filledAt(mid));
    expect(filledAt(mid)).toBeLessThan(filledAt(old));
    expect(snapshots).toHaveLength(4);

    // Last: what every derived state says, the log's name over the cached one.
    const last = snapshots.at(-1) ?? [];
    expect(last.map((r) => r.name)).toEqual(['New trip', 'Mid trip', 'Old trip']);
    for (const row of last) {
      const derived = await state.get(row.localId);
      expect(row).toMatchObject({
        memberCount: 50,
        myNet: derived?.myNet,
        hasActivity: true,
        lastActivityAt: derived?.lastActivityAt,
      });
    }
    expect(await state.list()).toEqual(last);
    state.dispose();
  });
});
