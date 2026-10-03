/**
 * MoveEntriesPrompt (design.md "Recognising a rotation"): once the old group's closure names the new group,
 * recognition asks before carrying this phone's own entries across, asks once per rotation, keeps the move for the
 * old group's settings after Not now, and asks nothing when there is nothing to carry. On the fake store, with a
 * rotator (A) and a straggler (B) through the fake server.
 */
import { deriveLocal, deriveServer, LIMITS, newId, open, parseEvent } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { GroupService } from './groups';
import { parseNotNow, recognitionStep } from './moveOffers';
import {
  body,
  createWorld,
  expectSynced,
  injectEvent,
  SERVER,
  secretOn,
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

async function lifecycle(d: Device, localId: string) {
  return (await d.store.getGroup(localId))?.state ?? null;
}

/** The expense titles in a group's stored log on this device, with each row's origin and acked flag. */
async function expenseRows(d: Device, localId: string) {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row.serverUrl).groupId;
  const out: { title: string; origin: string; acked: boolean }[] = [];
  for (const stored of await d.store.dump(localId)) {
    try {
      const event = parseEvent(open({ key, groupId, envelope: JSON.parse(stored.envelope) }));
      if (event?.type === 'expense.added') {
        out.push({ title: event.expense.title, origin: stored.origin, acked: stored.acked });
      }
    } catch {
      // not an event this test reads
    }
  }
  return out;
}

const expense = (paidBy: string, title: string, members: string[]) => ({
  title,
  amount: 3_000,
  paidBy,
  date: '2026-02-10',
  category: 'food' as const,
  split: { mode: 'equal' as const, members },
});

/**
 * A (Maya) creates Banff 2026 with Nathan; B joins and claims Nathan; one expense; A regenerates the invite. Then B
 * writes `late` expenses to the old group before it hears of the rotation, syncs it (the closure arrives) and takes
 * the new invite.
 */
async function rotated(late: string[]) {
  const w = await createWorld('fake');
  world = w;
  const a = await w.device('A');
  const b = await w.device('B');
  const { localId: g1, memberId: maya } = await g(a).createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Nathan'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, g1));
  await g(b).joinInvite((await g(a).inviteFor(g1)).code);
  const state = (await b.services.groupState.get(g1))?.state;
  const nathan = [...(state?.members.values() ?? [])].find((m) => m.name === 'Nathan')?.id ?? '';
  await g(b).claimMember(g1, nathan);
  await g(a).addExpense(g1, expense(maya, 'Dinner', [maya, nathan]));
  for (const d of [a, b, a, b]) expectSynced(await sync(d, g1));

  const rotation = await g(a).rotateInvite(g1);
  await a.services.idle();
  expectSynced(rotation.closing);
  const g2 = rotation.localId;

  for (const title of late) await g(b).addExpense(g1, expense(nathan, title, [maya, nathan]));
  expectSynced(await sync(b, g1));
  expect(await lifecycle(b, g1)).toBe('closed');
  const oldSyncs = () => b.events.filter((e) => e.type === 'started' && e.localId === g1).length;
  const syncsBefore = oldSyncs();
  await g(b).joinInvite(rotation.invite.code);
  await b.services.idle();
  return { w, a, b, g1, g2, nathan, oldSyncs, syncsBefore };
}

describe('recognitionStep', () => {
  it('rescues when nothing is missing, asks the first time, and only offers after Not now', () => {
    expect(recognitionStep(0, false)).toBe('rescue');
    expect(recognitionStep(0, true)).toBe('rescue');
    expect(recognitionStep(3, false)).toBe('ask');
    expect(recognitionStep(1, true)).toBe('offer');
  });

  it('reads the Not now row as local ids, and anything else as none', () => {
    expect(parseNotNow(null)).toEqual([]);
    expect(parseNotNow('{not json')).toEqual([]);
    expect(parseNotNow('{"a":1}')).toEqual([]);
    expect(parseNotNow('["g1", 2, "g2"]')).toEqual(['g1', 'g2']);
  });
});

describe('MoveEntriesPrompt on the fake store', () => {
  it('asks over the new group when this phone wrote entries it lacks, and copies and hides nothing yet', async () => {
    const { b, g1, g2, oldSyncs, syncsBefore } = await rotated(['Late dinner', 'Gas', 'Ferry']);
    expect(g(b).moveOffers.peek()).toEqual([
      { to: g2, from: g1, fromName: 'Banff 2026', count: 3, asked: false },
    ]);
    expect(await lifecycle(b, g1)).toBe('closed');
    expect(oldSyncs()).toBe(syncsBefore); // not even the one last sync
    expect((await expenseRows(b, g2)).map((r) => r.title)).toEqual(['Dinner']);
    expect((await b.services.groupState.list()).map((r) => r.localId).sort()).toEqual(
      [g1, g2].sort(),
    );
  });

  it('asks nothing when the new group lacks none of its entries, and hides the old group as before', async () => {
    const { b, g1, g2, nathan, oldSyncs, syncsBefore } = await rotated([]);
    expect(g(b).moveOffers.peek()).toEqual([]);
    expect(await lifecycle(b, g1)).toBe('hidden');
    expect(oldSyncs()).toBe(syncsBefore + 1); // the closed group's one last sync
    expect((await b.store.getGroup(g2))?.myMemberId).toBe(nathan);
    expect(await b.store.getPref('rotation.notNow')).toBeNull();
  });

  it('asks once per rotation: after Not now, a later recognition and a restart only keep the move offered', async () => {
    const { w, b, g1, g2 } = await rotated(['Late dinner']);
    await g(b).notNowMove(g1);
    const kept = { to: g2, from: g1, fromName: 'Banff 2026', count: 1, asked: true };
    expect(g(b).moveOffers.peek()).toEqual([kept]);
    expect(parseNotNow(await b.store.getPref('rotation.notNow'))).toEqual([g1]);

    // The new group's next sync runs recognition again: still asked, nothing moved, the old group still shown.
    expectSynced(await sync(b, g2));
    expect(g(b).moveOffers.peek()).toEqual([kept]);
    expect(await lifecycle(b, g1)).toBe('closed');

    // A restart rebuilds the offer from the lifecycle checks, as answered.
    const again = await w.restart(b);
    expect(g(again).moveOffers.peek()).toEqual([kept]);
    expect(await lifecycle(again, g1)).toBe('closed');
    expect((await expenseRows(again, g2)).map((r) => r.title)).toEqual(['Dinner']);
  });

  it("Move (from the prompt or the old group's settings) is the rescue, and forgets the answer", async () => {
    const { b, g1, g2, nathan, oldSyncs, syncsBefore } = await rotated(['Late dinner', 'Ferry']);
    await g(b).notNowMove(g1);
    await g(b).moveEntries(g2, g1);
    await b.services.idle();
    expect(oldSyncs()).toBe(syncsBefore + 1);
    expect(await lifecycle(b, g1)).toBe('hidden');
    expect(g(b).moveOffers.peek()).toEqual([]);
    expect(await b.store.getPref('rotation.notNow')).toBeNull();
    expect((await b.store.getGroup(g2))?.myMemberId).toBe(nathan);
    const moved = (await expenseRows(b, g2)).filter((r) => r.title !== 'Dinner');
    expect(moved.map((r) => r.title).sort()).toEqual(['Ferry', 'Late dinner']);
    for (const row of moved) expect(row).toMatchObject({ origin: 'local' });
    expect((await b.services.groupState.list()).map((r) => r.localId)).toEqual([g2]);
  });

  it("Move leaves behind a write of this phone's that the old group holds, as the rotator does", async () => {
    const { b, g1, g2, nathan } = await rotated(['Late dinner']);
    // A write this phone stamped years ahead (its clock was wrong): once the old group's last sync stamps it, it is
    // held there, and it does not cross.
    const far = await injectEvent(
      b,
      g1,
      body(
        {
          type: 'expense.added',
          expense: {
            id: newId(),
            title: 'Far',
            amount: 3_000,
            currency: 'CAD',
            paidBy: nathan,
            date: '2026-02-10',
            category: 'food',
            split: { [nathan]: 3_000 },
          },
        },
        nathan,
        b.services.deviceId,
        LIMITS.tsMax - 1,
      ),
    );
    await g(b).moveEntries(g2, g1);
    await b.services.idle();
    expect((await b.store.dump(g1)).find((r) => r.id === far)?.receivedAt).not.toBeNull();
    const moved = (await expenseRows(b, g2)).map((r) => r.title);
    expect(moved).toContain('Late dinner');
    expect(moved).not.toContain('Far');
    expect((await b.store.dump(g2)).map((r) => r.id)).not.toContain(far);
  });

  it('Not now keeps only groups this phone still shows', async () => {
    const { b, g1, g2 } = await rotated(['Late dinner']);
    await b.store.setPref('rotation.notNow', JSON.stringify(['gone', g2]));
    await g(b).notNowMove(g1);
    expect(parseNotNow(await b.store.getPref('rotation.notNow')).sort()).toEqual([g1, g2].sort());
  });
});
