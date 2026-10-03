/**
 * The past-dated `group.created` (pre-launch review, the sibling of H2; design.md "Reducer"), through the app's own
 * services and the fake server, on both stores. A hostile member writes a second `group.created` stamped at the floor
 * of the validator's range (2024-01-01) in another currency. If the earliest claim won, the group's currency would be
 * the attacker's for good (it is immutable), every expense would read `currency_mismatch`, the balances would be
 * empty, and regenerating the invite, which copied every `group.created`, could not undo it.
 */
import {
  deriveLocal,
  deriveServer,
  LIMITS,
  open,
  parseEvent,
  type Envelope,
  type Event,
} from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import type { GroupService } from './groups';
import {
  body,
  createWorld,
  expectSynced,
  injectEvent,
  OTHER_SERVER,
  secretOn,
  SERVER,
  sync,
  type Device,
  type World,
} from './testHarness';

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

function g(d: Device): GroupService {
  return d.services.groups;
}

async function derived(d: Device, localId: string) {
  const got = await d.services.groupState.get(localId);
  if (got?.state == null) throw new Error('no state');
  return { ...got, state: got.state };
}

/** Every valid event stored for a group on a device. */
async function events(d: Device, localId: string): Promise<{ id: string; event: Event }[]> {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row.serverUrl).groupId;
  const out: { id: string; event: Event }[] = [];
  for (const stored of await d.store.dump(localId)) {
    const event = parseEvent(open({ key, groupId, envelope: JSON.parse(stored.envelope) }));
    if (event !== null) out.push({ id: stored.id, event });
  }
  return out;
}

async function attacked(kind: StoreKind) {
  world = await createWorld(kind);
  const w = world;
  const a = await w.device('A');
  const b = await w.device('B');
  const h = await w.device('H');
  const { localId: g1, memberId: maya } = await g(a).createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Priya'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, g1));
  await g(b).joinInvite((await g(a).inviteFor(g1)).code);
  await g(h).joinInvite((await g(a).inviteFor(g1)).code);
  const priya = [...(await derived(h, g1)).state!.members.values()].find(
    (m) => m.name === 'Priya',
  )!.id;
  await g(h).claimMember(g1, priya);
  const dinner = await g(a).addExpense(g1, {
    title: 'Dinner',
    amount: 9_000,
    paidBy: maya,
    date: '2026-02-01',
    category: 'food',
    split: { mode: 'equal', members: [maya, priya] },
  });
  for (const d of [a, h, a]) expectSynced(await sync(d, g1));
  await w.clock.advance(60 * 60 * 1000);
  // The attack: a second creation, claiming the floor of the range, in another currency.
  const forged = await injectEvent(
    h,
    g1,
    body(
      { type: 'group.created', name: 'Pwned', currency: 'EUR' },
      priya,
      h.services.deviceId,
      LIMITS.tsMin,
    ),
  );
  for (const d of [h, a, b, h, a, b]) expectSynced(await sync(d, g1));
  return { w, a, b, h, g1, maya, priya, dinner, forged };
}

type Attacked = Awaited<ReturnType<typeof attacked>>;

/** The group's currency as each of `devices` reads it, its derived state's and its cache's. */
async function currencies(devices: readonly Device[], localId: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of devices) {
    const got = await derived(d, localId);
    out.push(`${got.state.currency}/${got.currency}/${got.row.currencyCache}`);
  }
  return out;
}

const CAD = 'CAD/CAD/CAD';

/** A phone that joins the group now, through Maya's invite (naming the group's server as it is now). */
async function newJoiner(t: Attacked, name: string): Promise<Device> {
  const c = await t.w.device(name);
  await g(c).joinInvite((await g(t.a).inviteFor(t.g1)).code);
  expectSynced(await sync(c, t.g1));
  return c;
}

/** Every phone syncs, H last (it has nothing to add), twice. */
async function syncAll(t: Attacked, devices: readonly Device[] = [t.a, t.b, t.h]): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const d of devices) expectSynced(await sync(d, t.g1));
  }
}

describe.each(STORE_KINDS)(
  'the pinned creation survives every re-formed copy on the %s store (review H5)',
  (kind) => {
    it('every phone pinned the creation that arrived first', async () => {
      const t = await attacked(kind);
      for (const d of [t.a, t.b, t.h]) {
        const row = await d.store.getGroup(t.g1);
        expect(row?.creationId).not.toBeNull();
        expect(row?.creationId).not.toBe(t.forged);
      }
      expect(await currencies([t.a, t.b, t.h], t.g1)).toEqual([CAD, CAD, CAD]);
    });

    it('an honest server move: every phone, and a phone that joins afterwards, keep the creation', async () => {
      const t = await attacked(kind);
      expect(await g(t.a).moveServer(t.g1, OTHER_SERVER)).toMatchObject({ outcome: 'moved' });
      for (const d of [t.b, t.h]) {
        await sync(d, t.g1);
        expect(await g(d).followMove(t.g1)).toMatchObject({ outcome: 'moved' });
      }
      await syncAll(t);
      // The first request the new copy stored is the creation, alone: it arrived before the backdated one.
      const secret = await secretOn(t.a, t.g1);
      const first = t.w.server(OTHER_SERVER).stored(deriveServer(secret, OTHER_SERVER).groupId)[0];
      expect(first?.id).toBe((await t.a.store.getGroup(t.g1))?.creationId);
      expect(await currencies([t.a, t.b, t.h], t.g1)).toEqual([CAD, CAD, CAD]);
      expect(await currencies([await newJoiner(t, 'C')], t.g1)).toEqual([CAD]);
    });

    it('a server wipe (idle expiry): every phone, and a phone that joins afterwards, keep the creation', async () => {
      const t = await attacked(kind);
      const secret = await secretOn(t.a, t.g1);
      t.w.server().wipe(deriveServer(secret, SERVER).groupId);
      await t.w.clock.advance(60_000);
      // H re-pushes first this time: an honest client sends its pinned creation alone first too.
      await syncAll(t, [t.h, t.a, t.b]);
      expect(await currencies([t.a, t.b, t.h], t.g1)).toEqual([CAD, CAD, CAD]);
      expect(await currencies([await newJoiner(t, 'C')], t.g1)).toEqual([CAD]);
    });

    it('an honest Leave with "Also delete the copy": the others, and a phone that joins afterwards, keep the creation', async () => {
      const t = await attacked(kind);
      expect(await g(t.b).leaveGroup(t.g1, { deleteServerCopy: true })).toMatchObject({
        serverCopy: { outcome: 'deleted' },
      });
      await t.w.clock.advance(60_000);
      await syncAll(t, [t.a, t.h]);
      expect(await currencies([t.a, t.h], t.g1)).toEqual([CAD, CAD]);
      expect(await currencies([await newJoiner(t, 'C')], t.g1)).toEqual([CAD]);
    });

    it("the hostile member's DELETE race: existing members never flip; only a phone that joins afterwards sees it, and a rotation by an existing member restores it", async () => {
      const t = await attacked(kind);
      // H deletes the copy and at once pushes the backdated creation alone, so it is the first the new copy stores.
      const secret = await secretOn(t.h, t.g1);
      const { groupId, authToken } = deriveServer(secret, SERVER);
      const transport = t.w.server().transport();
      await transport.delete(groupId, authToken);
      const forged = (await t.h.store.dump(t.g1)).find((r) => r.id === t.forged);
      await transport.push(groupId, authToken, [JSON.parse(forged?.envelope ?? '{}') as Envelope]);
      expect(t.w.server().stored(groupId)[0]?.id).toBe(t.forged);
      await t.w.clock.advance(60_000);
      await syncAll(t, [t.a, t.b]);
      // Existing members applied their pin all along.
      expect(await currencies([t.a, t.b], t.g1)).toEqual([CAD, CAD]);
      // A phone that joins now has no pin, and on this copy the backdated creation arrived first.
      const c = await newJoiner(t, 'C');
      expect((await derived(c, t.g1)).state.currency).toBe('EUR');
      // Maya regenerates the invite, removing Priya: the new group carries and pins her creation.
      const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
      await t.a.services.idle();
      expect((await t.a.store.getGroup(rotated.localId))?.creationId).toBe(
        (await t.a.store.getGroup(t.g1))?.creationId,
      );
      const g2 = rotated.localId;
      await g(c).joinInvite(rotated.invite.code);
      expectSynced(await sync(c, g2));
      expect(await currencies([t.a, c], g2)).toEqual([CAD, CAD]);
    });
  },
);

describe.each(STORE_KINDS)('a past-dated group.created on the %s store', (kind) => {
  it("does not take the group: its currency, name and balances stay the creator's, on every phone", async () => {
    const t = await attacked(kind);
    for (const d of [t.a, t.h]) {
      const got = await derived(d, t.g1);
      expect([got.currency, got.state.currency, got.state.name]).toEqual([
        'CAD',
        'CAD',
        'Banff 2026',
      ]);
      expect(got.state.flagged).toEqual([]);
      expect(got.nets?.get(t.maya)).toBe(4_500);
      expect(got.updateRequired).toBe(false);
      expect(got.state.activity.map((item) => item.eventId)).not.toContain(t.forged);
      expect(await d.store.getGroup(t.g1)).toMatchObject({
        currencyCache: 'CAD',
        nameCache: 'Banff 2026',
      });
    }
  });

  it('regenerating the invite copies only the creation that took effect', async () => {
    const t = await attacked(kind);
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const g2 = rotated.localId;
    const created = (await events(t.a, g2)).filter((e) => e.event.type === 'group.created');
    expect(created.map((e) => e.id)).toHaveLength(1);
    expect(created[0]?.event).toMatchObject({ currency: 'CAD', name: 'Banff 2026' });
    const got = await derived(t.a, g2);
    expect([got.currency, got.state.currency]).toEqual(['CAD', 'CAD']);
    expect(got.state.flagged).toEqual([]);
    expect(got.nets?.get(t.maya)).toBe(4_500);
  });
});
