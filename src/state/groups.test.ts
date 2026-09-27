/**
 * GroupService, end to end over the real sync engine and a protocol-faithful fake server, on both stores (the
 * in-memory fake and sqliteStore over node:sqlite).
 */
import {
  decodeInvite,
  deriveLocal,
  deriveServer,
  encodeInvite,
  inviteLink,
  isValidSplit,
  LIMITS,
  makeInvite,
  newId,
  open,
  parseEvent,
  PROTOCOL,
  secretFromInvite,
  type Event,
} from '@even/core';
import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { isStateError, type StateErrorCode } from './errors';
import type { GroupService } from './groups';
import {
  createWorld,
  expectSynced,
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

async function setup(kind: StoreKind, start?: number): Promise<World> {
  world = await createWorld(kind, start);
  return world;
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
      `expected StateError ${code}, got ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    );
  }
}

function g(d: Device): GroupService {
  return d.services.groups;
}

async function derived(d: Device, localId: string) {
  const value = await d.services.groupState.get(localId);
  if (value === null || value.state === null) throw new Error('no derived state');
  return { ...value, state: value.state };
}

/** Decrypted bodies of every row of a group on a device, in insertion order. */
async function bodies(
  d: Device,
  localId: string,
): Promise<{ row: { origin: string; acked: boolean }; event: Event }[]> {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row.serverUrl).groupId;
  const out = [];
  for (const stored of await d.store.dump(localId)) {
    const event = parseEvent(open({ key, groupId, envelope: JSON.parse(stored.envelope) }));
    if (event === null) throw new Error('invalid stored event');
    out.push({ row: { origin: stored.origin, acked: stored.acked }, event });
  }
  return out;
}

async function createTrip(d: Device, people: string[] = ['Nathan', 'Priya']) {
  return g(d).createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    myEmoji: '🦊',
    people,
    serverUrl: SERVER,
  });
}

function memberId(
  state: { members: Map<string, { id: string; name: string }> },
  name: string,
): string {
  for (const m of state.members.values()) if (m.name === name) return m.id;
  throw new Error(`no member ${name}`);
}

/** A creates and syncs, B joins and claims Nathan. */
async function twoDevices(w: World) {
  const a = await w.device('A');
  const b = await w.device('B');
  const { localId, memberId: maya } = await createTrip(a);
  expectSynced(await sync(a, localId));
  const invite = await g(a).inviteFor(localId);
  const joined = await g(b).joinInvite(invite.link);
  if (joined.kind !== 'joined') throw new Error('expected joined');
  const nathan = memberId((await derived(b, localId)).state, 'Nathan');
  await g(b).claimMember(localId, nathan);
  expectSynced(await sync(b, localId));
  expectSynced(await sync(a, localId));
  return {
    a,
    b,
    localId,
    maya,
    nathan,
    priya: memberId((await derived(a, localId)).state, 'Priya'),
  };
}

describe.each(STORE_KINDS)('GroupService on the %s store', (kind) => {
  describe('create', () => {
    it('keeps the member ids the sheet chose, so a previewed avatar colour is the real one', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const [me, nathan] = [newId(), newId()];
      const { localId, memberId } = await g(a).createGroup({
        name: 'Banff 2026',
        currency: 'CAD',
        myName: 'Sam',
        myId: me,
        people: [{ name: 'Nathan', id: nathan }, 'Maya'],
        serverUrl: SERVER,
      });
      expect(memberId).toBe(me);
      const members = (await derived(a, localId)).state.members;
      expect(members.get(nathan)?.name).toBe('Nathan');
      expect([...members.values()].map((m) => m.name).sort()).toEqual(['Maya', 'Nathan', 'Sam']);
      await rejectsWith(
        g(a).createGroup({
          name: 'Twice',
          currency: 'CAD',
          myName: 'Sam',
          myId: nathan,
          people: [{ name: 'Nathan', id: nathan }],
          serverUrl: SERVER,
        }),
        'invalid',
      );
    });

    it("writes the creator's member.added, member.claimed, group.created, then the pre-added members", async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId, memberId: maya } = await createTrip(a);

      const rows = await bodies(a, localId);
      expect(rows.map((r) => r.event.type)).toEqual([
        'member.added',
        'member.claimed',
        'group.created',
        'member.added',
        'member.added',
      ]);
      for (const { row, event } of rows) {
        expect(row).toEqual({ origin: 'local', acked: false });
        expect(event.dev).toBe(a.services.deviceId);
        expect(event.by).toBe(maya);
      }
      const ts = rows.map((r) => r.event.ts);
      expect(ts).toEqual([...ts].sort((x, y) => x - y));
      expect(new Set(ts).size).toBe(ts.length);
      const [self, claim, created] = rows.map((r) => r.event);
      expect(self).toMatchObject({
        type: 'member.added',
        member: { id: maya, name: 'Maya', emoji: '🦊' },
      });
      expect(claim).toMatchObject({ type: 'member.claimed', id: maya });
      expect(created).toMatchObject({ type: 'group.created', name: 'Banff 2026', currency: 'CAD' });

      const row = await a.store.getGroup(localId);
      expect(row).toMatchObject({
        serverUrl: SERVER,
        state: 'active',
        myMemberId: maya,
        nameCache: 'Banff 2026',
        currencyCache: 'CAD',
      });
      expect(await a.secrets.listLocalIds()).toEqual([localId]);
      expect(await a.secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
      const d = await derived(a, localId);
      expect(d.me?.name).toBe('Maya');
      expect([...d.state.members.values()].map((m) => m.name)).toEqual(['Maya', 'Nathan', 'Priya']);
      expect(d.state.activity.map((i) => i.summary)).toEqual([
        'Maya joined',
        'Maya created the group',
        'Maya added Nathan',
        'Maya added Priya',
      ]);
      // A write sync is requested (debounced): the timer is pending, nothing was sent yet.
      expect(w.clock.pending()).toHaveLength(1);
      expect(w.server().requests).toHaveLength(0);
      // The "me" default is remembered for the next join or create.
      expect(await a.services.prefs.load()).toMatchObject({ name: 'Maya', emoji: '🦊' });
    });

    it('validates everything before anything is stored', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const base = { name: 'Trip', currency: 'EUR', myName: 'Maya', serverUrl: SERVER };
      await rejectsWith(g(a).createGroup({ ...base, name: '   ' }), 'invalid');
      await rejectsWith(g(a).createGroup({ ...base, name: 'x'.repeat(81) }), 'invalid');
      await rejectsWith(g(a).createGroup({ ...base, currency: 'XYZ' }), 'invalid');
      await rejectsWith(g(a).createGroup({ ...base, myName: '' }), 'invalid');
      await rejectsWith(g(a).createGroup({ ...base, myEmoji: 'ab' }), 'invalid');
      await rejectsWith(g(a).createGroup({ ...base, people: [' maya '] }), 'name_taken');
      await rejectsWith(g(a).createGroup({ ...base, people: ['Nathan', 'NATHAN'] }), 'name_taken');
      await rejectsWith(
        g(a).createGroup({ ...base, serverUrl: 'http://sync.test' }),
        'invalid_url',
      );
      await rejectsWith(
        g(a).createGroup({ ...base, people: Array.from({ length: 50 }, (_, i) => `P${i}`) }),
        'members_full',
      );
      expect(await a.store.listGroups()).toEqual([]);
      expect(await a.secrets.listLocalIds()).toEqual([]);
    });

    it('defaults to the Even server', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId } = await g(a).createGroup({ name: 'Trip', currency: 'JPY', myName: 'Ken' });
      expect((await a.store.getGroup(localId))?.serverUrl).toBe(PROTOCOL.defaultServer);
      expect(await a.secrets.listGroups()).toEqual([
        { localId, serverUrl: PROTOCOL.defaultServer },
      ]);
    });

    it("refuses to write when the phone's clock is outside the valid range", async () => {
      const w = await setup(kind, 1_600_000_000_000); // 2020
      const a = await w.device('A');
      await rejectsWith(createTrip(a), 'clock');
      expect(await a.store.listGroups()).toEqual([]);
    });
  });

  describe('invite and join', () => {
    it('share is gated until group.created and the creator’s member.added are acknowledged', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId } = await createTrip(a);
      const before = await g(a).inviteFor(localId);
      expect(before.ready).toBe(false);
      expect(before.link).toBe(inviteLink(before.code));
      const invite = decodeInvite(before.code);
      expect(invite).toMatchObject({ s: SERVER, g: 'Banff 2026', cur: 'CAD' });
      expect(deriveLocal(secretFromInvite(invite)).localId).toBe(localId);

      w.server().offline = true;
      expect((await sync(a, localId)).outcome).toBe('failed');
      expect((await g(a).inviteFor(localId)).ready).toBe(false);

      w.server().offline = false;
      await w.clock.advance(60 * 60 * 1000); // past the backoff
      expectSynced(await sync(a, localId));
      expect((await g(a).inviteFor(localId)).ready).toBe(true);
      expect((await derived(a, localId)).inviteReady).toBe(true);
    });

    it('previewInvite decodes codes and links and names each problem', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId } = await createTrip(a);
      const { code, link } = await g(a).inviteFor(localId);

      const b = await w.device('B');
      const preview = await g(b).previewInvite(`  ${link} `);
      expect(preview).toEqual({
        ok: true,
        invite: {
          localId,
          name: 'Banff 2026',
          currency: 'CAD',
          serverUrl: SERVER,
          host: 'sync.test',
          local: null,
        },
      });
      expect(await g(a).previewInvite(code)).toMatchObject({
        ok: true,
        invite: { local: { state: 'active', serverUrl: SERVER } },
      });

      const payload = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      const recode = (value: Record<string, unknown>) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(await g(b).previewInvite(recode({ ...payload, h: 'AAAAAA' }))).toEqual({
        ok: false,
        error: 'checksum',
      });
      expect(await g(b).previewInvite('hello there')).toEqual({ ok: false, error: 'malformed' });
      expect(await g(b).previewInvite(recode({ ...payload, s: 'http://sync.test' }))).toEqual({
        ok: false,
        error: 'server',
      });
      expect(await g(b).previewInvite(recode({ ...payload, v: 2 }))).toEqual({
        ok: false,
        error: 'version',
      });
    });

    it('joins a new group, pulls the members, and claims one', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const b = await w.device('B');
      const { localId } = await createTrip(a);
      expectSynced(await sync(a, localId));

      const joined = await g(b).joinInvite((await g(a).inviteFor(localId)).code);
      expect(joined).toMatchObject({ kind: 'joined', localId, needsClaim: true, waiting: false });
      const row = await b.store.getGroup(localId);
      expect(row).toMatchObject({
        state: 'active',
        myMemberId: null,
        serverUrl: SERVER,
        lastSyncError: null,
      });
      const before = await derived(b, localId);
      expect(before.needsClaim).toBe(true);
      expect(before.name).toBe('Banff 2026');
      expect([...before.state.members.values()].map((m) => [m.name, m.devices.length])).toEqual([
        ['Maya', 1],
        ['Nathan', 0],
        ['Priya', 0],
      ]);
      expect(before.inviteReady).toBe(true); // pulled rows are acknowledged

      const nathan = memberId(before.state, 'Nathan');
      await g(b).claimMember(localId, nathan);
      expect((await b.store.getGroup(localId))?.myMemberId).toBe(nathan);
      const claims = (await bodies(b, localId)).filter((r) => r.event.type === 'member.claimed');
      expect(claims.at(-1)?.event).toMatchObject({
        id: nathan,
        by: nathan,
        dev: b.services.deviceId,
      });
      // Claiming again from the same device writes nothing.
      const count = (await b.store.dump(localId)).length;
      await g(b).claimMember(localId, nathan);
      expect((await b.store.dump(localId)).length).toBe(count);

      expectSynced(await sync(b, localId));
      expectSynced(await sync(a, localId));
      const onA = await derived(a, localId);
      expect(onA.state.members.get(nathan)?.devices).toEqual([b.services.deviceId]);
      expect(onA.state.activity.at(-1)?.summary).toBe('Nathan joined');
    });

    it('an invite for a group already here on the same server is "already"; on another server it is a move', async () => {
      const w = await setup(kind);
      const { a, b, localId } = await twoDevices(w);
      const { code } = await g(a).inviteFor(localId);
      expect(await b.secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
      expect(await g(b).joinInvite(code)).toEqual({ kind: 'already', localId });

      const secret = await secretOn(a, localId);
      const moved = encodeInvite(makeInvite(secret, OTHER_SERVER, { g: 'Banff 2026' }));
      expect(await g(b).joinInvite(moved)).toEqual({
        kind: 'move',
        localId,
        fromServer: SERVER,
        toServer: OTHER_SERVER,
      });
      // Not moved yet: the index keeps the row's server.
      expect(await b.secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
      // The caller confirms, then moves without announcing (the old server may be dead).
      const result = await g(b).acceptInviteMove(localId, OTHER_SERVER);
      expect(result).toMatchObject({
        outcome: 'moved',
        serverUrl: OTHER_SERVER,
        fromServer: SERVER,
      });
      expect((await b.store.getGroup(localId))?.serverUrl).toBe(OTHER_SERVER);
      expect(await b.secrets.listGroups()).toEqual([{ localId, serverUrl: OTHER_SERVER }]);
      expect(serverIds(w, secret, OTHER_SERVER).sort()).toEqual(
        (await b.store.dump(localId)).map((r) => r.id).sort(),
      );
      const types = (await bodies(b, localId)).map((r) => r.event.type);
      expect(types).not.toContain('group.moved');
    });

    it('joins offline: the group exists, the first sync failed, and the name pick waits for members', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const b = await w.device('B');
      const { localId } = await createTrip(a);
      expectSynced(await sync(a, localId));
      const { code } = await g(a).inviteFor(localId);

      w.server().offline = true;
      const joined = await g(b).joinInvite(code);
      expect(joined).toMatchObject({ kind: 'joined', needsClaim: true, waiting: true });
      if (joined.kind !== 'joined') throw new Error('unreachable');
      expect(joined.firstSync).toMatchObject({ outcome: 'failed', error: 'network' });
      expect(await b.store.getGroup(localId)).toMatchObject({
        state: 'active',
        lastSyncError: 'network',
      });
      const waiting = await derived(b, localId);
      expect(waiting.state.members.size).toBe(0);
      expect(waiting.name).toBe('Banff 2026'); // from the invite
      expect(waiting.currency).toBe('CAD');
      await rejectsWith(
        g(b).addExpense(localId, {
          title: 'x',
          amount: 1,
          paidBy: newId(),
          date: '2026-01-01',
          category: 'other',
          split: { mode: 'equal', members: [newId()] },
        }),
        'not_claimed',
      );

      w.server().offline = false;
      expectSynced(await sync(b, localId));
      expect((await derived(b, localId)).state.members.size).toBe(3);
    });

    it('refuses an invite whose group was rotated away here, and rejects bad codes with a typed error', async () => {
      const w = await setup(kind);
      const { a, b, localId } = await twoDevices(w);
      const { code } = await g(a).inviteFor(localId);
      await b.store.setGroupState(localId, 'closed');
      expect(await g(b).joinInvite(code)).toEqual({
        kind: 'closedGroupInvite',
        localId,
        state: 'closed',
      });
      await b.store.setGroupState(localId, 'hidden');
      expect(await g(b).joinInvite(code)).toEqual({
        kind: 'closedGroupInvite',
        localId,
        state: 'hidden',
      });
      await rejectsWith(g(b).joinInvite('not a code'), 'malformed');
      const payload = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      await rejectsWith(
        g(b).joinInvite(
          Buffer.from(JSON.stringify({ ...payload, h: 'AAAAAA' })).toString('base64url'),
        ),
        'checksum',
      );
    });

    it('a re-shared invite restores a missing secret (the Android-restore recovery path)', async () => {
      const w = await setup(kind);
      const { a, b, localId } = await twoDevices(w);
      await b.secrets.deleteSecret(localId);
      b.services.groupState.invalidate(localId);
      expect((await b.services.groupState.get(localId))?.noSecret).toBe(true);
      await rejectsWith(g(b).setDone(localId), 'no_secret');
      expect(await g(b).joinInvite((await g(a).inviteFor(localId)).code)).toEqual({
        kind: 'already',
        localId,
      });
      expect(await b.secrets.getSecret(localId)).not.toBeNull();
      expect((await derived(b, localId)).noSecret).toBe(false);
    });
  });

  describe('members', () => {
    it('names are unique among non-archived members, case-insensitively and ignoring spaces', async () => {
      const w = await setup(kind);
      const { a, localId, priya } = await twoDevices(w);
      await rejectsWith(g(a).addMember(localId, '  maya '), 'name_taken');
      await rejectsWith(g(a).addMember(localId, 'NATHAN'), 'name_taken');
      const sam = await g(a).addMember(localId, ' Sam ', '🐻');
      expect((await derived(a, localId)).state.members.get(sam)).toMatchObject({
        name: 'Sam',
        emoji: '🐻',
      });

      // Add member previews the new member's avatar colour: the id is chosen first and kept.
      const preset = newId();
      expect(await g(a).addMember(localId, 'Alex', undefined, { id: preset })).toBe(preset);
      await rejectsWith(g(a).addMember(localId, 'Alexa', undefined, { id: preset }), 'invalid');

      // An archived name is free again; unarchiving the old one would collide and is refused.
      await g(a).archiveMember(localId, priya);
      const priya2 = await g(a).addMember(localId, 'priya');
      await rejectsWith(g(a).unarchiveMember(localId, priya), 'name_taken');
      await g(a).updateMember(localId, priya2, { name: 'Priya S' });
      await g(a).unarchiveMember(localId, priya);
      expect((await derived(a, localId)).state.nameCollisions).toEqual([]);
    });

    it('edit rules: your own seat and unclaimed names only; archive others, never yourself', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan, priya } = await twoDevices(w);
      await g(a).updateMember(localId, maya, { name: 'Maya A', emoji: '🐼' }); // own seat
      await g(a).updateMember(localId, priya, { name: 'Priya K' }); // nobody has claimed Priya
      await rejectsWith(g(a).updateMember(localId, nathan, { name: 'Nate' }), 'not_allowed'); // B's seat
      await rejectsWith(g(a).updateMember(localId, priya, { name: 'maya a' }), 'name_taken');
      await g(b).updateMember(localId, nathan, { emoji: '🦉' });
      await g(b).updateMember(localId, nathan, { emoji: null });

      const count = (await a.store.dump(localId)).length;
      await g(a).updateMember(localId, maya, { name: 'Maya A' }); // no change, no event
      expect((await a.store.dump(localId)).length).toBe(count);

      await rejectsWith(g(a).archiveMember(localId, maya), 'not_allowed');
      await rejectsWith(g(a).unarchiveMember(localId, maya), 'not_allowed');
      await g(a).archiveMember(localId, nathan); // a joined member may be archived by others
      await g(a).archiveMember(localId, nathan); // repeat: no-op
      const archived = (await bodies(a, localId)).filter((r) => r.event.type === 'member.archived');
      expect(archived).toHaveLength(1);
      await rejectsWith(g(a).updateMember(localId, newId(), { name: 'X' }), 'not_found');

      expectSynced(await sync(b, localId));
      expectSynced(await sync(a, localId));
      const state = (await derived(a, localId)).state;
      expect(state.members.get(maya)).toMatchObject({ name: 'Maya A', emoji: '🐼' });
      expect(state.members.get(priya)?.name).toBe('Priya K');
      expect(state.members.get(nathan)).toMatchObject({ archived: true });
      expect(state.members.get(nathan)?.emoji).toBeUndefined();
    });

    it('"I\'m not listed" adds and claims a new member as a self-add', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const b = await w.device('B');
      const { localId } = await createTrip(a);
      expectSynced(await sync(a, localId));
      await g(b).joinInvite((await g(a).inviteFor(localId)).code);
      await rejectsWith(g(b).joinAsNewMember(localId, 'nathan'), 'name_taken');
      const sam = await g(b).joinAsNewMember(localId, 'Sam', '🐙');
      expect((await b.store.getGroup(localId))?.myMemberId).toBe(sam);
      const mine = (await bodies(b, localId))
        .filter((r) => r.row.origin === 'local')
        .map((r) => r.event);
      expect(mine).toMatchObject([
        { type: 'member.added', by: sam, member: { id: sam, name: 'Sam', emoji: '🐙' } },
        { type: 'member.claimed', by: sam, id: sam },
      ]);
      const summaries = (await derived(b, localId)).state.activity.map((i) => i.summary);
      expect(summaries.filter((s) => s.startsWith('Sam'))).toEqual(['Sam joined']);
      expect(await b.services.prefs.load()).toMatchObject({ name: 'Sam', emoji: '🐙' });
    });

    it('a group holds at most LIMITS.membersMax members', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId } = await createTrip(
        a,
        Array.from({ length: LIMITS.membersMax - 2 }, (_, i) => `P${i}`),
      );
      await g(a).addMember(localId, 'Last');
      await rejectsWith(g(a).addMember(localId, 'One more'), 'members_full');
    });
  });

  describe('expenses and payments', () => {
    it('adds an expense in each split mode; each stored split is valid and every event validates', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan, priya } = await twoDevices(w);
      const base = { paidBy: maya, date: '2026-02-01', category: 'food' as const };
      const equal = await g(a).addExpense(localId, {
        ...base,
        title: '  Dinner ',
        amount: 10_000,
        note: '  ',
        split: { mode: 'equal', members: [maya, nathan, priya] },
      });
      const weighted = await g(a).addExpense(localId, {
        ...base,
        title: 'Cabin',
        amount: 30_000,
        split: {
          mode: 'equal',
          members: [maya, nathan],
          weights: { [maya]: 2 },
          extras: { [nathan]: 3_000 },
        },
      });
      const exact = await g(b).addExpense(localId, {
        ...base,
        paidBy: nathan,
        title: 'Gas',
        amount: 5_000,
        category: 'fuel',
        note: 'Canmore',
        split: { mode: 'exact', amounts: { [maya]: 1_000, [nathan]: 4_000 } },
      });
      const percent = await g(b).addExpense(localId, {
        ...base,
        paidBy: nathan,
        title: 'Tickets',
        amount: 1_001,
        split: { mode: 'percent', bps: { [maya]: 5_000, [nathan]: 5_000, [priya]: 0 } },
      });
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: 'Bad',
          amount: 100,
          split: { mode: 'exact', amounts: { [maya]: 99 } },
        }),
        'invalid_split',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: 'Bad',
          amount: 100,
          split: { mode: 'percent', bps: { [maya]: 9_999 } },
        }),
        'invalid_split',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: 'Bad',
          amount: 100,
          split: { mode: 'equal', members: [newId()] },
        }),
        'not_found',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          paidBy: newId(),
          title: 'Bad',
          amount: 100,
          split: { mode: 'equal', members: [maya] },
        }),
        'not_found',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: ' ',
          amount: 1,
          split: { mode: 'equal', members: [maya] },
        }),
        'invalid',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: 'x',
          amount: 0,
          split: { mode: 'equal', members: [maya] },
        }),
        'invalid',
      );
      await rejectsWith(
        g(a).addExpense(localId, {
          ...base,
          title: 'x',
          amount: 1,
          date: '2026-02-30',
          split: { mode: 'equal', members: [maya] },
        }),
        'invalid',
      );

      expectSynced(await sync(b, localId));
      expectSynced(await sync(a, localId));
      const state = (await derived(a, localId)).state;
      const e = (id: string) => {
        const found = state.expenses.get(id);
        if (found === undefined) throw new Error('missing expense');
        return found;
      };
      expect(e(equal)).toMatchObject({ title: 'Dinner', currency: 'CAD', category: 'food' });
      expect(e(equal).note).toBeUndefined();
      expect(Object.values(e(equal).split).sort()).toEqual([3333, 3333, 3334]);
      expect(e(weighted).split).toEqual({ [maya]: 18_000, [nathan]: 12_000 });
      expect(e(exact)).toMatchObject({
        note: 'Canmore',
        split: { [maya]: 1_000, [nathan]: 4_000 },
      });
      expect(e(percent).split[priya]).toBe(0);
      for (const id of [equal, weighted, exact, percent])
        expect(isValidSplit(e(id).amount, e(id).split)).toBe(true);
      expect(state.flagged).toEqual([]);
      const d = await derived(a, localId);
      expect(d.balancesUnavailable).toBe(false);
      expect([...(d.nets?.values() ?? [])].reduce((x, y) => x + y, 0)).toBe(0);
      expect(d.myNet).toBe(d.nets?.get(maya));
      expect(d.transfers.length).toBeGreaterThan(0);
    });

    it('property: any accepted draft stores a valid split that validates on another phone', async () => {
      if (kind !== 'fake') return; // the rule is the store's-independent write path; once is enough
      const w = await setup(kind);
      const { a, localId, maya, nathan, priya } = await twoDevices(w);
      const ids = [maya, nathan, priya];
      const members = fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 3 });
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: LIMITS.amountMax }),
          fc.oneof(
            members.map((m) => ({ mode: 'equal' as const, members: m })),
            members.chain((m) =>
              fc
                .dictionary(fc.constantFrom(...m), fc.integer({ min: 0, max: 3 }))
                .map((weights) => ({
                  mode: 'equal' as const,
                  members: m,
                  weights,
                })),
            ),
            members.chain((m) =>
              fc
                .array(fc.integer({ min: 0, max: 10_000 }), {
                  minLength: m.length,
                  maxLength: m.length,
                })
                .map((parts) => ({
                  mode: 'percent' as const,
                  bps: Object.fromEntries(m.map((id, i) => [id, parts[i] ?? 0])),
                })),
            ),
          ),
          async (amount, split) => {
            let id: string;
            try {
              id = await g(a).addExpense(localId, {
                title: 'P',
                amount,
                paidBy: maya,
                date: '2026-03-03',
                category: 'other',
                split,
              });
            } catch (error) {
              expect(isStateError(error, 'invalid_split')).toBe(true);
              return;
            }
            const stored = (await derived(a, localId)).state.expenses.get(id);
            expect(stored !== undefined && isValidSplit(stored.amount, stored.split)).toBe(true);
          },
        ),
        { numRuns: 40 },
      );
      for (const { event } of await bodies(a, localId)) expect(parseEvent(event)).not.toBeNull();
    });

    it('updates write only what changed, with amount and split as one field', async () => {
      const w = await setup(kind);
      const { a, localId, maya, nathan } = await twoDevices(w);
      const id = await g(a).addExpense(localId, {
        title: 'Dinner',
        amount: 9_000,
        paidBy: maya,
        date: '2026-02-01',
        category: 'food',
        note: 'Grizzly House',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      await rejectsWith(g(a).updateExpense(localId, id, { amount: 100 }), 'invalid');
      await rejectsWith(
        g(a).updateExpense(localId, id, { split: { mode: 'equal', members: [maya] } }),
        'invalid',
      );
      const before = (await a.store.dump(localId)).length;
      await g(a).updateExpense(localId, id, { title: 'Dinner', category: 'food' }); // nothing differs
      expect((await a.store.dump(localId)).length).toBe(before);

      await g(a).updateExpense(localId, id, { title: 'Dinner at the Grizzly', note: null });
      await g(a).updateExpense(localId, id, {
        amount: 12_000,
        split: { mode: 'exact', amounts: { [maya]: 2_000, [nathan]: 10_000 } },
        date: '2026-02-02',
      });
      const updates = (await bodies(a, localId))
        .map((r) => r.event)
        .filter((e) => e.type === 'expense.updated');
      expect(updates.map((e) => (e.type === 'expense.updated' ? e.changes : null))).toEqual([
        { title: 'Dinner at the Grizzly', note: '' },
        { date: '2026-02-02', amount: 12_000, split: { [maya]: 2_000, [nathan]: 10_000 } },
      ]);
      const expense = (await derived(a, localId)).state.expenses.get(id);
      expect(expense).toMatchObject({
        title: 'Dinner at the Grizzly',
        amount: 12_000,
        date: '2026-02-02',
      });
      expect(expense?.note).toBeUndefined();
      expect(expense?.history.map((h) => h.kind)).toEqual(['added', 'updated', 'updated']);
      // The same split restated is not a change.
      const count = (await a.store.dump(localId)).length;
      await g(a).updateExpense(localId, id, {
        amount: 12_000,
        split: { mode: 'exact', amounts: { [nathan]: 10_000, [maya]: 2_000 } },
      });
      expect((await a.store.dump(localId)).length).toBe(count);
    });

    it('deletes are final, and restoring a version writes all its fields at once', async () => {
      const w = await setup(kind);
      const { a, localId, maya, nathan } = await twoDevices(w);
      const id = await g(a).addExpense(localId, {
        title: 'Dinner',
        amount: 9_000,
        paidBy: maya,
        date: '2026-02-01',
        category: 'food',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      await g(a).updateExpense(localId, id, {
        title: 'Lunch',
        category: 'drinks',
        note: 'oops',
        amount: 5_000,
        split: { mode: 'exact', amounts: { [nathan]: 5_000 } },
      });
      await g(a).restoreExpenseVersion(localId, id, 0);
      const restored = (await derived(a, localId)).state.expenses.get(id);
      expect(restored).toMatchObject({
        title: 'Dinner',
        category: 'food',
        amount: 9_000,
        split: { [maya]: 4_500, [nathan]: 4_500 },
      });
      expect(restored?.note).toBeUndefined();
      const last = (await bodies(a, localId)).at(-1)?.event;
      expect(last).toMatchObject({
        type: 'expense.updated',
        id,
        changes: {
          title: 'Dinner',
          paidBy: maya,
          date: '2026-02-01',
          category: 'food',
          note: '',
          amount: 9_000,
          split: { [maya]: 4_500, [nathan]: 4_500 },
        },
      });
      const count = (await a.store.dump(localId)).length;
      await g(a).restoreExpenseVersion(localId, id, 2); // the current version: nothing to write
      expect((await a.store.dump(localId)).length).toBe(count);
      await rejectsWith(g(a).restoreExpenseVersion(localId, id, 9), 'not_found');

      await g(a).deleteExpense(localId, id);
      const state = (await derived(a, localId)).state;
      expect(state.expenses.has(id)).toBe(false);
      expect(state.deletedExpenses.get(id)?.history.at(-1)?.kind).toBe('deleted');
      await rejectsWith(g(a).deleteExpense(localId, id), 'not_found');
      await rejectsWith(g(a).updateExpense(localId, id, { title: 'Back' }), 'not_found');
      await rejectsWith(g(a).restoreExpenseVersion(localId, id, 0), 'not_found');
      expect((await derived(a, localId)).myNet).toBe(0);
    });

    it('payments settle balances and can be deleted', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan } = await twoDevices(w);
      await g(a).addExpense(localId, {
        title: 'Dinner',
        amount: 9_000,
        paidBy: maya,
        date: '2026-02-01',
        category: 'food',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      expectSynced(await sync(a, localId));
      expectSynced(await sync(b, localId));
      const owed = await derived(b, localId);
      expect(owed.myNet).toBe(-4_500);
      expect(owed.transfers).toEqual([{ from: nathan, to: maya, amount: 4_500 }]);

      await rejectsWith(
        g(b).addPayment(localId, { from: nathan, to: nathan, amount: 1, date: '2026-02-02' }),
        'invalid',
      );
      await rejectsWith(
        g(b).addPayment(localId, { from: nathan, to: newId(), amount: 1, date: '2026-02-02' }),
        'not_found',
      );
      const payment = await g(b).addPayment(localId, {
        from: nathan,
        to: maya,
        amount: 4_500,
        date: '2026-02-02',
        note: 'e-transfer',
      });
      const settled = await derived(b, localId);
      expect(settled.myNet).toBe(0);
      expect(settled.transfers).toEqual([]);
      expect(settled.state.payments.get(payment)).toMatchObject({
        note: 'e-transfer',
        currency: 'CAD',
      });

      await g(b).deletePayment(localId, payment);
      expect((await derived(b, localId)).myNet).toBe(-4_500);
      await rejectsWith(g(b).deletePayment(localId, payment), 'not_found');
    });
  });

  describe('done adding', () => {
    it('marks and clears; allDone counts only claimed members; adding an expense clears your mark', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan } = await twoDevices(w);
      await g(a).setDone(localId);
      await g(a).setDone(localId); // repeat: no event
      expect((await bodies(a, localId)).filter((r) => r.event.type === 'member.done')).toHaveLength(
        1,
      );
      // Priya was pre-added and never claimed: she cannot hold the group up. Nathan has joined.
      expect((await derived(a, localId)).state.allDone).toBe(false);
      expectSynced(await sync(a, localId));
      expectSynced(await sync(b, localId));
      await g(b).setDone(localId);
      const done = await derived(b, localId);
      expect(done.state.doneMembers.sort()).toEqual([maya, nathan].sort());
      expect(done.state.allDone).toBe(true);

      await g(b).addExpense(localId, {
        title: 'One more',
        amount: 500,
        paidBy: nathan,
        date: '2026-02-03',
        category: 'other',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      expect((await derived(b, localId)).state.allDone).toBe(false);
      await g(a).setUndone(localId);
      await g(a).setUndone(localId);
      expect(
        (await bodies(a, localId)).filter((r) => r.event.type === 'member.undone'),
      ).toHaveLength(1);
      expect((await derived(a, localId)).state.doneMembers).not.toContain(maya);
    });
  });

  describe('the group', () => {
    it('rename keeps the cache; archive makes it read-only except unarchive and claims', async () => {
      const w = await setup(kind);
      const { a, localId, maya } = await twoDevices(w);
      await g(a).renameGroup(localId, '  Banff 2027 ');
      expect((await a.store.getGroup(localId))?.nameCache).toBe('Banff 2027');
      expect((await derived(a, localId)).name).toBe('Banff 2027');
      expect(decodeInvite((await g(a).inviteFor(localId)).code).g).toBe('Banff 2027');
      await rejectsWith(g(a).renameGroup(localId, ''), 'invalid');

      await g(a).archiveGroup(localId);
      const archived = await derived(a, localId);
      expect(archived.readOnly).toBe('archived');
      await rejectsWith(g(a).addMember(localId, 'Zed'), 'read_only');
      await rejectsWith(g(a).setDone(localId), 'read_only');
      await g(a).claimMember(localId, maya); // a claim is still allowed (no event: already claimed)
      await g(a).unarchiveGroup(localId);
      expect((await derived(a, localId)).readOnly).toBeNull();
      await g(a).addMember(localId, 'Zed');
    });
  });

  describe('leave', () => {
    it('reports unsent events, deletes rows, then the server copy, then the secret', async () => {
      const w = await setup(kind);
      const { a, localId, maya } = await twoDevices(w);
      const secret = await secretOn(a, localId);
      await g(a).addExpense(localId, {
        title: 'Unsent 1',
        amount: 100,
        paidBy: maya,
        date: '2026-02-01',
        category: 'other',
        split: { mode: 'equal', members: [maya] },
      });
      await g(a).setDone(localId);
      expect(await g(a).unsentCount(localId)).toBe(2);

      const order: string[] = [];
      const deleteSecret = a.secrets.deleteSecret.bind(a.secrets);
      a.secrets.deleteSecret = async (id) => {
        order.push(
          `secret after ${a.store.calls.filter((c) => c === 'deleteGroup' || c === 'pendingDeletes.add').join(',')}`,
        );
        return deleteSecret(id);
      };
      const deletes = () => w.server().requests.filter((r) => r.op === 'delete').length;
      const result = await g(a).leaveGroup(localId, { deleteServerCopy: true });
      expect(result).toEqual({ unsent: 2, serverCopy: { outcome: 'deleted' } });
      expect(order).toEqual(['secret after deleteGroup,pendingDeletes.add']);
      expect(a.store.calls.indexOf('deleteGroup')).toBeLessThan(
        a.store.calls.indexOf('pendingDeletes.add'),
      );
      expect(deletes()).toBe(1);
      expect(serverIds(w, secret)).toEqual([]);
      expect(await a.store.getGroup(localId)).toBeNull();
      expect(await a.secrets.getSecret(localId)).toBeNull();
      expect(await a.secrets.listLocalIds()).toEqual([]);
      expect(await a.store.pendingDeletes.list()).toEqual([]);
      expect(a.services.groupState.peek(localId).status).toBe('missing');
      expect(await a.services.groupState.list()).toEqual([]);
    });

    it('without the server delete nothing is sent; offline, the delete stays owed and is paid later', async () => {
      const w = await setup(kind);
      const { a, b, localId } = await twoDevices(w);
      const secret = await secretOn(a, localId);
      expect(await g(a).leaveGroup(localId)).toEqual({ unsent: 0, serverCopy: null });
      expect(w.server().requests.some((r) => r.op === 'delete')).toBe(false);
      expect(serverIds(w, secret).length).toBeGreaterThan(0);

      w.server().offline = true;
      const left = await g(b).leaveGroup(localId, { deleteServerCopy: true });
      expect(left.serverCopy).toEqual({ outcome: 'pending' });
      expect(await b.store.pendingDeletes.list()).toMatchObject([{ localId, serverUrl: SERVER }]);
      expect(await b.secrets.getSecret(localId)).toBeNull();
      w.server().offline = false;
      await b.services.foreground(); // syncAll pays debts first
      expect(await b.store.pendingDeletes.list()).toEqual([]);
      expect(serverIds(w, secret)).toEqual([]);
      await rejectsWith(g(b).leaveGroup(localId), 'not_found');
    });
  });

  describe('moving servers', () => {
    it('move announces group.moved on the old server, switches, and another member follows', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan } = await twoDevices(w);
      const secret = await secretOn(a, localId);
      const moved = await g(a).moveServer(localId, 'HTTPS://Other.test/');
      expect(moved).toMatchObject({
        outcome: 'moved',
        serverUrl: OTHER_SERVER,
        fromServer: SERVER,
      });
      expect((await a.store.getGroup(localId))?.serverUrl).toBe(OTHER_SERVER);
      expect(await a.secrets.listGroups()).toEqual([{ localId, serverUrl: OTHER_SERVER }]);
      const onA = (await a.store.dump(localId)).map((r) => r.id);
      expect(serverIds(w, secret, OTHER_SERVER).sort()).toEqual([...onA].sort());
      // The announcement reached the old server before the switch.
      const announcement = (await bodies(a, localId)).find((r) => r.event.type === 'group.moved');
      expect(announcement?.event).toMatchObject({ server: OTHER_SERVER, by: maya });
      expect((await derived(a, localId)).moveOffer).toBeNull();

      expectSynced(await sync(b, localId));
      const offered = await derived(b, localId);
      expect(offered.moveOffer).toBe(OTHER_SERVER);
      expect(await b.secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
      const followed = await g(b).followMove(localId);
      expect(followed).toMatchObject({ outcome: 'moved', serverUrl: OTHER_SERVER });
      expect(await b.secrets.listGroups()).toEqual([{ localId, serverUrl: OTHER_SERVER }]);
      expect((await derived(b, localId)).moveOffer).toBeNull();
      await rejectsWith(g(b).followMove(localId), 'not_found');

      await g(a).addExpense(localId, {
        title: 'After the move',
        amount: 800,
        paidBy: maya,
        date: '2026-02-05',
        category: 'other',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      expectSynced(await sync(a, localId));
      expectSynced(await sync(b, localId));
      const titles = [...(await derived(b, localId)).state.expenses.values()].map((e) => e.title);
      expect(titles).toContain('After the move');

      // Deleting the copy left on the old host.
      expect(serverIds(w, secret, SERVER).length).toBeGreaterThan(0);
      expect(await g(a).deleteServerCopy(localId, SERVER)).toEqual({ outcome: 'deleted' });
      expect(serverIds(w, secret, SERVER)).toEqual([]);
      expect(await g(a).deleteServerCopy(localId, OTHER_SERVER)).toEqual({
        outcome: 'failed',
        error: 'current_server',
      });
    });

    it('does not switch when the old server never acknowledges group.moved; refuses bad and same URLs', async () => {
      const w = await setup(kind);
      const { a, localId } = await twoDevices(w);
      await rejectsWith(g(a).moveServer(localId, 'http://other.test'), 'invalid_url');
      expect(await g(a).moveServer(localId, SERVER)).toMatchObject({
        outcome: 'failed',
        error: 'same_server',
      });
      expect((await bodies(a, localId)).some((r) => r.event.type === 'group.moved')).toBe(false);

      w.server().offline = true;
      expect(await g(a).moveServer(localId, OTHER_SERVER)).toEqual({
        localId,
        outcome: 'failed',
        error: 'not_acknowledged',
        fromServer: SERVER,
      });
      expect((await a.store.getGroup(localId))?.serverUrl).toBe(SERVER);
      expect(await a.secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
    });

    it('a blocked group moves without announcing and becomes active', async () => {
      const w = await setup(kind);
      const { a, localId } = await twoDevices(w);
      await a.store.setGroupState(localId, 'blocked');
      const result = await g(a).moveServer(localId, OTHER_SERVER);
      expect(result).toMatchObject({ outcome: 'moved' });
      expect(await a.store.getGroup(localId)).toMatchObject({
        state: 'active',
        serverUrl: OTHER_SERVER,
      });
      expect((await bodies(a, localId)).some((r) => r.event.type === 'group.moved')).toBe(false);
    });
  });

  describe('keychain index and reinstall recovery', () => {
    /** Rewrites a device's index entry for `localId` in the first format (a bare local id, no URL). */
    async function oldFormatEntry(d: Device, localId: string): Promise<void> {
      const index = await d.secrets.listGroups();
      d.secrets.kv.items.set(
        'even.groups',
        JSON.stringify(index.map((e) => (e.localId === localId ? e.localId : e))),
      );
    }

    it('after a reinstall, recovers every indexed group and the next sync pulls its log', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan } = await twoDevices(w);
      await g(a).addExpense(localId, {
        title: 'Groceries',
        amount: 4200,
        paidBy: maya,
        date: '2026-02-01',
        category: 'groceries',
        split: { mode: 'equal', members: [maya, nathan] },
      });
      expectSynced(await sync(a, localId));
      const { localId: other } = await g(a).createGroup({
        name: 'Elsewhere',
        currency: 'EUR',
        myName: 'Maya',
        serverUrl: OTHER_SERVER,
      });
      expectSynced(await sync(a, other));
      expect((await g(b).joinInvite((await g(a).inviteFor(other)).code)).kind).toBe('joined');

      const b2 = await w.reinstall(b);
      expect(await b2.store.listGroups()).toEqual([]);
      expect(b2.services.deviceId).toBe(b.services.deviceId);
      expect(await b2.secrets.listGroups()).toEqual([
        { localId, serverUrl: SERVER },
        { localId: other, serverUrl: OTHER_SERVER },
      ]);

      expect(await g(b2).recoverGroupsFromSecrets()).toBe(2);
      for (const [id, serverUrl] of [
        [localId, SERVER],
        [other, OTHER_SERVER],
      ] as const) {
        expect(await b2.store.getGroup(id)).toMatchObject({
          serverUrl,
          state: 'active',
          cursor: 0,
          epoch: null,
          myMemberId: null,
          lastSyncedAt: null,
        });
      }
      expect(await g(b2).recoverGroupsFromSecrets()).toBe(0);

      expectSynced(await sync(b2, localId));
      expectSynced(await sync(b2, other));
      const onA = await derived(a, localId);
      const recovered = await derived(b2, localId);
      expect(recovered.name).toBe('Banff 2026');
      // B claimed Nathan before the reinstall, and its device id survived: the seat comes back without asking.
      expect(recovered.needsClaim).toBe(false);
      expect(recovered.myMemberId).toBe(nathan);
      expect([...recovered.state.members.values()].map((m) => m.name)).toEqual(
        [...onA.state.members.values()].map((m) => m.name),
      );
      expect([...recovered.state.expenses.values()].map((e) => e.title)).toEqual(['Groceries']);
      // B joined Elsewhere but never picked a name: that one still asks.
      const elsewhere = await derived(b2, other);
      expect(elsewhere.name).toBe('Elsewhere');
      expect(elsewhere.needsClaim).toBe(true);
    });

    it('gives a row that lost its seat the member this device claimed, without writing an event', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId, memberId: maya } = await createTrip(a);
      expectSynced(await sync(a, localId));
      const count = (await a.store.dump(localId)).length;
      // What a keychain recovery (or a leave and re-join) leaves: the log says Maya is this device's, the row does not.
      await a.store.setMyMember(localId, null);
      a.services.groupState.invalidate(localId);
      expect((await derived(a, localId)).needsClaim).toBe(true);

      await g(a).processLifecycle(localId); // runs after every sync, join, import and at app start
      const after = await derived(a, localId);
      expect(after.needsClaim).toBe(false);
      expect(after.myMemberId).toBe(maya);
      expect((await a.store.getGroup(localId))?.myMemberId).toBe(maya);
      expect((await a.store.dump(localId)).length).toBe(count);
      expect((await a.services.groupState.list()).map((r) => r.needsClaim)).toEqual([false]);
      // Writes work again, signed by the restored seat.
      await g(a).setDone(localId);
      expect((await derived(a, localId)).state.doneMembers).toEqual([maya]);
      // Nothing to restore once the row has its seat.
      expect(await g(a).restoreSeat(localId)).toBe(false);
    });

    it('leaves the seat empty when no member, or more than one, carries this device', async () => {
      const w = await setup(kind);
      const { a, b, localId, maya, nathan } = await twoDevices(w);
      const c = await w.device('C');
      expect((await g(c).joinInvite((await g(a).inviteFor(localId)).code)).kind).toBe('joined');
      // C never claimed anything: it must pick a name, and keeps whatever it picks.
      expect(await g(c).restoreSeat(localId)).toBe(false);
      expect((await derived(c, localId)).needsClaim).toBe(true);

      // B claims Priya as well as Nathan, then loses its seat: two members carry B's device, so B asks.
      const priya = memberId((await derived(b, localId)).state, 'Priya');
      await g(b).claimMember(localId, priya);
      await b.store.setMyMember(localId, null);
      b.services.groupState.invalidate(localId);
      expect(await g(b).restoreSeat(localId)).toBe(false);
      expect((await derived(b, localId)).needsClaim).toBe(true);

      // "Is that you on another phone?" still works for a joined name on a genuinely other phone.
      await g(c).claimMember(localId, maya);
      const onC = await derived(c, localId);
      expect(onC.myMemberId).toBe(maya);
      expect(onC.state.members.get(maya)?.devices).toEqual(
        [a.services.deviceId, c.services.deviceId].sort(),
      );
      expect(onC.state.members.get(nathan)?.devices).toEqual([b.services.deviceId]);
    });

    it('creates rows only for missing groups, and skips entries without a URL or a secret', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const base = { currency: 'EUR', myName: 'Maya', serverUrl: SERVER };
      const { localId: kept } = await g(a).createGroup({ ...base, name: 'Kept' });
      const { localId: missing } = await g(a).createGroup({ ...base, name: 'Missing' });
      const { localId: noUrl } = await g(a).createGroup({ ...base, name: 'No URL' });
      const { localId: noSecret } = await g(a).createGroup({ ...base, name: 'No secret' });
      for (const id of [kept, missing, noUrl, noSecret]) expectSynced(await sync(a, id));
      const code = (await g(a).inviteFor(kept)).code;
      await oldFormatEntry(a, noUrl);
      a.secrets.kv.items.delete(`even.secret.${noSecret}`);

      const a2 = await w.reinstall(a);
      expect((await g(a2).joinInvite(code)).kind).toBe('joined');
      const keptRow = await a2.store.getGroup(kept);
      expect(keptRow?.cursor).toBeGreaterThan(0);

      expect(await g(a2).recoverGroupsFromSecrets()).toBe(1);
      expect((await a2.store.listGroups()).map((r) => r.localId).sort()).toEqual(
        [kept, missing].sort(),
      );
      expect(await a2.store.getGroup(kept)).toEqual(keptRow); // untouched
      expect(await a2.store.getGroup(missing)).toMatchObject({ serverUrl: SERVER, cursor: 0 });
      expectSynced(await sync(a2, missing));
      expect((await derived(a2, missing)).name).toBe('Missing');
    });

    it('on launch, fills in the URL of a first-format entry and repairs one a crash left stale', async () => {
      const w = await setup(kind);
      const a = await w.device('A');
      const { localId: first } = await createTrip(a);
      const { localId: second } = await g(a).createGroup({
        name: 'Other',
        currency: 'EUR',
        myName: 'Maya',
        serverUrl: OTHER_SERVER,
      });
      await oldFormatEntry(a, first);
      await a.secrets.setServerUrl(second, SERVER); // as if the app died between a move and its index update
      expect(await a.secrets.listGroups()).toEqual([
        { localId: first, serverUrl: null },
        { localId: second, serverUrl: SERVER },
      ]);

      const a2 = await w.restart(a);
      expect(await a2.secrets.listGroups()).toEqual([
        { localId: first, serverUrl: SERVER },
        { localId: second, serverUrl: OTHER_SERVER },
      ]);
    });
  });

  describe('checking a server', () => {
    it('reads /v1/info for Move server and Create, and words what is wrong', async () => {
      const w = await setup(kind);
      const { a, localId } = await twoDevices(w);
      const good = await g(a).checkServer('HTTPS://Other.test/', localId);
      expect(good).toMatchObject({ ok: true, serverUrl: OTHER_SERVER });
      if (!good.ok) throw new Error('unreachable');
      expect(good.info.limits.max_group_events).toBe(10_000);
      expect(good.usage?.events).toBe((await a.store.dump(localId)).length);
      expect(await g(a).checkServer('http://other.test')).toEqual({
        ok: false,
        problem: 'invalid_url',
      });
      w.server('https://never.test').offline = true;
      expect(await g(a).checkServer('https://never.test')).toEqual({
        ok: false,
        problem: 'unreachable',
      });
    });
  });

  describe('usage', () => {
    it("reports the group's bytes and events against the server's caps", async () => {
      const w = await setup(kind);
      const { a, localId } = await twoDevices(w);
      const report = await g(a).usage(localId);
      expect(report?.info.limits.max_group_events).toBe(10_000);
      expect(report?.usage.events).toBe((await a.store.dump(localId)).length);
      expect(report?.usage.warn).toBe(false);

      const c = await w.device('C');
      const { localId: other } = await g(c).createGroup({
        name: 'Offline',
        currency: 'EUR',
        myName: 'Cy',
        serverUrl: 'https://never.test',
      });
      w.server('https://never.test').offline = true;
      expect(await g(c).usage(other)).toBeNull();
    });
  });
});
