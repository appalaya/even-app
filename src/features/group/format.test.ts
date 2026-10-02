import { describe, expect, it } from 'vitest';

import {
  clockTime,
  dateTime,
  dayLabel,
  deviceShort,
  isoDateLabel,
  staleSince,
  statusLineWords,
  syncedLabel,
} from './format';

const NOW = new Date(2026, 8, 26, 15, 0).getTime();
const at = (d: number, hh: number, mm: number) => new Date(2026, 8, d, hh, mm).getTime();
const plain = (text: string) => text.replace(/ /g, ' ');

describe('group formats', () => {
  it('words times in the device locale, as every board now does ("9:14 PM")', () => {
    expect(plain(clockTime(at(26, 9, 50), 'en-US'))).toBe('9:50 AM');
    expect(plain(clockTime(at(20, 21, 14), 'en-US'))).toBe('9:14 PM');
    expect(plain(dateTime(at(20, 21, 14), NOW, 'en-US'))).toBe('Sep 20, 9:14 PM');
    expect(plain(clockTime(at(20, 21, 14), 'en-GB'))).toBe('21:14');
    expect(isoDateLabel('2026-09-20', NOW, 'en-US')).toBe('Sep 20');
    expect(isoDateLabel('2025-09-20', NOW, 'en-US')).toBe('Sep 20, 2025');
  });

  it('labels Activity days', () => {
    expect(dayLabel(at(26, 9, 50), NOW, 'en-US')).toBe('Today');
    expect(dayLabel(at(25, 18, 30), NOW, 'en-US')).toBe('Yesterday');
    expect(dayLabel(at(20, 20, 47), NOW, 'en-US')).toBe('Sep 20');
  });

  it('words the status line', () => {
    expect(syncedLabel(NOW - 20_000, NOW)).toBe('Synced just now');
    expect(syncedLabel(NOW - 2 * 60_000, NOW)).toBe('Synced 2 min ago');
    expect(plain(syncedLabel(at(26, 10, 5), NOW, 'en-US'))).toBe('Synced at 10:05 AM');
    expect(syncedLabel(at(24, 10, 5), NOW, 'en-US')).toBe('Synced Sep 24');
    expect(plain(staleSince(at(26, 14, 10), NOW, 'en-US'))).toBe('2:10 PM');
  });

  it("words Group's status line from a group's sync status", () => {
    const sync = (extra: Partial<Parameters<typeof statusLineWords>[0]>) => ({
      syncing: false,
      lifecycle: 'active',
      lastSyncedAt: NOW - 2 * 60_000,
      lastSyncError: null,
      ...extra,
    });
    expect(statusLineWords(sync({}), NOW)).toEqual({ state: 'synced', label: 'Synced 2 min ago' });
    expect(statusLineWords(sync({ syncing: true }), NOW)).toEqual({
      state: 'syncing',
      label: 'Syncing…',
    });
    expect(statusLineWords(sync({}), NOW, { replaying: true }).label).toBe('Syncing…');
    expect(statusLineWords(sync({ lastSyncError: 'unauthorized' }), NOW)).toEqual({
      state: 'stale',
      label: "Can't reach this group's server.",
    });
    expect(statusLineWords(sync({ lifecycle: 'blocked' }), NOW).label).toBe(
      'This group is blocked on its server.',
    );
    expect(statusLineWords(sync({ lastSyncError: 'not_an_even_server' }), NOW).label).toBe(
      "This group's server isn't an Even server.",
    );
    expect(statusLineWords(sync({ lastSyncError: 'unsupported_version' }), NOW).label).toBe(
      "This group's server needs an update.",
    );
    expect(
      plain(
        statusLineWords(sync({ lastSyncError: 'network', lastSyncedAt: at(26, 14, 10) }), NOW, {
          locale: 'en-US',
        }).label,
      ),
    ).toBe('Not synced since 2:10 PM');
    expect(statusLineWords(sync({ lastSyncedAt: null }), NOW)).toEqual({
      state: 'stale',
      label: 'Not synced yet',
    });
    expect(statusLineWords(sync({ lastSyncedAt: null, lastSyncError: 'network' }), NOW).label).toBe(
      'Not synced yet',
    );
  });

  it('shortens a device id', () => {
    expect(deviceShort('7qx2AbCdEfGhIjKlMnOpQr')).toBe('7QX2');
    expect(deviceShort('-_k2pdXXXXXXXXXXXXXXXX')).toBe('K2PD');
  });
});

describe('date formatters', () => {
  it('reads the same as a fresh Intl.DateTimeFormat, per locale and style', () => {
    const times = [at(26, 9, 50), at(20, 21, 14), new Date(2025, 0, 3, 0, 5).getTime()];
    for (const locale of ['en-US', 'en-GB', 'de-DE', 'ja-JP', undefined]) {
      for (const ms of times) {
        const fresh = new Intl.DateTimeFormat(locale, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(ms);
        expect(clockTime(ms, locale)).toBe(fresh);
        const sameYear = new Date(ms).getFullYear() === new Date(NOW).getFullYear();
        const day = new Intl.DateTimeFormat(locale, {
          month: 'short',
          day: 'numeric',
          ...(sameYear ? {} : { year: 'numeric' }),
        }).format(ms);
        expect(dateTime(ms, NOW, locale)).toBe(`${day}, ${fresh}`);
      }
    }
  });

  it('formats a long Activity list without building a formatter per row', () => {
    const start = performance.now();
    for (let i = 0; i < 30_000; i += 1) clockTime(NOW + i * 60_000, 'en-US');
    // About 10 ms; a new formatter per call took about 400 ms here.
    expect(performance.now() - start).toBeLessThan(150);
  });
});
