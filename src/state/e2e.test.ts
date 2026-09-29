/**
 * The state layer end to end against a real Even server (skipped unless EVEN_E2E_SERVER_URL is set), e.g. the
 * Python reference, started as described in src/services/sync/e2e.test.ts:
 *
 *   EVEN_E2E_SERVER_URL=http://127.0.0.1:8787 npx vitest run src/state/e2e.test.ts
 *
 * Two phones (two stores) through `createAppServices`: create → join → claim → both add an expense → converge;
 * then a rotation that the second phone follows. Keys are derived for the canonical https origin; the transport
 * reaches the same loopback server over http.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createMemorySecrets } from '../services/secrets/memorySecrets';
import { HttpTransport } from '../services/sync/httpTransport';
import type { SyncResult } from '../services/sync/types';
import {
  openTestStore,
  STORE_KINDS,
  type StoreKind,
  type TestStore,
} from '../services/testing/testStore';
import { createAppServices, type AppServices } from './services';

const SERVER = process.env.EVEN_E2E_SERVER_URL;

const opened: { store: TestStore; services: AppServices }[] = [];
afterEach(async () => {
  for (const { services } of opened) services.dispose();
  await Promise.all(opened.splice(0).map(({ store }) => store.close()));
});

function transportFor(origin: string): HttpTransport {
  return new HttpTransport(origin.replace(/^https:/, 'http:'), {
    allowInsecureLocal: true,
    timeoutMs: 10_000,
  });
}

async function phone(kind: StoreKind): Promise<AppServices> {
  const store = await openTestStore(kind);
  const services = await createAppServices({
    store,
    secrets: createMemorySecrets(),
    transportFor,
    log: () => undefined,
  });
  opened.push({ store, services });
  return services;
}

function synced(result: SyncResult): void {
  if (result.outcome !== 'synced') throw new Error(`expected synced: ${JSON.stringify(result)}`);
}

async function refresh(p: AppServices, localId: string): Promise<void> {
  synced(await p.groups.sync(localId, 'pull_to_refresh'));
  await p.idle();
}

describe.skipIf(SERVER === undefined).each(STORE_KINDS)(
  'state layer end to end on the %s store',
  (kind) => {
    it(
      'create, join on a second phone, add expenses, converge; then rotate and follow',
      { timeout: 60_000 },
      async () => {
        const origin = new HttpTransport(SERVER ?? '', { allowInsecureLocal: true }).origin;
        const a = await phone(kind);
        const b = await phone(kind);

        const { localId, memberId: maya } = await a.groups.createGroup({
          name: 'E2E trip',
          currency: 'CAD',
          myName: 'Maya',
          people: ['Nathan'],
          serverUrl: origin,
        });
        expect((await a.groups.inviteFor(localId)).ready).toBe(false);
        await refresh(a, localId);
        const invite = await a.groups.inviteFor(localId);
        expect(invite.ready).toBe(true);

        const joined = await b.groups.joinInvite(invite.link);
        expect(joined).toMatchObject({ kind: 'joined', needsClaim: true, waiting: false });
        const members = (await b.groupState.get(localId))?.state?.members;
        const nathan = [...(members?.values() ?? [])].find((m) => m.name === 'Nathan')?.id ?? '';
        await b.groups.claimMember(localId, nathan);

        const today = '2026-09-26';
        await a.groups.addExpense(localId, {
          title: 'Dinner',
          amount: 9_000,
          paidBy: maya,
          date: today,
          category: 'food',
          split: { mode: 'equal', members: [maya, nathan] },
        });
        await b.groups.addExpense(localId, {
          title: 'Gas',
          amount: 3_000,
          paidBy: nathan,
          date: today,
          category: 'fuel',
          split: { mode: 'equal', members: [maya, nathan] },
        });
        await refresh(a, localId);
        await refresh(b, localId);
        await refresh(a, localId);

        const onA = await a.groupState.get(localId);
        const onB = await b.groupState.get(localId);
        expect([...(onA?.state?.expenses.keys() ?? [])].sort()).toEqual(
          [...(onB?.state?.expenses.keys() ?? [])].sort(),
        );
        expect(onA?.state?.expenses.size).toBe(2);
        expect(onA?.nets).toEqual(onB?.nets);
        expect(onA?.myNet).toBe(3_000);
        expect(onB?.myNet).toBe(-3_000);
        expect(onB?.transfers).toEqual([{ from: nathan, to: maya, amount: 3_000 }]);
        expect(onA?.state?.members.get(nathan)?.devices).toEqual([b.deviceId]);
        for (const p of [a, b]) expect((await p.store.countByStatus(localId)).outbox).toBe(0);

        // Rotation: A regenerates the invite; B's old copy closes, and B follows with the new invite.
        const rotated = await a.groups.rotateInvite(localId);
        await a.idle();
        synced(rotated.pushed);
        synced(rotated.closing);
        expect((await a.store.getGroup(localId))?.state).toBe('hidden');
        await refresh(b, localId);
        expect((await b.store.getGroup(localId))?.state).toBe('closed');
        const followed = await b.groups.joinInvite(rotated.invite.code);
        await b.idle();
        expect(followed).toMatchObject({ kind: 'joined', needsClaim: false });
        expect((await b.store.getGroup(localId))?.state).toBe('hidden');
        const next = await b.groupState.get(rotated.localId);
        expect(next?.state?.expenses.size).toBe(2);
        expect(next?.myNet).toBe(-3_000);
      },
    );
  },
);
