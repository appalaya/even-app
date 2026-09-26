/**
 * The app's entry to storage: `openStore()` opens `even.db` with expo-sqlite, applies the connection pragmas,
 * migrates, and returns the process-wide store. Node tests use `openNodeStore` (nodeDriver.ts) instead; nothing
 * here may be imported from code that runs under Vitest, because it pulls in expo-sqlite.
 */
import { DEFAULT_DATABASE_NAME, openExpoDriver } from './expoDriver';
import { openSqliteStore, type SqliteStore } from './sqliteStore';
import type { OpenStore } from './types';

const opened = new Map<string, Promise<SqliteStore>>();

/** One store per database per process: concurrent and repeated calls share the first open. */
export const openStore: OpenStore = (databaseName = DEFAULT_DATABASE_NAME) => {
  let store = opened.get(databaseName);
  if (!store) {
    store = openExpoDriver(databaseName).then((driver) => openSqliteStore(driver));
    // A failed open (for example `schema_too_new`) is not cached, so a later call can retry.
    store.catch(() => opened.delete(databaseName));
    opened.set(databaseName, store);
  }
  return store;
};
