/**
 * Dev seed for screen stack D (Group settings, background refresh, notifications): the GroupSettings board's
 * "Banff 2026", written through the app's services so the screen reads it exactly as it reads a synced group.
 * Opened by `src/app/dev/seed-d.tsx` (`even://dev/seed-d`).
 *
 * - Sam is this phone's member (claimed on this device); Maya has joined on two other devices and Jordan (🏂) on
 *   one, their `member.claimed` events staged the way a sync delivers them (sealed for the group's server, stored
 *   as `remote`, acknowledged); Nathan was pre-added and nobody has claimed him.
 * - Expenses fill the log to about 246 KB, so the usage meter reads as drawn ("246 KB of 2 MB · 12%").
 * - The server's `/v1/info` is primed into the info cache with PROTOCOL.md §6.1's published values (the default
 *   server's): operator "Even (appalaya.com)", 2 MB and 10,000 entries, 365 days.
 * - The group's secret derives from a fixed key, so opening the seed again replaces the same group.
 */
import {
  deriveLocal,
  deriveServer,
  envelopeStoredSize,
  memberColor,
  newId,
  parseEvent,
  PROTOCOL,
  seal,
  utf8Encode,
  type Category,
  type Event,
  type EventPayload,
} from '@even/core';

import type { NewEventRow } from '../services/storage/types';
import type { ServerInfo, SyncResult, Transport } from '../services/sync/types';
import type { AppServices } from '../state';

/** Palette slots (src/theme/themes.ts `avatarPalette` order), so avatars match the board. */
const CLAY = 1;
const STEEL = 8;
const VIOLET = 10;

const GROUP_NAME = 'Banff 2026';
const CURRENCY = 'CAD';
/** "246 KB of 2 MB": the log is filled until it rounds to this many KiB. */
const TARGET_BYTES = 245.5 * 1024;

/** PROTOCOL.md §6.1, the default server's published `/v1/info`. */
export const DEFAULT_SERVER_INFO: ServerInfo = {
  protocol: [1],
  limits: {
    max_event_bytes: 8192,
    max_group_bytes: 2_097_152,
    max_group_events: 10_000,
    max_batch: 25,
    max_page: 500,
    daily_write_budget: 0,
    rate: { requests_per_minute: 120, writes_per_minute: 60, group_creates_per_minute: 3 },
  },
  retention_days: 365,
  push: false,
  operator: 'Even (appalaya.com)',
  terms: 'https://even.appalaya.com/terms',
};

export type SeedVariant =
  /** As drawn: every event acknowledged, so the invite may be shared. */
  | 'board'
  /** The group's first push not acknowledged yet: the invite card's buttons wait. */
  | 'preparing';

export interface SeededGroup {
  localId: string;
  serverUrl: string;
  sam: string;
  maya: string;
  jordan: string;
  nathan: string;
  mayaDevice: string;
}

/** A member id whose avatar colour lands on `slot` (core `memberColor`). */
function memberIdFor(slot: number): string {
  for (;;) {
    const id = newId();
    if (memberColor(id) === slot) return id;
  }
}

/** The seed group's secret: 32 bytes from a fixed key, so a second run finds and replaces the same group. */
function seedSecret(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode('even-dev-seed-d/banff-2026'.padEnd(32, '.').slice(0, 32)));
  return bytes;
}

/** A Transport that only answers `/v1/info`, to prime the info cache. */
function infoOnly(info: ServerInfo): Transport {
  const offline = () => Promise.reject(new Error('seed: info only'));
  return { info: async () => info, push: offline, pull: offline, delete: offline };
}

const TITLES: readonly [string, Category][] = [
  ['Groceries', 'groceries'],
  ['Gas', 'fuel'],
  ['Dinner', 'food'],
  ['Lift tickets', 'activities'],
  ['Coffee', 'coffee'],
  ['Parking', 'parking'],
  ['Cabin', 'lodging'],
];

function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Writes the board's group (replacing an earlier seed). */
export async function seedGroupSettings(
  services: AppServices,
  variant: SeedVariant = 'board',
): Promise<SeededGroup> {
  const { store, secrets, groups, groupState, infoCache, deviceId } = services;
  const serverUrl = PROTOCOL.defaultServer;
  const secret = seedSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  if ((await store.getGroup(localId)) !== null) await groups.leaveGroup(localId);
  const { groupId } = deriveServer(secret, serverUrl);

  const sam = memberIdFor(VIOLET);
  const maya = memberIdFor(CLAY);
  const jordan = newId();
  const nathan = memberIdFor(STEEL);
  const mayaPhone = newId();
  const mayaTablet = newId();
  const jordanPhone = newId();

  const now = Date.now();
  let ts = now - 8 * 24 * 60 * 60 * 1000;
  const rows: NewEventRow[] = [];
  let bytes = 0;
  const add = (payload: EventPayload, by: string, dev: string) => {
    ts += 60_000;
    const event = parseEvent({ sv: 1, ts, at: ts, by, dev, ...payload } as Event);
    if (event === null) throw new Error(`seed: invalid ${payload.type}`);
    const id = newId();
    const envelope = seal({ key, groupId, body: event, id });
    bytes += envelopeStoredSize(envelope);
    const mine = dev === deviceId;
    rows.push({
      id,
      origin: mine ? 'local' : 'remote',
      acked: !mine || variant === 'board',
      seq: null,
      ts,
      envelope: JSON.stringify(envelope),
      status: 'ok',
    });
  };

  add({ type: 'member.added', member: { id: sam, name: 'Sam' } }, sam, deviceId);
  add({ type: 'member.claimed', id: sam }, sam, deviceId);
  add({ type: 'group.created', name: GROUP_NAME, currency: CURRENCY }, sam, deviceId);
  add({ type: 'member.added', member: { id: maya, name: 'Maya' } }, sam, deviceId);
  add({ type: 'member.added', member: { id: jordan, name: 'Jordan', emoji: '🏂' } }, sam, deviceId);
  add({ type: 'member.added', member: { id: nathan, name: 'Nathan' } }, sam, deviceId);
  add({ type: 'member.claimed', id: maya }, maya, mayaPhone);
  add({ type: 'member.claimed', id: jordan }, jordan, jordanPhone);
  add({ type: 'member.claimed', id: maya }, maya, mayaTablet);

  const payers: readonly [string, string][] = [
    [maya, mayaPhone],
    [jordan, jordanPhone],
    [sam, deviceId],
    [maya, mayaTablet],
  ];
  for (let i = 0; bytes < TARGET_BYTES; i += 1) {
    const [title, category] = TITLES[i % TITLES.length] ?? ['Groceries', 'groceries'];
    const [paidBy, dev] = payers[i % payers.length] ?? [sam, deviceId];
    const share = 1000 + (i % 9) * 125;
    add(
      {
        type: 'expense.added',
        expense: {
          id: newId(),
          title,
          amount: share * 4,
          currency: CURRENCY,
          paidBy,
          date: isoDate(ts),
          category,
          split: { [sam]: share, [maya]: share, [jordan]: share, [nathan]: share },
        },
      },
      paidBy,
      dev,
    );
  }

  await secrets.setSecret(localId, secret, serverUrl);
  await store.transaction(async (tx) => {
    await tx.upsertGroup({
      localId,
      serverUrl,
      epoch: null,
      cursor: 0,
      myMemberId: sam,
      nameCache: GROUP_NAME,
      currencyCache: CURRENCY,
      createdAt: now - 8 * 24 * 60 * 60 * 1000,
      lastSyncedAt: variant === 'board' ? now : null,
      lastSyncError: null,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    await tx.insertEvents(localId, rows);
  });
  await infoCache.refresh(serverUrl, infoOnly(DEFAULT_SERVER_INFO));
  groupState.invalidate(localId);
  groupState.groupsChanged();
  return { localId, serverUrl, sam, maya, jordan, nathan, mayaDevice: mayaPhone };
}

/**
 * Stages what a background pull delivers: Maya's new expense, sealed on her phone and stored as `remote`. Returns
 * the synced result a background cycle would report for it, for `scheduleActivityNotifications`.
 */
export async function arriveFromMaya(
  services: AppServices,
  seeded: SeededGroup,
  title = 'Dinner',
  amount = 9000,
): Promise<SyncResult> {
  const secret = seedSecret();
  const { encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, seeded.serverUrl);
  const ts = Date.now();
  const share = amount / 4;
  const event = parseEvent({
    sv: 1,
    ts,
    at: ts,
    by: seeded.maya,
    dev: seeded.mayaDevice,
    type: 'expense.added',
    expense: {
      id: newId(),
      title,
      amount,
      currency: CURRENCY,
      paidBy: seeded.maya,
      date: isoDate(ts),
      category: 'food',
      split: {
        [seeded.sam]: share,
        [seeded.maya]: share,
        [seeded.jordan]: share,
        [seeded.nathan]: share,
      },
    },
  });
  if (event === null) throw new Error('seed: invalid expense');
  const id = newId();
  const envelope = seal({ key, groupId, body: event, id });
  await services.store.insertEvents(seeded.localId, [
    {
      id,
      origin: 'remote',
      acked: true,
      seq: null,
      ts,
      envelope: JSON.stringify(envelope),
      status: 'ok',
    },
  ]);
  services.groupState.invalidate(seeded.localId);
  return {
    localId: seeded.localId,
    outcome: 'synced',
    pushed: 0,
    pulled: 1,
    newOkIds: [id],
    epochResets: 0,
    at: ts,
  };
}
