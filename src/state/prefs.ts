/**
 * Local preferences (the `prefs` table, never synced): the "me" default name and emoji prefilled on every join and
 * create, and Appearance. The Notifications switch is the OS permission itself (design.md "Background refresh":
 * "tied to the OS permission"), read and requested through an injected adapter so Node tests need no Expo module.
 */
import { isSingleEmoji, LIMITS } from '@even/core';

import type { Store } from '../services/storage/types';
import { StateError } from './errors';

export type Appearance = 'system' | 'light' | 'dark';
export type NotificationStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** The OS notification permission. The app binds expo-notifications; tests pass a fake. */
export interface NotificationPermission {
  status(): Promise<NotificationStatus>;
  /** Shows the OS prompt when it still can; resolves with the resulting status. */
  request(): Promise<NotificationStatus>;
}

export interface Prefs {
  /** Default member name for joins and creates; null until set. */
  name: string | null;
  /** Default member emoji; null means initials. */
  emoji: string | null;
  appearance: Appearance;
  notifications: NotificationStatus;
}

const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/** Length in Unicode code points, the unit every length rule counts. */
function codePoints(text: string): number {
  return [...text].length;
}

/** Trimmed, 1..LIMITS.nameMax code points (the member-name rule). */
export function normaliseName(name: string): string {
  const trimmed = name.trim();
  const length = codePoints(trimmed);
  if (length === 0 || length > LIMITS.nameMax) {
    throw new StateError('invalid', `a name is 1 to ${LIMITS.nameMax} characters`);
  }
  return trimmed;
}

export function checkEmoji(emoji: string): string {
  if (!isSingleEmoji(emoji)) throw new StateError('invalid', 'an avatar is exactly one emoji');
  return emoji;
}

export class PrefsService {
  private snapshot: Prefs | null = null;
  private readonly listeners = new Set<() => void>();
  private loading: Promise<Prefs> | null = null;

  constructor(
    private readonly store: Pick<Store, 'getPref' | 'setPref'>,
    private readonly notifications: NotificationPermission | null = null,
  ) {}

  peek(): Prefs | null {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.snapshot === null) void this.load().catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
    };
  }

  load(): Promise<Prefs> {
    if (this.loading !== null) return this.loading;
    const run = this.read()
      .then((prefs) => {
        this.publish(prefs);
        return prefs;
      })
      .finally(() => {
        this.loading = null;
      });
    this.loading = run;
    return run;
  }

  async setName(name: string | null): Promise<void> {
    await this.store.setPref('me.name', name === null ? null : normaliseName(name));
    await this.load();
  }

  async setEmoji(emoji: string | null): Promise<void> {
    await this.store.setPref('me.emoji', emoji === null ? null : checkEmoji(emoji));
    await this.load();
  }

  async setAppearance(appearance: Appearance): Promise<void> {
    if (!APPEARANCES.includes(appearance)) throw new StateError('invalid', 'unknown appearance');
    await this.store.setPref('appearance', appearance);
    await this.load();
  }

  /** Asks the OS for notification permission (contextually, never at launch). */
  async requestNotifications(): Promise<NotificationStatus> {
    const status = this.notifications === null ? 'unavailable' : await this.notifications.request();
    await this.load();
    return status;
  }

  /** Remembers the name and emoji first used for a group, if no default is set yet. */
  async seedMe(name: string, emoji: string | undefined): Promise<void> {
    if ((await this.store.getPref('me.name')) !== null) return;
    await this.store.setPref('me.name', normaliseName(name));
    if (emoji !== undefined && (await this.store.getPref('me.emoji')) === null) {
      await this.store.setPref('me.emoji', checkEmoji(emoji));
    }
    await this.load();
  }

  private async read(): Promise<Prefs> {
    const [name, emoji, appearance] = await Promise.all([
      this.store.getPref('me.name'),
      this.store.getPref('me.emoji'),
      this.store.getPref('appearance'),
    ]);
    let notifications: NotificationStatus = 'unavailable';
    if (this.notifications !== null) {
      try {
        notifications = await this.notifications.status();
      } catch {
        notifications = 'unavailable';
      }
    }
    return {
      name,
      emoji: emoji !== null && isSingleEmoji(emoji) ? emoji : null,
      appearance: APPEARANCES.includes(appearance as Appearance)
        ? (appearance as Appearance)
        : 'system',
      notifications,
    };
  }

  private publish(prefs: Prefs): void {
    this.snapshot = prefs;
    for (const listener of [...this.listeners]) listener();
  }
}
