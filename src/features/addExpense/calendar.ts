/**
 * Calendar arithmetic for the date sheet, on local calendar days as `YYYY-MM-DD`. Pure, so Vitest runs it.
 */

/** A local date as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** `iso` moved by `days` calendar days. */
export function shiftIso(iso: string, days: number): string {
  const d = parse(iso);
  return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/**
 * The weeks of a month (`YYYY-MM`), Sunday first as drawn: seven cells a week, `null` before the 1st and after
 * the last day.
 */
export function monthGrid(month: string): (string | null)[][] {
  const [y, m] = month.split('-').map((part) => Number.parseInt(part, 10)) as [number, number];
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(isoDay(new Date(y, m - 1, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "September 2026". */
export function monthTitle(month: string, locale?: string): string {
  const [y, m] = month.split('-').map((part) => Number.parseInt(part, 10)) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(y, m - 1, 1),
  );
}

/** The weekday letters, Sunday first ("S M T W T F S"). */
export function weekdayLetters(locale?: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  // 2026-09-06 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2026, 8, 6 + i)));
}
