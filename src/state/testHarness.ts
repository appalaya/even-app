/// <reference types="node" />
/**
 * Test world for the state layer (Node only; never imported by app code): any number of "devices", each with its
 * own store (the in-memory fake or the real node:sqlite store, through the instrumented `testStore` wrapper), its
 * own memory secrets (the app's own `createSecrets` over a Map) and its own `createAppServices`, all sharing one
 * fake clock and a set of protocol-faithful fake servers keyed by canonical URL.
 *
 * Timers (the engine's write debounce and retries) fire only when a test advances the clock, so every sync in a
 * test is one the test asked for.
 */
import { deriveLocal, deriveServer, newId, seal, type Event, type EventPayload } from '@even/core';

import { createMemoryFileIO, type MemoryFileIO } from '../services/groupFile/memoryFileIO';
import { createMemorySecrets, type MemorySecrets } from '../services/secrets/memorySecrets';
import { FakeClock, settle } from '../services/testing/fakeClock';
import { FakeServer } from '../services/testing/fakeTransport';
import { openTestStore, type StoreKind, type TestStore } from '../services/testing/testStore';
import type { SyncEvent, SyncResult } from '../services/sync/types';
import type { NotificationPermission, NotificationStatus } from './prefs';
import { createAppServices, type AppServices } from './services';

export const SERVER = 'https://sync.test';
export const OTHER_SERVER = 'https://other.test';

export interface Device {
  name: string;
  /** How far this phone's clock runs ahead of the world's (the servers'); a test may change it ("fixing the date"). */
  clock: { offsetMs: number };
  store: TestStore;
  secrets: MemorySecrets;
  files: MemoryFileIO;
  services: AppServices;
  events: SyncEvent[];
  logs: string[];
  notifications: { status: NotificationStatus };
}

export interface World {
  kind: StoreKind;
  clock: FakeClock;
  /** The fake server at `url`, created on first use. */
  server(url?: string): FakeServer;
  device(name?: string, options?: { clockOffsetMs?: number }): Promise<Device>;
  /** The same device after an app restart: new services over the same store and secrets. */
  restart(d: Device): Promise<Device>;
  /**
   * The same iPhone after an uninstall and reinstall: the keychain (secrets, index, device id) survives, the app's
   * files do not, so new services over a new empty store (same kind) and the same secrets.
   */
  reinstall(d: Device): Promise<Device>;
  close(): Promise<void>;
}

export async function createWorld(kind: StoreKind, start?: number): Promise<World> {
  const clock = new FakeClock(start);
  const servers = new Map<string, FakeServer>();
  const devices: Device[] = [];

  function server(url = SERVER): FakeServer {
    let found = servers.get(url);
    if (found === undefined) {
      // The servers keep the world's time: their `received_at` is the fake clock's.
      found = new FakeServer({}, clock.now);
      servers.set(url, found);
    }
    return found;
  }

  async function open(
    name: string,
    store: TestStore,
    secrets: MemorySecrets,
    files: MemoryFileIO,
    skew: { offsetMs: number } = { offsetMs: 0 },
  ): Promise<Device> {
    const events: SyncEvent[] = [];
    const logs: string[] = [];
    const notifications = { status: 'undetermined' as NotificationStatus };
    // iOS's shape: a prompt that cannot be closed without an answer, and expo's reading of each status.
    const reading = () => ({
      granted: notifications.status === 'granted',
      status: notifications.status === 'unavailable' ? 'undetermined' : notifications.status,
      canAskAgain: notifications.status !== 'denied',
    });
    const permission: NotificationPermission = {
      dismissible: false,
      status: async () => reading(),
      request: async () => {
        notifications.status = 'granted';
        return reading();
      },
    };
    const services = await createAppServices({
      store,
      secrets,
      files,
      notifications: permission,
      transportFor: (url) => server(url).transport(),
      now: () => clock.now() + skew.offsetMs,
      sleep: clock.sleep,
      schedule: clock.schedule,
      log: (message, detail) =>
        logs.push(detail === undefined ? message : `${message} ${String(detail)}`),
      locale: 'en-US',
    });
    services.engine.subscribe((event) => events.push(event));
    await services.idle();
    const created: Device = {
      name,
      clock: skew,
      store,
      secrets,
      files,
      services,
      events,
      logs,
      notifications,
    };
    devices.push(created);
    return created;
  }

  async function device(
    name = `device${devices.length + 1}`,
    options: { clockOffsetMs?: number } = {},
  ): Promise<Device> {
    return open(name, await openTestStore(kind), createMemorySecrets(), createMemoryFileIO(), {
      offsetMs: options.clockOffsetMs ?? 0,
    });
  }

  async function restart(d: Device): Promise<Device> {
    d.services.dispose();
    devices.splice(devices.indexOf(d), 1);
    return open(d.name, d.store, d.secrets, d.files, d.clock);
  }

  async function reinstall(d: Device): Promise<Device> {
    d.services.dispose();
    devices.splice(devices.indexOf(d), 1);
    await d.store.close();
    return open(d.name, await openTestStore(kind), d.secrets, createMemoryFileIO(), d.clock);
  }

  return {
    kind,
    clock,
    server,
    device,
    restart,
    reinstall,
    async close() {
      for (const d of devices) d.services.dispose();
      await Promise.all([...new Set(devices.map((d) => d.store))].map((store) => store.close()));
    },
  };
}

/** A pull-to-refresh sync, then every lifecycle task it started. */
export async function sync(d: Device, localId: string): Promise<SyncResult> {
  const result = await d.services.groups.sync(localId, 'pull_to_refresh');
  await d.services.idle();
  await settle();
  await d.services.idle();
  return result;
}

export function expectSynced(result: SyncResult): Extract<SyncResult, { outcome: 'synced' }> {
  if (result.outcome !== 'synced')
    throw new Error(`expected synced, got ${JSON.stringify(result)}`);
  return result;
}

/** The group's secret on a device (tests only). */
export async function secretOn(d: Device, localId: string): Promise<Uint8Array> {
  const secret = await d.secrets.getSecret(localId);
  if (secret === null) throw new Error('no secret');
  return secret;
}

/**
 * Seals `event` for the group's current server on `d` and inserts it with the given origin, unacked: what the write
 * path does, minus its rules, to stage what an honest client never writes (a local control event, a hostile write).
 */
export async function injectEvent(
  d: Device,
  localId: string,
  event: Event,
  origin: 'local' | 'remote' = 'local',
): Promise<string> {
  const row = await d.store.getGroup(localId);
  if (row === null) throw new Error('no group');
  const secret = await secretOn(d, localId);
  const key = deriveLocal(secret).encryptionKey;
  const { groupId } = deriveServer(secret, row.serverUrl);
  const id = newId();
  const envelope = seal({ key, groupId, body: event, id });
  await d.store.insertEvents(localId, [
    {
      id,
      origin,
      acked: false,
      seq: null,
      ts: event.ts,
      envelope: JSON.stringify(envelope),
      status: 'ok',
    },
  ]);
  d.services.groupState.invalidate(localId);
  return id;
}

/** Envelope ids the fake server holds for a group (by its derived group id on `url`). */
export function serverIds(world: World, secret: Uint8Array, url = SERVER): string[] {
  const { groupId } = deriveServer(secret, url);
  return world
    .server(url)
    .stored(groupId)
    .map((e) => e.id);
}

/** A valid event body by `by` from device `dev` at `ts`. */
export function body(payload: EventPayload, by: string, dev: string, ts: number): Event {
  return { sv: 1, ts, at: ts, by, dev, ...payload } as Event;
}
