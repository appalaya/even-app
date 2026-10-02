/**
 * Far-future timestamps (pre-launch review H2; design.md "Ordering", "Reducer" and "Rotation, moving, closing"),
 * through the app's own services and the fake server, on both stores. A member writes an event at the top of the
 * validator's range, as the review's hostile member does (or a phone whose clock reads 2099). It must not pin the
 * group archived, its name, a member or an expense; honest writes must not be refused because of it; and
 * regenerating the invite must neither carry it into the new group nor fail on it.
 */
import {
  deriveLocal,
  deriveServer,
  LIMITS,
  newId,
  open,
  parseEvent,
  type Event,
  type EventPayload,
} from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { isStateError, type StateErrorCode } from './errors';
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

/** The latest valid `ts`, 2099-12-31T23:59:59.999Z: what the review's hostile member picks. */
const TOP = LIMITS.tsMax - 1;

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

/** Every valid event stored for a group on a device, with its envelope id, in insertion order. */
async function rows(d: Device, localId: string): Promise<{ id: string; event: Event }[]> {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row.serverUrl).groupId;
  const out: { id: string; event: Event }[] = [];
  for (const stored of await d.store.dump(localId)) {
    let event: Event | null = null;
    try {
      event = parseEvent(open({ key, groupId, envelope: JSON.parse(stored.envelope) }));
    } catch {
      event = null;
    }
    if (event !== null) out.push({ id: stored.id, event });
  }
  return out;
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

interface Trio {
  w: World;
  a: Device;
  b: Device;
  h: Device;
  g1: string;
  maya: string;
  nathan: string;
  priya: string;
  dinner: string;
}

/** A (Maya) creates Banff 2026; B claims Nathan; H claims Priya, who writes far ahead; Maya adds Dinner. */
async function trio(w: World): Promise<Trio> {
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
  const invite = (await g(a).inviteFor(g1)).code;
  await g(b).joinInvite(invite);
  await g(h).joinInvite(invite);
  const members = (await state(a, g1)).state;
  const nathan = memberId(members, 'Nathan');
  const priya = memberId(members, 'Priya');
  await g(b).claimMember(g1, nathan);
  await g(h).claimMember(g1, priya);
  const dinner = await g(a).addExpense(g1, expense(maya, 'Dinner', [maya, nathan, priya]));
  for (const d of [a, b, h, a, b, h]) expectSynced(await sync(d, g1));
  return { w, a, b, h, g1, maya, nathan, priya, dinner };
}

/**
 * H writes `payload` at `ts` (the top of the range unless given) as Priya from `dev` (H's own device unless a forged
 * one is given), and every device syncs it. Returns the envelope id.
 */
async function farWrite(
  t: Trio,
  payload: EventPayload,
  options: { ts?: number; dev?: string } = {},
): Promise<string> {
  const id = await injectEvent(
    t.h,
    t.g1,
    body(payload, t.priya, options.dev ?? t.h.services.deviceId, options.ts ?? TOP),
  );
  for (const d of [t.h, t.a, t.b]) expectSynced(await sync(d, t.g1));
  return id;
}

async function syncAll(t: Trio, localId: string): Promise<void> {
  for (const d of [t.a, t.b, t.h, t.a]) expectSynced(await sync(d, localId));
}

describe.each(STORE_KINDS)('far-future events on the %s store (review H2)', (kind) => {
  it('a group.archived at the top of the range does not make the group read-only; an unarchive at now stands', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'group.archived' });
    // What a member does on seeing the group archived (a no-op when it reads unarchived).
    await g(t.a).unarchiveGroup(t.g1);
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) {
      const { derived, state: s } = await state(d, t.g1);
      expect(s.archived).toBe(false);
      expect(derived.readOnly).toBeNull();
    }
    await g(t.b).addExpense(t.g1, expense(t.nathan, 'Gas', [t.maya, t.nathan]));
  });

  it('a group.renamed at the top of the range does not pin the name', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'group.renamed', name: 'Pwned' });
    expect((await state(t.a, t.g1)).state.name).toBe('Banff 2026');
    await g(t.a).renameGroup(t.g1, 'Banff trip');
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) expect((await state(d, t.g1)).state.name).toBe('Banff trip');
  });

  it('a member.updated at the top of the range does not pin a name, and the member can still rename', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.updated', id: t.nathan, changes: { name: 'Pwned' } });
    expect((await state(t.b, t.g1)).state.members.get(t.nathan)?.name).toBe('Nathan');
    await g(t.b).updateMember(t.g1, t.nathan, { name: 'Nate' });
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) {
      expect((await state(d, t.g1)).state.members.get(t.nathan)?.name).toBe('Nate');
    }
  });

  it('a member.archived at the top of the range does not hide a member', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.archived', id: t.nathan });
    for (const d of [t.a, t.b, t.h]) {
      expect((await state(d, t.g1)).state.members.get(t.nathan)?.archived).toBe(false);
    }
    // And an honest archive and unarchive still work around it.
    await g(t.a).archiveMember(t.g1, t.nathan);
    expect((await state(t.a, t.g1)).state.members.get(t.nathan)?.archived).toBe(true);
    await g(t.a).unarchiveMember(t.g1, t.nathan);
    expect((await state(t.a, t.g1)).state.members.get(t.nathan)?.archived).toBe(false);
  });

  it('an expense edited at the top of the range can still be edited and deleted (no "check your phone\'s date")', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'expense.updated', id: t.dinner, changes: { title: 'Pwned' } });
    expect((await state(t.a, t.g1)).state.expenses.get(t.dinner)?.title).toBe('Dinner');
    await g(t.a).updateExpense(t.g1, t.dinner, { title: 'Dinner at the Park' });
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) {
      expect((await state(d, t.g1)).state.expenses.get(t.dinner)?.title).toBe('Dinner at the Park');
    }
    await g(t.b).deleteExpense(t.g1, t.dinner);
    await syncAll(t, t.g1);
    expect((await state(t.a, t.g1)).state.expenses.has(t.dinner)).toBe(false);
  });

  it('an expense added at the top of the range can be deleted; an edit of it is still refused', async () => {
    const t = await trio(await setup(kind));
    const fake = newId();
    await farWrite(t, {
      type: 'expense.added',
      expense: {
        id: fake,
        title: 'Fake',
        amount: 900_000,
        currency: 'CAD',
        paidBy: t.priya,
        date: '2026-02-11',
        category: 'other',
        split: { [t.maya]: 450_000, [t.nathan]: 450_000 },
      },
    });
    expect((await state(t.a, t.g1)).state.expenses.has(fake)).toBe(true);
    // An edit has to sort after the add to take effect, and nothing below the top of the range does.
    await rejectsWith(g(t.a).updateExpense(t.g1, fake, { title: 'Still fake' }), 'clock');
    // A delete holds in either order: its tombstone keeps the add out.
    await g(t.a).deleteExpense(t.g1, fake);
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) {
      const s = (await state(d, t.g1)).state;
      expect(s.expenses.has(fake)).toBe(false);
      expect(s.expenses.has(t.dinner)).toBe(true);
    }
  });

  // ----- Regenerating the invite -----

  it('rotation leaves the group-level toggles behind and re-states the name and archive state at its own clock', async () => {
    const t = await trio(await setup(kind));
    await g(t.b).renameGroup(t.g1, 'Banff!');
    await syncAll(t, t.g1);
    await g(t.a).archiveGroup(t.g1);
    expectSynced(await sync(t.a, t.g1));
    const toggles = (await rows(t.a, t.g1))
      .filter((r) => ['group.renamed', 'group.archived', 'group.unarchived'].includes(r.event.type))
      .map((r) => r.id);
    expect(toggles).toHaveLength(2);
    const before = t.w.clock.now();

    const rotated = await g(t.a).rotateInvite(t.g1);
    await t.a.services.idle();
    const g2 = rotated.localId;
    const newRows = await rows(t.a, g2);
    for (const id of toggles) expect(newRows.map((r) => r.id)).not.toContain(id);
    const tail = newRows.slice(-3).map((r) => r.event);
    expect(tail.map((e) => e.type)).toEqual(['group.rotated', 'group.renamed', 'group.archived']);
    expect(tail[1]).toMatchObject({ name: 'Banff!', by: t.maya });
    for (const e of tail) expect(e.ts).toBeGreaterThanOrEqual(before);
    const after = await state(t.a, g2);
    expect(after.state.name).toBe('Banff!');
    expect(after.state.archived).toBe(true);
    await g(t.a).unarchiveGroup(g2);
    expect((await state(t.a, g2)).state.archived).toBe(false);
  });

  it("rotation does not carry the review's far-future archive into the new group", async () => {
    const t = await trio(await setup(kind));
    const far = await farWrite(t, { type: 'group.archived' });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const g2 = rotated.localId;
    expect((await rows(t.a, g2)).map((r) => r.id)).not.toContain(far);
    const after = await state(t.a, g2);
    expect(after.state.archived).toBe(false);
    expect(after.derived.readOnly).toBeNull();
    expect(after.state.members.get(t.priya)?.archived).toBe(true);
    await g(t.a).addExpense(g2, expense(t.maya, 'Breakfast', [t.maya, t.nathan]));
  });

  it('a far archive a second (forged) device backs up holds in the old group; rotation is the way out', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'group.archived' });
    await farWrite(t, { type: 'group.archived' }, { dev: newId() });
    // Two devices at the top of the range: the log has caught up to the archive, so it wins and an unarchive at
    // now cannot outrank it (design.md "Reducer": the rule depends only on the log, and `dev` is the writer's claim).
    await g(t.a).unarchiveGroup(t.g1);
    expect((await state(t.a, t.g1)).state.archived).toBe(true);

    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const g2 = rotated.localId;
    for (const r of await rows(t.a, g2)) expect(r.event.ts).toBeLessThan(TOP);
    expect((await state(t.a, g2)).state.archived).toBe(true); // re-stated at the rotator's clock
    await g(t.a).unarchiveGroup(g2);
    const after = await state(t.a, g2);
    expect(after.state.archived).toBe(false);
    expect(after.derived.readOnly).toBeNull();
  });

  it('removing a member whose own far-future rename is in the log: the rotation completes and archives them', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.updated', id: t.priya, changes: { name: 'Pri' } });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    expectSynced(rotated.pushed);
    const removed = (await state(t.a, rotated.localId)).state.members.get(t.priya);
    expect(removed).toMatchObject({ name: 'Priya', archived: true });
  });

  it('removing a member with a far-future claim of theirs: the mark is written at the group clock and holds', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.claimed', id: t.priya }, { dev: newId() });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const mark = (await rows(t.a, rotated.localId)).find(
      (r) => r.event.type === 'member.archived' && r.event.id === t.priya,
    );
    expect(mark?.event.ts).toBeLessThan(TOP);
    expect((await state(t.a, rotated.localId)).state.members.get(t.priya)?.archived).toBe(true);
  });

  it('a removal a far-future unarchive outranks is still written; the member stays listed', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.unarchived', id: t.priya });
    await farWrite(t, { type: 'member.unarchived', id: t.priya }, { dev: newId() });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    expectSynced(rotated.pushed);
    const g2 = rotated.localId;
    const mark = (await rows(t.a, g2)).find(
      (r) => r.event.type === 'member.archived' && r.event.id === t.priya,
    );
    expect(mark?.event).toMatchObject({ by: t.maya });
    // What the user sees: Priya still listed in the new group, though she holds no invite to it.
    expect((await state(t.a, g2)).state.members.get(t.priya)?.archived).toBe(false);
    expect(await t.h.secrets.getSecret(g2)).toBeNull();
  });
});
