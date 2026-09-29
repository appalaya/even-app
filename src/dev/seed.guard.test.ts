/**
 * The dev seed never talks to the production server. Every state runs against the state layer's test world (fake
 * servers keyed by URL, a fake clock) with the dev server's URL: no group row, keychain entry, pending delete or
 * request lands on production, even once the syncs it starts have run. A production `server` is refused, and so is
 * a phone that still holds a production group, until the cleanup has deleted its copy there with DELETEs alone.
 */
import { deriveLocal, deriveServer, newId, PROTOCOL, seal, type Event } from '@even/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createWorld, type Device, type World } from '../state/testHarness';
import { cleanupProduction, fixedSecret, SEED_SECRET_TEXTS } from './cleanupProduction';
import {
  assertNotProduction,
  devServerUrl,
  isProductionServer,
  productionHoldings,
  seedServerOrigin,
} from './devServer';
import {
  buildCopyScenario,
  buildScenario,
  GROUP_SCENARIOS,
  seed,
  SEED_STATES,
  seedSecret,
} from './seed';

const PRODUCTION = PROTOCOL.defaultServer;
/** The dev server as the iOS simulator is given it, and as a group stores it. */
const DEV_URL = 'http://127.0.0.1:8787';
const DEV = 'https://127.0.0.1:8787';
/** The servers the "does not answer" states keep. */
const UNANSWERING = ['https://10.255.255.1', 'https://127.0.0.1:9', 'https://home.example.net'];

let world: World | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

async function device(): Promise<Device> {
  world = await createWorld('fake', Date.now());
  return world.device();
}

/** Every server this phone holds anything for: rows, keychain entries, pending deletes. */
async function serversHeld(d: Device): Promise<string[]> {
  const rows = (await d.store.listGroups()).map((row) => row.serverUrl);
  const entries = (await d.secrets.listGroups()).map((entry) => entry.serverUrl ?? '(none)');
  const debts = (await d.store.pendingDeletes.list()).map((debt) => debt.serverUrl);
  return [...new Set([...rows, ...entries, ...debts])];
}

describe('the dev server', () => {
  it('is 127.0.0.1 from the simulator and 10.0.2.2 from the Android emulator', () => {
    expect(devServerUrl('ios')).toBe('http://127.0.0.1:8787');
    expect(devServerUrl('android')).toBe('http://10.0.2.2:8787');
    expect(seedServerOrigin(devServerUrl('ios'))).toBe(DEV);
    expect(seedServerOrigin(devServerUrl('android'))).toBe('https://10.0.2.2:8787');
    // A phone on the local network, or an https tunnel.
    expect(seedServerOrigin('http://192.168.1.20:8787')).toBe('https://192.168.1.20:8787');
    expect(seedServerOrigin('https://even-dev.example.net')).toBe('https://even-dev.example.net');
  });

  it('is never production: the default server and every host under appalaya.com are refused', () => {
    for (const url of [
      PRODUCTION,
      'https://SYNC.even.appalaya.com:443/',
      'http://sync.even.appalaya.com',
      'https://sync.even.appalaya.com.',
      'https://appalaya.com',
      'https://staging.appalaya.com',
      'https://x.even.appalaya.com:8443/even',
      'not a url',
    ]) {
      expect(isProductionServer(url), url).toBe(true);
      expect(() => assertNotProduction(url), url).toThrow(/production/);
    }
    for (const url of [DEV, 'https://10.0.2.2:8787', ...UNANSWERING, 'https://notappalaya.com']) {
      expect(isProductionServer(url), url).toBe(false);
    }
    expect(() => seedServerOrigin(PRODUCTION)).toThrow(/production/);
    expect(() => seedServerOrigin('http://sync.even.appalaya.com')).toThrow();
    // Plain http only for this Mac or the local network.
    expect(() => seedServerOrigin('http://even-dev.example.net:8787')).toThrow(/local network/);
  });
});

describe('seed', () => {
  it('builds every Group scenario on the dev server, or on a server that does not answer', () => {
    const now = new Date(2026, 8, 26, 15, 0).getTime();
    const copies = ['owed', 'settled-member', 'collision', 'expense-currency'] as const;
    const specs = [
      ...GROUP_SCENARIOS.map((state) => buildScenario(state, 'thisDeviceAAAAAAAAAAAA', now, DEV)),
      ...copies.map((state) => buildCopyScenario(state, 'thisDeviceAAAAAAAAAAAA', now, DEV)),
    ];
    for (const spec of specs) {
      expect([DEV, ...UNANSWERING]).toContain(spec.serverUrl);
      // The cleanup knows every fixed key the seed uses.
      expect(SEED_SECRET_TEXTS).toContain(`even-dev-seed/${spec.key}`);
      expect(fixedSecret(`even-dev-seed/${spec.key}`)).toEqual(seedSecret(spec.key));
    }
  });

  it('never reaches production from any state, and syncs with the dev server', async () => {
    const d = await device();
    const w = world as World;
    // The Groups screen keeps the list loaded, and the Diagnostics seed waits on it for the syncs it starts.
    await d.services.groupState.list();
    let onDev = 0;
    for (const state of SEED_STATES) {
      if (state === 'expense-flagged') continue; // rendered in place, nothing written
      await seed(d.services, state, { server: DEV_URL });
      for (const server of await serversHeld(d)) {
        expect([DEV, ...UNANSWERING], `${state}: ${server}`).toContain(server);
      }
      onDev += (await d.store.listGroups()).filter((row) => row.serverUrl === DEV).length;
      // Let the syncs the state started run: debounced writes, first pushes, retries.
      await w.clock.advance(15 * 60_000);
    }
    expect(onDev).toBeGreaterThan(0);
    expect(w.server(PRODUCTION).requests).toEqual([]);
    expect(w.server(DEV).requests.some((request) => request.op === 'push')).toBe(true);
  }, 30_000);

  it('refuses a production server before touching anything', async () => {
    const d = await device();
    await seed(d.services, 'group', { server: DEV_URL });
    const before = await d.store.listGroups();
    for (const server of [
      PRODUCTION,
      'https://staging.appalaya.com',
      'http://sync.even.appalaya.com',
    ]) {
      await expect(seed(d.services, 'groups', { server })).rejects.toThrow();
    }
    expect(await d.store.listGroups()).toEqual(before);
  });
});

describe('a phone that still holds production groups from older seeds', () => {
  /** A fixed-key group an older seed pushed to production, as another phone left it there. */
  async function oldFixedCopy(w: World, text: string): Promise<string> {
    const secret = fixedSecret(text);
    const { encryptionKey } = deriveLocal(secret);
    const { groupId, authToken } = deriveServer(secret, PRODUCTION);
    const id = newId();
    const at = 1_760_000_000_000;
    const body: Event = {
      sv: 1,
      ts: at,
      at,
      by: newId(),
      dev: newId(),
      type: 'member.done',
      id: newId(),
    };
    await w
      .server(PRODUCTION)
      .transport()
      .push(groupId, authToken, [seal({ key: encryptionKey, groupId, body, id })]);
    return groupId;
  }

  it('is refused by the seed, and the cleanup deletes the copies there with DELETEs alone', async () => {
    const d = await device();
    const w = world as World;
    // A group an older seed created on production and pushed, and a keychain entry whose row is gone.
    const { localId } = await d.services.groups.createGroup({
      name: 'Friday dinners',
      currency: 'CAD',
      myName: 'Sam',
      people: ['Maya'],
      serverUrl: PRODUCTION,
    });
    await w.clock.advance(5_000);
    const orphan = await d.services.groups.createGroup({
      name: 'Oak Street house',
      currency: 'CAD',
      myName: 'Sam',
      people: ['Priya'],
      serverUrl: PRODUCTION,
    });
    await w.clock.advance(5_000);
    await d.store.deleteGroup(orphan.localId);
    const fixed = await oldFixedCopy(w, 'even-dev-seed/banff-invite');
    const oldB = await oldFixedCopy(w, 'even-dev-seed-b/banff');
    expect(w.server(PRODUCTION).groups.size).toBe(4);
    expect((await productionHoldings(d.services)).map((h) => [h.localId, h.hasRow])).toEqual([
      [localId, true],
      [orphan.localId, false],
    ]);

    await expect(seed(d.services, 'group', { server: DEV_URL })).rejects.toThrow(/dev\/cleanup/);
    expect(await d.store.getGroup(localId)).not.toBeNull(); // nothing was removed

    const sent = w.server(PRODUCTION).requests.length;
    const lines = await cleanupProduction(d.services);
    const requests = w.server(PRODUCTION).requests.slice(sent);
    expect(requests.every((request) => request.op === 'delete')).toBe(true);
    expect(requests).toHaveLength(SEED_SECRET_TEXTS.length + 2);
    expect(w.server(PRODUCTION).groups.size).toBe(0);
    expect(lines.every((line) => line.outcome === 'deleted')).toBe(true);
    expect(lines.map((line) => line.groupId)).toEqual(expect.arrayContaining([fixed, oldB]));
    expect(await productionHoldings(d.services)).toEqual([]);
    expect(await serversHeld(d)).toEqual([]);

    // Nothing left on production: the seed runs, and production hears nothing more.
    await seed(d.services, 'group', { server: DEV_URL });
    await w.clock.advance(15 * 60_000);
    expect(w.server(PRODUCTION).requests.slice(sent + requests.length)).toEqual([]);
  });
});
