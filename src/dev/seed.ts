/**
 * The dev seed: the canvas's sample data for every screen and state, written through the app's services so each
 * screen reads it exactly as it reads a real group. One route opens it: `src/app/dev/seed.tsx`
 * (`even://dev/seed?state=<state>`, or `com.appalaya.even://dev/seed?state=…`); `SEED_STATES` lists them all.
 *
 * Every seeded group syncs with the dev server (`npm run dev:server`; src/dev/devServer.ts), never with the
 * production one: `seed` refuses `PROTOCOL.defaultServer` and every host under appalaya.com (`assertNotProduction`,
 * checked again by each writer), and refuses to run while this phone still holds a group on production (open
 * `even://dev/cleanup` first). The states about a server that does not answer keep theirs: a non-routable address,
 * a refused port, home.example.net.
 *
 * Every state first removes all groups (rows, secrets, and each one's copy on the dev server) and orphaned keychain
 * entries, then writes what it needs and says where to go (`SeedResult.steps`). A group with a fixed key is the
 * same server group every run, so its dev server copy is deleted again before it is written. Dev-only shortcuts
 * stand in for a server, and nothing outside this file uses them:
 * - `markSynced` acknowledges a group's events and stamps a last sync (what a successful push would do);
 * - other members' events are staged the way a sync delivers them: sealed with the group key for the group's server
 *   and inserted as `remote`, acknowledged rows; this device's own as `local`;
 * - `/v1/info` is primed into the info cache (`infoOnly`) for home.example.net, which is not there to ask;
 * - the name-pick seed clears this phone's claimed seat, and the `unclaimed` states write their row with none; the
 *   recovery seed deletes rows but keeps their secrets, as a reinstall would.
 * Member ids are drawn until their avatar colour lands on the boards' slots (Sam violet, Maya clay, Nathan steel…),
 * and timestamps are chosen so Activity and Expense detail read like their boards.
 *
 * Pure apart from the writers, which take the services; `seed.test.ts` checks the Group scenarios against the
 * boards' numbers.
 */
import {
  deriveLocal,
  deriveServer,
  encodeInvite,
  envelopeStoredSize,
  makeInvite,
  memberColor,
  newId,
  parseEvent,
  PROTOCOL,
  reduce,
  seal,
  utf8Encode,
  type Category,
  type Event,
  type EventPayload,
  type LogEntry,
} from '@even/core';

import { initialChipState, type ChipState } from '@/features/addExpense/chipMachine';
import { createDraft, todayIso, type SheetDraft } from '@/features/addExpense/draft';
import {
  equalDraft,
  setAmount,
  setBps,
  setExtra,
  setWeight,
  toggleMember,
} from '@/features/split/draft';

import { refineCategory } from '../state/categories';
import { assertNotProduction, productionHoldings, seedServerOrigin } from './devServer';
import type { NewEventRow } from '../services/storage/types';
import type { ServerInfo, SyncResult, Transport } from '../services/sync/types';
import type { AppServices } from '../state';

// ---------- The states ----------

/** Every state the seed opens, grouped by where it lives. */
export const SEED_STATES = [
  // Groups, Create, Join, App settings
  'groups',
  'groups-archived',
  'groups-empty',
  'recovery',
  'create',
  'create-end',
  'create-emoji',
  'create-currency',
  'create-advanced',
  'join-code',
  'join-preview',
  'join-error',
  'join-version',
  'join-pick',
  'join-not-listed',
  'join-same-name',
  'join-move',
  'app-settings',
  'app-settings-emoji',
  'app-settings-help',
  'about',
  'diagnostics',
  'diagnostics-check',
  // Group
  'group',
  'balances',
  'activity',
  'unreadable',
  'syncing',
  'stale',
  'update',
  'closed',
  'moved',
  'alldone',
  'even',
  'group-archived',
  'many',
  'done-sheet',
  'group-new',
  'newWithExpenses',
  'invite',
  'share',
  'unclaimed',
  'unclaimed-own',
  'unclaimed-two',
  'owed',
  'settled-member',
  'collision',
  // Expense detail
  'expense-detail',
  'expense-flagged',
  'expense-currency',
  // Add expense, Split, Settle
  'add-expense',
  'add-first',
  'add-edit',
  'add-typing',
  'add-error',
  'add-payer',
  'add-date',
  'add-picker',
  'add-chosen',
  'add-suggested',
  'split-equal',
  'split-exact',
  'split-percent',
  'split-excluded',
  'split-over-percent',
  'split-over-exact',
  'settle',
  'settle-empty',
  'settle-to',
  'settle-recorded',
  // Group settings
  'group-settings',
  'settings-preparing',
  'settings-rename',
  'settings-add',
  'settings-move',
  'settings-leave',
  'settings-moved',
  'settings-usage',
  'settings-archived-member',
  'settings-regenerate',
  'settings-avatar',
  'settings-report',
  'settings-report-other',
  // Background refresh and notifications (stay on the seed screen and log)
  'task',
  'notify',
  'notify-quiet',
] as const;
export type SeedState = (typeof SEED_STATES)[number];

export function isSeedState(value: string | undefined): value is SeedState {
  return value !== undefined && (SEED_STATES as readonly string[]).includes(value);
}

export interface SeedOptions {
  /**
   * The dev server every seeded group syncs with, as this phone reaches it (`devServerUrl`, or the link's
   * `server`): `http://` for this Mac or the local network, https for anything else. Never the production server.
   */
  server: string;
  /** App settings' avatar: the light board draws initials, the dark one 🌲. */
  emoji?: string | null;
  /** Hold the empty-state motion at this time (ms). */
  motionAt?: number;
  /** Group settings, App settings and Diagnostics: a content offset, as if scrolled. */
  y?: number;
}

/** One navigation the seed route performs, after `wait` ms. */
export interface SeedStep {
  path: string;
  mode: 'replace' | 'push';
  wait?: number;
}

export interface SeedResult {
  steps: SeedStep[];
  /** Expense detail, flagged: rendered in place (a split that does not add up cannot be stored). */
  flagged?: boolean;
  /** Start a manual sync once the group is open (Group, syncing). */
  syncOnOpen?: string;
  /** Hand the invite to the share sheet once the group is open (Share sheet). */
  shareOnOpen?: { localId: string; name: string };
  /** Let Groups ask about the keychain again once it is up (recovery). */
  recoveryOffer?: boolean;
  /** What a background or notification check found (it stays on the seed screen). */
  lines?: string[];
}

// ---------- Shared ----------

/** Palette slots (src/theme/themes.ts `avatarPalette` order). */
const ROSE = 0;
const CLAY = 1;
const OCHRE = 2;
const OLIVE = 3;
const MOSS = 4;
const PINE = 5;
const TEAL = 6;
const LAGOON = 7;
const STEEL = 8;
const INDIGO = 9;
const VIOLET = 10;
const PLUM = 11;

// ---------- Time ----------

const MINUTE = 60_000;

/** Today (local) at hh:mm, shifted by `days`. */
function day(days: number, hh: number, mm: number, now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hh, mm).getTime();
}

/** September `d`, 2026 (the trip on the boards) at hh:mm local. */
function sep(d: number, hh: number, mm: number): number {
  return new Date(2026, 8, d, hh, mm).getTime();
}

// ---------- Log builder ----------

/** A member id whose avatar colour lands on `slot` (core `memberColor`), so avatars match the boards. */
function memberIdFor(slot: number): string {
  for (;;) {
    const id = newId();
    if (memberColor(id) === slot) return id;
  }
}

/** A device id whose short form (Activity: "7QX2") starts with `prefix`. */
function deviceIdFor(prefix: string): string {
  return `${prefix}${newId().slice(prefix.length)}`;
}

export interface SeedMember {
  id: string;
  name: string;
  /** The member's first device (their `member.claimed`). */
  dev: string;
}

class Log {
  readonly entries: LogEntry[] = [];
  private lastTs = 0;

  add(at: number, by: SeedMember, payload: EventPayload, dev: string = by.dev): string {
    const ts = Math.max(at, this.lastTs + 1);
    this.lastTs = ts;
    const event = { sv: 1, ts, at, by: by.id, dev, ...payload } as Event;
    if (parseEvent(JSON.parse(JSON.stringify(event))) === null) {
      throw new Error(`seed: invalid ${payload.type} event`);
    }
    const id = newId();
    this.entries.push({ id, event });
    return id;
  }
}

function expense(
  id: string,
  title: string,
  amount: number,
  paidBy: SeedMember,
  date: string,
  category: Category,
  split: Record<string, number>,
  note?: string,
): EventPayload {
  return {
    type: 'expense.added',
    expense: {
      id,
      title,
      amount,
      currency: 'CAD',
      paidBy: paidBy.id,
      date,
      category,
      split,
      ...(note === undefined ? {} : { note }),
    },
  };
}

function payment(from: SeedMember, to: SeedMember, amount: number, date: string): EventPayload {
  return {
    type: 'payment.added',
    payment: { id: newId(), from: from.id, to: to.id, amount, currency: 'CAD', date },
  };
}

// ---------- Scenarios (Group, Expense detail) ----------

/** The Group and Expense detail states `buildScenario` builds. */
export const GROUP_SCENARIOS = [
  'group',
  'balances',
  'activity',
  'unreadable',
  'syncing',
  'stale',
  'update',
  'closed',
  'moved',
  'alldone',
  'even',
  'group-archived',
  'many',
  'done-sheet',
  'group-new',
  'newWithExpenses',
  'invite',
  'share',
  'unclaimed',
  'unclaimed-own',
  'unclaimed-two',
  'expense-detail',
] as const;
export type GroupScenario = (typeof GROUP_SCENARIOS)[number];

export interface Scenario {
  /** Seed key: the group's secret derives from it. */
  key: string;
  name: string;
  serverUrl: string;
  me: SeedMember;
  entries: LogEntry[];
  /** `false` leaves this device's events unacknowledged (the invite is still "Preparing…"). */
  acked: boolean;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  /** Rows beside the readable log: unreadable entries, an envelope of a newer version. */
  extraRows: NewEventRow[];
  /** Where the seed route lands. */
  open: {
    tab?: 'expenses' | 'balances' | 'activity';
    /** The segment already stuck under the nav bar (the Balances and Activity boards). */
    stuck?: boolean;
    sheet?: 'done';
    expenseId?: string;
  };
  /** Start a manual sync once the group is open (the syncing board). */
  syncOnOpen: boolean;
  /** Hand the invite to the share sheet once the group is open (the share sheet board). */
  shareOnOpen: boolean;
  /** `false` writes the row with no seat (`my_member_id` null), as a keychain recovery or an abandoned name pick leaves it. */
  claimed: boolean;
}

/** A server nobody answers (a non-routable address): a sync hangs for the transport's 30 s timeout. */
const SILENT_SERVER = 'https://10.255.255.1';
/** A server that refuses at once (nothing listens on port 9 of the phone itself): every push fails, fast. */
const REFUSING_SERVER = 'https://127.0.0.1:9';

interface Banff {
  log: Log;
  sam: SeedMember;
  maya: SeedMember;
  jordan: SeedMember;
  nathan: SeedMember;
  dinnerId: string;
  liftId: string;
}

/**
 * Banff 2026, Sep 17–20 (Group, Balances, Activity, Expense detail). Five expenses, $1,780.00 in total; with the two
 * payments of "Yesterday" the nets are the Balances board's: you −$52.00, Maya +$172.00, Nathan −$128.00, Jordan
 * +$8.00, which simplify to Nathan → Maya $128, you → Maya $44, you → Jordan $8.
 *
 * `dinner`: 'activity' adds the dinner at $96.00 with its note (the Activity board: "Maya added Dinner at Park
 * Distillery · $96.00, 8:47 PM"); 'detail' gives it the Expense detail board's history ($90.00 at 9:14 pm, Jordan's
 * note at 11:40 pm, Maya's change to $96.00 on Sep 21 at 8:02 am). The two boards disagree; each state follows its own.
 */
function banffBase(
  myDevice: string,
  dinner: 'activity' | 'detail',
  phone: 'sam' | 'maya' = 'sam',
): Banff {
  const log = new Log();
  const sam: SeedMember = {
    id: memberIdFor(VIOLET),
    name: 'Sam',
    dev: phone === 'sam' ? myDevice : newId(),
  };
  const maya: SeedMember = {
    id: memberIdFor(CLAY),
    name: 'Maya',
    dev: phone === 'maya' ? myDevice : newId(),
  };
  const jordan: SeedMember = { id: memberIdFor(OCHRE), name: 'Jordan', dev: newId() };
  const nathan: SeedMember = { id: memberIdFor(STEEL), name: 'Nathan', dev: newId() };

  log.add(sep(17, 18, 0), sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  log.add(sep(17, 18, 0), sam, { type: 'member.claimed', id: sam.id });
  log.add(sep(17, 18, 0), sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const m of [maya, jordan, nathan]) {
    log.add(sep(17, 18, 1), sam, { type: 'member.added', member: { id: m.id, name: m.name } });
  }
  log.add(sep(17, 18, 30), maya, { type: 'member.claimed', id: maya.id });
  log.add(sep(17, 19, 0), jordan, { type: 'member.claimed', id: jordan.id });
  log.add(sep(17, 19, 2), jordan, {
    type: 'member.updated',
    id: jordan.id,
    changes: { emoji: '🏂' },
  });
  log.add(sep(17, 20, 0), nathan, { type: 'member.claimed', id: nathan.id });

  const all = [sam, maya, jordan, nathan];
  const each = (amount: number, who: SeedMember[]) =>
    Object.fromEntries(who.map((m) => [m.id, amount / who.length]));

  log.add(
    sep(18, 15, 0),
    maya,
    expense(
      newId(),
      'Fairmont Banff Springs',
      118000,
      maya,
      '2026-09-18',
      'lodging',
      each(118000, all),
    ),
  );
  log.add(
    sep(18, 17, 0),
    jordan,
    expense(newId(), 'Gas at Petro-Canada', 6000, jordan, '2026-09-18', 'fuel', each(6000, all)),
  );
  log.add(
    sep(19, 10, 0),
    sam,
    expense(
      newId(),
      'Banff Town Parking',
      2400,
      sam,
      '2026-09-19',
      'parking',
      each(2400, [sam, jordan, nathan]),
    ),
  );
  log.add(sep(19, 21, 0), jordan, { type: 'member.done', id: jordan.id });
  const liftId = newId();
  log.add(
    sep(20, 7, 5),
    nathan,
    expense(liftId, 'Sunshine Village lift tickets', 40000, nathan, '2026-09-20', 'activities', {
      [sam.id]: 9000,
      [jordan.id]: 9000,
      [nathan.id]: 22000,
    }),
  );
  const dinnerId = newId();
  const trio = [sam, maya, jordan];
  if (dinner === 'activity') {
    log.add(
      sep(20, 20, 47),
      maya,
      expense(
        dinnerId,
        'Dinner at Park Distillery',
        9600,
        maya,
        '2026-09-20',
        'food',
        each(9600, trio),
        'Split the wine',
      ),
    );
  } else {
    log.add(
      sep(20, 21, 14),
      maya,
      expense(
        dinnerId,
        'Dinner at Park Distillery',
        9000,
        maya,
        '2026-09-20',
        'food',
        each(9000, trio),
      ),
    );
    log.add(sep(20, 23, 40), jordan, {
      type: 'expense.updated',
      id: dinnerId,
      changes: { note: 'Split the wine' },
    });
  }
  log.add(sep(20, 21, 30), nathan, { type: 'member.done', id: nathan.id });
  if (dinner === 'detail') {
    log.add(sep(21, 8, 2), maya, {
      type: 'expense.updated',
      id: dinnerId,
      changes: { amount: 9600, split: each(9600, trio) },
    });
  }
  return { log, sam, maya, jordan, nathan, dinnerId, liftId };
}

/** The lift tickets go from $400.00 to $420.00 (Maya, from her second phone: "K2PD" on the Activity board). */
function liftChange(b: Banff, at: number): void {
  b.log.add(
    at,
    b.maya,
    {
      type: 'expense.updated',
      id: b.liftId,
      changes: {
        amount: 42000,
        split: { [b.sam.id]: 9500, [b.jordan.id]: 9500, [b.nathan.id]: 23000 },
      },
    },
    deviceIdFor('k2pd'),
  );
}

/** The Group / Activity boards' last days: two payments yesterday, then this morning's three items. */
function banffRecent(b: Banff, now: number): void {
  b.log.add(day(-1, 17, 2, now), b.jordan, payment(b.jordan, b.maya, 39300, '2026-09-25'));
  b.log.add(day(-1, 18, 30, now), b.sam, payment(b.sam, b.maya, 36900, '2026-09-25'));
  liftChange(b, day(0, 9, 12, now));
  b.log.add(
    day(0, 9, 41, now),
    b.jordan,
    { type: 'member.claimed', id: b.jordan.id },
    deviceIdFor('7qx2'),
  );
  b.log.add(day(0, 9, 50, now), b.maya, { type: 'member.done', id: b.maya.id });
}

function scenario(
  key: string,
  b: { log: Log; sam: SeedMember },
  now: number,
  server: string,
  overrides: Partial<Omit<Scenario, 'key' | 'entries'>> = {},
): Scenario {
  return {
    key,
    name: 'Banff 2026',
    serverUrl: server,
    me: b.sam,
    entries: b.log.entries,
    acked: true,
    lastSyncedAt: now - 2 * MINUTE,
    lastSyncError: null,
    extraRows: [],
    open: {},
    syncOnOpen: false,
    shareOnOpen: false,
    claimed: true,
    ...overrides,
  };
}

function junkRow(status: 'undecryptable' | 'unsupported_envelope'): NewEventRow {
  const id = newId();
  const envelope =
    status === 'undecryptable'
      ? JSON.stringify({ id, v: 1, n: 'A'.repeat(32), c: 'A'.repeat(342) })
      : JSON.stringify({ id, v: 2, n: 'A'.repeat(32), c: 'A'.repeat(342) });
  return { id, origin: 'remote', acked: true, seq: null, ts: null, envelope, status };
}

function banffMain(
  key: string,
  myDevice: string,
  now: number,
  server: string,
  overrides: Partial<Scenario> = {},
): Scenario {
  const b = banffBase(myDevice, 'activity');
  banffRecent(b, now);
  return scenario(key, b, now, server, overrides);
}

/** Group, everyone done: you mark yourself done after this morning's items. */
function banffAllDone(myDevice: string, now: number): Banff {
  const b = banffBase(myDevice, 'activity');
  banffRecent(b, now);
  b.log.add(day(0, 10, 5, now), b.sam, { type: 'member.done', id: b.sam.id });
  return b;
}

/**
 * Group, archived: everyone settled up this morning and Nathan archived the group at 10:02 AM (the archived board's
 * Activity tab). Its earlier days are moved off Today and Yesterday so those two sections read as drawn.
 */
function banffArchived(myDevice: string, now: number): Banff {
  const b = banffBase(myDevice, 'activity');
  liftChange(b, sep(21, 9, 12));
  b.log.add(sep(22, 17, 2), b.jordan, payment(b.jordan, b.maya, 39300, '2026-09-22'));
  b.log.add(sep(22, 18, 30), b.sam, payment(b.sam, b.maya, 36900, '2026-09-22'));
  b.log.add(day(-1, 20, 15, now), b.maya, { type: 'member.done', id: b.maya.id });
  b.log.add(day(0, 9, 39, now), b.sam, payment(b.sam, b.maya, 4400, '2026-09-26'));
  b.log.add(day(0, 9, 40, now), b.sam, payment(b.sam, b.jordan, 800, '2026-09-26'));
  b.log.add(day(0, 9, 58, now), b.nathan, payment(b.nathan, b.maya, 12800, '2026-09-26'));
  b.log.add(day(0, 10, 2, now), b.nathan, { type: 'group.archived' });
  return b;
}

/**
 * Whistler 2027, twelve members, seven done (Group · twelve members, Done adding): two expenses and the payments
 * that leave you owing $86.40 — Priya $62.40 and Maya $24.00 — with everyone else square.
 */
function whistler(myDevice: string, now: number): { log: Log; sam: SeedMember } {
  const log = new Log();
  const person = (name: string, slot: number, dev = newId()): SeedMember => ({
    id: memberIdFor(slot),
    name,
    dev,
  });
  const sam = person('Sam', VIOLET, myDevice);
  const priya = person('Priya', ROSE);
  const maya = person('Maya', CLAY);
  const jordan = person('Jordan', OCHRE);
  const nathan = person('Nathan', STEEL);
  const leo = person('Leo', OLIVE);
  const aiko = person('Aiko', TEAL);
  const ben = person('Ben', PINE);
  const chloe = person('Chloe', LAGOON);
  const diego = person('Diego', INDIGO);
  const hana = person('Hana', MOSS);
  const omar = person('Omar', PLUM);
  const everyone = [sam, priya, maya, jordan, nathan, leo, aiko, ben, chloe, diego, hana, omar];

  log.add(sep(20, 12, 0), sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  log.add(sep(20, 12, 0), sam, { type: 'member.claimed', id: sam.id });
  log.add(sep(20, 12, 0), sam, { type: 'group.created', name: 'Whistler 2027', currency: 'CAD' });
  for (const m of everyone.slice(1)) {
    log.add(sep(20, 12, 1), sam, { type: 'member.added', member: { id: m.id, name: m.name } });
  }
  everyone.slice(1).forEach((m, i) => {
    log.add(sep(20, 13, i), m, { type: 'member.claimed', id: m.id });
  });
  log.add(sep(20, 13, 30), jordan, {
    type: 'member.updated',
    id: jordan.id,
    changes: { emoji: '🏂' },
  });

  const equal = (amount: number) =>
    Object.fromEntries(everyone.map((m) => [m.id, amount / everyone.length]));
  log.add(
    sep(23, 16, 0),
    leo,
    expense(newId(), 'Sea to Sky van rental', 61200, leo, '2026-09-23', 'rental', equal(61200)),
  );
  log.add(
    sep(24, 18, 0),
    priya,
    expense(newId(), 'Chalet on Alta Lake', 432000, priya, '2026-09-24', 'lodging', equal(432000)),
  );

  log.add(day(-1, 9, 0, now), sam, payment(sam, priya, 32460, '2026-09-25'));
  log.add(day(-1, 9, 5, now), maya, payment(maya, priya, 43500, '2026-09-25'));
  log.add(day(-1, 9, 10, now), jordan, payment(jordan, leo, 20100, '2026-09-25'));
  log.add(day(-1, 9, 11, now), jordan, payment(jordan, priya, 21000, '2026-09-25'));
  [nathan, aiko, ben, chloe, diego, hana, omar].forEach((m, i) => {
    log.add(day(-1, 10, i, now), m, payment(m, priya, 41100, '2026-09-25'));
  });
  [maya, jordan, nathan, aiko, chloe, hana, omar].forEach((m, i) => {
    log.add(day(0, 8, i, now), m, { type: 'member.done', id: m.id });
  });
  return { log, sam };
}

/** Maya (clay), Jordan (ochre) and Nathan (steel) ids, drawn until they sort in that order. */
function namesInIdOrder(): [string, string, string] {
  for (;;) {
    const ids: [string, string, string] = [
      memberIdFor(CLAY),
      memberIdFor(OCHRE),
      memberIdFor(STEEL),
    ];
    if (ids[0] < ids[1] && ids[1] < ids[2]) return ids;
  }
}

/**
 * Group, just created: you and three pre-added names; nobody else has joined yet. `expenses` adds two of yours split
 * four ways (Group, new with expenses): the Fairmont $1,180.00 and the parking $24.00, so you're owed $903.00 and Maya,
 * Jordan and Nathan each pay you $301.00. Their ids are drawn in that order, which is `simplify`'s order for a tie.
 */
function banffNew(myDevice: string, now: number, expenses = false): { log: Log; sam: SeedMember } {
  const log = new Log();
  const sam: SeedMember = { id: memberIdFor(VIOLET), name: 'Sam', dev: myDevice };
  const [maya, jordan, nathan] = namesInIdOrder();
  const at = now - 5 * MINUTE;
  log.add(at, sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  log.add(at, sam, { type: 'member.claimed', id: sam.id });
  log.add(at, sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const [id, name] of [
    [maya, 'Maya'],
    [jordan, 'Jordan'],
    [nathan, 'Nathan'],
  ] as const) {
    log.add(at, sam, { type: 'member.added', member: { id, name } });
  }
  if (expenses) {
    const all = [sam.id, maya, jordan, nathan];
    const each = (amount: number) => Object.fromEntries(all.map((id) => [id, amount / 4]));
    log.add(
      at + MINUTE,
      sam,
      expense(
        newId(),
        'Fairmont Banff Springs',
        118000,
        sam,
        '2026-09-18',
        'lodging',
        each(118000),
      ),
    );
    log.add(
      at + 2 * MINUTE,
      sam,
      expense(newId(), 'Banff Town Parking', 2400, sam, '2026-09-19', 'parking', each(2400)),
    );
  }
  return { log, sam };
}

/**
 * Banff 2026 held by a phone with no seat in it (GroupNoSeat, SeatPick): Sam created it on another phone ("K4…") and
 * pre-added the others; Maya and Jordan (🏂) joined on theirs and Nathan has not; the five expenses come to
 * $1,780.00 ("Spent so far") and list as drawn (Dinner, the lift tickets, Parking, Gas, the Fairmont). With
 * `twoSeats` (SeatSameDevice) Sam also pre-added "Maya K.", and this phone claimed both Maya and Maya K., as a phone
 * that lost its seat and picked again would have.
 */
function banffNoSeat(myDevice: string, twoSeats: boolean): { log: Log; sam: SeedMember } {
  const log = new Log();
  const sam: SeedMember = { id: memberIdFor(VIOLET), name: 'Sam', dev: deviceIdFor('K4') };
  const maya: SeedMember = {
    id: memberIdFor(CLAY),
    name: 'Maya',
    dev: twoSeats ? myDevice : newId(),
  };
  const mayaK: SeedMember = { id: memberIdFor(PLUM), name: 'Maya K.', dev: myDevice };
  const jordan: SeedMember = { id: memberIdFor(OCHRE), name: 'Jordan', dev: newId() };
  // Nathan never claims his name: SeatPick draws him with a chevron.
  const nathan: SeedMember = { id: memberIdFor(STEEL), name: 'Nathan', dev: newId() };

  log.add(sep(17, 18, 0), sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  log.add(sep(17, 18, 0), sam, { type: 'member.claimed', id: sam.id });
  log.add(sep(17, 18, 0), sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const m of twoSeats ? [maya, mayaK, jordan, nathan] : [maya, jordan, nathan]) {
    log.add(sep(17, 18, 1), sam, { type: 'member.added', member: { id: m.id, name: m.name } });
  }
  log.add(sep(17, 18, 30), maya, { type: 'member.claimed', id: maya.id });
  log.add(sep(17, 19, 0), jordan, { type: 'member.claimed', id: jordan.id });
  log.add(sep(17, 19, 2), jordan, {
    type: 'member.updated',
    id: jordan.id,
    changes: { emoji: '🏂' },
  });
  if (twoSeats) log.add(sep(19, 8, 0), mayaK, { type: 'member.claimed', id: mayaK.id });

  const all = [sam, maya, jordan, nathan];
  const each = (amount: number, who: SeedMember[]) =>
    Object.fromEntries(who.map((m) => [m.id, amount / who.length]));
  log.add(
    sep(18, 15, 0),
    maya,
    expense(
      newId(),
      'Fairmont Banff Springs',
      118000,
      maya,
      '2026-09-18',
      'lodging',
      each(118000, all),
    ),
  );
  log.add(
    sep(18, 17, 0),
    jordan,
    expense(newId(), 'Gas at Petro-Canada', 6000, jordan, '2026-09-18', 'fuel', each(6000, all)),
  );
  log.add(
    sep(19, 10, 0),
    sam,
    expense(
      newId(),
      'Banff Town Parking',
      2400,
      sam,
      '2026-09-19',
      'parking',
      each(2400, [sam, jordan, nathan]),
    ),
  );
  log.add(
    sep(20, 7, 5),
    sam,
    expense(newId(), 'Sunshine Village lift tickets', 42000, nathan, '2026-09-20', 'activities', {
      [sam.id]: 9500,
      [jordan.id]: 9500,
      [nathan.id]: 23000,
    }),
  );
  log.add(
    sep(20, 20, 47),
    maya,
    expense(
      newId(),
      'Dinner at Park Distillery',
      9600,
      maya,
      '2026-09-20',
      'food',
      each(9600, [sam, maya, jordan]),
      'Split the wine',
    ),
  );
  return { log, sam: twoSeats ? maya : sam };
}

/**
 * The scenario for a seed state. `myDevice` is this install's device id; `now` pins "Today"; `server` is the dev
 * server's canonical URL (`seedServerOrigin`), which every scenario syncs with unless its board is about another.
 */
export function buildScenario(
  state: GroupScenario,
  myDevice: string,
  now: number,
  server: string,
): Scenario {
  switch (state) {
    case 'group':
    case 'balances':
    case 'activity':
      return banffMain('banff', myDevice, now, server, {
        open: state === 'group' ? {} : { tab: state, stuck: true },
      });
    case 'unreadable':
      return banffMain('banff-unreadable', myDevice, now, server, {
        extraRows: [junkRow('undecryptable'), junkRow('undecryptable')],
      });
    case 'syncing':
      return banffMain('banff-syncing', myDevice, now, server, {
        serverUrl: SILENT_SERVER,
        syncOnOpen: true,
      });
    case 'stale':
      return banffMain('banff-stale', myDevice, now, server, {
        lastSyncedAt: day(0, 14, 10, now),
        lastSyncError: 'network',
      });
    case 'update':
      return banffMain('banff-update', myDevice, now, server, {
        extraRows: [junkRow('unsupported_envelope')],
      });
    case 'closed': {
      const b = banffBase(myDevice, 'activity');
      banffRecent(b, now);
      b.log.add(day(0, 10, 30, now), b.maya, { type: 'group.closed', reason: 'rotated' });
      return scenario('banff-closed', b, now, server);
    }
    case 'moved': {
      const b = banffBase(myDevice, 'activity');
      banffRecent(b, now);
      b.log.add(day(0, 10, 30, now), b.maya, {
        type: 'group.moved',
        server: 'https://sync.example.net',
      });
      return scenario('banff-moved', b, now, server);
    }
    case 'alldone':
      return scenario('banff-alldone', banffAllDone(myDevice, now), now, server, {
        lastSyncedAt: now - 10_000,
      });
    case 'even': {
      const b = banffAllDone(myDevice, now);
      b.log.add(day(0, 10, 10, now), b.nathan, payment(b.nathan, b.maya, 12800, '2026-09-26'));
      b.log.add(day(0, 10, 12, now), b.sam, payment(b.sam, b.maya, 4400, '2026-09-26'));
      b.log.add(day(0, 10, 13, now), b.sam, payment(b.sam, b.jordan, 800, '2026-09-26'));
      return scenario('banff-even', b, now, server, { lastSyncedAt: now - 10_000 });
    }
    case 'group-archived':
      return scenario('banff-archived', banffArchived(myDevice, now), now, server, {
        lastSyncedAt: now - 10_000,
        open: { tab: 'activity' },
      });
    case 'many':
    case 'done-sheet':
      return {
        ...scenario('whistler', whistler(myDevice, now), now, server, {
          lastSyncedAt: now - 10_000,
        }),
        name: 'Whistler 2027',
        open: state === 'done-sheet' ? { sheet: 'done' } : {},
      };
    case 'group-new':
    case 'share':
    case 'invite':
      return scenario(
        state === 'invite' ? 'banff-invite' : 'banff-new',
        banffNew(myDevice, now),
        now,
        server,
        {
          acked: state !== 'invite',
          lastSyncedAt: state === 'invite' ? null : now - 10_000,
          shareOnOpen: state === 'share',
        },
      );
    case 'newWithExpenses':
      return scenario('banff-new-expenses', banffNew(myDevice, now, true), now, server);
    // A group held by a phone with no seat in it. `unclaimed`: Sam created it on another phone, so no member carries
    // this device and Group offers "Which name is yours?" as offered again (SeatPick; closed, GroupNoSeat).
    // `unclaimed-own`: this phone created it as Sam and the row lost the seat (a reinstall's keychain recovery), so
    // Sam's seat still lists this device and Group restores it without asking (Group, just created).
    // `unclaimed-two`: this phone claimed both Maya and Maya K., so it cannot tell which is its own and asks, marking
    // both "this phone" (SeatSameDevice, once Maya is tapped).
    case 'unclaimed':
      return scenario('banff-unclaimed', banffNoSeat(myDevice, false), now, server, {
        claimed: false,
      });
    case 'unclaimed-own':
      return scenario('banff-unclaimed-own', banffNew(myDevice, now), now, server, {
        claimed: false,
      });
    case 'unclaimed-two':
      return scenario('banff-unclaimed-two', banffNoSeat(myDevice, true), now, server, {
        claimed: false,
      });
    case 'expense-detail': {
      const b = banffBase(myDevice, 'detail');
      banffRecent(b, now);
      return scenario('banff-detail', b, now, server, { open: { expenseId: b.dinnerId } });
    }
  }
}

/**
 * The Expense detail · flagged board, as an in-memory state: the dinner's last version splits $94.00 of $96.00. The
 * validator refuses a split that does not add up (core `schema.ts`), so no synced log can carry one; the reducer's
 * flag is defence against old or hostile clients. The dev route renders the detail view over this state directly.
 */
export function flaggedPreview(myDevice: string) {
  const b = banffBase(myDevice, 'activity');
  const dinnerId = newId();
  const entries = b.log.entries.filter(
    (e) => !(e.event.type === 'expense.added' && e.event.expense.title.startsWith('Dinner')),
  );
  const trio = [b.sam.id, b.maya.id, b.jordan.id];
  const split = (amounts: number[]) =>
    Object.fromEntries(trio.map((id, i) => [id, amounts[i] ?? 0]));
  const raw = (at: number, by: SeedMember, payload: EventPayload): LogEntry => ({
    id: newId(),
    event: { sv: 1, ts: at, at, by: by.id, dev: by.dev, ...payload } as Event,
  });
  const extra = [
    raw(
      sep(20, 21, 14),
      b.maya,
      expense(
        dinnerId,
        'Dinner at Park Distillery',
        9000,
        b.maya,
        '2026-09-20',
        'food',
        split([3000, 3000, 3000]),
        'Split the wine',
      ),
    ),
    raw(sep(21, 8, 2), b.maya, {
      type: 'expense.updated',
      id: dinnerId,
      changes: { amount: 9600, split: split([3200, 3200, 3200]) },
    }),
    raw(sep(21, 9, 30), b.jordan, {
      type: 'expense.updated',
      id: dinnerId,
      changes: { amount: 9600, split: split([3200, 3200, 3000]) },
    }),
  ];
  const state = reduce([...entries, ...extra]);
  return { state, myMemberId: b.sam.id, dinnerId };
}

// ---------- Writing ----------

/** Each seed group's secret: 32 bytes from its key, so a second run finds and replaces the same group. */
export function seedSecret(key: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode(`even-dev-seed/${key}`.padEnd(32, '.').slice(0, 32)));
  return bytes;
}

function sealRows(
  scenarioSpec: Scenario,
  key: Uint8Array,
  groupId: string,
  myDevice: string,
): NewEventRow[] {
  return scenarioSpec.entries.map(({ id, event }) => ({
    id,
    origin: event.dev === myDevice ? 'local' : 'remote',
    acked: scenarioSpec.acked || event.dev !== myDevice,
    seq: null,
    ts: event.ts,
    envelope: JSON.stringify(seal({ key, groupId, body: event, id })),
    status: 'ok',
  }));
}

/**
 * Makes room for a group with a fixed key: this phone's copy goes (rows and secret), the secret is written for
 * `serverUrl`, and on the dev server the copy an earlier run left is deleted. A fixed key is the same server group
 * every run, so without that the first pull would bring the old run's log into the new one. A group on one of the
 * unreachable servers is not asked for.
 */
async function makeRoom(
  s: AppServices,
  secret: Uint8Array,
  serverUrl: string,
  devServer: string,
): Promise<void> {
  assertNotProduction(serverUrl);
  const { localId } = deriveLocal(secret);
  if ((await s.store.getGroup(localId)) !== null) await s.groups.leaveGroup(localId);
  await s.secrets.setSecret(localId, secret, serverUrl);
  if (serverUrl === devServer) await s.groups.deleteServerCopy(localId, serverUrl);
}

/** Writes a scenario's group (replacing an earlier seed of the same key). Returns its local id. */
export async function seedGroup(
  services: AppServices,
  spec: Scenario,
  devServer: string,
): Promise<string> {
  const { store, groupState, deviceId } = services;
  const secret = seedSecret(spec.key);
  const { localId, encryptionKey } = deriveLocal(secret);
  await makeRoom(services, secret, spec.serverUrl, devServer);
  const { groupId } = deriveServer(secret, spec.serverUrl);
  const rows = [...sealRows(spec, encryptionKey, groupId, deviceId), ...spec.extraRows];
  const createdAt = Math.min(...spec.entries.map((e) => e.event.at));
  await store.transaction(async (tx) => {
    await tx.upsertGroup({
      localId,
      serverUrl: spec.serverUrl,
      epoch: null,
      cursor: 0,
      myMemberId: spec.claimed ? spec.me.id : null,
      nameCache: spec.name,
      currencyCache: 'CAD',
      createdAt,
      lastSyncedAt: spec.lastSyncedAt,
      lastSyncError: spec.lastSyncError,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    await tx.insertEvents(localId, rows);
  });
  groupState.invalidate(localId);
  groupState.groupsChanged();
  await groupState.get(localId); // the screen opens on the new snapshot, not the one Leave left behind
  return localId;
}

// ---------- Groups, Create, Join, App settings ----------

/**
 * The JoinCodePreview board's code: a complete invite to "Banff 2026", CAD, on the default server, as drawn. The
 * preview reads it without asking any server; tapping Join would reach production, so screenshots stop at the
 * preview.
 */
export const BOARD_CODE =
  'eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBlSHlBaElpTWtKU1kiLCJoIjoiemtQek9RIiwiZyI6IkJhbmZmIDIwMjYiLCJjdXIiOiJDQUQifQ';
/** The JoinCodeError board's code: the same, cut short. */
export const BOARD_CODE_INCOMPLETE =
  'eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBl';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Removes every group (rows and secrets) and any keychain entry left without a row, deleting each one's copy on
 * the dev server as it goes (Leave's "Also delete the copy"). Groups on any other server are only removed here.
 */
export async function wipe(s: AppServices, devServer: string): Promise<void> {
  for (const row of await s.store.listGroups()) {
    await s.groups
      .leaveGroup(row.localId, { deleteServerCopy: row.serverUrl === devServer })
      .catch(() => undefined);
  }
  for (const entry of await s.secrets.listGroups()) {
    if ((await s.store.getGroup(entry.localId)) === null) {
      if (entry.serverUrl === devServer) {
        await s.groups.deleteServerCopy(entry.localId, devServer).catch(() => undefined);
      }
      await s.secrets.deleteSecret(entry.localId).catch(() => undefined);
    }
  }
}

async function seedMe(s: AppServices, emoji: string | null): Promise<void> {
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
  /** Fixed member ids keep the avatar colours the boards draw. */
  myId?: string;
  people: (string | { name: string; id: string })[];
  spends?: Spend[];
  archived?: boolean;
  synced: boolean;
  /** The group's server: always named, so no seed falls back to the default (production) one. */
  serverUrl: string;
}

/** Creates a group as Sam (or `myName`), adds its expenses split equally among everyone, archives it if asked. */
async function createAs(s: AppServices, spec: GroupSpec): Promise<string> {
  assertNotProduction(spec.serverUrl);
  const myName = spec.myName ?? 'Sam';
  const { localId, memberId } = await s.groups.createGroup({
    name: spec.name,
    currency: 'CAD',
    myName,
    myId: spec.myId,
    people: spec.people,
    serverUrl: spec.serverUrl,
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
      date: isoToday(),
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
async function mainGroups(s: AppServices, server: string): Promise<void> {
  // Groups, extra states (Archived, expanded): Jasper 2025 (4 people) over Lisbon 2024 (3 people), both settled.
  await createAs(s, {
    name: 'Lisbon 2024',
    people: ['Maya', 'Priya'],
    archived: true,
    synced: true,
    serverUrl: server,
  });
  await createAs(s, {
    name: 'Jasper 2025',
    people: ['Maya', 'Jordan', 'Nathan'],
    archived: true,
    synced: true,
    serverUrl: server,
  });
  await otherGroups(s, server);
  await createAs(s, {
    name: 'Banff 2026',
    people: ['Maya', 'Jordan', 'Nathan'],
    spends: [{ payer: 'Maya', amount: 20800, title: 'Cabin', category: 'lodging' }],
    synced: true,
    serverUrl: server,
  });
}

/** Tofino weekend (settled), Friday dinners (you owe $12.00, unsent), Oak Street house (you're owed $44.00). */
async function otherGroups(s: AppServices, server: string): Promise<void> {
  await createAs(s, {
    name: 'Tofino weekend',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya'],
    synced: true,
    serverUrl: server,
  });
  await createAs(s, {
    name: 'Friday dinners',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya', 'Leo'],
    spends: [{ payer: 'Jordan', amount: 7200, title: 'Ramen', category: 'food' }],
    synced: false,
    serverUrl: server,
  });
  await createAs(s, {
    name: 'Oak Street house',
    people: ['Maya', 'Priya'],
    spends: [{ payer: 'Sam', amount: 6600, title: 'Internet', category: 'fees' }],
    synced: true,
    serverUrl: server,
  });
}

/**
 * The AppDiagnostics board's Sync card: Banff 2026 synced 2 min ago, Oak Street house an hour ago, Friday dinners
 * never synced with its server refusing it ("Can't reach this group's server.") and its entries unsent, Tofino
 * weekend 3 days ago. Friday dinners is on a server that refuses at once, so its entries stay unsent; the times and
 * the error are written once the syncs the new groups started have finished, so the list reads as drawn (until the
 * engine's own retry of Friday dinners, 30 s later, words its error as the network one).
 */
async function diagnosticsGroups(s: AppServices, server: string): Promise<void> {
  const tofino = await createAs(s, {
    name: 'Tofino weekend',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya'],
    synced: true,
    serverUrl: server,
  });
  const friday = await createAs(s, {
    name: 'Friday dinners',
    people: ['Maya', 'Jordan', 'Nathan', 'Priya', 'Leo'],
    spends: [{ payer: 'Jordan', amount: 7200, title: 'Ramen', category: 'food' }],
    synced: false,
    serverUrl: REFUSING_SERVER,
  });
  const oak = await createAs(s, {
    name: 'Oak Street house',
    people: ['Maya', 'Priya'],
    spends: [{ payer: 'Sam', amount: 6600, title: 'Internet', category: 'fees' }],
    synced: true,
    serverUrl: server,
  });
  const banff = await createAs(s, {
    name: 'Banff 2026',
    people: ['Maya', 'Jordan', 'Nathan'],
    spends: [{ payer: 'Maya', amount: 20800, title: 'Cabin', category: 'lodging' }],
    synced: true,
    serverUrl: server,
  });
  await askTheModel();
  for (let waited = 0; waited < 8000; waited += 200) {
    const list = s.groupState.peekList();
    if (list.status === 'ready' && list.rows.every((row) => !row.sync.syncing)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  const now = Date.now();
  const stamps: [string, number | null, string | null][] = [
    [banff, now - 2 * 60_000, null],
    [oak, now - 61 * 60_000, null],
    [friday, null, 'unauthorized'],
    [tofino, now - 3 * 24 * 3_600_000, null],
  ];
  for (const [localId, lastSyncedAt, lastSyncError] of stamps) {
    await s.store.setSyncState(localId, { lastSyncedAt, lastSyncError });
    s.groupState.invalidate(localId);
  }
  s.groupState.groupsChanged();
}

/**
 * Diagnostics' "Since Even opened": a few titles asked of the real on-device model through the chip's path
 * (`refineCategory`), so the table shows what this phone's model answers. The titles are this seed's own; they are
 * not kept anywhere (only each outcome is).
 */
async function askTheModel(): Promise<void> {
  for (const title of ['Sur', 'Fairmont Banff Springs', "Surly's brewing"]) {
    await refineCategory(title);
  }
}

/**
 * The Join board: "Banff 2026" where Maya and Jordan (🏂) have joined and Nathan has not, and this phone has no
 * seat yet. Seeded first so its activity sorts below the three groups the board shows behind the sheet.
 */
async function pickGroup(s: AppServices, server: string): Promise<string> {
  const localId = await createAs(s, {
    name: 'Banff 2026',
    myName: 'Maya',
    myId: memberIdFor(CLAY),
    people: [
      { name: 'Jordan', id: memberIdFor(OCHRE) },
      { name: 'Nathan', id: memberIdFor(STEEL) },
    ],
    synced: false,
    serverUrl: server,
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

/** Two groups whose rows are gone but whose secrets remain: "Recover 2 groups?" */
async function reinstalled(s: AppServices, server: string): Promise<void> {
  const a = await createAs(s, {
    name: 'Banff 2026',
    people: ['Maya'],
    synced: false,
    serverUrl: server,
  });
  const b = await createAs(s, {
    name: 'Oak Street house',
    people: ['Priya'],
    synced: false,
    serverUrl: server,
  });
  for (const localId of [a, b]) {
    await s.store.deleteGroup(localId);
    s.groupState.evict(localId);
  }
  s.groupState.groupsChanged();
}

// ---------- Add expense, Split, Settle ----------

export interface BanffC {
  localId: string;
  sam: string;
  maya: string;
  jordan: string;
  nathan: string;
  dinnerId: string;
}

function sheetSecret(key: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode(`even-dev-seed/sheets-${key}`.padEnd(32, '.').slice(0, 32)));
  return bytes;
}

/** Writes Banff 2026 as the Add expense, Split and Settle boards draw it, on the dev server. */
export async function seedBanff(services: AppServices, devServer: string): Promise<BanffC> {
  const { store, groupState, deviceId } = services;
  const serverUrl = devServer;
  const secret = sheetSecret('banff');
  const { localId, encryptionKey } = deriveLocal(secret);
  await makeRoom(services, secret, serverUrl, devServer);
  const { groupId } = deriveServer(secret, serverUrl);

  const sam = memberIdFor(VIOLET);
  const maya = memberIdFor(CLAY);
  const jordan = memberIdFor(OCHRE);
  const nathan = memberIdFor(STEEL);
  const devices: Record<string, string> = {
    [sam]: deviceId,
    [maya]: newId(),
    [jordan]: newId(),
    [nathan]: newId(),
  };
  const dinnerId = newId();
  const now = Date.now();
  const start = now - 3 * 24 * 60 * 60 * 1000;
  const rows: NewEventRow[] = [];
  let ts = start;

  const add = (by: string, payload: EventPayload) => {
    ts += 60_000;
    const event = { sv: 1, ts, at: ts, by, dev: devices[by], ...payload } as Event;
    if (parseEvent(JSON.parse(JSON.stringify(event))) === null) {
      throw new Error(`seed: invalid ${payload.type} event`);
    }
    const id = newId();
    rows.push({
      id,
      origin: by === sam ? 'local' : 'remote',
      acked: true,
      seq: null,
      ts,
      envelope: JSON.stringify(seal({ key: encryptionKey, groupId, body: event, id })),
      status: 'ok',
    });
  };
  const expense = (
    id: string,
    title: string,
    amount: number,
    category: Category,
    split: Record<string, number>,
    date = todayIso(new Date(ts)),
  ): EventPayload => ({
    type: 'expense.added',
    expense: {
      id,
      title,
      amount,
      currency: 'CAD',
      paidBy: maya,
      date,
      category,
      split,
    },
  });

  add(sam, { type: 'member.added', member: { id: sam, name: 'Sam' } });
  add(sam, { type: 'member.claimed', id: sam });
  add(sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const [id, name] of [
    [maya, 'Maya'],
    [jordan, 'Jordan'],
    [nathan, 'Nathan'],
  ] as const) {
    add(sam, { type: 'member.added', member: { id, name } });
  }
  for (const id of [maya, jordan, nathan]) add(id, { type: 'member.claimed', id });
  add(jordan, { type: 'member.updated', id: jordan, changes: { emoji: '🏂' } });
  add(
    maya,
    expense(newId(), 'Gas at Petro-Canada', 8000, 'fuel', {
      [sam]: 2000,
      [maya]: 2000,
      [jordan]: 2000,
      [nathan]: 2000,
    }),
  );
  add(
    maya,
    // "Sep 20", as the Edit expense board draws it.
    expense(
      dinnerId,
      'Dinner at Park Distillery',
      9600,
      'food',
      { [sam]: 3200, [maya]: 3200, [jordan]: 3200 },
      '2026-09-20',
    ),
  );

  await store.transaction(async (tx) => {
    await tx.upsertGroup({
      localId,
      serverUrl,
      epoch: null,
      cursor: 0,
      myMemberId: sam,
      nameCache: 'Banff 2026',
      currencyCache: 'CAD',
      createdAt: start,
      lastSyncedAt: now - 2 * 60_000,
      lastSyncError: null,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    await tx.insertEvents(localId, rows);
  });
  groupState.invalidate(localId);
  groupState.groupsChanged();
  return { localId, sam, maya, jordan, nathan, dinnerId };
}

/** The Add expense, Split and Settle states. */
export type SheetState = Extract<
  SeedState,
  `add-${string}` | `split-${string}` | 'settle' | `settle-${string}`
>;

/** What the sheet states open: the sheet's route (with its draft or dev parameters), and Split pushed over it. */
export type SheetPlan =
  | {
      kind: 'expense';
      draftId: string | null;
      editId: string | null;
      split: boolean;
      /** Dev parameters for the sheet: `focus=title`, `sheet=payer|date`. */
      query?: string;
    }
  | { kind: 'settle'; query: string };

function draftFor(b: BanffC, init: Partial<Omit<SheetDraft, 'id' | 'groupId'>>): string {
  return createDraft({
    groupId: b.localId,
    editId: null,
    title: '',
    amountText: '',
    paidBy: null,
    date: todayIso(),
    split: null,
    chip: null,
    pickerOpen: false,
    splitFocus: null,
    error: null,
    ...init,
  }).id;
}

/** The model's pick for `title`, not yet touched: the chip carries the sparkle, with no timer. */
function suggested(category: ChipState['category'], title: string): ChipState {
  return { category, source: 'model', frozen: false, swaps: 1, tagged: true, answeredTitle: title };
}

/** The boards' drafts: the sheet's fields, the chip, and the split editor's state. */
export function planFor(b: BanffC, state: SheetState): SheetPlan {
  const all = [b.sam, b.maya, b.jordan, b.nathan];
  const shuttle = { title: 'Lake Louise shuttle', amountText: '36' };
  const expense = (draftId: string | null, query?: string): SheetPlan => ({
    kind: 'expense',
    draftId,
    editId: null,
    split: false,
    ...(query === undefined ? {} : { query }),
  });
  const split = (init: Partial<Omit<SheetDraft, 'id' | 'groupId'>>): SheetPlan => ({
    kind: 'expense',
    draftId: draftFor(b, init),
    editId: null,
    split: true,
  });
  switch (state) {
    case 'add-first':
      // Add expense, extra states: first open.
      return expense(null);
    case 'add-expense':
      // AddExpense: the keyword table does not know "Surly's brewing"; the model's pick is Drinks, with its sparkle.
      return expense(
        draftFor(b, {
          title: "Surly's brewing",
          amountText: '36',
          chip: suggested('drinks', "Surly's brewing"),
        }),
      );
    case 'add-typing':
      // Typing the title: the keypad hides, the amount shrinks, Save sits above the keyboard.
      return expense(draftFor(b, shuttle), 'focus=title');
    case 'add-error':
      // Save failed: the line just above Save.
      return expense(draftFor(b, { ...shuttle, error: "Couldn't save. Try again." }));
    case 'add-payer':
      return expense(draftFor(b, shuttle), 'sheet=payer');
    case 'add-date':
      return expense(draftFor(b, shuttle), 'sheet=date');
    case 'add-picker':
      // CategoryPicker: the model picked Lodging for "Grizzly House" (the sparkle); the picker is open.
      return expense(
        draftFor(b, {
          title: 'Grizzly House',
          amountText: '148',
          chip: suggested('lodging', 'Grizzly House'),
          pickerOpen: true,
        }),
      );
    case 'add-suggested':
      // The model's pick, not yet touched: the sparkle, no timer (AddExpenseStates, "Category chip").
      return expense(
        draftFor(b, {
          title: 'Grizzly House',
          amountText: '148',
          chip: suggested('lodging', 'Grizzly House'),
        }),
      );
    case 'add-chosen':
      // CategoryChosen: you picked Food.
      return expense(
        draftFor(b, {
          title: 'Grizzly House',
          amountText: '148',
          chip: initialChipState('Grizzly House', 'food'),
        }),
      );
    case 'add-edit':
      return { kind: 'expense', draftId: null, editId: b.dinnerId, split: false };
    case 'settle':
      return { kind: 'settle', query: `from=${b.sam}&to=${b.maya}&amount=4400` };
    case 'settle-empty':
      // Opened from Balances' "Settle up": you pay, nobody chosen yet.
      return { kind: 'settle', query: '' };
    case 'settle-to':
      return { kind: 'settle', query: `from=${b.sam}&to=${b.maya}&amount=4400&sheet=to` };
    case 'settle-recorded':
      return { kind: 'settle', query: `from=${b.sam}&to=${b.maya}&amount=4400&recorded=1` };
    case 'split-equal':
      // SplitEqual: Maya ×2 (a guest), Nathan +$12.00 (his cocktail).
      return split({
        title: 'Dinner at Park Distillery',
        amountText: '96',
        split: setExtra(setWeight(equalDraft(all), b.maya, 2), b.nathan, 1200),
      });
    case 'split-exact': {
      // Split (Exact): Nathan out, Jordan's cell under the keypad at $6.00, $6.00 remaining.
      let d = toggleMember(equalDraft(all), b.nathan);
      d = setAmount(setAmount(setAmount(d, b.sam, 1200), b.maya, 1200), b.jordan, 600);
      return split({ ...shuttle, split: { ...d, mode: 'exact' }, splitFocus: b.jordan });
    }
    case 'split-percent': {
      // SplitPercent: 15 / 40 / 15 / 30, Maya's cell under the keypad.
      const d = setBps(
        setBps(setBps(setBps(equalDraft(all), b.sam, 1500), b.maya, 4000), b.jordan, 1500),
        b.nathan,
        3000,
      );
      return split({
        title: 'Dinner at Park Distillery',
        amountText: '96',
        split: { ...d, mode: 'percent' },
        splitFocus: b.maya,
      });
    }
    case 'split-excluded':
      // Split, extra states 1: Equal, Nathan left out, $12.00 each.
      return split({ ...shuttle, split: toggleMember(equalDraft(all), b.nathan) });
    case 'split-over-percent': {
      // Split, extra states 2: 15 / 45 / 15 / 30, over by 5%, Maya's cell under the keypad.
      const d = setBps(
        setBps(setBps(setBps(equalDraft(all), b.sam, 1500), b.maya, 4500), b.jordan, 1500),
        b.nathan,
        3000,
      );
      return split({
        title: 'Dinner at Park Distillery',
        amountText: '96',
        split: { ...d, mode: 'percent' },
        splitFocus: b.maya,
      });
    }
    case 'split-over-exact': {
      // Split, extra states 3: 12 + 12 + 18 of $36.00, over by $6.00, Jordan's cell under the keypad.
      let d = toggleMember(equalDraft(all), b.nathan);
      d = setAmount(setAmount(setAmount(d, b.sam, 1200), b.maya, 1200), b.jordan, 1800);
      return split({ ...shuttle, split: { ...d, mode: 'exact' }, splitFocus: b.jordan });
    }
  }
  return expense(null);
}

/** The steps a sheet state takes: the Group screen underneath, then the sheet, then Split over it. */
export function sheetSteps(localId: string, plan: SheetPlan): SeedStep[] {
  const root = `/group/${encodeURIComponent(localId)}`;
  const steps: SeedStep[] = [{ path: root, mode: 'replace' }];
  if (plan.kind === 'settle') {
    steps.push({
      path: `${root}/settle${plan.query === '' ? '' : `?${plan.query}`}`,
      mode: 'push',
      wait: 400,
    });
    return steps;
  }
  const query = [
    plan.draftId === null ? null : `draft=${plan.draftId}`,
    plan.editId === null ? null : `edit=${plan.editId}`,
    plan.query ?? null,
  ].filter((part): part is string => part !== null);
  steps.push({
    path: `${root}/expense${query.length === 0 ? '' : `?${query.join('&')}`}`,
    mode: 'push',
    wait: 400,
  });
  if (plan.split && plan.draftId !== null) {
    steps.push({ path: `${root}/split?draft=${plan.draftId}`, mode: 'push', wait: 700 });
  }
  return steps;
}

// ---------- Group settings, background refresh ----------

const GROUP_NAME = 'Banff 2026';
const CURRENCY = 'CAD';
/** "246 KB of 2 MB": the log is filled until it rounds to this many KiB. */
const TARGET_BYTES = 245.5 * 1024;
/** "1.7 MB of 2 MB · 85%" (Group settings, extra states: usage at 80 % and up). */
const TARGET_BYTES_FULLISH = 0.85 * 2_097_152;
/** The server the extra states move the group to. */
const HOME_SERVER = 'https://home.example.net';

/** PROTOCOL.md §6.1, the default server's published `/v1/info` (what home.example.net's differs from). */
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

/** home.example.net as the Move server board reads it: no operator named, 5 MB · 50,000 entries, 730 days. */
export const HOME_SERVER_INFO: ServerInfo = {
  ...DEFAULT_SERVER_INFO,
  limits: { ...DEFAULT_SERVER_INFO.limits, max_group_bytes: 5_242_880, max_group_events: 50_000 },
  retention_days: 730,
  operator: undefined,
  terms: undefined,
};

/** home.example.net as ReportGroupOther reads it: it sends an operator ("Self-hosted") and its terms. */
export const HOME_SERVER_INFO_WITH_TERMS: ServerInfo = {
  ...HOME_SERVER_INFO,
  operator: 'Self-hosted',
  terms: 'https://home.example.net/terms',
};

export type SeedVariant =
  /** As drawn: every event acknowledged, so the invite may be shared. */
  | 'board'
  /** The group's first push not acknowledged yet: the invite card's buttons wait. */
  | 'preparing'
  /** Three of this phone's entries not acknowledged (Leave, with unsent entries). */
  | 'unsent'
  /** Jordan archived (Archived member). */
  | 'archived-member'
  /** Filled to 85 % of the server's limit (Usage at 80 % and up). */
  | 'usage'
  /** Moved to home.example.net (After a move). */
  | 'moved';

export interface SeededGroup {
  localId: string;
  serverUrl: string;
  sam: string;
  maya: string;
  jordan: string;
  nathan: string;
  mayaDevice: string;
}

/** The settings seed group's secret: 32 bytes from a fixed key, so a second run finds and replaces the same group. */
function settingsSecret(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set(utf8Encode('even-dev-seed/settings-banff-2026'.padEnd(32, '.').slice(0, 32)));
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

/** Writes the board's group (replacing an earlier seed): on the dev server, or moved from it to home.example.net. */
export async function seedGroupSettings(
  services: AppServices,
  variant: SeedVariant,
  devServer: string,
): Promise<SeededGroup> {
  const { store, groupState, infoCache, deviceId } = services;
  const serverUrl = variant === 'moved' ? HOME_SERVER : devServer;
  const secret = settingsSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  await makeRoom(services, secret, serverUrl, devServer);
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
  const add = (payload: EventPayload, by: string, dev: string, pending = false) => {
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
      acked: !mine || (variant !== 'preparing' && !pending),
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
  const target = variant === 'usage' ? TARGET_BYTES_FULLISH : TARGET_BYTES;
  // The 85 % state fills faster with long notes (each entry still well under the event size limit).
  const note =
    variant === 'usage' ? 'Split evenly, receipts in the shared album. '.repeat(10) : undefined;
  const expenseBy = (i: number, pending = false) => {
    const [title, category] = TITLES[i % TITLES.length] ?? ['Groceries', 'groceries'];
    const [paidBy, dev] = pending
      ? [sam, deviceId]
      : (payers[i % payers.length] ?? [sam, deviceId]);
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
          ...(note === undefined ? {} : { note }),
        },
      },
      paidBy,
      dev,
      pending,
    );
  };
  let i = 0;
  for (; bytes < target; i += 1) expenseBy(i);
  if (variant === 'archived-member') add({ type: 'member.archived', id: jordan }, sam, deviceId);
  if (variant === 'moved') add({ type: 'group.moved', server: HOME_SERVER }, sam, deviceId);
  if (variant === 'unsent') for (let k = 0; k < 3; k += 1) expenseBy(i + k, true);

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
      lastSyncedAt: variant === 'preparing' ? null : now,
      lastSyncError: null,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    await tx.insertEvents(localId, rows);
  });
  // The dev server answers its own /v1/info; home.example.net is not there to ask.
  await infoCache.refresh(HOME_SERVER, infoOnly(HOME_SERVER_INFO));
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
  const secret = settingsSecret();
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

// ---------- New states: Group screen copy ----------

/** "Two members are named Maya": a second Maya, added by Nathan's phone, nobody's seat yet. */
function banffCollision(myDevice: string, now: number): Banff {
  const b = banffBase(myDevice, 'activity');
  banffRecent(b, now);
  b.log.add(day(0, 10, 20, now), b.nathan, {
    type: 'member.added',
    member: { id: memberIdFor(ROSE), name: 'Maya' },
  });
  return b;
}

/** "This expense is in USD, not CAD": Jordan's gondola tickets, $72.00 in US dollars, split four ways. */
function banffCurrency(myDevice: string, now: number): { b: Banff; expenseId: string } {
  const b = banffBase(myDevice, 'activity');
  banffRecent(b, now);
  const expenseId = newId();
  const all = [b.sam, b.maya, b.jordan, b.nathan];
  b.log.add(sep(21, 11, 0), b.jordan, {
    type: 'expense.added',
    expense: {
      id: expenseId,
      title: 'Sulphur Mountain Gondola',
      amount: 7200,
      currency: 'USD',
      paidBy: b.jordan.id,
      date: '2026-09-21',
      category: 'activities',
      split: Object.fromEntries(all.map((m) => [m.id, 1800])),
    },
  });
  return { b, expenseId };
}

/** The Group screen copy states beside `buildScenario`'s. */
export function buildCopyScenario(
  state: 'owed' | 'settled-member' | 'collision' | 'expense-currency',
  myDevice: string,
  now: number,
  server: string,
): Scenario {
  switch (state) {
    case 'owed': {
      // Maya's phone: "You're owed $172.00", Nathan and Sam pay her.
      const b = banffBase(myDevice, 'activity', 'maya');
      banffRecent(b, now);
      return scenario('banff-owed', b, now, server, { me: b.maya });
    }
    case 'settled-member': {
      const b = banffBase(myDevice, 'activity');
      banffRecent(b, now);
      b.log.add(day(0, 10, 15, now), b.nathan, payment(b.nathan, b.maya, 12800, '2026-09-26'));
      return scenario('banff-settled', b, now, server, {
        open: { tab: 'balances', stuck: true },
      });
    }
    case 'collision':
      return scenario('banff-collision', banffCollision(myDevice, now), now, server);
    case 'expense-currency': {
      const { b, expenseId } = banffCurrency(myDevice, now);
      return scenario('banff-currency', b, now, server, { open: { expenseId } });
    }
  }
}

// ---------- Join, extra states ----------

/** A code for `localId`'s group naming another server: "Move Banff 2026 from … to home.example.net?" */
async function moveCode(s: AppServices, localId: string, name: string): Promise<string> {
  const secret = await s.secrets.getSecret(localId);
  if (secret === null) throw new Error('seed: no secret');
  return encodeInvite(makeInvite(secret, 'https://home.example.net', { g: name, cur: 'CAD' }));
}

/** An invite of a newer version: "This invite needs a newer Even." */
function newerCode(): string {
  const bytes = utf8Encode(
    JSON.stringify({ v: 2, s: PROTOCOL.defaultServer, k: 'x', h: 'x', g: 'Banff 2026' }),
  );
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- The dispatcher ----------

const q = encodeURIComponent;
const push = (path: string, wait?: number): SeedStep => ({
  path,
  mode: 'push',
  ...(wait === undefined ? {} : { wait }),
});
const replace = (path: string): SeedStep => ({ path, mode: 'replace' });

/**
 * Writes what `state` needs (after removing every group) and says where to go. Throws before touching anything
 * for a production `server`, and while this phone still holds a group on the production server: removing it here
 * would lose the secret that `even://dev/cleanup` needs to delete its copy there.
 */
export async function seed(
  s: AppServices,
  state: SeedState,
  options: SeedOptions,
): Promise<SeedResult> {
  const server = seedServerOrigin(options.server);
  const held = await productionHoldings(s);
  if (held.length > 0) {
    throw new Error(
      `this phone still holds ${held.length} ${held.length === 1 ? 'group' : 'groups'} on the production server from older seeds. Open even://dev/cleanup to delete ${held.length === 1 ? 'its copy' : 'their copies'} there, then seed again.`,
    );
  }
  await wipe(s, server);
  // The chips' colours as the CreateGroup board draws them: Maya clay, Jordan ochre, Nathan steel.
  const people = `Maya:${memberIdFor(CLAY)},Jordan:${memberIdFor(OCHRE)},Nathan:${memberIdFor(STEEL)}`;
  const createPrefill = `name=${q('Banff 2026')}&currency=CAD&people=${q(people)}&me=Sam&emoji=${q('🌲')}`;
  const creating =
    state === 'create' ||
    state === 'create-end' ||
    state === 'create-emoji' ||
    state.startsWith('create-');
  await seedMe(s, creating ? '🌲' : (options.emoji ?? null));

  switch (state) {
    // ----- Groups, Create, Join, App settings -----
    case 'groups':
      await mainGroups(s, server);
      return { steps: [replace('/')] };
    case 'groups-archived':
      await mainGroups(s, server);
      return { steps: [replace('/?archived=open')] };
    case 'groups-empty':
      return {
        steps: [replace(options.motionAt === undefined ? '/' : `/?motionAt=${options.motionAt}`)],
      };
    case 'recovery':
      await reinstalled(s, server);
      return { steps: [replace('/')], recoveryOffer: true };
    case 'create':
      return { steps: [push(`/create?${createPrefill}`)] };
    case 'create-end':
      return { steps: [push(`/create?${createPrefill}&scroll=end`)] };
    case 'create-emoji':
      return { steps: [push(`/create?${createPrefill}&picker=emoji`)] };
    case 'create-currency':
      return { steps: [push(`/create?${createPrefill}&picker=currency`)] };
    case 'create-advanced':
      return { steps: [push(`/create?${createPrefill}&advanced=1&scroll=end`)] };
    case 'join-code':
      return { steps: [push('/join')] };
    case 'join-preview':
      return { steps: [push(`/join?code=${BOARD_CODE}`)] };
    case 'join-error':
      return { steps: [push(`/join?code=${BOARD_CODE_INCOMPLETE}`)] };
    case 'join-version':
      return { steps: [push(`/join?code=${newerCode()}`)] };
    case 'join-pick':
    case 'join-not-listed':
    case 'join-same-name': {
      const localId = await pickGroup(s, server);
      await otherGroups(s, server);
      const extra =
        state === 'join-not-listed'
          ? '&notListed=1'
          : state === 'join-same-name'
            ? '&ask=Maya'
            : '';
      return { steps: [push(`/join?localId=${q(localId)}${extra}`)] };
    }
    case 'join-move': {
      await otherGroups(s, server);
      const localId = await createAs(s, {
        name: 'Banff 2026',
        people: ['Maya', 'Jordan', 'Nathan'],
        synced: true,
        serverUrl: server,
      });
      return { steps: [push(`/join?code=${await moveCode(s, localId, 'Banff 2026')}&auto=1`)] };
    }
    case 'app-settings':
      return { steps: [push('/settings')] };
    case 'app-settings-emoji':
      return { steps: [push('/settings?picker=emoji')] };
    case 'app-settings-help':
      // Scrolled so Groups, Help and About show, as the bottom of the AppSettings board.
      return { steps: [push(`/settings?y=${options.y ?? 206}`)] };
    case 'about':
      return { steps: [push('/settings'), push('/about', 400)] };
    case 'diagnostics':
    case 'diagnostics-check': {
      await diagnosticsGroups(s, server);
      const query = [
        ...(state === 'diagnostics-check' ? ['check=1'] : []),
        ...(options.y === undefined ? [] : [`y=${options.y}`]),
      ].join('&');
      return {
        steps: [
          push('/settings'),
          push('/about', 400),
          push(`/diagnostics${query === '' ? '' : `?${query}`}`, 400),
        ],
      };
    }

    // ----- Group, Expense detail -----
    case 'expense-flagged':
      return { steps: [], flagged: true };
    case 'owed':
    case 'settled-member':
    case 'collision':
    case 'expense-currency':
      return openScenario(s, buildCopyScenario(state, s.deviceId, Date.now(), server), server);
    case 'group':
    case 'balances':
    case 'activity':
    case 'unreadable':
    case 'syncing':
    case 'stale':
    case 'update':
    case 'closed':
    case 'moved':
    case 'alldone':
    case 'even':
    case 'group-archived':
    case 'many':
    case 'done-sheet':
    case 'group-new':
    case 'newWithExpenses':
    case 'invite':
    case 'share':
    case 'unclaimed':
    case 'unclaimed-own':
    case 'unclaimed-two':
    case 'expense-detail':
      return openScenario(s, buildScenario(state, s.deviceId, Date.now(), server), server);

    // ----- Group settings -----
    case 'group-settings':
    case 'settings-preparing':
    case 'settings-rename':
    case 'settings-add':
    case 'settings-move':
    case 'settings-leave':
    case 'settings-moved':
    case 'settings-usage':
    case 'settings-archived-member':
    case 'settings-regenerate':
    case 'settings-avatar':
    case 'settings-report':
    case 'settings-report-other': {
      const variant: SeedVariant =
        state === 'settings-preparing'
          ? 'preparing'
          : state === 'settings-leave'
            ? 'unsent'
            : state === 'settings-archived-member'
              ? 'archived-member'
              : state === 'settings-usage'
                ? 'usage'
                : state === 'settings-moved' || state === 'settings-report-other'
                  ? 'moved'
                  : 'board';
      const seeded = await seedGroupSettings(s, variant, server);
      if (state === 'settings-report-other') {
        await s.infoCache.refresh(HOME_SERVER, infoOnly(HOME_SERVER_INFO_WITH_TERMS));
      }
      const params = new URLSearchParams();
      // The boards draw these scrolled: Server (after a move, usage) or Members (archived member) under the nav bar.
      const drawnY =
        state === 'settings-moved' || state === 'settings-usage'
          ? 920
          : state === 'settings-archived-member'
            ? 312
            : undefined;
      const y = options.y ?? drawnY;
      if (y !== undefined) params.set('y', String(y));
      if (state === 'settings-rename') {
        // Group settings, extra states: the name already changed, so Save is on.
        params.set('open', 'rename-group');
        params.set('value', 'Banff & Jasper 2026');
      }
      if (state === 'settings-add') {
        params.set('open', 'add');
        params.set('value', 'Alex');
      }
      if (state === 'settings-move') {
        params.set('open', 'move');
        params.set('value', 'https://home.example.net');
      }
      if (state === 'settings-leave') params.set('open', 'leave');
      if (state === 'settings-regenerate') {
        params.set('open', 'regenerate');
        params.set('member', 'Nathan');
      }
      if (state === 'settings-avatar') {
        params.set('open', 'avatar');
        params.set('member', 'Sam');
      }
      // ReportGroup, ReportGroupOther: the sheet over the top of Group settings.
      if (state === 'settings-report' || state === 'settings-report-other') {
        params.set('open', 'report');
      }
      if (state === 'settings-moved') params.set('movedFrom', server);
      const query = params.toString();
      return {
        steps: [
          replace(`/group/${q(seeded.localId)}`),
          push(`/group/${q(seeded.localId)}/settings${query === '' ? '' : `?${query}`}`, 400),
        ],
      };
    }

    // ----- Background refresh and notifications -----
    case 'task':
    case 'notify':
    case 'notify-quiet': {
      const seeded = await seedGroupSettings(s, 'board', server);
      return { steps: [], lines: [`Seeded Banff 2026 (${seeded.localId.slice(0, 8)}…)`] };
    }

    // ----- Add expense, Split, Settle -----
    default: {
      const banff = await seedBanff(s, server);
      await s.groupState.get(banff.localId);
      return { steps: sheetSteps(banff.localId, planFor(banff, state)) };
    }
  }
}

/** A Group scenario: written, then opened where its board is (a tab, the Done adding sheet, an expense). */
async function openScenario(
  s: AppServices,
  spec: Scenario,
  devServer: string,
): Promise<SeedResult> {
  const localId = await seedGroup(s, spec, devServer);
  const { tab, stuck, sheet, expenseId } = spec.open;
  const group = `/group/${q(localId)}`;
  if (expenseId !== undefined) {
    return { steps: [replace(group), push(`${group}/${q(expenseId)}`, 400)] };
  }
  const query = [tab && `tab=${tab}`, stuck && 'stuck=1', sheet && `sheet=${sheet}`]
    .filter(Boolean)
    .join('&');
  return {
    steps: [replace(`${group}${query ? `?${query}` : ''}`)],
    ...(spec.syncOnOpen ? { syncOnOpen: localId } : {}),
    ...(spec.shareOnOpen ? { shareOnOpen: { localId, name: spec.name } } : {}),
  };
}
