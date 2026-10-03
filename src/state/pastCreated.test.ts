/**
 * The past-dated `group.created` (pre-launch review, the sibling of H2; design.md "Reducer"), through the app's own
 * services and the fake server, on both stores. A hostile member writes a second `group.created` stamped at the floor
 * of the validator's range (2024-01-01) in another currency. If the earliest claim won, the group's currency would be
 * the attacker's for good (it is immutable), every expense would read `currency_mismatch`, the balances would be
 * empty, and regenerating the invite, which copied every `group.created`, could not undo it.
 */
import { deriveLocal, deriveServer, LIMITS, open, parseEvent, type Event } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import type { GroupService } from './groups';
import {
  body,
  createWorld,
  expectSynced,
  injectEvent,
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
  const h = await w.device('H');
  const { localId: g1, memberId: maya } = await g(a).createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Priya'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, g1));
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
  for (const d of [h, a, h, a]) expectSynced(await sync(d, g1));
  return { w, a, h, g1, maya, priya, dinner, forged };
}

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
