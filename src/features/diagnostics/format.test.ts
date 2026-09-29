import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  appleIntelligence,
  categoryLabel,
  checkSummary,
  countOf,
  deviceLabel,
  diagnosticsSections,
  lastSyncedLabel,
  medianLine,
  modelLabel,
  modelName,
  modelStatus,
  NONE,
  outcomeLabel,
  percentOf,
  seconds,
  syncErrorLine,
  systemRow,
  unsentLabel,
} from './format';

const available = { status: 'available' } as const;
const off = (reason: string) => ({ status: 'unavailable', reason }) as const;
const NOW = new Date(2026, 8, 26, 15, 0).getTime();
const plain = (text: string) => text.replace(/ /g, ' ');

describe('diagnostics words', () => {
  it('words the model status as drawn, one wording per reason', () => {
    expect(modelStatus(available)).toBe('Available');
    expect(modelStatus(off('appleIntelligenceNotEnabled'))).toBe(
      'Unavailable: Apple Intelligence is off',
    );
    expect(modelStatus(off('deviceNotEligible'))).toBe("Unavailable: this device can't run it");
    expect(modelStatus(off('modelNotReady'))).toBe("Unavailable: the model isn't ready yet");
    for (const reason of ['osTooOld', 'frameworkMissing', 'notBuilt', 'checkFailed', 'unknown']) {
      expect(modelStatus(off(reason))).toBe("Unavailable: this device can't run it");
    }
    expect(modelStatus(null)).toBe("Unavailable: this device can't run it");
  });

  it('names the model while it can answer, a dash otherwise', () => {
    expect(modelName(available)).toBe('System language model');
    expect(modelName(off('appleIntelligenceNotEnabled'))).toBe(NONE);
    expect(modelName(null)).toBe('—');
  });

  it('says Apple Intelligence is on while the model is there or getting ready', () => {
    expect(appleIntelligence(available)).toBe('On');
    expect(appleIntelligence(off('modelNotReady'))).toBe('On');
    expect(appleIntelligence(off('appleIntelligenceNotEnabled'))).toBe('Off');
    expect(appleIntelligence(off('deviceNotEligible'))).toBe('Off');
    expect(appleIntelligence(null)).toBe('Off');
  });

  it('words the outcomes table: outcome, category, time, model', () => {
    expect(
      ['answered', 'none', 'timeout', 'refused', 'error'].map((o) => outcomeLabel(o as never)),
    ).toEqual(['Answered', 'No answer', 'Timed out', 'Refused', 'Error']);
    expect(categoryLabel('drinks')).toBe('🍻 Drinks');
    expect(categoryLabel('lodging')).toBe('🏨 Lodging');
    expect(categoryLabel('food')).toBe('🍽️ Food');
    expect(seconds(412)).toBe('0.4 s');
    expect(seconds(2000)).toBe('2.0 s');
    expect(seconds(0)).toBe('0.0 s');
    expect(seconds(12_345)).toBe('12.3 s');
    expect(seconds(-5)).toBe('0.0 s');
    expect(modelLabel('general')).toBe('general');
    expect(modelLabel('contentTagging')).toBe('tagging');
    expect(modelLabel(null)).toBe('—');
  });

  it("words the check's results as drawn", () => {
    expect(checkSummary(178, 221)).toBe('178 of 221 right, 81%');
    expect(checkSummary(0, 0)).toBe('0 of 0 right, 0%');
    expect(medianLine(412)).toBe('Median 0.4 s per title');
    expect(medianLine(null)).toBe('Median 0.0 s per title');
    expect(countOf(22, 24)).toBe('22 of 24');
    expect(countOf(37, 221)).toBe('37 of 221');
    expect(percentOf(22, 24)).toBe(92);
    expect(percentOf(5, 11)).toBe(45);
    expect(percentOf(9, 12)).toBe(75);
    expect(percentOf(1, 0)).toBe(0);
  });

  it('words a sync row: unsent, last synced, and the error line in the status line words', () => {
    expect(unsentLabel(0)).toBe('0 unsent');
    expect(unsentLabel(3)).toBe('3 unsent');
    expect(lastSyncedLabel(null, NOW)).toBe('Never synced');
    expect(lastSyncedLabel(NOW - 20_000, NOW)).toBe('Last synced just now');
    expect(lastSyncedLabel(NOW - 2 * 60_000, NOW)).toBe('Last synced 2 min ago');
    expect(lastSyncedLabel(NOW - 59 * 60_000, NOW)).toBe('Last synced 59 min ago');
    expect(lastSyncedLabel(NOW - 60 * 60_000, NOW)).toBe('Last synced 1 hr ago');
    expect(lastSyncedLabel(NOW - 23 * 3_600_000, NOW)).toBe('Last synced 23 hr ago');
    expect(lastSyncedLabel(NOW - 24 * 3_600_000, NOW)).toBe('Last synced 1 day ago');
    expect(lastSyncedLabel(NOW - 3 * 24 * 3_600_000, NOW)).toBe('Last synced 3 days ago');
    expect(lastSyncedLabel(NOW + 5_000, NOW)).toBe('Last synced just now');

    const sync = {
      syncing: false,
      lifecycle: 'active',
      lastSyncedAt: NOW - 60_000,
      lastSyncError: null,
    };
    expect(syncErrorLine(sync, NOW)).toBeNull();
    expect(syncErrorLine({ ...sync, syncing: true }, NOW)).toBeNull();
    expect(syncErrorLine({ ...sync, lastSyncedAt: null, lastSyncError: 'unauthorized' }, NOW)).toBe(
      "Can't reach this group's server.",
    );
    expect(syncErrorLine({ ...sync, lifecycle: 'blocked' }, NOW)).toBe(
      'This group is blocked on its server.',
    );
    expect(
      plain(
        syncErrorLine(
          {
            ...sync,
            lastSyncedAt: new Date(2026, 8, 26, 14, 10).getTime(),
            lastSyncError: 'network',
          },
          NOW,
          'en-US',
        ) ?? '',
      ),
    ).toBe('Not synced since 2:10 PM');
    // A cycle running does not hide the last error.
    expect(syncErrorLine({ ...sync, syncing: true, lastSyncError: 'unauthorized' }, NOW)).toBe(
      "Can't reach this group's server.",
    );
  });

  it('words This build from what Platform reports', () => {
    const ios = { os: 'ios', version: '27.0', constants: { interfaceIdiom: 'phone' } };
    expect(systemRow(ios)).toEqual({ label: 'iOS', value: '27.0' });
    expect(deviceLabel(ios)).toBe('iPhone');
    expect(deviceLabel({ ...ios, constants: { interfaceIdiom: 'pad' } })).toBe('iPad');
    const android = { os: 'android', version: 36, constants: { Release: '16', Model: 'Pixel 9' } };
    expect(systemRow(android)).toEqual({ label: 'Android', value: '16' });
    expect(deviceLabel(android)).toBe('Pixel 9');
    expect(systemRow({ ...android, constants: {} })).toEqual({ label: 'Android', value: '36' });
    expect(deviceLabel({ ...android, constants: {} })).toBe('Android');
  });
});

describe('which sections Diagnostics shows', () => {
  it('shows the model sections on iOS, Sync only with groups, This build always', () => {
    expect(diagnosticsSections('ios', 2)).toEqual(['model', 'check', 'sync', 'build']);
    expect(diagnosticsSections('ios', 0)).toEqual(['model', 'check', 'build']);
  });

  it('leaves out Category model and Check on this phone on Android, which has no on-device model', () => {
    expect(diagnosticsSections('android', 2)).toEqual(['sync', 'build']);
    expect(diagnosticsSections('android', 0)).toEqual(['build']);
  });
});

describe('what Diagnostics shows (a page meant to be screenshotted)', () => {
  it('reads no device id, server URL, secret, token or group id; the local id only as a key', () => {
    const screen = readFileSync(new URL('./DiagnosticsScreen.tsx', import.meta.url), 'utf8');
    expect(screen).not.toMatch(/deviceId|serverUrl|secret|authToken|groupId/i);
    expect(screen.match(/localId/g)).toEqual(
      screen.match(/key=\{row\.localId\}/g)?.map(() => 'localId'),
    );
  });
});
