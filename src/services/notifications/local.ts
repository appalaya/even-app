/**
 * Local notifications for background refresh (design.md "Background refresh"), on expo-notifications:
 * - `scheduleActivityNotifications(results)`: after a background cycle, one notification per group for the new
 *   `ok` events other devices wrote (planned by activity.ts / coalesce.ts), posted at once; a newer one replaces
 *   the group's previous one and carries its count on while it is still showing;
 * - `ensureNotificationPermission()`: the contextual permission request (never at launch); a no-op once the OS has
 *   an answer. `askForNotificationsOnce()` is what the group screen calls the first time a group with more than one
 *   member is opened: it asks at most once per install (`prefs` row `notifications.asked`);
 * - `clearActivityNotification(localId)`: for the group screen, once its activity has been seen.
 *
 * "Last notified" per group (when, and how many events) is the `prefs` row `notifications.ledger`
 * (coalesce.ts `prefsLedger`): local group ids and counts only, nothing decrypted.
 */
import * as Notifications from 'expo-notifications';

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
  for (const plan of planned) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: plan.identifier,
        content: { title: plan.title, body: plan.body, data: { localId: plan.localId } },
        trigger: null,
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
  let current: Notifications.NotificationPermissionsStatus;
  try {
    current = await Notifications.getPermissionsAsync();
  } catch {
    return 'unavailable';
  }
  if (current.granted) return 'granted';
  if (current.status === 'denied' || !current.canAskAgain) return 'denied';
  return (services ?? (await openAppServices())).prefs.requestNotifications();
}

/**
 * The group screen's contextual ask: the first time a group with more than one member is opened on this install,
 * ask for notification permission (unless the OS already has an answer); never again after that. Resolves with the
 * status, or null when it had already asked.
 */
export async function askForNotificationsOnce(
  services?: AppServices,
): Promise<NotificationStatus | null> {
  const app = services ?? (await openAppServices());
  if (!(await app.prefs.claimNotificationAsk())) return null;
  return ensureNotificationPermission(app);
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
