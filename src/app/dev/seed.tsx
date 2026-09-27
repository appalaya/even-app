/**
 * Dev only: seeds the canvas's data for one screen or state and opens it, for simulator screenshots
 * (`even://dev/seed?state=<state>`; `SEED_STATES` in src/dev/seed.ts lists them). Parameters: `state`, `emoji` (App
 * settings' avatar), `t` (hold the empty-state motion at this time, ms), `y` (Group settings' scroll offset).
 * `task`, `notify` and `notify-quiet` stay here and log what the background task and a notification did.
 * Production builds redirect home.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LogBox, StyleSheet, View } from 'react-native';

import { AppText, Screen } from '@/components';
import {
  arriveFromMaya,
  flaggedPreview,
  isSeedState,
  seed,
  seedGroupSettings,
  type SeedResult,
} from '@/dev/seed';
import { ExpenseDetailView } from '@/features/expense/ExpenseDetailView';
import { flagOf } from '@/features/expense/model';
import { useNow } from '@/features/group/hooks';
import { shareInvite } from '@/features/group/InviteCard';
import { resetRecoveryOffer, suppressRecoveryOffer } from '@/features/groups/useKeychainRecovery';
import {
  BACKGROUND_REFRESH_TASK,
  registerBackgroundRefresh,
  runBackgroundRefresh,
} from '@/services/background/task';
import {
  ensureNotificationPermission,
  scheduleActivityNotifications,
} from '@/services/notifications/local';
import { useApp, type AppServices } from '@/state';
import { layout } from '@/theme';

export default function SeedRoute() {
  const { state } = useLocalSearchParams<{ state?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (state === 'expense-flagged') return <FlaggedPreview />;
  return <Seeder />;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Seeder() {
  const services = useApp();
  const params = useLocalSearchParams<{ state?: string; emoji?: string; t?: string; y?: string }>();
  const [lines, setLines] = useState<string[]>(['Seeding…']);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Screenshots: no LogBox toasts (the unreachable server's sync warnings) over the footer.
    LogBox.ignoreAllLogs(true);
    suppressRecoveryOffer();
    const state = isSeedState(params.state) ? params.state : 'groups';
    const log = (line: string) => {
      console.log(`[seed] ${line}`);
      setLines((current) => [...current, line]);
    };
    void (async () => {
      const result = await seed(services, state, {
        emoji: params.emoji ?? null,
        ...(params.t === undefined ? {} : { motionAt: Number(params.t) }),
        ...(params.y === undefined ? {} : { y: Number(params.y) }),
      });
      for (const line of result.lines ?? []) log(line);
      if (state === 'task') await checkTask(services, log);
      if (state === 'notify' || state === 'notify-quiet') {
        await checkNotify(services, state === 'notify-quiet', log);
      }
      await navigate(services, result);
    })().catch((error: unknown) => {
      log(`Seed failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [services, params]);

  return (
    <Screen largeTitle="Seed">
      <View style={styles.lines}>
        {lines.map((line, i) => (
          <AppText key={i} variant="subheadLoose" color="textSecondary">
            {line}
          </AppText>
        ))}
      </View>
    </Screen>
  );
}

/** Performs a seed's steps: the first from the top of the stack, the rest after their waits. */
async function navigate(services: AppServices, result: SeedResult): Promise<void> {
  if (result.steps.length === 0) return;
  router.dismissAll();
  await wait(60);
  for (const [i, step] of result.steps.entries()) {
    if (step.wait !== undefined) await wait(step.wait);
    const href = step.path as Href;
    if (i === 0 && step.mode === 'replace') router.replace(href);
    else if (step.mode === 'replace') router.replace(href);
    else router.push(href);
  }
  if (result.recoveryOffer === true) setTimeout(resetRecoveryOffer, 600);
  if (result.syncOnOpen !== undefined) {
    const localId = result.syncOnOpen;
    setTimeout(() => void services.groups.sync(localId, 'manual'), 600);
  }
  if (result.shareOnOpen !== undefined) {
    const { localId, name } = result.shareOnOpen;
    setTimeout(() => {
      void services.groups.inviteFor(localId).then((invite) => shareInvite(invite, name));
    }, 1500);
  }
}

/** The background task: defined, the OS status, registration, the debug trigger, and one run of its body. */
async function checkTask(services: AppServices, log: (line: string) => void): Promise<void> {
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
  const outcomes = run.results.map((r) =>
    r.outcome === 'failed'
      ? `failed (${r.error})`
      : r.outcome === 'skipped'
        ? `skipped (${r.reason})`
        : r.outcome,
  );
  log(`Task body ran: ${outcomes.join(', ') || 'no groups'}; notified ${run.notified.length}`);
}

/**
 * A notification as a background cycle would post it: permission (the OS prompt, or provisional without one), an
 * expense arriving from Maya's phone, and what reached Notification Center.
 */
async function checkNotify(
  services: AppServices,
  quiet: boolean,
  log: (line: string) => void,
): Promise<void> {
  // Shown while the app is open too, so the simulator can show it without backgrounding the app.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (quiet) {
    // The simulator cannot answer the OS prompt headless: provisional permission needs none.
    const granted = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowProvisional: true },
    });
    log(`Permission (provisional): ios status ${String(granted.ios?.status)}`);
  } else {
    log(`Permission: ${await ensureNotificationPermission(services)}`);
  }
  const seeded = await seedGroupSettings(services, 'board');
  const arrived = await arriveFromMaya(services, seeded);
  const posted = await scheduleActivityNotifications([arrived], { services });
  log(`Posted: ${posted.map((p) => `${p.title} / ${p.body}`).join('; ') || 'nothing'}`);
  const shown = await Notifications.getPresentedNotificationsAsync();
  log(
    `In Notification Center: ${shown.map((n) => `${n.request.content.title} / ${n.request.content.body}`).join('; ') || 'nothing'}`,
  );
}

/** Expense detail, flagged: a split that does not add up cannot pass validation, so it is rendered in place. */
function FlaggedPreview() {
  const preview = useMemo(() => flaggedPreview('seedPreviewDeviceAAAAA'), []);
  const now = useNow();
  const expense = preview.state.expenses.get(preview.dinnerId);
  if (expense === undefined) return null;
  return (
    <ExpenseDetailView
      groupName="Banff 2026"
      state={preview.state}
      expense={expense}
      myId={preview.myMemberId}
      writable
      flag={flagOf(preview.state, preview.dinnerId)}
      now={now}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))}
      onEdit={() => undefined}
      onDelete={() => undefined}
      onRestore={() => undefined}
    />
  );
}

const styles = StyleSheet.create({
  lines: { paddingHorizontal: layout.textInset, gap: 8 },
});
