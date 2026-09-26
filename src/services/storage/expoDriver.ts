/**
 * expo-sqlite adapter: one connection per database file, opened with `openDatabaseAsync`. Locking,
 * transactions (`BEGIN IMMEDIATE`, savepoints for nesting), and pragmas are not done here; see `driver.ts` for
 * why the store does not use `withExclusiveTransactionAsync`.
 *
 * `runAsync`/`getAllAsync` prepare a single statement, so every statement is sent on its own.
 */
import * as SQLite from 'expo-sqlite';

import {
  createDriver,
  type DriverOptions,
  type SqlConnection,
  type SqlDriver,
  type SqlRow,
} from './driver';

export const DEFAULT_DATABASE_NAME = 'even.db';

export async function openExpoConnection(databaseName: string): Promise<SqlConnection> {
  const db = await SQLite.openDatabaseAsync(databaseName);
  return {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params) {
      const result = await db.runAsync(sql, [...params]);
      return { changes: result.changes };
    },
    all: (sql, params) => db.getAllAsync<SqlRow>(sql, [...params]),
    close: () => db.closeAsync(),
  };
}

export async function openExpoDriver(
  databaseName: string = DEFAULT_DATABASE_NAME,
  options?: DriverOptions,
): Promise<SqlDriver> {
  return createDriver(await openExpoConnection(databaseName), options);
}
