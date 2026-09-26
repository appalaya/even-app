/**
 * The group file: export through the share interface, import on a phone with or without the group, re-encryption
 * when the file's server differs, refusal of rotated-away groups, and bad files. Both stores.
 */
import {
  decodeInvite,
  deriveLocal,
  deriveServer,
  encodeInvite,
  makeInvite,
  newId,
  seal,
  type Event,
} from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

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
} from '../../state/testHarness';
import { STORE_KINDS, type StoreKind } from '../testing/testStore';
import {
  GROUP_FILE_FORMAT,
  GROUP_FILE_MIME,
  GROUP_FILE_UTI,
  parseGroupFile,
  type GroupFileV1,
} from './groupFile';

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});

async function setup(kind: StoreKind): Promise<World> {
  world = await createWorld(kind);
  return world;
}

async function trip(d: Device) {
  const { localId, memberId } = await d.services.groups.createGroup({
    name: 'Banff 2026',
    currency: 'CAD',
    myName: 'Maya',
    people: ['Nathan'],
    serverUrl: SERVER,
  });
  await d.services.groups.addExpense(localId, {
    title: 'Dinner',
    amount: 9_000,
    paidBy: memberId,
    date: '2026-02-01',
    category: 'food',
    split: { mode: 'equal', members: [memberId] },
  });
  return { localId, memberId };
}

async function exported(d: Device, localId: string): Promise<{ text: string; file: GroupFileV1 }> {
  await d.services.groups.exportGroupFile(localId);
  const shared = d.files.shared.at(-1);
  if (shared === undefined) throw new Error('nothing shared');
  const parsed = parseGroupFile(shared.contents);
  if (!parsed.ok) throw new Error('export is not a group file');
  return { text: shared.contents, file: parsed.file };
}

/** A well-formed envelope of a future version, stored as a pull would keep it. */
async function futureRow(d: Device, localId: string) {
  const secret = await secretOn(d, localId);
  const envelope = seal({
    key: deriveLocal(secret).encryptionKey,
    groupId: deriveServer(secret, SERVER).groupId,
    body: { sv: 1 } as unknown as Event,
  });
  return {
    id: envelope.id,
    origin: 'remote' as const,
    acked: true,
    seq: null,
    ts: null,
    envelope: JSON.stringify({ ...envelope, v: 2 }),
    status: 'unsupported_envelope' as const,
  };
}

async function sortedIds(d: Device, localId: string): Promise<string[]> {
  return (await d.store.dump(localId)).map((r) => r.id).sort();
}

describe.each(STORE_KINDS)('group file on the %s store', (kind) => {
  it('exports format, version, the invite and every envelope worth keeping through the share sheet', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    const future = await futureRow(a, localId);
    const junk = {
      id: newId(),
      origin: 'remote' as const,
      acked: true,
      seq: null,
      ts: null,
      envelope: JSON.stringify({ junk: true }),
      status: 'undecryptable' as const,
    };
    await a.store.insertEvents(localId, [future, junk]);

    const { file } = await exported(a, localId);
    expect(a.files.shared.at(-1)).toMatchObject({
      name: 'Banff 2026.even',
      mimeType: GROUP_FILE_MIME,
      uti: GROUP_FILE_UTI,
    });
    expect(file.format).toBe(GROUP_FILE_FORMAT);
    expect(file.v).toBe(1);
    const invite = decodeInvite(file.invite);
    expect(invite).toMatchObject({ s: SERVER, g: 'Banff 2026', cur: 'CAD' });
    expect(deriveLocal(Buffer.from(invite.k, 'base64url')).localId).toBe(localId);
    const ids = file.envelopes.map((e) => e.id).sort();
    expect(ids).toEqual((await sortedIds(a, localId)).filter((id) => id !== junk.id));
    expect(file.envelopes.find((e) => e.id === future.id)?.v).toBe(2);
    expect(Object.keys(file.envelopes[0] ?? {}).sort()).toEqual(['c', 'id', 'n', 'v']);
  });

  it('imports on a phone without the group, unacked, and restores the server copy on the next sync', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    expectSynced(await sync(a, localId));
    const { text } = await exported(a, localId);
    const secret = await secretOn(a, localId);

    const c = await w.device('C');
    const result = await c.services.groups.importGroupFile(text);
    expect(result).toEqual({
      outcome: 'imported',
      localId,
      created: true,
      revived: false,
      inserted: (await a.store.dump(localId)).length,
      dropped: 0,
      reencrypted: false,
      state: 'active',
    });
    expect(await c.store.getGroup(localId)).toMatchObject({
      serverUrl: SERVER,
      nameCache: 'Banff 2026',
      currencyCache: 'CAD',
      myMemberId: null,
      state: 'active',
    });
    expect(await c.secrets.listLocalIds()).toEqual([localId]);
    const rows = await c.store.dump(localId);
    expect(rows.every((r) => r.origin === 'remote' && !r.acked && r.status === 'ok')).toBe(true);
    const onA = await a.services.groupState.get(localId);
    const onC = await c.services.groupState.get(localId);
    expect(onC?.state?.expenses.size).toBe(1);
    expect(onC?.nets).toEqual(onA?.nets);
    expect(onC?.needsClaim).toBe(true);

    // The server lost the group: C's import brings it back whole.
    w.server().wipe(deriveServer(secret, SERVER).groupId);
    expectSynced(await sync(c, localId));
    expect(serverIds(w, secret).sort()).toEqual(await sortedIds(c, localId));

    // Importing again changes nothing but the acks.
    expect(await c.services.groups.importGroupFile(text)).toMatchObject({
      outcome: 'imported',
      created: false,
      inserted: 0,
    });
  });

  it('re-encrypts for the group’s current server when the file names another one', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    await a.store.insertEvents(localId, [await futureRow(a, localId)]);
    const { text, file } = await exported(a, localId);
    const secret = await secretOn(a, localId);

    // C holds the group on another server (it accepted an invite naming it) with nothing there yet.
    const c = await w.device('C');
    const joined = await c.services.groups.joinInvite(
      encodeInvite(makeInvite(secret, OTHER_SERVER, { g: 'Banff 2026' })),
    );
    expect(joined.kind).toBe('joined');
    const result = await c.services.groups.importGroupFile(text);
    expect(result).toMatchObject({
      outcome: 'imported',
      created: false,
      reencrypted: true,
      dropped: 1, // the future-version envelope cannot be re-encrypted
      inserted: file.envelopes.length - 1,
    });
    const d = await c.services.groupState.get(localId);
    expect(d?.state?.expenses.size).toBe(1);
    expect(d?.skipped.total).toBe(0);
    expect(d?.name).toBe('Banff 2026');
    expectSynced(await sync(c, localId));
    expect(serverIds(w, secret, OTHER_SERVER).sort()).toEqual(await sortedIds(c, localId));
    expect(serverIds(w, secret, SERVER)).toEqual([]);
  });

  it('refuses a group rotated away here unless forced; forced, it comes back read-only', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const b = await w.device('B');
    const { localId } = await trip(a);
    expectSynced(await sync(a, localId));
    await b.services.groups.joinInvite((await a.services.groups.inviteFor(localId)).code);
    await a.services.groups.rotateInvite(localId);
    await a.services.idle();
    expectSynced(await sync(b, localId));
    expect((await b.store.getGroup(localId))?.state).toBe('closed');

    const { text } = await exported(a, localId); // A's copy (hidden there) holds the closure
    expect(await b.services.groups.importGroupFile(text)).toEqual({
      outcome: 'refused',
      localId,
      state: 'closed',
    });
    await b.store.setGroupState(localId, 'hidden');
    expect(await b.services.groups.importGroupFile(text)).toMatchObject({
      outcome: 'refused',
      state: 'hidden',
    });
    const revived = await b.services.groups.importGroupFile(text, { force: true });
    expect(revived).toMatchObject({ outcome: 'imported', revived: true, state: 'closed' });
    await b.services.idle();
    expect((await b.store.getGroup(localId))?.state).toBe('closed');
    expect((await b.services.groupState.list()).map((r) => [r.localId, r.closed])).toContainEqual([
      localId,
      true,
    ]);
  });

  it('a group hidden without a closure (a concurrent-rotation pick) revives active', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    const { text } = await exported(a, localId);
    await a.services.groups.hideGroup(localId);
    expect(await a.services.groups.importGroupFile(text, { force: true })).toMatchObject({
      outcome: 'imported',
      revived: true,
      state: 'active',
    });
  });

  it('drops envelopes it cannot read and names what is wrong with a bad file', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    const { file } = await exported(a, localId);
    const c = await w.device('C');
    const tampered: GroupFileV1 = {
      ...file,
      envelopes: file.envelopes.map((e, i) =>
        i === 0 ? { ...e, c: (e.c[0] === 'A' ? 'B' : 'A') + e.c.slice(1) } : e,
      ),
    };
    expect(await c.services.groups.importGroupFile(JSON.stringify(tampered))).toMatchObject({
      outcome: 'imported',
      dropped: 1,
      inserted: file.envelopes.length - 1,
    });
    const notEnvelopes = { ...file, envelopes: [{ id: 'x' }, 42, ...file.envelopes] };
    expect(await c.services.groups.importGroupFile(JSON.stringify(notEnvelopes))).toMatchObject({
      dropped: 2,
    });

    const invalid = async (text: string) => c.services.groups.importGroupFile(text);
    expect(await invalid('not json')).toEqual({ outcome: 'invalid', problem: 'format' });
    expect(await invalid(JSON.stringify({ ...file, format: 'other' }))).toEqual({
      outcome: 'invalid',
      problem: 'format',
    });
    expect(await invalid(JSON.stringify({ ...file, v: 2 }))).toEqual({
      outcome: 'invalid',
      problem: 'version',
    });
    expect(await invalid(JSON.stringify({ ...file, envelopes: 'x' }))).toEqual({
      outcome: 'invalid',
      problem: 'format',
    });
    expect(await invalid(JSON.stringify({ ...file, invite: 'garbage' }))).toEqual({
      outcome: 'invalid',
      problem: 'malformed',
    });
    const payload = JSON.parse(Buffer.from(file.invite, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const badSum = Buffer.from(JSON.stringify({ ...payload, h: 'AAAAAA' })).toString('base64url');
    expect(await invalid(JSON.stringify({ ...file, invite: badSum }))).toEqual({
      outcome: 'invalid',
      problem: 'checksum',
    });
  });

  it('picks a file through the file interface; a cancelled pick is null', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    const { text } = await exported(a, localId);
    const c = await w.device('C');
    c.files.queuePick({ name: 'Banff 2026.even', text });
    c.files.queuePick(null);
    expect(await c.services.groups.pickGroupFile()).toBe(text);
    expect(await c.services.groups.pickGroupFile()).toBeNull();
  });

  it('exports the CSV through the same interface', async () => {
    const w = await setup(kind);
    const a = await w.device('A');
    const { localId } = await trip(a);
    await a.services.groups.exportCsv(localId);
    const csv = a.files.shared.at(-1);
    expect(csv?.name).toBe('Banff 2026.csv');
    expect(csv?.contents.startsWith('﻿Type,Date,Title')).toBe(true);
    expect(csv?.contents).toContain('Expense,2026-02-01,Dinner,Food,Maya,,90.00,CAD,,90.00,');
  });
});
