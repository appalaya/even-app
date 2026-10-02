/**
 * Local notifications for background refresh (design.md "Background refresh"), on expo-notifications:
 * - `scheduleActivityNotifications(results)`: after a background cycle, one notification per group for the new
 *   `ok` events other devices wrote (planned by activity.ts / coalesce.ts), posted at once; a newer one replaces
 *   the group's previous one and carries its count on while it is still showing;
 * - `ensureNotificationPermission()`: the contextual permission request (never at launch); a no-op once the OS has
 *   an answer. `askForNotificationsInContext()` is what the group screen calls when a group with more than one
 *   member is opened: it asks the first time on this install (`prefs` row `notifications.asked`), and again only
 *   while the last prompt closed with no answer, up to a limit (`notifications.unanswered`, state/prefs.ts);
 * - `clearActivityNotification(localId)`: for the group screen, once its activity has been seen;
 * - `ensureActivityChannel()`: Android's "Group activity" channel, which every activity notification is posted in.
 *
 * "Last notified" per group (when, and how many events) is the `prefs` row `notifications.ledger`
 * (coalesce.ts `prefsLedger`): local group ids and counts only, nothing decrypted.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { describeForLog } from '../../state/errors';
import { openAppServices } from '../../state/openAppServices';
import type { AppServices } from '../../state/services';
import type { NotificationStatus } from '../../state/prefs';
import type { SyncResult } from '../sync/types';
import { planActivityNotifications } from './activity';
import {
  activityIdentifier,
  nextLedger,
  prefsLedger,
  type LedgerStore,
  type PlannedNotification,
} from './coalesce';

/**
 * Android shows each notification channel by name in Settings › Apps › Even › Notifications, where people can turn it
 * off. Even posts one kind of notification, a group's new activity, so it has one channel. Without it
 * expo-notifications posts to its fallback channel, "Miscellaneous". The channel is delivered the way that fallback
 * was (high importance: a sound and a heads-up banner, badge and vibration on), so only the name changes. An app can
 * lower a channel's importance later but never raise it. iOS has no channels.
 */
export const ACTIVITY_CHANNEL = {
  id: 'group-activity',
  name: 'Group activity',
  description: 'New expenses and payments in your groups.',
} as const;

let activityChannel: Promise<void> | null = null;

/**
 * Creates (once per process) Android's "Group activity" channel; a no-op on iOS. The root layout calls it at launch,
 * so the channel is listed from the first run, and the background task calls it before posting, since Android can
 * run the task without the app's screens. Creating a channel asks for nothing. Never throws.
 */
export function ensureActivityChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  activityChannel ??= Notifications.setNotificationChannelAsync(ACTIVITY_CHANNEL.id, {
    name: ACTIVITY_CHANNEL.name,
    description: ACTIVITY_CHANNEL.description,
    importance: AndroidImportance.HIGH,
    showBadge: true,
    enableVibrate: true,
  }).then(
    () => undefined,
    (error: unknown) => {
      activityChannel = null;
      console.warn('notifications: could not create the channel', describeForLog(error));
    },
  );
  return activityChannel;
}

/** expo-notifications' `IosAuthorizationStatus.PROVISIONAL`. */
const IOS_PROVISIONAL = 3;

/** Granted, or provisional on iOS (delivered quietly to Notification Center). */
async function permitted(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return settings.granted || settings.ios?.status === IOS_PROVISIONAL;
  } catch {
    return false;
  }
}

async function shownIdentifiers(): Promise<Set<string>> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return new Set(presented.map((n) => n.request.identifier));
  } catch {
    return new Set();
  }
}

export interface ScheduleOptions {
  /** Defaults to the process's services (the background task opens them). */
  services?: AppServices;
  ledger?: LedgerStore;
}

/**
 * Posts the notifications a background cycle earned. Returns what was posted. Without the OS permission nothing is
 * posted (the user said no, or has not been asked yet) and nothing is recorded.
 */
export async function scheduleActivityNotifications(
  results: readonly SyncResult[],
  options: ScheduleOptions = {},
): Promise<PlannedNotification[]> {
  if (!results.some((r) => r.outcome === 'synced' && r.newOkIds.length > 0)) return [];
  if (!(await permitted())) return [];
  const services = options.services ?? (await openAppServices());
  const ledger = options.ledger ?? prefsLedger(services.store);
  const recorded = await ledger.read();
  const showing = await shownIdentifiers();
  const planned = await planActivityNotifications(services, results, (localId) => {
    const entry = recorded[localId];
    return entry !== undefined && showing.has(activityIdentifier(localId)) ? entry : null;
  });
  const posted: PlannedNotification[] = [];
  if (planned.length > 0) await ensureActivityChannel();
  for (const plan of planned) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: plan.identifier,
        content: { title: plan.title, body: plan.body, data: { localId: plan.localId } },
        // Posted now, in the "Group activity" channel on Android (expo-notifications takes the channel on the
        // trigger; iOS reads this as "now").
        trigger: { channelId: ACTIVITY_CHANNEL.id },
      });
      posted.push(plan);
    } catch {
      // One group's failure (a revoked permission mid-run) does not stop the others.
    }
  }
  const existing = new Set((await services.store.listGroups()).map((row) => row.localId));
  await ledger.write(nextLedger(recorded, posted, Date.now(), existing));
  return posted;
}

/**
 * Asks for notification permission the first time it matters (the user opened a group with more than one member),
 * through App settings' preference service so its Notifications switch updates. Once the OS has an answer this
 * only reads it back: iOS shows its prompt once per install.
 */
export async function ensureNotificationPermission(
  services?: AppServices,
): Promise<NotificationStatus> {
  return (services ?? (await openAppServices())).prefs.ensureNotifications();
}

/**
 * The group screen's contextual ask: the first time a group with more than one member is opened on this install,
 * ask for notification permission (unless the OS already has an answer). Never again after an answer; a prompt
 * closed with no answer (Android's Back, or a tap outside) is asked again at the next such open, up to a limit
 * (state/prefs.ts `contextualAskDue`). Resolves with the status, or null when no ask was due.
 */
export async function askForNotificationsInContext(
  services?: AppServices,
): Promise<NotificationStatus | null> {
  return (services ?? (await openAppServices())).prefs.askForNotificationsInContext();
}

/** Removes a group's activity notification and forgets its count (the group screen calls this when it opens). */
export async function clearActivityNotification(
  localId: string,
  services?: AppServices,
  ledger?: LedgerStore,
): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(activityIdentifier(localId));
  } catch {
    // Nothing showing.
  }
  const store = ledger ?? prefsLedger((services ?? (await openAppServices())).store);
  const recorded = await store.read();
  if (recorded[localId] === undefined) return;
  const { [localId]: _cleared, ...rest } = recorded;
  await store.write(rest);
}
