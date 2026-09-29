/**
 * Diagnostics' words (AppDiagnostics, DiagnosticsStates): the model's status, the outcomes table, the check's
 * results, the sync rows and This build. Pure (no React Native), so Vitest runs it; the clock and the platform's
 * values are passed in.
 */
import { CATEGORY_EMOJI, CATEGORY_LABEL, type Category } from '@even/core';

import { statusLineWords, type StatusLineInput } from '@/features/group/format';
import type { ModelOutcome } from '@/state/categories';

import type { ClassifierAvailability } from '../../../modules/even-classifier/src/EvenClassifier.types';

/** A dash where there is nothing to say (no category, no model). */
export const NONE = '—';

/**
 * The Status row: "Available", or why not. Foundation Models' reasons have their own words; any other (an OS or a
 * build with no model, Android for now, a failed check) is a device that cannot run it.
 */
export function modelStatus(availability: ClassifierAvailability | null): string {
  if (availability?.status === 'available') return 'Available';
  switch (availability?.reason) {
    case 'appleIntelligenceNotEnabled':
      return 'Unavailable: Apple Intelligence is off';
    case 'modelNotReady':
      return "Unavailable: the model isn't ready yet";
    default:
      return "Unavailable: this device can't run it";
  }
}

/**
 * The Model row: the one model the app asks, Foundation Models' on-device system language model (both of its uses,
 * general and content tagging, are that model), while it can answer; a dash otherwise.
 */
export function modelName(availability: ClassifierAvailability | null): string {
  return availability?.status === 'available' ? 'System language model' : NONE;
}

/** This build → Apple Intelligence: on while the model is there or still getting ready. */
export function appleIntelligence(availability: ClassifierAvailability | null): 'On' | 'Off' {
  return availability?.status === 'available' || availability?.reason === 'modelNotReady'
    ? 'On'
    : 'Off';
}

const OUTCOME_WORDS: Readonly<Record<ModelOutcome, string>> = {
  answered: 'Answered',
  none: 'No answer',
  timeout: 'Timed out',
  refused: 'Refused',
  error: 'Error',
};

/** The Outcome column. */
export function outcomeLabel(outcome: ModelOutcome): string {
  return OUTCOME_WORDS[outcome];
}

/** A category as the tables write it: "🍻 Drinks". */
export function categoryLabel(category: Category): string {
  return `${CATEGORY_EMOJI[category]} ${CATEGORY_LABEL[category]}`;
}

/** The Model column: `general`, `tagging` for content tagging, a dash for none. */
export function modelLabel(model: string | null): string {
  if (model === null || model === '') return NONE;
  return model === 'contentTagging' ? 'tagging' : model;
}

/** Milliseconds as the tables write a time: "0.4 s", "2.0 s". */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** A whole percent of `total`; 0 of nothing is 0. */
export function percentOf(right: number, total: number): number {
  return total > 0 ? Math.round((right / total) * 100) : 0;
}

/** "22 of 24" (a category's row), "37 of 221" (the progress line). */
export function countOf(count: number, total: number): string {
  return `${count} of ${total}`;
}

/** The check's headline: "178 of 221 right, 81%". */
export function checkSummary(right: number, total: number): string {
  return `${countOf(right, total)} right, ${percentOf(right, total)}%`;
}

/** Under the headline: "Median 0.4 s per title". */
export function medianLine(medianMs: number | null): string {
  return `Median ${seconds(medianMs ?? 0)} per title`;
}

/** A sync row's count: "0 unsent". */
export function unsentLabel(count: number): string {
  return `${count} unsent`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A sync row's second line: "Last synced 2 min ago", "… 1 hr ago", "… 3 days ago", or "Never synced". */
export function lastSyncedLabel(lastSyncedAt: number | null, now: number): string {
  if (lastSyncedAt === null) return 'Never synced';
  const ago = Math.max(0, now - lastSyncedAt);
  if (ago < MINUTE) return 'Last synced just now';
  if (ago < HOUR) return `Last synced ${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `Last synced ${Math.floor(ago / HOUR)} hr ago`;
  const days = Math.floor(ago / DAY);
  return `Last synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * A sync row's error line, in the words Group's status line uses for it ("Can't reach this group's server.", "Not
 * synced since 2:10 PM"), or null when the last cycle had no error.
 */
export function syncErrorLine(sync: StatusLineInput, now: number, locale?: string): string | null {
  if (sync.lastSyncError === null && sync.lifecycle !== 'blocked') return null;
  return statusLineWords({ ...sync, syncing: false }, now, { locale }).label;
}

/** The device id, shortened to its first and last four characters: "d91f…Kq2e". */
export function shortDeviceId(id: string): string {
  return id.length <= 9 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** What React Native's `Platform` says about the phone (the fields This build reads). */
export interface PlatformFacts {
  os: string;
  /** `Platform.Version`: "27.0" on iOS, the API level on Android. */
  version: string | number;
  /** `Platform.constants`: `interfaceIdiom` on iOS; `Release`, `Brand`, `Model` on Android. */
  constants: Record<string, unknown>;
}

/** This build → the system row: "iOS" and "27.0"; "Android" and its release on Android. */
export function systemRow(platform: PlatformFacts): { label: string; value: string } {
  if (platform.os === 'ios') return { label: 'iOS', value: String(platform.version) };
  const release = platform.constants.Release;
  return {
    label: 'Android',
    value: typeof release === 'string' && release !== '' ? release : String(platform.version),
  };
}

/**
 * This build → Device: on iOS, React Native knows only the kind of device ("iPhone", "iPad"), not the model; on
 * Android, the model it reports.
 */
export function deviceLabel(platform: PlatformFacts): string {
  const c = platform.constants;
  if (platform.os === 'ios') return c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone';
  return typeof c.Model === 'string' && c.Model !== '' ? c.Model : 'Android';
}
