/**
 * `createAppServices`: the whole app state layer as plain objects over injected dependencies, shared by the React
 * provider (which passes the device's store, secure store, HTTP transport and file sharing) and by the tests (which
 * pass the in-memory or node:sqlite store, memory secrets, the fake server and a fake clock). The React layer
 * (`AppProvider`, hooks) only reads from what this returns.
 *
 * On creation: runs the store's migrations (idempotent), reads the device id, builds the sync engine, the derived
 * group state (sharing one decode cache, so an envelope a pull opened is not opened again) and the group service, wires the engine's `finished` events to the lifecycle checks (closure,
 * rotation recognition, name cache), and starts one `reconcile` pass so a rotation that was waiting for its closure
 * to be acknowledged when the app last stopped carries on.
 */
import type { Secrets } from '../services/secrets/types';
import type { FileIO } from '../services/groupFile/fileIO';
import type { Store } from '../services/storage/types';
import { DecodeCache } from '../services/sync/decodeCache';
import { createSyncEngine, type SyncEngineHandle, type SyncTuning } from '../services/sync/engine';
import { createInfoCache, type InfoCache } from '../services/sync/info';
import type { SyncResult, Transport } from '../services/sync/types';
import { describeForLog } from './errors';
import { GroupStateStore } from './groupState';
import { GroupService } from './groups';
import { PrefsService, type NotificationPermission } from './prefs';

/** design.md "Background refresh": no new group or debt starts after this much of a run. */
export const BACKGROUND_BUDGET_MS = 25_000;

export interface AppServicesDeps {
  store: Store;
  secrets: Secrets;
  /** The transport for a canonical server URL (the app: an `HttpTransport` per origin). */
  transportFor: (serverUrl: string) => Transport;
  infoCache?: InfoCache;
  files?: FileIO | null;
  notifications?: NotificationPermission | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: (message: string, detail?: unknown) => void;
  tuning?: Partial<SyncTuning>;
  /** Locale for amounts in activity summaries; the device default when omitted. */
  locale?: string;
}

export interface AppServices {
  store: Store;
  secrets: Secrets;
  engine: SyncEngineHandle;
  infoCache: InfoCache;
  /** This install's device id. */
  deviceId: string;
  groups: GroupService;
  groupState: GroupStateStore;
  prefs: PrefsService;
  /** The app came to the foreground: sync every active group (backoff respected). */
  foreground(): Promise<SyncResult[]>;
  /**
   * The background task's body (its registration with expo-background-task is a later step): debts first, then
   * active groups with an event in the last 30 days, within `BACKGROUND_BUDGET_MS`.
   */
  backgroundRefresh(): Promise<SyncResult[]>;
  /** Resolves when every lifecycle task started so far has finished (tests; a background task before it returns). */
  idle(): Promise<void>;
  dispose(): void;
}

export async function createAppServices(deps: AppServicesDeps): Promise<AppServices> {
  const { store, secrets, transportFor } = deps;
  const now = deps.now ?? Date.now;
  const log =
    deps.log ??
    ((message: string, detail?: unknown) =>
      detail === undefined ? console.warn(message) : console.warn(message, detail));
  await store.migrate();
  const deviceId = await secrets.deviceId();
  const infoCache = deps.infoCache ?? createInfoCache();
  // One decode cache: what a pull opens, the derive and rotation do not open again (pre-launch review H3).
  const decodeCache = new DecodeCache();

  const engine = createSyncEngine({
    store,
    secrets,
    transportFor,
    infoCache,
    decodeCache,
    now,
    log,
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    ...(deps.schedule === undefined ? {} : { schedule: deps.schedule }),
    ...(deps.tuning === undefined ? {} : { tuning: deps.tuning }),
  });
  const groupState = new GroupStateStore({
    store,
    secrets,
    engine,
    decodeCache,
    log,
    ...(deps.locale === undefined ? {} : { locale: deps.locale }),
  });
  const prefs = new PrefsService(store, deps.notifications ?? null);
  const groups = new GroupService({
    store,
    secrets,
    engine,
    groupState,
    deviceId,
    now,
    transportFor,
    infoCache,
    files: deps.files ?? null,
    prefs,
    log,
  });

  const tasks = new Set<Promise<unknown>>();
  function track(task: Promise<unknown>): void {
    const settled = task
      .catch((error: unknown) => {
        log('state: background task failed', describeForLog(error));
      })
      .finally(() => {
        tasks.delete(settled);
      });
    tasks.add(settled);
  }
  groupState.setFinishedHook((localId) => track(groups.processLifecycle(localId)));
  track(groups.reconcile());

  return {
    store,
    secrets,
    engine,
    infoCache,
    deviceId,
    groups,
    groupState,
    prefs,
    foreground: () => engine.syncAll({ trigger: 'foreground' }),
    backgroundRefresh: () =>
      engine.syncAll({ trigger: 'background', deadline: now() + BACKGROUND_BUDGET_MS }),
    async idle() {
      while (tasks.size > 0) await Promise.allSettled([...tasks]);
    },
    dispose() {
      groupState.setFinishedHook(null);
      engine.dispose();
      groupState.dispose();
    },
  };
}
