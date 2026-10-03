/**
 * Far-future timestamps (pre-launch review H2; design.md "Ordering", "Reducer" and "Rotation, moving, closing"),
 * through the app's own services and the fake server, on both stores. A hostile member writes events stamped at the
 * top of the validator's range (as the review's does; a phone whose clock reads 2099 does the same), from one device
 * id or from several. Once a server has stamped them with its arrival time R they are held: they must not archive the
 * group, rename it, add or edit an expense, or keep a removed member in the new group, and honest writes go on around
 * them. They must stay held when every R is re-assigned: after a server move, a server wipe, and the hostile member's
 * own DELETE followed by a re-push that reaches the new copy first.
 */
import {
  deriveLocal,
  deriveServer,
  LIMITS,
  newId,
  open,
  parseEvent,
  type Envelope,
  type Event,
  type EventPayload,
} from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { saveErrorMessage } from '../features/addExpense/labels';
import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { isStateError } from './errors';
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
  /** The group's server now (a move changes it). */
  server: string;
}

/** A (Maya) creates Banff 2026; B claims Nathan; H claims Priya, who is hostile; Maya adds Dinner. */
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
  return { w, a, b, h, g1, maya, nathan, priya, dinner, server: SERVER };
}

/**
 * H writes `payload` at `ts` (the top of the range unless given) as Priya from each of `devs` (H's own device id
 * unless forged ones are given), and every device syncs it. Returns the envelope ids.
 */
async function farWrite(
  t: Trio,
  payload: EventPayload | ((i: number) => EventPayload),
  options: { ts?: number; devs?: readonly string[] } = {},
): Promise<string[]> {
  const ids: string[] = [];
  const devs = options.devs ?? [t.h.services.deviceId];
  for (const [i, dev] of devs.entries()) {
    const made = typeof payload === 'function' ? payload(i) : payload;
    ids.push(await injectEvent(t.h, t.g1, body(made, t.priya, dev, options.ts ?? TOP)));
  }
  for (const d of [t.h, t.a, t.b]) expectSynced(await sync(d, t.g1));
  return ids;
}

/** H's own device id and `k − 1` forged ones. */
function deviceIds(t: Trio, k: number): string[] {
  return [t.h.services.deviceId, ...Array.from({ length: k - 1 }, () => newId())];
}

async function syncAll(t: Trio, localId: string): Promise<void> {
  for (const d of [t.a, t.b, t.h, t.a, t.b]) expectSynced(await sync(d, localId));
}

type When = 'as is' | 'after a move' | 'after a server wipe' | "after the hostile member's DELETE";
const WHENS: readonly When[] = [
  'as is',
  'after a move',
  'after a server wipe',
  "after the hostile member's DELETE",
];

/**
 * Re-assigns every R the group has. A move: Maya moves the group to another server and the others follow, each
 * re-pushing the whole log in claimed-ts order. A wipe: the server loses the copy, and the epoch reset re-pushes it.
 * The hostile DELETE: H deletes the copy and at once pushes its far writes alone, so they are the first the new copy
 * stores; then everyone's epoch reset re-pushes the rest.
 */
async function reassign(t: Trio, when: When, far: readonly string[]): Promise<void> {
  if (when === 'as is') return;
  if (when === 'after a move') {
    expect(await g(t.a).moveServer(t.g1, OTHER_SERVER)).toMatchObject({ outcome: 'moved' });
    for (const d of [t.b, t.h]) {
      await sync(d, t.g1);
      expect(await g(d).followMove(t.g1)).toMatchObject({ outcome: 'moved' });
    }
    t.server = OTHER_SERVER;
  } else {
    const secret = await secretOn(t.h, t.g1);
    const { groupId, authToken } = deriveServer(secret, t.server);
    const server = t.w.server(t.server);
    if (when === 'after a server wipe') {
      server.wipe(groupId);
    } else {
      const transport = server.transport();
      await transport.delete(groupId, authToken);
      const mine = (await t.h.store.dump(t.g1)).filter((r) => far.includes(r.id));
      expect(mine).toHaveLength(far.length);
      await transport.push(
        groupId,
        authToken,
        mine.map((r) => JSON.parse(r.envelope) as Envelope),
      );
      const first = server.stored(groupId).map((e) => e.id);
      expect(new Set(first)).toEqual(new Set(far));
    }
  }
  await t.w.clock.advance(60_000);
  await syncAll(t, t.g1);
  // Every R is the new copy's now.
  const secret = await secretOn(t.a, t.g1);
  const arrivals = t.w.server(t.server).receivedAt(deriveServer(secret, t.server).groupId);
  for (const d of [t.a, t.b, t.h]) {
    for (const row of await d.store.dump(t.g1)) expect(row.receivedAt).toBe(arrivals.get(row.id));
  }
}

describe.each(STORE_KINDS)('far-future events on the %s store (review H2)', (kind) => {
  describe.each([1, 2])("from %i device id(s): the review's attacks are held", (k) => {
    describe.each(WHENS)('%s', (when) => {
      it('a far group.archived does not make the group read-only; an unarchive at now stands', async () => {
        const t = await trio(await setup(kind));
        const far = await farWrite(t, { type: 'group.archived' }, { devs: deviceIds(t, k) });
        // What a member does on seeing the group archived (a no-op when it reads unarchived).
        await g(t.a).unarchiveGroup(t.g1);
        await syncAll(t, t.g1);
        await reassign(t, when, far);
        for (const d of [t.a, t.b, t.h]) {
          const { derived, state: s } = await state(d, t.g1);
          expect(s.archived).toBe(false);
          expect(derived.readOnly).toBeNull();
          expect(s.activity.map((item) => item.eventId)).not.toContain(far[0]);
        }
        await g(t.b).addExpense(t.g1, expense(t.nathan, 'Gas', [t.maya, t.nathan]));
      });

      it('a far group.renamed does not pin the name; a rename at now stands', async () => {
        const t = await trio(await setup(kind));
        const far = await farWrite(
          t,
          { type: 'group.renamed', name: 'Pwned' },
          { devs: deviceIds(t, k) },
        );
        expect((await state(t.a, t.g1)).state.name).toBe('Banff 2026');
        await g(t.a).renameGroup(t.g1, 'Banff trip');
        await syncAll(t, t.g1);
        await reassign(t, when, far);
        for (const d of [t.a, t.b, t.h])
          expect((await state(d, t.g1)).state.name).toBe('Banff trip');
      });

      it('a far expense.added never reaches the expenses or the balances', async () => {
        const t = await trio(await setup(kind));
        const before = (await state(t.a, t.g1)).derived;
        const fakes = deviceIds(t, k).map(() => newId());
        const far = await farWrite(
          t,
          (i) => ({
            type: 'expense.added',
            expense: {
              id: fakes[i] as string,
              title: 'Fake',
              amount: 900_000,
              currency: 'CAD',
              paidBy: t.priya,
              date: '2026-02-11',
              category: 'other',
              split: { [t.maya]: 450_000, [t.nathan]: 450_000 },
            },
          }),
          { devs: deviceIds(t, k) },
        );
        await reassign(t, when, far);
        for (const d of [t.a, t.b, t.h]) {
          const { derived, state: s } = await state(d, t.g1);
          for (const fake of fakes) expect(s.expenses.has(fake)).toBe(false);
          expect(s.expenses.has(t.dinner)).toBe(true);
          expect(derived.nets).toEqual(before.nets);
        }
      });

      it('a far expense.updated does not pin the expense; an edit at now stands and it can be deleted', async () => {
        const t = await trio(await setup(kind));
        const far = await farWrite(
          t,
          {
            type: 'expense.updated',
            id: t.dinner,
            changes: { title: 'Pwned', amount: 3, split: { [t.priya]: 3 } },
          },
          { devs: deviceIds(t, k) },
        );
        expect((await state(t.a, t.g1)).state.expenses.get(t.dinner)?.title).toBe('Dinner');
        await g(t.a).updateExpense(t.g1, t.dinner, { title: 'Dinner at the Park' });
        await syncAll(t, t.g1);
        await reassign(t, when, far);
        for (const d of [t.a, t.b, t.h]) {
          const dinner = (await state(d, t.g1)).state.expenses.get(t.dinner);
          expect(dinner).toMatchObject({ title: 'Dinner at the Park', amount: 3_000 });
        }
        await g(t.b).deleteExpense(t.g1, t.dinner);
        await syncAll(t, t.g1);
        expect((await state(t.a, t.g1)).state.expenses.has(t.dinner)).toBe(false);
      });

      it('removing the hostile member while regenerating the invite: a far unarchive of her never outranks it', async () => {
        const t = await trio(await setup(kind));
        const far = await farWrite(
          t,
          { type: 'member.unarchived', id: t.priya },
          { devs: deviceIds(t, k) },
        );
        await reassign(t, when, far);
        const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
        await t.a.services.idle();
        expectSynced(rotated.pushed);
        const g2 = rotated.localId;
        const mark = (await rows(t.a, g2)).find(
          (r) => r.event.type === 'member.archived' && r.event.id === t.priya,
        );
        expect(mark?.event).toMatchObject({ by: t.maya });
        expect(mark?.event.ts).toBeLessThan(TOP);
        expect((await state(t.a, g2)).state.members.get(t.priya)).toMatchObject({
          name: 'Priya',
          archived: true,
        });
        expect(await t.h.secrets.getSecret(g2)).toBeNull();
      });
    });
  });

  it('a far member.updated does not pin a name, and the member can still rename', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.updated', id: t.nathan, changes: { name: 'Pwned' } });
    expect((await state(t.b, t.g1)).state.members.get(t.nathan)?.name).toBe('Nathan');
    await g(t.b).updateMember(t.g1, t.nathan, { name: 'Nate' });
    await syncAll(t, t.g1);
    for (const d of [t.a, t.b, t.h]) {
      expect((await state(d, t.g1)).state.members.get(t.nathan)?.name).toBe('Nate');
    }
  });

  it('a far member.archived does not hide a member; an honest archive and unarchive go on around it', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.archived', id: t.nathan });
    for (const d of [t.a, t.b, t.h]) {
      expect((await state(d, t.g1)).state.members.get(t.nathan)?.archived).toBe(false);
    }
    await g(t.a).archiveMember(t.g1, t.nathan);
    expect((await state(t.a, t.g1)).state.members.get(t.nathan)?.archived).toBe(true);
    await g(t.a).unarchiveMember(t.g1, t.nathan);
    expect((await state(t.a, t.g1)).state.members.get(t.nathan)?.archived).toBe(false);
  });

  it('before a server stamps it, a far write takes effect at its claim on the phone that holds it; the stamp holds it', async () => {
    const t = await trio(await setup(kind));
    // Written on H, not yet pushed: no R, so not held (design.md "Ordering"): H's own phone shows it.
    await injectEvent(
      t.h,
      t.g1,
      body({ type: 'group.renamed', name: 'Pwned' }, t.priya, t.h.services.deviceId, TOP),
    );
    expect((await state(t.h, t.g1)).state.name).toBe('Pwned');
    expectSynced(await sync(t.h, t.g1));
    expect((await state(t.h, t.g1)).state.name).toBe('Banff 2026');
  });

  it("a group-file round trip keeps them held: the importer takes the file's R until its own server reports one", async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'group.archived' }, { devs: deviceIds(t, 2) });
    await farWrite(t, { type: 'group.renamed', name: 'Pwned' }, { devs: deviceIds(t, 2) });
    await g(t.a).exportGroupFile(t.g1);
    const text = t.a.files.shared.at(-1)?.contents ?? '';
    const expected = (await state(t.a, t.g1)).state;
    expect([expected.archived, expected.name]).toEqual([false, 'Banff 2026']);

    // A phone that never synced this group: the file's R alone holds the far writes.
    const c = await t.w.device('C');
    expect(await g(c).importGroupFile(text)).toMatchObject({ outcome: 'imported', created: true });
    const onC = (await state(c, t.g1)).state;
    expect([onC.archived, onC.name]).toEqual([false, 'Banff 2026']);
    expect(onC.activity).toEqual(expected.activity);
    expectSynced(await sync(c, t.g1));
    expect((await state(c, t.g1)).state).toMatchObject({ archived: false, name: 'Banff 2026' });

    // The same file without its R map (an exporter from before R): until it syncs, the importer sees them at their
    // claim, as every phone did before the rule.
    const bare = JSON.parse(text) as Record<string, unknown>;
    delete bare.received;
    const e = await t.w.device('E');
    await g(e).importGroupFile(JSON.stringify(bare));
    expect((await state(e, t.g1)).state).toMatchObject({ archived: true, name: 'Pwned' });
    expectSynced(await sync(e, t.g1));
    expect((await state(e, t.g1)).state).toMatchObject({ archived: false, name: 'Banff 2026' });
  });

  it('a phone 3 days ahead gets "Check your phone\'s date" once a push shows it; fixing the date clears it', async () => {
    const w = await setup(kind);
    const day = 24 * 60 * 60 * 1000;
    const a = await w.device('A');
    const f = await w.device('F', { clockOffsetMs: 3 * day });
    const { localId: g1, memberId: maya } = await g(a).createGroup({
      name: 'Banff 2026',
      currency: 'CAD',
      myName: 'Maya',
      people: ['Nathan'],
      serverUrl: SERVER,
    });
    expectSynced(await sync(a, g1));
    await g(f).joinInvite((await g(a).inviteFor(g1)).code);
    const nathan = memberId((await state(f, g1)).state, 'Nathan');
    // Nothing tells this phone yet that its clock is off: its first write goes out, stamped three days ahead.
    await g(f).claimMember(g1, nathan);
    expectSynced(await sync(f, g1));
    const claim = (await f.store.dump(g1)).find((r) => r.origin === 'local');
    expect((claim?.ts ?? 0) - (claim?.receivedAt ?? 0)).toBeGreaterThan(day);
    // Held everywhere, this phone included, like any claim more than a day past the latest R.
    expect((await state(f, g1)).state.members.get(nathan)?.devices).toEqual([]);

    // From now on every write is refused with the existing copy, and so is creating a group.
    const dinner = expense(nathan, 'Dinner', [maya, nathan]);
    let refused: unknown = null;
    try {
      await g(f).addExpense(g1, dinner);
    } catch (error) {
      refused = error;
    }
    expect(isStateError(refused, 'clock')).toBe(true);
    expect(saveErrorMessage(refused)).toBe("Check your phone's date.");
    let created: unknown = null;
    try {
      await g(f).createGroup({
        name: 'Other',
        currency: 'CAD',
        myName: 'Nathan',
        serverUrl: SERVER,
      });
    } catch (error) {
      created = error;
    }
    expect(isStateError(created, 'clock')).toBe(true);
    // A phone whose clock is right writes on.
    await g(a).addExpense(g1, expense(maya, 'Gas', [maya, nathan]));

    // The date fixed: writes go through, and the next push measures again.
    f.clock.offsetMs = 0;
    const id = await g(f).addExpense(g1, dinner);
    expectSynced(await sync(f, g1));
    expectSynced(await sync(a, g1));
    expect((await state(a, g1)).state.expenses.has(id)).toBe(true);
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

  it('rotation leaves behind every event its reducer holds, and copies the rest unchanged', async () => {
    const t = await trio(await setup(kind));
    const fake = newId();
    const far = await farWrite(
      t,
      (i) =>
        [
          { type: 'group.archived' } as const,
          {
            type: 'expense.added',
            expense: {
              id: fake,
              title: 'Fake',
              amount: 900_000,
              currency: 'CAD',
              paidBy: t.priya,
              date: '2026-02-11',
              category: 'other',
              split: { [t.maya]: 900_000 },
            },
          } as const,
          { type: 'expense.updated', id: t.dinner, changes: { title: 'Pwned' } } as const,
          { type: 'member.unarchived', id: t.priya } as const,
          { type: 'member.claimed', id: t.nathan } as const,
        ][i] as EventPayload,
      { devs: Array.from({ length: 5 }, () => newId()) },
    );
    // Not only the top of the range: two days past the latest R is held too.
    const soon = await farWrite(
      t,
      { type: 'expense.updated', id: t.dinner, changes: { note: 'two days ahead' } },
      { ts: t.w.clock.now() + 2 * 24 * 60 * 60 * 1000 },
    );
    const before = await rows(t.a, t.g1);
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const g2 = rotated.localId;
    const copied = new Map((await rows(t.a, g2)).map((r) => [r.id, r.event]));
    for (const id of [...far, ...soon]) expect(copied.has(id)).toBe(false);
    // Everything else readable crossed, byte for byte the same body: no re-stamping.
    const crossing = before.filter(
      (r) =>
        ![...far, ...soon].includes(r.id) &&
        ![
          'group.closed',
          'group.rotated',
          'group.moved',
          'group.renamed',
          'group.archived',
          'group.unarchived',
        ].includes(r.event.type),
    );
    expect(crossing.length).toBeGreaterThan(5);
    for (const r of crossing) expect(copied.get(r.id)).toEqual(r.event);
    const after = (await state(t.a, g2)).state;
    expect(after.archived).toBe(false);
    expect(after.expenses.has(fake)).toBe(false);
    expect(after.expenses.get(t.dinner)?.title).toBe('Dinner');
    expect(after.members.get(t.priya)?.archived).toBe(true);
  });

  it("rotation does not carry the review's far-future archive into the new group", async () => {
    const t = await trio(await setup(kind));
    const far = await farWrite(t, { type: 'group.archived' });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const g2 = rotated.localId;
    expect((await rows(t.a, g2)).map((r) => r.id)).not.toContain(far[0]);
    const after = await state(t.a, g2);
    expect(after.state.archived).toBe(false);
    expect(after.derived.readOnly).toBeNull();
    expect(after.state.members.get(t.priya)?.archived).toBe(true);
    await g(t.a).addExpense(g2, expense(t.maya, 'Breakfast', [t.maya, t.nathan]));
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

  it('removing a member with a far-future claim of theirs: the mark is written at the clock and holds', async () => {
    const t = await trio(await setup(kind));
    await farWrite(t, { type: 'member.claimed', id: t.priya }, { devs: [newId()] });
    const rotated = await g(t.a).rotateInvite(t.g1, { removeMemberId: t.priya });
    await t.a.services.idle();
    const mark = (await rows(t.a, rotated.localId)).find(
      (r) => r.event.type === 'member.archived' && r.event.id === t.priya,
    );
    expect(mark?.event.ts).toBeLessThan(TOP);
    expect((await state(t.a, rotated.localId)).state.members.get(t.priya)?.archived).toBe(true);
  });
});
