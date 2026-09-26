import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useRef, useState } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';

import { AppText, Screen } from '@/components';
import { arriveFromMaya, seedGroupSettings, type SeedVariant } from '@/dev/seedD';
import {
  BACKGROUND_REFRESH_TASK,
  registerBackgroundRefresh,
  runBackgroundRefresh,
} from '@/services/background/task';
import {
  ensureNotificationPermission,
  scheduleActivityNotifications,
} from '@/services/notifications/local';
import { useApp } from '@/state';

/**
 * Dev-only entry for screen stack D: seeds the GroupSettings board's "Banff 2026" (src/dev/seedD.ts) and opens
 * `/group/<id>/settings`, e.g. `even://dev/seed-d`.
 *
 * Parameters: `variant` (`board` | `preparing`); `y`, `open`, `member`, `value` pass through to the settings route
 * (scroll offset, a sheet to open, its member, a value to submit); `stay=1` stays here instead. `task=1` checks the
 * background task (defined, OS status, registration, the debug trigger) and runs its body once; `notify=1` asks for
 * notification permission, stages an expense from Maya's phone and posts the notification a background cycle would
 * (`notify=quiet` asks for provisional permission instead, which the simulator grants without a prompt).
 */
export default function SeedDRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <SeedD />;
}

type Params = {
  variant?: SeedVariant;
  stay?: string;
  task?: string;
  notify?: string;
  y?: string;
  open?: string;
  member?: string;
  value?: string;
};

function SeedD() {
  const services = useApp();
  const params = useLocalSearchParams<Params>();
  const [lines, setLines] = useState<string[]>(['Seeding…']);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // No LogBox toasts over the screenshots this route exists for.
    LogBox.ignoreAllLogs(true);
    const log = (line: string) => {
      console.log(`[seed-d] ${line}`);
      setLines((current) => [...current, line]);
    };
    void (async () => {
      const seeded = await seedGroupSettings(services, params.variant ?? 'board');
      log(`Seeded Banff 2026 (${seeded.localId.slice(0, 8)}…)`);

      if (params.task === '1') {
        log(`Task defined: ${TaskManager.isTaskDefined(BACKGROUND_REFRESH_TASK)}`);
        const status = await BackgroundTask.getStatusAsync();
        log(`OS status: ${BackgroundTask.BackgroundTaskStatus[status]}`);
        log(`Register: ${await registerBackgroundRefresh()}`);
        log(`Registered: ${await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK)}`);
        try {
          log(`Debug trigger: ${String(await BackgroundTask.triggerTaskWorkerForTestingAsync())}`);
        } catch (error) {
          log(`Debug trigger failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const run = await runBackgroundRefresh(services);
        log(
          `Task body ran: ${run.results.map((r) => `${r.outcome}${r.outcome === 'failed' ? ` (${r.error})` : r.outcome === 'skipped' ? ` (${r.reason})` : ''}`).join(', ') || 'no groups'}; notified ${run.notified.length}`,
        );
      }

      if (params.notify === '1' || params.notify === 'quiet') {
        // Shown while the app is open too, so the simulator can show it without backgrounding the app.
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
        if (params.notify === 'quiet') {
          // The simulator cannot answer the OS prompt headless: provisional permission needs none.
          const quiet = await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowProvisional: true },
          });
          log(`Permission (provisional): ios status ${String(quiet.ios?.status)}`);
        } else {
          log(`Permission: ${await ensureNotificationPermission(services)}`);
        }
        const arrived = await arriveFromMaya(services, seeded);
        const posted = await scheduleActivityNotifications([arrived], { services });
        log(`Posted: ${posted.map((p) => `${p.title} / ${p.body}`).join('; ') || 'nothing'}`);
        const shown = await Notifications.getPresentedNotificationsAsync();
        log(
          `In Notification Center: ${shown.map((n) => `${n.request.content.title} / ${n.request.content.body}`).join('; ') || 'nothing'}`,
        );
      }

      if (params.stay === '1' || params.task !== undefined || params.notify !== undefined) return;
      const pass: Record<string, string> = {};
      for (const key of ['y', 'open', 'member', 'value'] as const) {
        const value = params[key];
        if (value !== undefined) pass[key] = value;
      }
      router.replace({
        pathname: '/group/[id]/settings',
        params: { id: seeded.localId, ...pass },
      });
    })().catch((error: unknown) => {
      log(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [services, params]);

  return (
    <Screen largeTitle="Seed D">
      <View style={styles.lines}>
        {lines.map((line, i) => (
          <AppText key={i} variant="subheadLoose">
            {line}
          </AppText>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lines: { paddingHorizontal: 20, gap: 8 },
});
