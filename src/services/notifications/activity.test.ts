/**
 * Background refresh → notifications, through the real state layer: phone A (this phone) and phone B (Maya) share a
 * group on the fake server; B adds expenses; A's background refresh pulls them and plans one notification.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../testing/testStore';
import {
  createWorld,
  expectSynced,
  sync,
  SERVER,
  type Device,
  type World,
} from '../../state/testHarness';
import { planActivityNotifications } from './activity';

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

const DAY = 24 * 60 * 60 * 1000;
const TODAY = '2026-09-26';

async function twoPhones(kind: StoreKind) {
  world = await createWorld(kind);
  const a = await world.device('A');
  const b = await world.device('B');
  const { localId, memberId: sam } = await a.services.groups.createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Sam',
    people: ['Maya'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, localId));
  const invite = await a.services.groups.inviteFor(localId);
  const joined = await b.services.groups.joinInvite(invite.link);
  if (joined.kind !== 'joined') throw new Error('expected joined');
  const state = (await b.services.groupState.get(localId))?.state;
  const maya = [...(state?.members.values() ?? [])].find((m) => m.name === 'Maya');
  if (maya === undefined) throw new Error('no Maya');
  await b.services.groups.claimMember(localId, maya.id);
  expectSynced(await sync(b, localId));
  expectSynced(await sync(a, localId));
  return { a, b, localId, sam, maya: maya.id };
}

async function addDinner(
  d: Device,
  localId: string,
  paidBy: string,
  title: string,
  amount: number,
) {
  await d.services.groups.addExpense(localId, {
    title,
    amount,
    paidBy,
    date: TODAY,
    category: 'food',
    split: { mode: 'equal', members: [paidBy] },
  });
}

async function background(d: Device) {
  const results = await d.services.backgroundRefresh();
  await d.services.idle();
  return results;
}

describe.each(STORE_KINDS)('background refresh plans notifications (%s store)', (kind) => {
  it("announces another phone's expense with its activity summary", async () => {
    const { a, b, localId, maya } = await twoPhones(kind);
    await addDinner(b, localId, maya, 'Dinner', 9000);
    expectSynced(await sync(b, localId));

    const results = await background(a);
    const planned = await planActivityNotifications(a.services, results);
    expect(planned).toEqual([
      {
        localId,
        identifier: `activity:${localId}`,
        title: 'Banff 2026',
        body: expect.stringMatching(/^Maya added Dinner · .*90\.00$/),
        count: 1,
      },
    ]);
  });

  it('coalesces several into one per group, and says nothing about its own writes', async () => {
    const { a, b, localId, sam, maya } = await twoPhones(kind);
    await addDinner(b, localId, maya, 'Dinner', 9000);
    await addDinner(b, localId, maya, 'Taxi', 2400);
    await addDinner(b, localId, maya, 'Lift tickets', 31000);
    expectSynced(await sync(b, localId));
    await addDinner(a, localId, sam, 'Gas', 4000);

    const planned = await planActivityNotifications(a.services, await background(a));
    expect(planned.map((p) => p.body)).toEqual(['3 new in Banff 2026']);

    // The next cycle has nothing new: nothing to say.
    expect(await planActivityNotifications(a.services, await background(a))).toEqual([]);
  });

  it('events a foreground sync already brought in are not announced later', async () => {
    const { a, b, localId, maya } = await twoPhones(kind);
    await addDinner(b, localId, maya, 'Dinner', 9000);
    expectSynced(await sync(b, localId));
    await a.services.foreground();
    await a.services.idle();
    expect(await planActivityNotifications(a.services, await background(a))).toEqual([]);
  });

  it('a group idle for more than 30 days is not synced in the background, so it says nothing', async () => {
    const { a, b, localId, maya } = await twoPhones(kind);
    await world?.clock.advance(31 * DAY);
    await addDinner(b, localId, maya, 'Dinner', 9000);
    expectSynced(await sync(b, localId));
    // A's own log is older than 30 days: the background trigger skips the group.
    const results = await background(a);
    expect(results.some((r) => r.localId === localId && r.outcome === 'synced')).toBe(false);
    expect(await planActivityNotifications(a.services, results)).toEqual([]);
  });
});
