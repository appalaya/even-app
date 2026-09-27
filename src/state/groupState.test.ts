/**
 * Derived group state: invalidation on sync `finished` and on local writes, snapshots for hooks, skipped counts,
 * the update-required flag, the balances-unavailable wrap, and the Groups list.
 */
import {
  deriveLocal,
  deriveServer,
  emptyState,
  LIMITS,
  newId,
  seal,
  type Envelope,
  type Event,
  type GroupState,
} from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import type { NewEventRow } from '../services/storage/types';
import { settle } from '../services/testing/fakeClock';
import { STORE_KINDS, type StoreKind } from '../services/testing/testStore';
import { balancesOf, sortGroupRows, type GroupListRow, type GroupSnapshot } from './groupState';
import {
  createWorld,
  expectSynced,
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

async function setup(kind: StoreKind): Promise<World> {
  world = await createWorld(kind);
  return world;
}

async function trip(w: World) {
  const a = await w.device('A');
  const b = await w.device('B');
  const { localId, memberId: maya } = await a.services.groups.createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Nathan'],
    serverUrl: SERVER,
  });
  expectSynced(await sync(a, localId));
  await b.services.groups.joinInvite((await a.services.groups.inviteFor(localId)).code);
  const state = (await b.services.groupState.get(localId))?.state;
  const nathan = [...(state?.members.values() ?? [])].find((m) => m.name === 'Nathan')?.id ?? '';
  await b.services.groups.claimMember(localId, nathan);
  expectSynced(await sync(b, localId));
  expectSynced(await sync(a, localId));
  return { a, b, localId, maya, nathan };
}

const dinner = (paidBy: string, members: string[], amount = 9_000) => ({
  title: 'Dinner',
  amount,
  paidBy,
  date: '2026-02-01',
  category: 'food' as const,
  split: { mode: 'equal' as const, members },
});

/** A row as a pull would store it: sealed for the device's current server, remote, acked, with a status. */
async function stored(
  d: Device,
  localId: string,
  body: unknown,
  status: NewEventRow['status'],
  mutate?: (envelope: Envelope) => Record<string, unknown>,
): Promise<NewEventRow> {
  const row = await d.store.getGroup(localId);
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const groupId = deriveServer(secret, row?.serverUrl ?? SERVER).groupId;
  const envelope = seal({ key, groupId, body: body as Event });
  const ts = typeof (body as { ts?: unknown }).ts === 'number' ? (body as { ts: number }).ts : null;
  return {
    id: envelope.id,
    origin: 'remote',
    acked: true,
    seq: null,
    ts: status === 'ok' || status === 'invalid' || status === 'unsupported_body' ? ts : null,
    envelope: JSON.stringify(mutate === undefined ? envelope : mutate(envelope)),
    status,
  };
}

describe.each(STORE_KINDS)('derived group state on the %s store', (kind) => {
  it('re-derives and notifies on the engine’s finished events', async () => {
    const w = await setup(kind);
    const { a, b, localId, maya, nathan } = await trip(w);
    const snapshots: GroupSnapshot[] = [];
    const unsubscribe = b.services.groupState.subscribe(localId, () =>
      snapshots.push(b.services.groupState.peek(localId)),
    );
    let lists = 0;
    const unsubscribeList = b.services.groupState.subscribeList(() => {
      lists += 1;
    });
    await settle();
    expect(b.services.groupState.peek(localId).derived?.state?.expenses.size).toBe(0);
    expect(b.services.groupState.peekList().rows.map((r) => r.myNet)).toEqual([0]);
    // Nothing to settle yet: the card must not say "settled".
    expect(b.services.groupState.peekList().rows.map((r) => r.hasActivity)).toEqual([false]);

    await a.services.groups.addExpense(localId, dinner(maya, [maya, nathan]));
    expectSynced(await sync(a, localId));
    snapshots.length = 0;
    lists = 0;
    expectSynced(await sync(b, localId));
    await settle();

    const latest = b.services.groupState.peek(localId);
    expect(latest.status).toBe('ready');
    expect(latest.derived?.state?.expenses.size).toBe(1);
    expect(latest.derived?.myNet).toBe(-4_500);
    expect(latest.sync).toMatchObject({ syncing: false, lastSyncError: null, lifecycle: 'active' });
    expect(latest.sync?.lastResult?.outcome).toBe('synced');
    expect(snapshots.some((s) => s.sync?.syncing === true)).toBe(true);
    expect(snapshots.at(-1)).toBe(latest);
    expect(lists).toBeGreaterThan(0);
    expect(b.services.groupState.peekList().rows[0]).toMatchObject({
      localId,
      name: 'Banff 2026',
      currency: 'CAD',
      myNet: -4_500,
      hasActivity: true,
      // Everything a Groups card shows rides on the row: two people, nothing unsent on B.
      memberCount: 2,
      outbox: 0,
      needsClaim: false,
    });
    // Snapshots are replaced, never mutated: the same object until something changes.
    expect(b.services.groupState.peek(localId)).toBe(latest);
    unsubscribe();
    unsubscribeList();
  });

  it('re-derives on a local write', async () => {
    const w = await setup(kind);
    const { b, localId, maya, nathan } = await trip(w);
    let calls = 0;
    const unsubscribe = b.services.groupState.subscribe(localId, () => {
      calls += 1;
    });
    await settle();
    calls = 0;
    await b.services.groups.addExpense(localId, dinner(nathan, [maya, nathan], 1_000));
    await settle();
    expect(calls).toBeGreaterThan(0);
    expect(b.services.groupState.peek(localId).derived?.myNet).toBe(500);
    expect((await b.services.groupState.get(localId))?.state?.expenses.size).toBe(1);
    unsubscribe();
  });

  it('counts skipped rows by status and raises update-required only for money or unknown envelopes', async () => {
    const w = await setup(kind);
    const { b, localId, nathan } = await trip(w);
    const dev = newId();
    const ts = w.clock.now();
    const base = { ts, at: ts, by: nathan, dev };
    const themed = await stored(
      b,
      localId,
      { sv: 1, type: 'group.themed', theme: 'x', ...base },
      'unsupported_body',
    );
    const junk: NewEventRow = {
      id: newId(),
      origin: 'remote',
      acked: true,
      seq: null,
      ts: null,
      envelope: JSON.stringify({ not: 'an envelope' }),
      status: 'undecryptable',
    };
    await b.store.insertEvents(localId, [themed, junk]);
    b.services.groupState.invalidate(localId);
    let d = await b.services.groupState.get(localId);
    expect(d?.skipped).toEqual({
      undecryptable: 1,
      invalid: 0,
      unsupported_envelope: 0,
      unsupported_body: 1,
      total: 2,
    });
    expect(d?.updateRequired).toBe(false);

    const badMoney = await stored(
      b,
      localId,
      { sv: 1, type: 'payment.added', payment: { id: newId(), amount: -1 }, ...base },
      'invalid',
    );
    await b.store.insertEvents(localId, [badMoney]);
    b.services.groupState.invalidate(localId);
    d = await b.services.groupState.get(localId);
    expect(d?.skipped.invalid).toBe(1);
    expect(d?.updateRequired).toBe(true);
    expect(d?.balancesUnavailable).toBe(false);
  });

  it('an envelope of an unknown version also requires an update (it may hold money)', async () => {
    const w = await setup(kind);
    const { b, localId } = await trip(w);
    const future = await stored(b, localId, { sv: 1 }, 'unsupported_envelope', (e) => ({
      ...e,
      v: 2,
    }));
    await b.store.insertEvents(localId, [future]);
    b.services.groupState.invalidate(localId);
    const d = await b.services.groupState.get(localId);
    expect(d?.skipped.unsupported_envelope).toBe(1);
    expect(d?.updateRequired).toBe(true);
    const sv2 = await stored(b, localId, { sv: 2, type: 'expense.added' }, 'unsupported_body');
    await b.store.insertEvents(localId, [sv2]);
    b.services.groupState.invalidate(localId);
    expect((await b.services.groupState.get(localId))?.skipped.unsupported_body).toBe(1);
  });

  it('a group without its secret derives no state and is read-only', async () => {
    const w = await setup(kind);
    const { b, localId } = await trip(w);
    await b.secrets.deleteSecret(localId);
    b.services.groupState.invalidate(localId);
    const d = await b.services.groupState.get(localId);
    expect(d).toMatchObject({
      noSecret: true,
      state: null,
      readOnly: 'no_secret',
      name: 'Banff 2026',
    });
  });

  it('lists groups: hidden ones left out, closed ones marked, archived last', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const make = async (name: string) =>
      (
        await a.services.groups.createGroup({
          name,
          currency: 'EUR',
          myName: 'Maya',
          serverUrl: SERVER,
        })
      ).localId;
    const one = await make('One');
    await w.clock.advance(1000);
    const two = await make('Two');
    await w.clock.advance(1000);
    const three = await make('Three');
    await w.clock.advance(1000);
    const four = await make('Four');
    await a.services.groups.archiveGroup(two);
    await a.store.setGroupState(three, 'hidden');
    await a.store.setGroupState(four, 'closed');
    for (const id of [one, two, three, four]) a.services.groupState.invalidate(id);
    const list = await a.services.groupState.list();
    expect(list.map((r) => r.name)).toEqual(['Four', 'One', 'Two']);
    expect(list.map((r) => [r.archived, r.closed])).toEqual([
      [false, true],
      [false, false],
      [true, false],
    ]);
  });
});

describe('balances', () => {
  it('wraps a hostile log whose nets overflow: balances unavailable instead of a crash', () => {
    const state: GroupState = emptyState();
    const a = newId();
    const b = newId();
    for (const id of [a, b]) {
      state.members.set(id, {
        id,
        name: id,
        archived: false,
        devices: [],
        unknown: false,
        color: 0,
        initials: 'X',
      });
    }
    for (let i = 0; i < 2; i++) {
      const id = newId();
      state.expenses.set(id, {
        id,
        title: 'x',
        amount: Number.MAX_SAFE_INTEGER,
        currency: 'CAD',
        paidBy: a,
        date: '2026-01-01',
        category: 'other',
        split: { [b]: Number.MAX_SAFE_INTEGER },
        addedBy: a,
        addedAt: 0,
        updatedAt: 0,
        history: [],
      });
    }
    expect(balancesOf(state)).toEqual({ nets: null, transfers: [], balancesUnavailable: true });
    state.expenses.clear();
    const ok = balancesOf(state);
    expect(ok.balancesUnavailable).toBe(false);
    expect(ok.nets?.get(a)).toBe(0);
    expect(ok.transfers).toEqual([]);
  });

  it('a real hostile log through the store shows balances unavailable', async () => {
    const w = await createWorld('fake');
    world = w;
    const a = await w.device('A');
    const { localId, memberId: maya } = await a.services.groups.createGroup({
      name: 'Hostile',
      currency: 'USD',
      myName: 'Maya',
      people: ['Mallory'],
      serverUrl: SERVER,
    });
    const mallory =
      [...((await a.services.groupState.get(localId))?.state?.members.values() ?? [])].find(
        (m) => m.name === 'Mallory',
      )?.id ?? '';
    const secret = await secretOn(a, localId);
    const key = deriveLocal(secret).encryptionKey;
    const groupId = deriveServer(secret, SERVER).groupId;
    // Enough maximum-amount expenses owed by one member to push a net past 2^53.
    const count = Math.ceil(Number.MAX_SAFE_INTEGER / LIMITS.amountMax) + 1;
    const rows: NewEventRow[] = [];
    let ts = w.clock.now() + 10;
    for (let i = 0; i < count; i++) {
      ts += 1;
      const event: Event = {
        sv: 1,
        ts,
        at: ts,
        by: mallory,
        dev: newId(),
        type: 'expense.added',
        expense: {
          id: newId(),
          title: 'x',
          amount: LIMITS.amountMax,
          currency: 'USD',
          paidBy: maya,
          date: '2026-01-01',
          category: 'other',
          split: { [mallory]: LIMITS.amountMax },
        },
      };
      const envelope = seal({ key, groupId, body: event });
      rows.push({
        id: envelope.id,
        origin: 'remote',
        acked: true,
        seq: null,
        ts,
        envelope: JSON.stringify(envelope),
        status: 'ok',
      });
    }
    await a.store.insertEvents(localId, rows);
    a.services.groupState.invalidate(localId);
    const d = await a.services.groupState.get(localId);
    expect(d?.balancesUnavailable).toBe(true);
    expect(d?.myNet).toBeNull();
    expect(d?.nets).toBeNull();
    expect(d?.state?.expenses.size).toBe(count);
    expect((await a.services.groupState.list())[0]).toMatchObject({
      balancesUnavailable: true,
      myNet: null,
    });
  }, 60_000);
});

describe('sortGroupRows', () => {
  const row = (localId: string, lastActivityAt: number, archived = false): GroupListRow => ({
    localId,
    name: localId,
    currency: 'CAD',
    myNet: 0,
    memberCount: 2,
    outbox: 0,
    hasActivity: true,
    balancesUnavailable: false,
    lifecycle: 'active',
    archived,
    closed: false,
    needsClaim: false,
    sync: {
      lifecycle: 'active',
      syncing: false,
      lastSyncedAt: null,
      lastSyncError: null,
      serverUrl: SERVER,
      lastResult: null,
    },
    lastActivityAt,
    rotationSiblings: [],
  });

  it('active groups by latest activity, newest first, then archived ones; ties by id', () => {
    const sorted = sortGroupRows([
      row('old', 1),
      row('archivedNew', 9, true),
      row('new', 5),
      row('archivedOld', 2, true),
      row('b', 3),
      row('a', 3),
    ]);
    expect(sorted.map((r) => r.localId)).toEqual([
      'new',
      'a',
      'b',
      'old',
      'archivedNew',
      'archivedOld',
    ]);
  });
});
