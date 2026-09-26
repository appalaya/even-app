/// <reference types="node" />
/**
 * node:sqlite adapter (Node ≥ 22.13, built in; no native dependency) for Vitest and for the sync engine's tests.
 * Never import this from app code: Metro cannot bundle `node:sqlite`. The app uses `expoDriver.ts`.
 *
 * Differences from expo-sqlite that this file and `createDriver` absorb:
 * - rows come back as null-prototype objects; they are copied into plain ones.
 * - `changes` may be a bigint when `readBigInts` is on; it is converted to a number.
 * - booleans and `undefined` cannot be bound; `SqlValue` excludes both.
 * - foreign keys default ON here and OFF in expo-sqlite; the store sets the pragma on every connection.
 * - double-quoted string literals are rejected here; the store's SQL uses single quotes only.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  createDriver,
  type DriverOptions,
  type SqlConnection,
  type SqlDriver,
  type SqlRow,
} from './driver';
import { openSqliteStore, type SqliteStore, type SqliteStoreOptions } from './sqliteStore';

export function openNodeConnection(path = ':memory:'): SqlConnection {
  const db = new DatabaseSync(path);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params) {
      const result = db.prepare(sql).run(...(params as SQLInputValue[]));
      return { changes: Number(result.changes) };
    },
    async all(sql, params) {
      return db
        .prepare(sql)
        .all(...(params as SQLInputValue[]))
        .map((row) => ({ ...row }) as SqlRow);
    },
    async close() {
      db.close();
    },
  };
}

export function openNodeDriver(path = ':memory:', options?: DriverOptions): SqlDriver {
  return createDriver(openNodeConnection(path), options);
}

/** A migrated store on an in-memory (default) or file database. For tests and fakes. */
export function openNodeStore(
  path = ':memory:',
  options?: SqliteStoreOptions & DriverOptions,
): Promise<SqliteStore> {
  return openSqliteStore(openNodeDriver(path, options), options);
}
