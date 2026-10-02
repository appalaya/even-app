/**
 * The background refresh task (design.md "Background refresh"), on expo-background-task: one task that runs the
 * sync cycle for `active` groups with an event dated within the last 30 days, pending server-copy deletes first,
 * with no new group or debt started after 25 s (`AppServices.backgroundRefresh`, i.e. the engine's
 * `syncAll({ trigger: 'background', deadline })`, which applies the 30-day window itself), then posts the local
 * notifications the cycle earned.
 *
 * `TaskManager.defineTask` must run when the JS bundle loads, before the OS asks for the task, so the app's entry
 * (index.js) imports this module for its side effect, ahead of Expo Router: a headless start (Android's WorkManager
 * waking a killed process) evaluates the entry but never the root layout. The root layout calls
 * `registerBackgroundRefresh()` once the app is up. iOS decides when (and whether) the task runs; it never runs after
 * a force-quit, and the simulator refuses background tasks altogether (`BackgroundTaskStatus.Restricted`).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { describeForLog } from '../../state/errors';
import { openAppServices } from '../../state/openAppServices';
import type { AppServices } from '../../state/services';
import type { SyncResult } from '../sync/types';
import { scheduleActivityNotifications } from '../notifications/local';
import type { PlannedNotification } from '../notifications/coalesce';

export const BACKGROUND_REFRESH_TASK = 'even.background-refresh';

/** iOS treats this as a floor, not a schedule; Android's own floor is 15 minutes. */
const MINIMUM_INTERVAL_MINUTES = 15;

export interface BackgroundRun {
  results: SyncResult[];
  notified: PlannedNotification[];
}

/** The task's body: one background cycle, then its notifications. Exported so a dev screen can run it directly. */
export async function runBackgroundRefresh(services?: AppServices): Promise<BackgroundRun> {
  const app = services ?? (await openAppServices());
  const results = await app.backgroundRefresh();
  // Lifecycle work the cycle started (a closure, a rotation's recognition) settles before the OS suspends us.
  await app.idle();
  const notified = await scheduleActivityNotifications(results, { services: app });
  return { results, notified };
}

if (!TaskManager.isTaskDefined(BACKGROUND_REFRESH_TASK)) {
  TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
    try {
      await runBackgroundRefresh();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.warn('background: refresh failed', describeForLog(error));
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export type RegistrationResult =
  /** Registered now or earlier. */
  | 'registered'
  /** The OS does not allow background tasks here (the simulator, Background App Refresh off). */
  | 'restricted'
  | 'failed';

/** Registers the task with the OS (idempotent). Never throws. */
export async function registerBackgroundRefresh(): Promise<RegistrationResult> {
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) {
      return 'restricted';
    }
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
    }
    return 'registered';
  } catch (error) {
    console.warn('background: could not register', describeForLog(error));
    return 'failed';
  }
}
