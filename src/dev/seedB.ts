/**
 * Dev seed for screen stack B (Group, Expense detail): the canvas's sample groups, written through the app's services
 * so every screen reads them exactly as it reads a synced group. Opened by `src/app/dev/seed-b.tsx`
 * (`com.appalaya.even://dev/seed-b?state=even`).
 *
 * Other members' events are staged the way a sync delivers them: sealed with the group key for the group's server
 * and inserted as `remote`, acknowledged rows; this device's own as `local`. Timestamps are chosen so the Activity
 * tab and Expense detail read like their boards ("Today 9:50 AM", "Sep 20, 9:14 pm"). Each group's secret is
 * derived from its seed key, so opening a state again replaces that group instead of adding another.
 *
 * Pure apart from `seedGroup`, which takes the services; Vitest checks the scenarios against the boards' numbers.
 */
import {
  deriveLocal,
  deriveServer,
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

import type { NewEventRow } from '../services/storage/types';
import type { AppServices } from '../state';

// ---------- Palette slots (src/theme/themes.ts avatarPalette order) ----------

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
      throw new Error(`seed-b: invalid ${payload.type} event`);
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

// ---------- Scenarios ----------

export type SeedState =
  | 'group'
  | 'balances'
  | 'activity'
  | 'unreadable'
  | 'syncing'
  | 'stale'
  | 'update'
  | 'closed'
  | 'moved'
  | 'alldone'
  | 'even'
  | 'archived'
  | 'many'
  | 'done-sheet'
  | 'new'
  | 'invite'
  | 'share'
  | 'expense';

export const SEED_STATES: readonly SeedState[] = [
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
  'archived',
  'many',
  'done-sheet',
  'new',
  'invite',
  'share',
  'expense',
];

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
}

/** A server nobody answers (a non-routable address): a sync hangs for the transport's 30 s timeout. */
const SILENT_SERVER = 'https://10.255.255.1';

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
function banffBase(myDevice: string, dinner: 'activity' | 'detail'): Banff {
  const log = new Log();
  const sam: SeedMember = { id: memberIdFor(VIOLET), name: 'Sam', dev: myDevice };
  const maya: SeedMember = { id: memberIdFor(CLAY), name: 'Maya', dev: newId() };
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
  overrides: Partial<Omit<Scenario, 'key' | 'me' | 'entries'>> = {},
): Scenario {
  return {
    key,
    name: 'Banff 2026',
    serverUrl: PROTOCOL.defaultServer,
    me: b.sam,
    entries: b.log.entries,
    acked: true,
    lastSyncedAt: now - 2 * MINUTE,
    lastSyncError: null,
    extraRows: [],
    open: {},
    syncOnOpen: false,
    shareOnOpen: false,
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
  overrides: Partial<Scenario> = {},
): Scenario {
  const b = banffBase(myDevice, 'activity');
  banffRecent(b, now);
  return scenario(key, b, now, overrides);
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

/** Group, just created: you and three pre-added names; nobody else has joined yet. */
function banffNew(myDevice: string, now: number): { log: Log; sam: SeedMember } {
  const log = new Log();
  const sam: SeedMember = { id: memberIdFor(VIOLET), name: 'Sam', dev: myDevice };
  const at = now - 5 * MINUTE;
  log.add(at, sam, { type: 'member.added', member: { id: sam.id, name: 'Sam' } });
  log.add(at, sam, { type: 'member.claimed', id: sam.id });
  log.add(at, sam, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  for (const [name, slot] of [
    ['Maya', CLAY],
    ['Jordan', OCHRE],
    ['Nathan', STEEL],
  ] as const) {
    log.add(at, sam, { type: 'member.added', member: { id: memberIdFor(slot), name } });
  }
  return { log, sam };
}

/** The scenario for a seed state. `myDevice` is this install's device id; `now` pins "Today". */
export function buildScenario(state: SeedState, myDevice: string, now: number): Scenario {
  switch (state) {
    case 'group':
    case 'balances':
    case 'activity':
      return banffMain('banff', myDevice, now, {
        open: state === 'group' ? {} : { tab: state, stuck: true },
      });
    case 'unreadable':
      return banffMain('banff-unreadable', myDevice, now, {
        extraRows: [junkRow('undecryptable'), junkRow('undecryptable')],
      });
    case 'syncing':
      return banffMain('banff-syncing', myDevice, now, {
        serverUrl: SILENT_SERVER,
        syncOnOpen: true,
      });
    case 'stale':
      return banffMain('banff-stale', myDevice, now, {
        lastSyncedAt: day(0, 14, 10, now),
        lastSyncError: 'network',
      });
    case 'update':
      return banffMain('banff-update', myDevice, now, {
        extraRows: [junkRow('unsupported_envelope')],
      });
    case 'closed': {
      const b = banffBase(myDevice, 'activity');
      banffRecent(b, now);
      b.log.add(day(0, 10, 30, now), b.maya, { type: 'group.closed', reason: 'rotated' });
      return scenario('banff-closed', b, now);
    }
    case 'moved': {
      const b = banffBase(myDevice, 'activity');
      banffRecent(b, now);
      b.log.add(day(0, 10, 30, now), b.maya, {
        type: 'group.moved',
        server: 'https://sync.example.net',
      });
      return scenario('banff-moved', b, now);
    }
    case 'alldone':
      return scenario('banff-alldone', banffAllDone(myDevice, now), now, {
        lastSyncedAt: now - 10_000,
      });
    case 'even': {
      const b = banffAllDone(myDevice, now);
      b.log.add(day(0, 10, 10, now), b.nathan, payment(b.nathan, b.maya, 12800, '2026-09-26'));
      b.log.add(day(0, 10, 12, now), b.sam, payment(b.sam, b.maya, 4400, '2026-09-26'));
      b.log.add(day(0, 10, 13, now), b.sam, payment(b.sam, b.jordan, 800, '2026-09-26'));
      return scenario('banff-even', b, now, { lastSyncedAt: now - 10_000 });
    }
    case 'archived':
      return scenario('banff-archived', banffArchived(myDevice, now), now, {
        lastSyncedAt: now - 10_000,
        open: { tab: 'activity' },
      });
    case 'many':
    case 'done-sheet':
      return {
        ...scenario('whistler', whistler(myDevice, now), now, { lastSyncedAt: now - 10_000 }),
        name: 'Whistler 2027',
        open: state === 'done-sheet' ? { sheet: 'done' } : {},
      };
    case 'new':
    case 'share':
    case 'invite':
      return scenario(
        state === 'invite' ? 'banff-invite' : 'banff-new',
        banffNew(myDevice, now),
        now,
        {
          acked: state !== 'invite',
          lastSyncedAt: state === 'invite' ? null : now - 10_000,
          shareOnOpen: state === 'share',
        },
      );
    case 'expense': {
      const b = banffBase(myDevice, 'detail');
      banffRecent(b, now);
      return scenario('banff-detail', b, now, { open: { expenseId: b.dinnerId } });
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
  bytes.set(utf8Encode(`even-dev-seed-b/${key}`.padEnd(32, '.').slice(0, 32)));
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

/** Writes a scenario's group (replacing an earlier seed of the same key). Returns its local id. */
export async function seedGroup(services: AppServices, spec: Scenario): Promise<string> {
  const { store, secrets, groups, groupState, deviceId } = services;
  const secret = seedSecret(spec.key);
  const { localId, encryptionKey } = deriveLocal(secret);
  if ((await store.getGroup(localId)) !== null) await groups.leaveGroup(localId);
  const { groupId } = deriveServer(secret, spec.serverUrl);
  const rows = [...sealRows(spec, encryptionKey, groupId, deviceId), ...spec.extraRows];
  const createdAt = Math.min(...spec.entries.map((e) => e.event.at));
  await secrets.setSecret(localId, secret, spec.serverUrl);
  await store.transaction(async (tx) => {
    await tx.upsertGroup({
      localId,
      serverUrl: spec.serverUrl,
      epoch: null,
      cursor: 0,
      myMemberId: spec.me.id,
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
