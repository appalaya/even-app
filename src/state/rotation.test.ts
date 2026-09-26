/**
 * Rotation, closure and recognition (design.md "Rotation, moving, closing"), with several devices through the fake
 * server, on both stores: a rotator, a straggler who wrote to the old group after the rotation, and a hostile device
 * that keeps the old invite.
 */
import { deriveLocal, deriveServer, open, parseEvent, type Event } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { isStateError, type StateErrorCode } from './errors';
import type { GroupService } from './groups';
import {
  body,
  createWorld,
  expectSynced,
  injectEvent,
  OTHER_SERVER,
  secretOn,
  SERVER,
  serverIds,
  sync,
  type Device,
  type World,
} from './testHarness';

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

async function setup(kind: StoreKind): Promise<World> {
  world = await createWorld(kind);
  return world;
}

function g(d: Device): GroupService {
  return d.services.groups;
}

async function rejectsWith(promise: Promise<unknown>, code: StateErrorCode): Promise<void> {
  let thrown: unknown = null;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }
  if (!isStateError(thrown, code)) {
    throw new Error(
      `expected ${code}, got ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
  }
}

async function state(d: Device, localId: string) {
  const derived = await d.services.groupState.get(localId);
  if (derived?.state == null) throw new Error('no state');
  return { derived, state: derived.state };
}

async function lifecycle(d: Device, localId: string) {
  return (await d.store.getGroup(localId))?.state ?? null;
}

/** Every stored row of a group on a device with its decrypted body (null when not a valid event). */
async function rows(
  d: Device,
  localId: string,
): Promise<{ id: string; origin: string; acked: boolean; event: Event | null }[]> {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row.serverUrl).groupId;
  return (await d.store.dump(localId)).map((stored) => {
    let event: Event | null = null;
    try {
      event = parseEvent(open({ key, groupId, envelope: JSON.parse(stored.envelope) }));
    } catch {
      event = null;
    }
    return { id: stored.id, origin: stored.origin, acked: stored.acked, event };
  });
}

/** The envelope id of the `expense.added` that created `expenseId`. */
async function envelopeOf(d: Device, localId: string, expenseId: string): Promise<string> {
  const found = (await rows(d, localId)).find(
    (r) => r.event?.type === 'expense.added' && r.event.expense.id === expenseId,
  );
  if (found === undefined) throw new Error('no such expense');
  return found.id;
}

function memberId(s: { members: Map<string, { id: string; name: string }> }, name: string): string {
  for (const m of s.members.values()) if (m.name === name) return m.id;
  throw new Error(`no member ${name}`);
}

const expense = (paidBy: string, title: string, members: string[]) => ({
  title,
  amount: 3_000,
  paidBy,
  date: '2026-02-10',
  category: 'food' as const,
  split: { mode: 'equal' as const, members },
});

/** A (Maya) creates; B claims Nathan; H claims Priya; everyone converges with two expenses. */
async function trio(w: World) {
  const a = await w.device('A');
  const b = await w.device('B');
  const h = await w.device('H');
  const { localId: g1, memberId: maya } = await g(a).createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Nathan', 'Priya'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, g1));
  const oldInvite = (await g(a).inviteFor(g1)).code;
  await g(b).joinInvite(oldInvite);
  await g(h).joinInvite(oldInvite);
  const members = (await state(a, g1)).state;
  const nathan = memberId(members, 'Nathan');
  const priya = memberId(members, 'Priya');
  await g(b).claimMember(g1, nathan);
  await g(h).claimMember(g1, priya);
  await g(a).addExpense(g1, expense(maya, 'Dinner', [maya, nathan, priya]));
  await g(b).addExpense(g1, expense(nathan, 'Gas', [maya, nathan]));
  for (const d of [a, b, h, a, b, h]) expectSynced(await sync(d, g1));
  return { a, b, h, g1, maya, nathan, priya, oldInvite };
}

describe.each(STORE_KINDS)('rotation on the %s store', (kind) => {
  it('end to end: the rotator, a straggler who wrote after the rotation, and a hostile device', async () => {
    const w = await setup(kind);
    const { a, b, h, g1, maya, nathan, priya, oldInvite } = await trio(w);
    const oldSecret = await secretOn(a, g1);

    // A control event in the old group before the rotation (H announces a move nobody followed).
    const preControl = await injectEvent(
      h,
      g1,
      body(
        { type: 'group.moved', server: OTHER_SERVER },
        priya,
        h.services.deviceId,
        w.clock.now(),
      ),
    );
    expectSynced(await sync(h, g1));
    expectSynced(await sync(a, g1));
    const before = await state(a, g1);

    // ----- A rotates, removing Priya (H's seat) -----
    const rotated = await g(a).rotateInvite(g1, { removeMemberId: priya });
    const g2 = rotated.localId;
    await a.services.idle();
    expect(g2).not.toBe(g1);
    expectSynced(rotated.lastSync);
    expectSynced(rotated.pushed);
    expectSynced(rotated.closing);
    expect(rotated.invite.ready).toBe(true);

    // The old group: closed on the server, hidden on the rotator, not deleted from the server.
    expect(await lifecycle(a, g1)).toBe('hidden');
    const closure = (await rows(a, g1)).find((r) => r.event?.type === 'group.closed');
    expect(closure?.event).toMatchObject({ reason: 'rotated', to: g2, by: maya });
    expect(serverIds(w, oldSecret)).toContain(closure?.id);

    // The new group: every readable old event (same ids, same origins), minus control events, plus the marks.
    const newSecret = await secretOn(a, g2);
    const newRows = await rows(a, g2);
    const oldRows = await rows(a, g1);
    const copied = oldRows.filter(
      (r) => r.event !== null && !['group.moved', 'group.closed'].includes(r.event.type),
    );
    const pairs = (list: { id: string; origin: string }[]) =>
      list.map((r) => `${r.id}:${r.origin}`).sort();
    expect(pairs(newRows.slice(0, copied.length))).toEqual(pairs(copied));
    expect(newRows.map((r) => r.id)).not.toContain(preControl);
    expect(newRows.map((r) => r.id)).not.toContain(closure?.id);
    expect(newRows.slice(copied.length).map((r) => r.event?.type)).toEqual([
      'group.rotated',
      'member.archived',
    ]);
    expect(newRows.at(-2)?.event).toMatchObject({ type: 'group.rotated', from: g1, by: maya });
    expect(newRows.at(-1)?.event).toMatchObject({ type: 'member.archived', id: priya });
    expect(serverIds(w, newSecret).sort()).toEqual(newRows.map((r) => r.id).sort());
    expect(await a.store.getGroup(g2)).toMatchObject({
      state: 'active',
      myMemberId: maya,
      nameCache: 'Banff 2026',
    });
    const after = await state(a, g2);
    expect(after.state.rotatedFrom).toEqual([g1]);
    expect(after.state.members.get(priya)?.archived).toBe(true);
    expect([...after.state.expenses.keys()].sort()).toEqual(
      [...before.state.expenses.keys()].sort(),
    );
    expect(after.derived.nets).toEqual(before.derived.nets);
    // The rotator does not "recognise" its own rotation: nothing was rescued twice, and the list shows one group.
    expect((await a.services.groupState.list()).map((r) => r.localId)).toEqual([g2]);

    // ----- After the rotation: the straggler writes to the old group before hearing of it -----
    const lateExpense = await g(b).addExpense(g1, expense(nathan, 'Late dinner', [maya, nathan]));
    const late = await envelopeOf(b, g1, lateExpense);
    const lateControl = await injectEvent(
      b,
      g1,
      body(
        { type: 'group.moved', server: 'https://third.test' },
        nathan,
        b.services.deviceId,
        w.clock.now(),
      ),
    );
    // ... and the hostile device keeps writing to the old group with the old invite.
    const hostileExpense = await g(h).addExpense(
      g1,
      expense(priya, 'Hostile', [maya, nathan, priya]),
    );
    const hostile = await envelopeOf(h, g1, hostileExpense);
    expectSynced(await sync(h, g1));
    expect(await lifecycle(h, g1)).toBe('closed');
    expect((await sync(h, g1)).outcome).toBe('skipped'); // closed groups never sync

    // The straggler syncs the old group: its writes go up, the closure and H's write come down; it is closed.
    expectSynced(await sync(b, g1));
    expect(await lifecycle(b, g1)).toBe('closed');
    const closed = await state(b, g1);
    expect(closed.derived.readOnly).toBe('closed');
    expect(closed.state.closed).toEqual({ reason: 'rotated', to: g2 });
    await rejectsWith(g(b).addExpense(g1, expense(nathan, 'Nope', [nathan])), 'read_only');
    expect(await g(b).joinInvite(oldInvite)).toEqual({
      kind: 'closedGroupInvite',
      localId: g1,
      state: 'closed',
    });

    // ----- The straggler pastes the new invite: recognition -----
    const oldSyncs = () => b.events.filter((e) => e.type === 'started' && e.localId === g1).length;
    const syncsBefore = oldSyncs();
    const joined = await g(b).joinInvite(rotated.invite.code);
    await b.services.idle();
    expect(oldSyncs()).toBe(syncsBefore + 1); // the closed group's one last sync
    expect(joined).toMatchObject({
      kind: 'joined',
      localId: g2,
      needsClaim: false,
      waiting: false,
    });
    expect(await lifecycle(b, g1)).toBe('hidden');
    expect((await b.store.getGroup(g2))?.myMemberId).toBe(nathan); // carried over
    const rescued = await rows(b, g2);
    const byId = new Map(rescued.map((r) => [r.id, r]));
    expect(byId.get(late)).toMatchObject({ origin: 'local', acked: false });
    expect(byId.has(lateControl)).toBe(false); // control events never cross
    expect(byId.has(hostile)).toBe(false); // not this device's own write
    expect(byId.has(closure?.id ?? '')).toBe(false);
    expect(rescued.filter((r) => r.origin === 'local' && !r.acked).map((r) => r.id)).toEqual([
      late,
    ]);

    // The rescued write reaches the new group on the server, and the rotator sees it; the hostile one never does.
    expectSynced(await sync(b, g2));
    expect(serverIds(w, newSecret)).toContain(late);
    expect(serverIds(w, newSecret)).not.toContain(hostile);
    expectSynced(await sync(a, g2));
    const titles = [...(await state(a, g2)).state.expenses.values()].map((e) => e.title).sort();
    expect(titles).toEqual(['Dinner', 'Gas', 'Late dinner']);
    expect((await b.services.groupState.list()).map((r) => r.localId)).toEqual([g2]);

    // H is left with a read-only copy up to the closure and no way into the new group.
    expect(await h.secrets.getSecret(g2)).toBeNull();
    expect((await state(h, g1)).derived.readOnly).toBe('closed');
  });

  it('the rotator hides the old group only once its closure is acknowledged, across a restart', async () => {
    const w = await setup(kind);
    const { a, g1, maya } = await trio(w);
    const oldSecret = await secretOn(a, g1);

    w.server().offline = true;
    const rotated = await g(a).rotateInvite(g1);
    const g2 = rotated.localId;
    await a.services.idle();
    expect(rotated.lastSync.outcome).toBe('failed');
    expect(rotated.pushed.outcome).toBe('failed');
    expect(rotated.closing.outcome).toBe('failed');
    expect(rotated.invite.ready).toBe(false);

    // Still active (it must keep syncing), but read-only: its own closure is in the log.
    expect(await lifecycle(a, g1)).toBe('active');
    const pending = await state(a, g1);
    expect(pending.derived.readOnly).toBe('closed');
    expect(pending.derived.localClosure?.to).toBe(g2);
    await rejectsWith(g(a).addExpense(g1, expense(maya, 'Nope', [maya])), 'read_only');
    // The new group's marker does not make the rotator rescue into it.
    const copies = (await a.store.dump(g2)).length;

    let restarted = await w.restart(a);
    expect(await lifecycle(restarted, g1)).toBe('active');
    expect((await restarted.store.dump(g2)).length).toBe(copies);

    w.server().offline = false;
    restarted = await w.restart(restarted);
    expectSynced(await sync(restarted, g2));
    expect(await lifecycle(restarted, g1)).toBe('active');
    expectSynced(await sync(restarted, g1));
    expect(await lifecycle(restarted, g1)).toBe('hidden');
    const closureId = (await rows(restarted, g1)).find((r) => r.event?.type === 'group.closed')?.id;
    expect(serverIds(w, oldSecret)).toContain(closureId);
    expect((await restarted.store.dump(g2)).length).toBe(copies);
    expect((await g(restarted).inviteFor(g2)).ready).toBe(true);
  });

  it('refuses what the confirmation sheet cannot offer', async () => {
    const w = await setup(kind);
    const { a, b, g1, maya } = await trio(w);
    await rejectsWith(g(a).rotateInvite(g1, { removeMemberId: maya }), 'not_allowed');
    await rejectsWith(
      g(a).rotateInvite(g1, { removeMemberId: 'AAAAAAAAAAAAAAAAAAAAAA' }),
      'not_found',
    );
    await rejectsWith(g(a).rotateInvite(g1, { serverUrl: 'ftp://x' }), 'invalid_url');
    const { localId: g2 } = await g(a).rotateInvite(g1);
    await a.services.idle();
    await rejectsWith(g(a).rotateInvite(g1), 'read_only'); // hidden now
    // B has not synced: its first step (the last sync) brings the closure, so B cannot rotate it again.
    await rejectsWith(g(b).rotateInvite(g1), 'read_only');
    expect(await lifecycle(b, g1)).toBe('closed');
    expect(g2).toBeTruthy();
  });

  it('can move the new group to another server', async () => {
    const w = await setup(kind);
    const { a, g1 } = await trio(w);
    const rotated = await g(a).rotateInvite(g1, { serverUrl: OTHER_SERVER });
    await a.services.idle();
    expect(await a.store.getGroup(rotated.localId)).toMatchObject({ serverUrl: OTHER_SERVER });
    const index = new Map((await a.secrets.listGroups()).map((e) => [e.localId, e.serverUrl]));
    expect(index.get(rotated.localId)).toBe(OTHER_SERVER);
    const newSecret = await secretOn(a, rotated.localId);
    expect(serverIds(w, newSecret, OTHER_SERVER).length).toBe(
      (await a.store.dump(rotated.localId)).length,
    );
    expect(serverIds(w, newSecret, SERVER)).toEqual([]);
    expect(await lifecycle(a, g1)).toBe('hidden');
  });

  it('two concurrent rotations: both new groups show, marked as siblings, and the user hides one', async () => {
    const w = await setup(kind);
    const { a, b, h, g1 } = await trio(w);
    const first = await g(a).rotateInvite(g1);
    await a.services.idle();
    // H rotates too, offline, before it could hear of A's rotation.
    w.server().offline = true;
    const second = await g(h).rotateInvite(g1);
    w.server().offline = false;
    await h.services.idle();
    expectSynced(await sync(h, second.localId));
    expectSynced(await sync(h, g1));

    expectSynced(await sync(b, g1));
    expect(await lifecycle(b, g1)).toBe('closed');
    await g(b).joinInvite(first.invite.code);
    await b.services.idle();
    expect(await lifecycle(b, g1)).toBe('hidden');
    await g(b).joinInvite((await g(h).inviteFor(second.localId)).code);
    await b.services.idle();

    const list = await b.services.groupState.list();
    expect(list.map((r) => r.localId).sort()).toEqual([first.localId, second.localId].sort());
    expect(list.find((r) => r.localId === first.localId)?.rotationSiblings).toEqual([
      second.localId,
    ]);
    expect(list.find((r) => r.localId === second.localId)?.rotationSiblings).toEqual([
      first.localId,
    ]);
    await g(b).hideGroup(second.localId);
    expect((await b.services.groupState.list()).map((r) => r.localId)).toEqual([first.localId]);
  });
});
