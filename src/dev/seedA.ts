/**
 * Dev seed for stack A (Groups, Create, Join, App settings): writes the canvas's sample data through the services and
 * says where to go. Offline is fine: the default server is not reachable from the simulator, so every sync fails
 * silently. Two dev-only shortcuts stand in for a server, and nothing outside this file does either:
 * - `markSynced` acknowledges a group's events and stamps a last sync (what a successful push would do), so the
 *   Main board's filled sync dots can be reproduced; Friday dinners is left unsent, as drawn ("waiting to sync");
 * - the name-pick seed clears this phone's claimed seat after claiming Maya and Jordan, so both read "joined";
 * - the recovery seed deletes group rows but keeps their keychain secrets, as a reinstall would.
 * Every seed first removes all groups (other stacks' seeded data included) and orphaned keychain entries.
 */
import type { Category } from '@even/core';

import type { AppServices } from '@/state';

/** The JoinCodePreview board's code: a complete invite to "Banff 2026", CAD, on the default server. */
export const BOARD_CODE =
  'eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBlSHlBaElpTWtKU1kiLCJoIjoiemtQek9RIiwiZyI6IkJhbmZmIDIwMjYiLCJjdXIiOiJDQUQifQ';
/** The JoinCodeError board's code: the same, cut short. */
export const BOARD_CODE_INCOMPLETE =
  'eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBl';

export const SEED_SCREENS = [
  'groups',
  'archived',
  'empty',
  'create',
  'create-end',
  'emoji',
  'join-code',
  'join-preview',
  'join-error',
  'join-pick',
  'settings',
  'settings-emoji',
  'recovery',
] as const;
export type SeedScreen = (typeof SEED_SCREENS)[number];

export interface SeedOptions {
  /** App settings' avatar: the light board draws initials, the dark one 🌲. */
  emoji?: string | null;
  /** Hold the empty-state motion at this time (ms). */
  motionAt?: number;
}

/** Where to go once seeded: a path, and whether it replaces Groups or is pushed over it. */
export interface SeedTarget {
  path: string;
  mode: 'replace' | 'push';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Removes every group (rows and secrets) and any keychain entry left without a row. */
export async function wipe(s: AppServices): Promise<void> {
  for (const row of await s.store.listGroups()) {
    await s.groups.leaveGroup(row.localId).catch(() => undefined);
  }
  for (const entry of await s.secrets.listGroups()) {
    if ((await s.store.getGroup(entry.localId)) === null) {
      await s.secrets.deleteSecret(entry.localId).catch(() => undefined);
    }
  }
}

async function me(s: AppServices, emoji: string | null): Promise<void> {
  await s.prefs.setName('Sam');
  await s.prefs.setEmoji(emoji);
  await s.prefs.setAppearance('system');
}

interface Spend {
  payer: string;
  amount: number;
  title: string;
  category: Category;
}

interface GroupSpec {
  name: string;
  myName?: string;
  people: string[];
  spends?: Spend[];
  archived?: boolean;
  synced: boolean;
}

/** Creates a group as Sam (or `myName`), adds its expenses split equally among everyone, archives it if asked. */
async function group(s: AppServices, spec: GroupSpec): Promise<string> {
  const myName = spec.myName ?? 'Sam';
  const { localId, memberId } = await s.groups.createGroup({
    name: spec.name,
    currency: 'CAD',
    myName,
    people: spec.people,
  });
  const derived = await s.groupState.get(localId);
  const ids = new Map<string, string>();
  for (const m of derived?.state?.members.values() ?? []) ids.set(m.name, m.id);
  const everyone = [...ids.values()];
  for (const spend of spec.spends ?? []) {
    await s.groups.addExpense(localId, {
      title: spend.title,
      amount: spend.amount,
      paidBy: spend.payer === myName ? memberId : (ids.get(spend.payer) ?? memberId),
      date: today(),
      category: spend.category,
      split: { mode: 'equal', members: everyone },
    });
  }
  if (spec.archived === true) await s.groups.archiveGroup(localId);
  if (spec.synced) await markSynced(s, localId);
  return localId;
}

/** Dev only: what an acknowledged push would leave behind (see the file comment). */
async function markSynced(s: AppServices, localId: string): Promise<void> {
  const rows = await s.store.listEnvelopes(localId);
  await s.store.ack(
    localId,
    rows.map((row) => row.id),
  );
  await s.store.setSyncState(localId, { lastSyncedAt: Date.now(), lastSyncError: null });
  s.groupState.invalidate(localId);
  s.groupState.groupsChanged();
}

/** The Main board: four active groups, newest activity first, and two archived. */
async function mainGroups(s: AppServices): Promise<void> {
  await group(s, { name: 'Squamish 2025', people: ['Maya', 'Leo'], archived: true, synced: true });
  await group(s, { name: 'Ski cabin', people: ['Priya', 'Jordan'], archived: true, synced: true });
  await otherGroups(s);
  await group(s, {
    name: 'Banff 2026',
    people: ['Maya', 'Jordan', 'Nathan'],
    spends: [{ payer: 'Maya', amount: 20800, title: 'Cabin', category: 'lodging' }],
    synced: true,
  });
}

/** Tofino weekend (settled), Friday dinners (you owe $12.00, unsent), Oak Street house (you're owed $44.00). */
async function otherGroups(s: AppServices): Promise<void> {
  await group(s, {
    name: 'Tofino weekend',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya'],
    synced: true,
  });
  await group(s, {
    name: 'Friday dinners',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya', 'Leo'],
    spends: [{ payer: 'Jordan', amount: 7200, title: 'Ramen', category: 'food' }],
    synced: false,
  });
  await group(s, {
    name: 'Oak Street house',
    people: ['Maya', 'Priya'],
    spends: [{ payer: 'Sam', amount: 6600, title: 'Internet', category: 'fees' }],
    synced: true,
  });
}

/**
 * The Join board: "Banff 2026" where Maya and Jordan (🏂) have joined and Nathan has not, and this phone has no
 * seat yet. Seeded first so its activity sorts below the three groups the board shows behind the sheet.
 */
async function pickGroup(s: AppServices): Promise<string> {
  const localId = await group(s, {
    name: 'Banff 2026',
    myName: 'Maya',
    people: ['Jordan', 'Nathan'],
    synced: false,
  });
  const derived = await s.groupState.get(localId);
  const jordan = [...(derived?.state?.members.values() ?? [])].find((m) => m.name === 'Jordan');
  if (jordan !== undefined) {
    await s.groups.claimMember(localId, jordan.id);
    await s.groups.updateMember(localId, jordan.id, { emoji: '🏂' });
  }
  await markSynced(s, localId);
  await s.store.setMyMember(localId, null);
  s.groupState.invalidate(localId);
  s.groupState.groupsChanged();
  return localId;
}

/** Two groups whose rows are gone but whose secrets remain: "Recover 2 groups from your keychain?" */
async function reinstalled(s: AppServices): Promise<void> {
  const a = await group(s, { name: 'Banff 2026', people: ['Maya'], synced: false });
  const b = await group(s, { name: 'Oak Street house', people: ['Priya'], synced: false });
  for (const localId of [a, b]) {
    await s.store.deleteGroup(localId);
    s.groupState.evict(localId);
  }
  s.groupState.groupsChanged();
}

const q = encodeURIComponent;

export async function seedA(
  s: AppServices,
  screen: SeedScreen,
  options: SeedOptions = {},
): Promise<SeedTarget> {
  await wipe(s);
  await me(s, screen.startsWith('create') || screen === 'emoji' ? '🌲' : (options.emoji ?? null));
  switch (screen) {
    case 'groups':
      await mainGroups(s);
      return { path: '/', mode: 'replace' };
    case 'archived':
      await mainGroups(s);
      return { path: '/?archived=open', mode: 'replace' };
    case 'empty':
      return {
        path: options.motionAt === undefined ? '/' : `/?motionAt=${options.motionAt}`,
        mode: 'replace',
      };
    case 'create':
    case 'create-end':
    case 'emoji': {
      const prefill = `name=${q('Banff 2026')}&currency=CAD&people=${q('Maya,Jordan,Nathan')}&me=Sam&emoji=${q('🌲')}`;
      return {
        path: `/create?${prefill}${screen === 'emoji' ? '&picker=emoji' : ''}${screen === 'create-end' ? '&scroll=end' : ''}`,
        mode: 'push',
      };
    }
    case 'join-code':
      return { path: '/join', mode: 'push' };
    case 'join-preview':
      return { path: `/join?code=${BOARD_CODE}`, mode: 'push' };
    case 'join-error':
      return { path: `/join?code=${BOARD_CODE_INCOMPLETE}`, mode: 'push' };
    case 'join-pick': {
      const localId = await pickGroup(s);
      await otherGroups(s);
      return { path: `/join?localId=${q(localId)}`, mode: 'push' };
    }
    case 'settings':
      return { path: '/settings', mode: 'push' };
    case 'settings-emoji':
      return { path: '/settings?picker=emoji', mode: 'push' };
    case 'recovery':
      await reinstalled(s);
      return { path: '/', mode: 'replace' };
  }
}
