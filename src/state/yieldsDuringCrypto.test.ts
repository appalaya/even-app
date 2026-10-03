/**
 * The long crypto loops hand the JavaScript thread back (pre-launch review H3): deriving a group, a pull, a server
 * move and a rotation each let a timer fire part-way through once they go past one slice, so a screen can draw its
 * loading state and answer touches meanwhile. Every store, secret and fake-server call in this world settles in
 * microtasks, so a timer that fires between two store calls can only have been let through by those loops.
 */
import { deriveLocal, deriveServer, encodeInvite, makeInvite, newSecret, seal } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { largeGroup } from '../dev/largeGroup';
import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { OPENS_PER_YIELD } from '../services/yieldToEventLoop';
import type { GroupSnapshot } from './groupState';
import { createWorld, OTHER_SERVER, SERVER, type Device, type World } from './testHarness';

const EVENTS = 2 * OPENS_PER_YIELD + 50;

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

/** A group of `EVENTS` events on `d`, stored as a sync would leave it, with a seat; not derived yet. */
async function bigGroupOn(d: Device): Promise<{ localId: string; secret: Uint8Array }> {
  const now = world?.clock.now() ?? Date.now();
  const group = largeGroup({ events: EVENTS, end: now - 60_000, name: 'Big trip' });
  const secret = newSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, SERVER);
  await d.secrets.setSecret(localId, secret, SERVER);
  await d.store.upsertGroup({
    localId,
    serverUrl: SERVER,
    epoch: null,
    cursor: 0,
    myMemberId: group.members[4]?.id ?? null,
    nameCache: group.name,
    currencyCache: group.currency,
    createdAt: now - 70 * 86_400_000,
    lastSyncedAt: null,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
    creationId: null,
  });
  await d.store.insertEvents(
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
  return { localId, secret };
}

/** Runs `fn` with a zero-delay timer chain writing `tick` into the store's call log each time it gets the thread. */
async function withTicks<T>(
  d: Device,
  fn: () => Promise<T>,
): Promise<{ value: T; calls: string[] }> {
  const from = d.store.calls.length;
  let running = true;
  const tick = (): void => {
    if (!running) return;
    d.store.calls.push('tick');
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  const value = await fn();
  running = false;
  return { value, calls: d.store.calls.slice(from) };
}

/** True when a `tick` falls after the first `after` call and before the first `before` call that follows it. */
function tickBetween(calls: readonly string[], after: string, before: string): boolean {
  const start = calls.indexOf(after);
  const end = calls.indexOf(before, start + 1);
  return start >= 0 && end > start && calls.slice(start, end).includes('tick');
}

describe.each(STORE_KINDS)('crypto loops yield the thread on the %s store', (kind: StoreKind) => {
  it('a derive opens a large group in slices, under its cached name until it lands', async () => {
    world = await createWorld(kind);
    const a = await world.device('A');
    const { localId } = await bigGroupOn(a);
    const seen: GroupSnapshot[] = [];
    const unsubscribe = a.services.groupState.subscribe(localId, () =>
      seen.push(a.services.groupState.peek(localId)),
    );
    const { value, calls } = await withTicks(a, () => a.services.groupState.get(localId));
    unsubscribe();
    expect(value?.state?.expenses.size).toBeGreaterThan(100);
    // listEnvelopes is the derive's last store call before the decrypt loop; the next derive starts with getGroup.
    expect(calls.slice(calls.indexOf('listEnvelopes')).includes('tick')).toBe(true);
    expect(seen[0]).toMatchObject({ status: 'loading', derived: null, name: 'Big trip' });
    expect(seen.at(-1)?.status).toBe('ready');
  });

  it('a server move re-encrypts in slices, inside its transaction', async () => {
    world = await createWorld(kind);
    const a = await world.device('A');
    const { localId } = await bigGroupOn(a);
    const { value, calls } = await withTicks(a, () =>
      a.services.engine.moveServer(localId, OTHER_SERVER),
    );
    expect(value.outcome).toBe('moved');
    expect(tickBetween(calls, 'listReadable', 'setServer')).toBe(true);
  });

  it('a rotation re-encrypts in slices', async () => {
    world = await createWorld(kind);
    const a = await world.device('A');
    const { localId } = await bigGroupOn(a);
    await a.services.groupState.get(localId);
    const { calls } = await withTicks(a, () => a.services.groups.rotateInvite(localId));
    // The copy is built between reading the old log and writing the new group's row.
    const start = calls.lastIndexOf('listEnvelopes', calls.indexOf('upsertGroup'));
    expect(calls.slice(start, calls.indexOf('upsertGroup')).includes('tick')).toBe(true);
  });

  it('a join opens each pulled page in slices', async () => {
    world = await createWorld(kind);
    const a = await world.device('A');
    const { localId, secret } = await bigGroupOn(a);
    await a.services.engine.syncGroup(localId, { trigger: 'manual' });
    const b = await world.device('B');
    const code = encodeInvite(makeInvite(secret, SERVER, { g: 'Big trip', cur: 'CAD' }));
    const { value, calls } = await withTicks(b, () => b.services.groups.joinInvite(code));
    expect(value.kind).toBe('joined');
    // The first page is classified (opened) between setting up the row and committing the page.
    expect(tickBetween(calls, 'upsertGroup', 'insertEvents')).toBe(true);
  });
});
