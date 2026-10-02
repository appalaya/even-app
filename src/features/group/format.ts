/**
 * Dates, times and the status line's words for the Group and Expense detail screens. Pure (no React Native), so
 * Vitest runs it; every function takes `now` and an optional locale so a test can pin both.
 *
 * Times are in the device locale's own format (every board: "9:14 PM", "Not synced since 2:10 PM" in en-US).
 */
import { notSyncedLabel } from '@/components/statusLineWords';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DATE_STYLES = {
  clock: { hour: 'numeric', minute: '2-digit' },
  day: { month: 'short', day: 'numeric' },
  dayYear: { month: 'short', day: 'numeric', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * One formatter per locale and style, built on first use (as core's `formatMinor` keeps its number formatters).
 * Building one costs about 50 times what formatting with it does, and Activity and Expenses format a time or a date
 * for every row on every render: thousands of them in a long-running group.
 */
function dateFormat(
  locale: string | undefined,
  style: keyof typeof DATE_STYLES,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${style}`;
  let format = dateFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, DATE_STYLES[style]);
    dateFormats.set(key, format);
  }
  return format;
}

/** "9:50 AM": the device locale's clock time. */
export function clockTime(ms: number, locale?: string): string {
  return dateFormat(locale, 'clock').format(ms);
}

/** "Sep 20"; "Sep 20, 2025" outside the current year. */
export function shortDate(ms: number, now: number, locale?: string): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return dateFormat(locale, sameYear ? 'day' : 'dayYear').format(ms);
}

/** An expense's `YYYY-MM-DD` as a local calendar day ("Sep 20"). */
export function isoDateLabel(iso: string, now: number, locale?: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return iso;
  return shortDate(new Date(y, m - 1, d).getTime(), now, locale);
}

/** "Sep 20, 9:14 PM" (Expense detail: the added-by line and History). */
export function dateTime(ms: number, now: number, locale?: string): string {
  return `${shortDate(ms, now, locale)}, ${clockTime(ms, locale)}`;
}

/** The Activity tab's section headers: "Today", "Yesterday", else "Sep 20". */
export function dayLabel(ms: number, now: number, locale?: string): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDate(ms, now, locale);
}

/** A key that groups timestamps by local calendar day. */
export function dayKey(ms: number): number {
  return startOfDay(ms);
}

/** The status line's words for the last successful sync: "Synced just now", "Synced 2 min ago". */
export function syncedLabel(lastSyncedAt: number, now: number, locale?: string): string {
  const ago = Math.max(0, now - lastSyncedAt);
  if (ago < 60_000) return 'Synced just now';
  if (ago < 60 * 60_000) return `Synced ${Math.floor(ago / 60_000)} min ago`;
  if (startOfDay(lastSyncedAt) === startOfDay(now)) {
    return `Synced at ${clockTime(lastSyncedAt, locale)}`;
  }
  return `Synced ${shortDate(lastSyncedAt, now, locale)}`;
}

/**
 * The time in "Not synced since 2:10 PM" (States; the kit's `notSyncedLabel` words the rest): the clock time when
 * it was today, else the day.
 */
export function staleSince(lastSyncedAt: number, now: number, locale?: string): string {
  return startOfDay(lastSyncedAt) === startOfDay(now)
    ? clockTime(lastSyncedAt, locale)
    : shortDate(lastSyncedAt, now, locale);
}

/** Errors the status line words on their own (design.md "Error handling"); the rest read "Not synced since …". */
const SYNC_ERROR_WORDS: Readonly<Record<string, string>> = {
  group_blocked: 'This group is blocked on its server.',
  not_an_even_server: "This group's server isn't an Even server.",
  unsupported_version: "This group's server needs an update.",
  unauthorized: "Can't reach this group's server.",
};

/** What the status line needs to know about a group's sync (`SyncStatus`). */
export interface StatusLineInput {
  syncing: boolean;
  /** `blocked` reads as the `group_blocked` error. */
  lifecycle: string;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
}

/**
 * The status line under Group's big number, as words: "Syncing…" while a cycle runs (or the glyph replays a turn);
 * an error with words of its own ("Can't reach this group's server."); after any other error, or before the first
 * sync, "Not synced since 2:10 PM" / "Not synced yet"; else "Synced 2 min ago".
 */
export function statusLineWords(
  sync: StatusLineInput,
  now: number,
  options: { replaying?: boolean; locale?: string } = {},
): { state: 'synced' | 'syncing' | 'stale'; label: string } {
  if (sync.syncing || options.replaying === true) return { state: 'syncing', label: 'Syncing…' };
  const error = sync.lifecycle === 'blocked' ? 'group_blocked' : sync.lastSyncError;
  if (error !== null) {
    const words = SYNC_ERROR_WORDS[error];
    if (words !== undefined) return { state: 'stale', label: words };
  }
  if (error !== null || sync.lastSyncedAt === null) {
    const label =
      sync.lastSyncedAt === null
        ? 'Not synced yet'
        : notSyncedLabel(staleSince(sync.lastSyncedAt, now, options.locale));
    return { state: 'stale', label };
  }
  return { state: 'synced', label: syncedLabel(sync.lastSyncedAt, now, options.locale) };
}

/** A device id's short form for the Activity tab ("7QX2"): its first four letters or digits, uppercased. */
export function deviceShort(dev: string): string {
  return dev
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase();
}
