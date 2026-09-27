/**
 * Background refresh notifications, the pure part (design.md "Background refresh"): after a background cycle, the
 * new `ok` events authored by another device become at most one local notification per group. Title: the group
 * name. Body: the event's activity summary ("Maya added Dinner · $90.00"), or "3 new in Banff 2026" when there are
 * several. No Expo imports, so this runs under Vitest in Node.
 */

/** One applied event, as the reducer's activity feed carries it. */
export interface ActivityLine {
  eventId: string;
  /** The device that wrote it. */
  dev: string;
  /** "Maya added Dinner · $90.00". */
  summary: string;
}

/** What is still showing for a group from an earlier background cycle (the ledger's entry, if the OS still shows it). */
export interface ShownNotification {
  /** How many events it announced. */
  count: number;
}

export interface GroupActivityInput {
  localId: string;
  groupName: string;
  /** This install: its own events are never announced. */
  deviceId: string;
  /** Every applied event of the group, in log order (`GroupState.activity`). */
  activity: readonly ActivityLine[];
  /** The ids this background cycle inserted with status `ok` (`SyncResult.newOkIds`). */
  newOkIds: readonly string[];
  /** The group's notification that is still showing, if any: the new one replaces it and carries its count on. */
  shown: ShownNotification | null;
}

export interface PlannedNotification {
  localId: string;
  /** One per group, so a newer notification replaces the older one instead of stacking. */
  identifier: string;
  title: string;
  body: string;
  /** Events announced, including those of the notification it replaces. */
  count: number;
}

/** The notification identifier for a group. */
export function activityIdentifier(localId: string): string {
  return `activity:${localId}`;
}

/** "3 new in Banff 2026". */
export function coalescedBody(count: number, groupName: string): string {
  return `${count} new in ${groupName}`;
}

/**
 * The notification for one group after one background cycle, or null when there is nothing to say:
 * - only events this cycle inserted count (a foreground sync's events were already on screen);
 * - events written by this device are skipped (a rotation or a restore can bring them back);
 * - a first download (every event of the log arrived in this cycle: a join whose first sync failed, a reinstall)
 *   is history, not activity, and announces nothing;
 * - a notification still showing for the group is replaced, its count carried into the new "N new in …".
 */
export function planGroupNotification(input: GroupActivityInput): PlannedNotification | null {
  const fresh = new Set(input.newOkIds);
  if (fresh.size === 0) return null;
  const arrived = input.activity.filter((line) => fresh.has(line.eventId));
  if (arrived.length === 0 || arrived.length === input.activity.length) return null;
  const others = arrived.filter((line) => line.dev !== input.deviceId && line.summary !== '');
  const first = others[0];
  if (first === undefined) return null;
  const count = others.length + (input.shown?.count ?? 0);
  return {
    localId: input.localId,
    identifier: activityIdentifier(input.localId),
    title: input.groupName,
    body: count === 1 ? first.summary : coalescedBody(count, input.groupName),
    count,
  };
}

// ---------- The ledger ("last notified", per group) ----------

export interface LedgerEntry {
  /** When the group's notification was last posted (unix ms). */
  at: number;
  /** How many events it announced. */
  count: number;
}

export type Ledger = Record<string, LedgerEntry>;

/** Where the ledger lives: the store's `prefs` table (`prefsLedger`), a Map in tests. */
export interface LedgerStore {
  read(): Promise<Ledger>;
  write(ledger: Ledger): Promise<void>;
}

/**
 * The ledger as one `prefs` row (`notifications.ledger`), JSON. Local, never synced; it holds local group ids and
 * counts only. An empty ledger clears the row.
 */
export function prefsLedger(prefs: {
  getPref(key: 'notifications.ledger'): Promise<string | null>;
  setPref(key: 'notifications.ledger', value: string | null): Promise<void>;
}): LedgerStore {
  return {
    read: async () => parseLedger(await prefs.getPref('notifications.ledger')),
    write: async (ledger) =>
      prefs.setPref(
        'notifications.ledger',
        Object.keys(ledger).length === 0 ? null : JSON.stringify(ledger),
      ),
  };
}

/** Parses the stored ledger; anything malformed reads as empty (the worst case is one notification too few). */
export function parseLedger(text: string | null): Ledger {
  if (text === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Ledger = {};
  for (const [localId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { at, count } = entry as { at?: unknown; count?: unknown };
    if (Number.isSafeInteger(at) && Number.isSafeInteger(count) && (count as number) > 0) {
      out[localId] = { at: at as number, count: count as number };
    }
  }
  return out;
}

/** The ledger after posting `planned` at `now`; groups that no longer exist on this phone are dropped. */
export function nextLedger(
  ledger: Ledger,
  planned: readonly PlannedNotification[],
  now: number,
  existing: ReadonlySet<string>,
): Ledger {
  const out: Ledger = {};
  for (const [localId, entry] of Object.entries(ledger)) {
    if (existing.has(localId)) out[localId] = entry;
  }
  for (const plan of planned) out[plan.localId] = { at: now, count: plan.count };
  return out;
}
