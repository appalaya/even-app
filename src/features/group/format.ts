/**
 * Dates, times and the status line's words for the Group and Expense detail screens. Pure (no React Native), so
 * Vitest runs it; every function takes `now` and an optional locale so a test can pin both.
 *
 * Times are in the device locale's own format (every board: "9:14 PM", "Not synced since 2:10 PM" in en-US).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "9:50 AM": the device locale's clock time. */
export function clockTime(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms);
}

/** "Sep 20"; "Sep 20, 2025" outside the current year. */
export function shortDate(ms: number, now: number, locale?: string): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(ms);
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

/** A device id's short form for the Activity tab ("7QX2"): its first four letters or digits, uppercased. */
export function deviceShort(dev: string): string {
  return dev
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase();
}
