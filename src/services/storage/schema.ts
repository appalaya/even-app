/**
 * Schema and migrations (design.md "Local storage" → "SQLite schema" and "Migrations").
 *
 * `PRAGMA user_version` counts applied migrations. Each migration runs in its own transaction together with the
 * `user_version` bump, so a failed migration leaves the previous version intact. Append new migrations; never
 * edit a shipped one. Old events are never migrated in place (CLAUDE.md): a migration may add columns or
 * tables, but must not rewrite envelopes.
 *
 * Differences from the SQL sketched in design.md, all additive:
 * - `NOT NULL` on the TEXT primary keys (SQLite otherwise admits NULL keys, a legacy quirk).
 * - `events.local_id REFERENCES groups ON DELETE CASCADE`: an event cannot outlive its group, so a pulled page
 *   committed after Leave fails instead of leaving ciphertext behind. `pending_deletes` has no such reference:
 *   the debt outlives the group on purpose. Consequence: never `INSERT OR REPLACE` into `groups` (the implied
 *   delete would cascade); `upsertGroup` uses `ON CONFLICT DO UPDATE`.
 * - No CHECK constraints on the enum columns: SQLite cannot alter a CHECK without rebuilding the table, and the
 *   store validates every enum before binding it.
 */
import type { SqlDriver } from './driver';
import { StoreError } from './errors';

export interface Migration {
  /** The `user_version` after this migration: its 1-based position in the list. */
  readonly version: number;
  readonly description: string;
  up(tx: SqlDriver): Promise<void>;
}

/** Runs statements one at a time: expo-sqlite prepares only the first statement of a string. */
function statements(...sql: string[]): (tx: SqlDriver) => Promise<void> {
  return async (tx) => {
    for (const statement of sql) await tx.run(statement);
  };
}

const V1 = statements(
  `CREATE TABLE groups (
    local_id                TEXT PRIMARY KEY NOT NULL,
    server_url              TEXT NOT NULL,
    epoch                   TEXT,
    cursor                  INTEGER NOT NULL DEFAULT 0,
    my_member_id            TEXT,
    name_cache              TEXT,
    currency_cache          TEXT,
    created_at              INTEGER NOT NULL,
    last_synced_at          INTEGER,
    last_sync_error         TEXT,
    state                   TEXT NOT NULL DEFAULT 'active',
    epoch_resets_this_cycle INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE prefs (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
  )`,
  `CREATE TABLE pending_deletes (
    local_id   TEXT NOT NULL,
    server_url TEXT NOT NULL,
    PRIMARY KEY (local_id, server_url)
  )`,
  `CREATE TABLE events (
    local_id   TEXT NOT NULL REFERENCES groups (local_id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    origin     TEXT NOT NULL,
    acked      INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER,
    ts         INTEGER,
    envelope   TEXT NOT NULL,
    status     TEXT NOT NULL,
    push_state TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY (local_id, id)
  )`,
  // The outbox is a query, not a table. Queries must spell the predicate with literals (not bound
  // parameters) for the planner to use this partial index.
  `CREATE INDEX events_outbox ON events (local_id) WHERE acked = 0 AND push_state = 'pending'`,
  `CREATE INDEX events_ts ON events (local_id, ts)`,
);

/**
 * v2: `pending_deletes.auth_token` (design.md "Rotation, moving, closing": a debt carries the per-server token, so the
 * retry still works after Leave removed the secret). SQLite cannot add a `NOT NULL` column without a default, so the
 * table is rebuilt. A v1 row has no token and nothing can derive one here (secrets are in secure store), so it
 * could never be paid; no build that wrote such rows shipped, and they are dropped.
 */
const V2 = statements(
  `CREATE TABLE pending_deletes_v2 (
    local_id   TEXT NOT NULL,
    server_url TEXT NOT NULL,
    auth_token TEXT NOT NULL,
    PRIMARY KEY (local_id, server_url)
  )`,
  'DROP TABLE pending_deletes',
  'ALTER TABLE pending_deletes_v2 RENAME TO pending_deletes',
);

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, description: 'initial schema', up: V1 },
  { version: 2, description: 'pending_deletes.auth_token', up: V2 },
];

/** The schema version this build writes. */
export const SCHEMA_VERSION = MIGRATIONS.length;

/**
 * Per-connection settings, applied on open outside any transaction: `journal_mode` cannot change inside one and
 * `foreign_keys` is silently ignored inside one. expo-sqlite leaves foreign keys off by default; node:sqlite
 * turns them on; setting both explicitly makes the two drivers behave the same.
 */
export const CONNECTION_PRAGMAS: readonly string[] = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA foreign_keys = ON',
];

export async function applyConnectionPragmas(driver: SqlDriver): Promise<void> {
  for (const pragma of CONNECTION_PRAGMAS) await driver.run(pragma);
}

export async function readSchemaVersion(db: SqlDriver): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

function checkMigrations(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `migration at position ${index} has version ${migration.version}, expected ${index + 1}`,
      );
    }
  });
}

/** Brings the database to `migrations.length`. Idempotent and safe to call concurrently. */
export async function migrate(
  driver: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<void> {
  checkMigrations(migrations);
  const current = await readSchemaVersion(driver);
  if (current > migrations.length) {
    throw new StoreError(
      'schema_too_new',
      `the database is at schema v${current}; this app knows v${migrations.length}. Update the app.`,
    );
  }
  for (const migration of migrations.slice(current)) {
    await driver.transaction(async (tx) => {
      // Re-read under the lock: a concurrent migrate() may have applied it already.
      if ((await readSchemaVersion(tx)) >= migration.version) return;
      await migration.up(tx);
      // PRAGMA takes no bound parameters; the version is an integer from this file, never input.
      await tx.run(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
    });
  }
}
