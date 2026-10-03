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
import { envelopeStoredSize, newId } from '@even/core';

import { storedSizeOfText } from './envelopeSize';
import { envelopeText, openSqliteStore } from './sqliteStore';
import { localRow, makeEnvelope, makeGroup, pulledRow } from './testFixtures';
import type { NewEventRow } from './types';

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

/** Inserts rows with the v1 columns only, as a build before v4 wrote them (the store writes the current schema). */
async function insertBefore4(db: SqlDriver, localId: string, rows: NewEventRow[]): Promise<void> {
  for (const r of rows) {
    await db.run(
      `INSERT INTO events (local_id, id, origin, acked, seq, ts, envelope, status, push_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [localId, r.id, r.origin, r.acked ? 1 : 0, r.seq, r.ts, r.envelope, r.status],
    );
  }
}

describe('migrate', () => {
  it('creates the design.md schema on an empty database', async () => {
    const db = driverFor();
    expect(await readSchemaVersion(db)).toBe(0);
    await migrate(db);
    expect(await readSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5);

    const objects = await db.all<{ type: string; name: string }>(
      `SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`,
    );
    expect(objects).toEqual([
      { type: 'index', name: 'events_outbox' },
      { type: 'index', name: 'events_own_received' },
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
      ['size', 0],
      ['received_at', 0],
    ]);
    expect((await columns(db, 'prefs')).map((c) => c.name)).toEqual(['key', 'value']);
    expect((await columns(db, 'pending_deletes')).map((c) => [c.name, c.pk, c.notnull])).toEqual([
      ['local_id', 1, 1],
      ['server_url', 2, 1],
      ['auth_token', 0, 1],
      ['created_at', 0, 1],
      ['attempts', 0, 1],
    ]);
  });

  it('v2 upgrades a v1 database: pending_deletes gains auth_token, v1 debts (no token) are dropped', async () => {
    const db = driverFor();
    await migrate(db, MIGRATIONS.slice(0, 1));
    expect(await readSchemaVersion(db)).toBe(1);
    const store = await openSqliteStore(db, { migrations: MIGRATIONS.slice(0, 1) });
    const group = makeGroup();
    await store.upsertGroup(group);
    await insertBefore4(db, group.localId, [localRow(1_760_000_000_001)]);
    await db.run('INSERT INTO pending_deletes (local_id, server_url) VALUES (?, ?)', [
      group.localId,
      group.serverUrl,
    ]);

    await migrate(db, MIGRATIONS.slice(0, 2));

    expect(await readSchemaVersion(db)).toBe(2);
    expect((await columns(db, 'pending_deletes')).map((c) => c.name)).toEqual([
      'local_id',
      'server_url',
      'auth_token',
    ]);
    expect(await db.all('SELECT * FROM pending_deletes')).toEqual([]);
    // Nothing else is touched.
    const upgraded = await openSqliteStore(db, { migrations: MIGRATIONS.slice(0, 2) });
    expect(await upgraded.getGroup(group.localId)).toEqual(group);
    expect((await upgraded.countByStatus(group.localId)).byStatus.ok).toBe(1);
  });

  it('v3 upgrades a v2 database: a debt keeps its token, counts its age from the upgrade, and has no attempts', async () => {
    const db = driverFor();
    await migrate(db, MIGRATIONS.slice(0, 2));
    const group = makeGroup();
    const token = 'A'.repeat(43);
    await db.run(
      'INSERT INTO pending_deletes (local_id, server_url, auth_token) VALUES (?, ?, ?)',
      [group.localId, group.serverUrl, token],
    );
    const before = Date.now();

    await migrate(db, MIGRATIONS.slice(0, 3));

    expect(await readSchemaVersion(db)).toBe(3);
    const [debt, ...rest] = await (await openSqliteStore(db)).pendingDeletes.list();
    expect(rest).toEqual([]);
    expect(debt).toMatchObject({
      localId: group.localId,
      serverUrl: group.serverUrl,
      authToken: token,
      attempts: 0,
    });
    // strftime('%s') has whole seconds.
    expect(debt?.createdAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(debt?.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('v4 upgrades a v3 database: every row gets its stored size, a page at a time; junk gets none', async () => {
    const db = driverFor();
    await migrate(db, MIGRATIONS.slice(0, 3));
    const store = await openSqliteStore(db, { migrations: MIGRATIONS.slice(0, 3) });
    const group = makeGroup();
    await store.upsertGroup(group);
    // More than one page of v4's 300, and every kind of row: readable, another v, junk, an unopened envelope.
    const rows = Array.from({ length: 650 }, (_, i) => localRow(1_760_000_000_000 + i));
    const other = makeEnvelope(newId(), 2);
    rows.push(
      pulledRow(1, null, {
        id: other.id,
        envelope: envelopeText(other),
        status: 'unsupported_envelope',
      }),
      pulledRow(2, null, { envelope: '{"junk":true}' }),
      pulledRow(3, null),
    );
    await insertBefore4(db, group.localId, rows);

    await migrate(db);

    const stored = await db.all<{ envelope: string; size: number | null }>(
      'SELECT envelope, size FROM events ORDER BY rowid',
    );
    expect(stored).toHaveLength(653);
    for (const row of stored) expect(row.size).toBe(storedSizeOfText(row.envelope));
    expect(stored.filter((r) => r.size === null)).toHaveLength(1); // the junk
    expect(stored[0]?.size).toBe(envelopeStoredSize(JSON.parse(stored[0]?.envelope ?? '')));
    const upgraded = await openSqliteStore(db);
    expect(await upgraded.usage(group.localId)).toEqual({
      events: 652,
      bytes: stored.reduce((sum, r) => sum + (r.size ?? 0), 0),
    });
  });

  it('v5 upgrades a v4 database: events gain received_at, null on every stored row, nothing rewritten', async () => {
    const db = driverFor();
    await migrate(db, MIGRATIONS.slice(0, 4));
    const before = await openSqliteStore(db, { migrations: MIGRATIONS.slice(0, 4) });
    const group = makeGroup();
    await before.upsertGroup(group);
    const rows = [localRow(1_760_000_000_001), pulledRow(1, 1_760_000_000_002)];
    await db.run(
      `INSERT INTO events (local_id, id, origin, acked, seq, ts, envelope, status, push_state, size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?), (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      rows.flatMap((r) => [
        group.localId,
        r.id,
        r.origin,
        r.acked ? 1 : 0,
        r.seq,
        r.ts,
        r.envelope,
        r.status,
        storedSizeOfText(r.envelope),
      ]),
    );
    const stored = await db.all('SELECT * FROM events ORDER BY rowid');

    await migrate(db);

    expect(await readSchemaVersion(db)).toBe(5);
    const after = await db.all<Record<string, unknown>>('SELECT * FROM events ORDER BY rowid');
    expect(after).toEqual(stored.map((row) => ({ ...(row as object), received_at: null })));
    const upgraded = await openSqliteStore(db);
    expect((await upgraded.listEnvelopes(group.localId)).map((r) => r.receivedAt)).toEqual([
      null,
      null,
    ]);
    expect(await upgraded.latestOwnReceipt(group.serverUrl)).toBeNull();
  });

  it('v5 sets every group cursor to 0 so the next sync pulls the whole log again; nothing else moves', async () => {
    const db = driverFor();
    await migrate(db, MIGRATIONS.slice(0, 4));
    const before = await openSqliteStore(db, { migrations: MIGRATIONS.slice(0, 4) });
    const groups = [
      makeGroup({ cursor: 120, epoch: 'k3JdAAAAAAAAAAAAAAAAAA', lastSyncedAt: 1 }),
      makeGroup({ cursor: 7, state: 'closed' }),
      makeGroup({ cursor: 0 }),
    ];
    for (const group of groups) await before.upsertGroup(group);
    const unsent = localRow(1_760_000_000_001);
    await db.run(
      `INSERT INTO events (local_id, id, origin, acked, seq, ts, envelope, status, push_state, size)
       VALUES (?, ?, 'local', 0, NULL, ?, ?, 'ok', 'pending', ?)`,
      [
        groups[0]!.localId,
        unsent.id,
        unsent.ts,
        unsent.envelope,
        storedSizeOfText(unsent.envelope),
      ],
    );

    await migrate(db);

    const upgraded = await openSqliteStore(db);
    for (const group of groups) {
      expect(await upgraded.getGroup(group.localId)).toEqual({ ...group, cursor: 0 });
    }
    expect((await upgraded.outbox(groups[0]!.localId, 10)).map((r) => r.id)).toEqual([unsent.id]);
    // Once only: a later cursor is not reset by opening the store again.
    await upgraded.setCursor(groups[0]!.localId, 50);
    await migrate(db);
    expect((await upgraded.getGroup(groups[0]!.localId))?.cursor).toBe(50);
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
        version: MIGRATIONS.length + 1,
        description: 'add a table',
        up: async (tx) => {
          await tx.run('CREATE TABLE extra (x INTEGER)');
        },
      },
      {
        version: MIGRATIONS.length + 2,
        description: 'fails half-way',
        up: async (tx) => {
          await tx.run('CREATE TABLE half (x INTEGER)');
          throw new Error('the extra migration failed');
        },
      },
    ];
    await expect(migrate(db, extra)).rejects.toThrow('the extra migration failed');
    expect(await readSchemaVersion(db)).toBe(MIGRATIONS.length + 1);
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
