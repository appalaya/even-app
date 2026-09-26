import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SqlDriver } from './driver';
import { isStoreError } from './errors';
import { openNodeDriver } from './nodeDriver';
import {
  applyConnectionPragmas,
  migrate,
  MIGRATIONS,
  readSchemaVersion,
  SCHEMA_VERSION,
  type Migration,
} from './schema';
import { openSqliteStore } from './sqliteStore';
import { localRow, makeGroup } from './testFixtures';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function driverFor(path = ':memory:'): SqlDriver {
  const driver = openNodeDriver(path);
  cleanups.push(() => driver.close());
  return driver;
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'even-store-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'even.db');
}

async function columns(
  db: SqlDriver,
  table: string,
): Promise<{ name: string; notnull: number; pk: number }[]> {
  return db.all(`SELECT name, "notnull", pk FROM pragma_table_info(?) ORDER BY cid`, [table]);
}

describe('migrate', () => {
  it('creates the design.md schema on an empty database', async () => {
    const db = driverFor();
    expect(await readSchemaVersion(db)).toBe(0);
    await migrate(db);
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);

    const objects = await db.all<{ type: string; name: string }>(
      `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    );
    expect(objects).toEqual([
      { type: 'index', name: 'events_outbox' },
      { type: 'index', name: 'events_ts' },
      { type: 'table', name: 'events' },
      { type: 'table', name: 'groups' },
      { type: 'table', name: 'pending_deletes' },
      { type: 'table', name: 'prefs' },
    ]);
    expect((await columns(db, 'groups')).map((c) => c.name)).toEqual([
      'local_id',
      'server_url',
      'epoch',
      'cursor',
      'my_member_id',
      'name_cache',
      'currency_cache',
      'created_at',
      'last_synced_at',
      'last_sync_error',
      'state',
      'epoch_resets_this_cycle',
    ]);
    expect((await columns(db, 'events')).map((c) => [c.name, c.pk])).toEqual([
      ['local_id', 1],
      ['id', 2],
      ['origin', 0],
      ['acked', 0],
      ['seq', 0],
      ['ts', 0],
      ['envelope', 0],
      ['status', 0],
      ['push_state', 0],
    ]);
    expect((await columns(db, 'prefs')).map((c) => c.name)).toEqual(['key', 'value']);
    expect((await columns(db, 'pending_deletes')).map((c) => [c.name, c.pk])).toEqual([
      ['local_id', 1],
      ['server_url', 2],
    ]);
  });

  it('keeps decrypted content out of the schema: no column beyond ts and the name/currency caches', async () => {
    const db = driverFor();
    await migrate(db);
    const all = [
      ...(await columns(db, 'groups')),
      ...(await columns(db, 'events')),
      ...(await columns(db, 'prefs')),
      ...(await columns(db, 'pending_deletes')),
    ].map((c) => c.name);
    expect(all.filter((name) => /body|title|amount|note|member_name|plain/.test(name))).toEqual([]);
  });

  it('is idempotent and preserves data on re-run', async () => {
    const db = driverFor();
    const store = await openSqliteStore(db);
    const group = makeGroup();
    await store.upsertGroup(group);
    await store.insertEvents(group.localId, [localRow(1_760_000_000_001)]);
    await migrate(db);
    await store.migrate();
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(await store.getGroup(group.localId)).toEqual(group);
    expect((await store.countByStatus(group.localId)).byStatus.ok).toBe(1);
  });

  it('is safe to call concurrently', async () => {
    const db = driverFor();
    await Promise.all([migrate(db), migrate(db), migrate(db)]);
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('survives reopening a file database', async () => {
    const path = tempDbPath();
    const first = await openSqliteStore(openNodeDriver(path));
    const group = makeGroup();
    await first.upsertGroup(group);
    await first.close();
    const second = await openSqliteStore(openNodeDriver(path));
    cleanups.push(() => second.close());
    expect(await second.listGroups()).toEqual([group]);
  });

  it('refuses a database written by a newer app', async () => {
    const db = driverFor();
    await migrate(db);
    await db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toSatisfy((e) => isStoreError(e, 'schema_too_new'));
  });

  it('runs later migrations in order and rolls a failed one back with its version bump', async () => {
    const db = driverFor();
    await migrate(db);
    const extra: Migration[] = [
      ...MIGRATIONS,
      {
        version: 2,
        description: 'add a table',
        up: async (tx) => {
          await tx.run('CREATE TABLE extra (x INTEGER)');
        },
      },
      {
        version: 3,
        description: 'fails half-way',
        up: async (tx) => {
          await tx.run('CREATE TABLE half (x INTEGER)');
          throw new Error('migration 3 failed');
        },
      },
    ];
    await expect(migrate(db, extra)).rejects.toThrow('migration 3 failed');
    expect(await readSchemaVersion(db)).toBe(2);
    const tables = await db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('extra', 'half')`,
    );
    expect(tables.map((t) => t.name)).toEqual(['extra']);
  });

  it('rejects a migration list with gaps', async () => {
    const db = driverFor();
    const broken: Migration[] = [{ version: 2, description: 'gap', up: async () => undefined }];
    await expect(migrate(db, broken)).rejects.toThrow(/expected 1/);
    expect(await readSchemaVersion(db)).toBe(0);
  });
});

describe('connection pragmas', () => {
  it('turns on WAL and foreign keys', async () => {
    const db = driverFor(tempDbPath());
    await applyConnectionPragmas(db);
    expect(await db.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(await db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('enforces the events → groups foreign key', async () => {
    const db = driverFor();
    await openSqliteStore(db);
    await expect(
      db.run(
        `INSERT INTO events (local_id, id, origin, envelope, status) VALUES (?, ?, 'local', '{}', 'ok')`,
        ['x'.repeat(43), 'y'.repeat(22)],
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('query plans', () => {
  it('serves the outbox from the partial index', async () => {
    const db = driverFor();
    await openSqliteStore(db);
    const plan = await db.all<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id, ts, envelope FROM events
       WHERE local_id = ? AND acked = 0 AND push_state = 'pending' ORDER BY ts IS NULL, ts, id LIMIT ?`,
      ['a', 10],
    );
    expect(plan.map((p) => p.detail).join('\n')).toMatch(/events_outbox/);
  });
});
