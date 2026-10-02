/**
 * One decode cache for the engine, the derived state and rotation (pre-launch review H3): an envelope is opened
 * once. Counted by wrapping core's `open` and `openMany` (each envelope of a batch counts once), which every one of
 * them calls to decrypt a body (`resealEnvelope` opens through core's own internals, so a re-encryption is not
 * counted, only the reads around it).
 */
import { deriveLocal, deriveServer, encodeInvite, makeInvite, newSecret, seal } from '@even/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { largeGroup } from '../dev/largeGroup';
import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { createWorld, OTHER_SERVER, SERVER, sync, type Device, type World } from './testHarness';

const opened = vi.hoisted(() => ({ count: 0 }));
vi.mock('@even/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@even/core')>();
  return {
    ...core,
    open: (...args: Parameters<typeof core.open>) => {
      opened.count += 1;
      return core.open(...args);
    },
    openMany: (...args: Parameters<typeof core.openMany>) => {
      opened.count += args[0].envelopes.length;
      return core.openMany(...args);
    },
  };
});

const EVENTS = 150;

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

/** `fn`'s count of opened envelopes, with every lifecycle task it started included. */
async function opens(d: Device, fn: () => Promise<unknown>): Promise<number> {
  await d.services.idle();
  const before = opened.count;
  await fn();
  await d.services.idle();
  return opened.count - before;
}

/** A's group of `EVENTS` events, pushed to the server, and B joined to it. */
async function joined(kind: StoreKind) {
  world = await createWorld(kind);
  const a = await world.device('A');
  const now = world.clock.now();
  const group = largeGroup({ events: EVENTS, end: now - 60_000, name: 'Big trip' });
  const secret = newSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, SERVER);
  await a.secrets.setSecret(localId, secret, SERVER);
  await a.store.upsertGroup({
    localId,
    serverUrl: SERVER,
    epoch: null,
    cursor: 0,
    myMemberId: group.members[0]?.id ?? null,
    nameCache: 'Big trip',
    currencyCache: 'CAD',
    createdAt: now - 86_400_000,
    lastSyncedAt: null,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
  });
  await a.store.insertEvents(
    localId,
    group.entries.map(({ id, event }) => ({
      id,
      origin: 'local' as const,
      acked: false,
      seq: null,
      ts: event.ts,
      envelope: JSON.stringify(seal({ key, groupId, body: event, id })),
      status: 'ok' as const,
    })),
  );
  await sync(a, localId);
  const b = await world.device('B');
  // The invite names no group: the name and currency B shows come from the log.
  const code = encodeInvite(makeInvite(secret, SERVER));
  const joining = await opens(b, () => b.services.groups.joinInvite(code));
  const member = group.members[1]?.id ?? '';
  return { a, b, localId, joining, member };
}

describe.each(STORE_KINDS)('one decode cache on the %s store', (kind) => {
  it('a join opens each envelope once, and the name cache comes from the derived state', async () => {
    const { b, localId, joining } = await joined(kind);
    // The pull opened each one; the name cache and the lifecycle's derive opened none again (they were 3 each).
    expect(joining).toBe(EVENTS);
    expect(await b.store.getGroup(localId)).toMatchObject({
      nameCache: 'Big trip',
      currencyCache: 'CAD',
    });
    expect((await b.services.groupState.get(localId))?.state?.expenses.size).toBeGreaterThan(20);
  });

  it('a rename pulled later opens only itself, and the cached name follows it', async () => {
    const { a, b, localId } = await joined(kind);
    await a.services.groups.renameGroup(localId, 'Bigger trip');
    await sync(a, localId);
    expect(await opens(b, () => sync(b, localId))).toBe(1);
    expect((await b.store.getGroup(localId))?.nameCache).toBe('Bigger trip');
  });

  it('a server move opens nothing again: not its re-pull, not the derive after it', async () => {
    const { b, localId, member } = await joined(kind);
    await b.store.setMyMember(localId, member);
    b.services.groupState.invalidate(localId);
    const moving = await opens(b, async () => {
      expect(await b.services.groups.moveServer(localId, OTHER_SERVER)).toMatchObject({
        outcome: 'moved',
      });
      await b.services.groupState.get(localId);
    });
    // The one open is the group.moved announcement B wrote and pulled back before switching.
    expect(moving).toBe(1);
  });

  it('a rotation copies without opening, and the new group derives from what it carried', async () => {
    const { b, localId, member } = await joined(kind);
    await b.store.setMyMember(localId, member);
    b.services.groupState.invalidate(localId);
    await b.services.groupState.get(localId);
    let next = '';
    const rotating = await opens(b, async () => {
      next = (await b.services.groups.rotateInvite(localId)).localId;
      await b.services.groupState.get(next);
    });
    expect((await b.services.groupState.get(next))?.state?.expenses.size).toBeGreaterThan(20);
    // Only what the rotation itself wrote: the new group's group.rotated, the old group's group.closed.
    expect(rotating).toBeLessThanOrEqual(4);
  });
});
