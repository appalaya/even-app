/**
 * Local preferences (the `prefs` table, never synced): the "me" default name and emoji prefilled on every join and
 * create, and Appearance. The Notifications switch is the OS permission itself (design.md "Background refresh":
 * "tied to the OS permission"), read and requested through an injected adapter so Node tests need no Expo module;
 * the one thing the app adds is a prompt closed with no answer, which the OS does not count as one.
 */
import { hasBidiControl, isSingleEmoji, LIMITS } from '@even/core';

import type { Store } from '../services/storage/types';
import { StateError } from './errors';

export type Appearance = 'system' | 'light' | 'dark';
export type NotificationStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** What expo-notifications answers (`getPermissionsAsync`, `requestPermissionsAsync`): the fields the app reads. */
export interface PermissionReading {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/**
 * How many prompts in a row may close with no answer before the app stops asking: the group screen asks no more and
 * the switch sends people to the Settings app. The first prompt and one more.
 */
export const UNANSWERED_PROMPT_LIMIT = 2;

/**
 * What expo-notifications answers, as the Notifications switch reads it. iOS reports a permission it never asked for
 * as `undetermined`; Android 13 and later report it as `denied` with `canAskAgain`, and still do after one refusal,
 * when the OS will show its prompt again. Either way the app may ask, so both read as undetermined; `denied` is only a
 * refusal the OS will not ask about again (on iOS every refusal).
 *
 * `unanswered` is how many prompts in a row closed with no answer (`promptWentUnanswered`). Android records no
 * decision for those, so while it is below the limit "denied, can't ask again" also reads as undetermined.
 */
export function notificationStatusOf(
  response: PermissionReading,
  unanswered = 0,
): NotificationStatus {
  if (response.granted) return 'granted';
  if (response.status !== 'denied' || response.canAskAgain) return 'undetermined';
  return unanswered > 0 && unanswered < UNANSWERED_PROMPT_LIMIT ? 'undetermined' : 'denied';
}

/**
 * Whether the prompt just shown closed with no answer. Android 13 and later let people close it with Back or a tap
 * outside, and record no decision then: the OS shows the prompt again next time. expo-notifications reads that close
 * as a permanent refusal all the same (`denied`, `canAskAgain` false: Android's rationale flag is off both before a
 * first answer and after a final refusal, and expo marks the permission asked before the prompt shows). Only a first
 * "Don't allow" reads differently (`denied`, `canAskAgain`). So right after a prompt, "denied, can't ask again" counts
 * as no answer; when it really was a final refusal, the next ask shows nothing and costs nothing. iOS's prompt cannot
 * be closed without an answer.
 */
export function promptWentUnanswered(after: PermissionReading, dismissible: boolean): boolean {
  return dismissible && !after.granted && after.status === 'denied' && !after.canAskAgain;
}

/**
 * Whether the group screen's contextual ask is due: the first time, and again while the last prompt closed with no
 * answer and the limit is not reached. Never after an answer, whoever asked (design.md "Background refresh").
 */
export function contextualAskDue(asked: boolean, unanswered: number): boolean {
  if (!asked) return true;
  return unanswered > 0 && unanswered < UNANSWERED_PROMPT_LIMIT;
}

/** The OS notification permission. The app binds expo-notifications; tests pass a fake. */
export interface NotificationPermission {
  /** True where the OS prompt can close with no answer: Android 13 and later (Back, or a tap outside). */
  readonly dismissible: boolean;
  status(): Promise<PermissionReading>;
  /** Shows the OS prompt when it still can; resolves with the reading after it. */
  request(): Promise<PermissionReading>;
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
  if (hasBidiControl(trimmed)) {
    throw new StateError('invalid', 'a name cannot hold a text-direction control character');
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

  /** The Notifications switch's reading: the OS permission, a prompt closed with no answer read as not asked yet. */
  async notificationStatus(): Promise<NotificationStatus> {
    if (this.notifications === null) return 'unavailable';
    const unanswered = await this.unansweredPrompts();
    try {
      return notificationStatusOf(await this.notifications.status(), unanswered);
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Asks the OS for notification permission (contextually, never at launch), and records the ask and whether the
   * prompt closed with no answer.
   */
  async requestNotifications(): Promise<NotificationStatus> {
    if (this.notifications === null) {
      await this.load();
      return 'unavailable';
    }
    const after = await this.notifications.request();
    const unanswered = promptWentUnanswered(after, this.notifications.dismissible)
      ? (await this.unansweredPrompts()) + 1
      : 0;
    await this.store.setPref(
      'notifications.unanswered',
      unanswered === 0 ? null : String(unanswered),
    );
    await this.store.setPref('notifications.asked', '1');
    await this.load();
    return notificationStatusOf(after, unanswered);
  }

  /** Asks when the switch would (the OS can still show its prompt); otherwise only reads the status back. */
  async ensureNotifications(): Promise<NotificationStatus> {
    const status = await this.notificationStatus();
    if (status !== 'undetermined') return status;
    return this.requestNotifications();
  }

  /**
   * The group screen's contextual ask (design.md "Background refresh": the first time a group with more than one
   * member is opened). Asks when `claimNotificationAsk` says it is due; resolves with the status, or null when not.
   */
  async askForNotificationsInContext(): Promise<NotificationStatus | null> {
    if (!(await this.claimNotificationAsk())) return null;
    return this.ensureNotifications();
  }

  /**
   * True when the contextual ask is due (`contextualAskDue`): the first time on this install, and again after a
   * prompt that closed with no answer, up to the limit. Records the ask; false once someone has answered.
   */
  async claimNotificationAsk(): Promise<boolean> {
    const asked = (await this.store.getPref('notifications.asked')) !== null;
    if (!contextualAskDue(asked, await this.unansweredPrompts())) return false;
    await this.store.setPref('notifications.asked', '1');
    return true;
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
    const notifications = await this.notificationStatus();
    return {
      name,
      emoji: emoji !== null && isSingleEmoji(emoji) ? emoji : null,
      appearance: APPEARANCES.includes(appearance as Appearance)
        ? (appearance as Appearance)
        : 'system',
      notifications,
    };
  }

  /** `notifications.unanswered`: prompts in a row closed with no answer; 0 when absent or unreadable. */
  private async unansweredPrompts(): Promise<number> {
    const count = Number(await this.store.getPref('notifications.unanswered'));
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  }

  private publish(prefs: Prefs): void {
    this.snapshot = prefs;
    for (const listener of [...this.listeners]) listener();
  }
}
