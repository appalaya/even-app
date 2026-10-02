/**
 * The `Store` contract (types.ts) over a `SqlDriver`. Written once; runs on expo-sqlite in the app and on
 * node:sqlite under Vitest.
 *
 * Conventions:
 * - Every argument is validated before any SQL runs, and every value is bound, never interpolated. The only
 *   literals in SQL are the fixed enum values below, written inline so SQLite can use the partial outbox index.
 * - Multi-statement methods run inside `driver.transaction`, which nests as a savepoint when the store is
 *   already a transaction's `tx`. So each method is atomic on its own and composes inside `transaction`.
 * - Batches are chunked to at most 999 bound parameters per statement: one round trip per chunk instead of one
 *   per row (each expo-sqlite call crosses the native bridge), under SQLite's historical parameter limit.
 */
import { envelopeShape, envelopeStoredSize, isEnvelope, type Envelope } from '@even/core';

import type { SqlDriver, SqlValue } from './driver';
import { StoreError } from './errors';
import { applyConnectionPragmas, migrate, MIGRATIONS, type Migration } from './schema';
import type {
  EventCounts,
  EventOrigin,
  EventStatus,
  GroupLifecycle,
  GroupRow,
  InsertEventsResult,
  NewEventRow,
  NewPendingDelete,
  OutboxRow,
  PendingDeleteKey,
  PendingDeleteRow,
  PendingDeletes,
  PrefKey,
  PushState,
  ReadableEnvelope,
  ReadableStatus,
  Store,
  StoredEnvelopeRow,
  SyncStatePatch,
} from './types';
import {
  checkAuthToken,
  checkBoolean,
  checkEnum,
  checkId,
  checkIds,
  checkInt,
  checkLocalId,
  checkNullableCurrency,
  checkNullableId,
  checkNullableInt,
  checkNullableString,
  checkServerUrl,
  checkString,
} from './validate';

// ---------- Enums ----------

export const EVENT_STATUSES: readonly EventStatus[] = [
  'ok',
  'undecryptable',
  'invalid',
  'unsupported_envelope',
  'unsupported_body',
];
export const READABLE_STATUSES: readonly ReadableStatus[] = ['ok', 'invalid', 'unsupported_body'];
export const GROUP_STATES: readonly GroupLifecycle[] = ['active', 'closed', 'hidden', 'blocked'];
const ORIGINS: readonly EventOrigin[] = ['local', 'remote'];
const PUSH_STATES: readonly PushState[] = ['pending', 'rejected'];
export const PREF_KEYS: readonly PrefKey[] = [
  'me.name',
  'me.emoji',
  'appearance',
  'theme',
  'notifications.asked',
  'notifications.unanswered',
  'notifications.ledger',
];

/**
 * Longest `events.envelope` text accepted. A maximal v1 envelope is about 11,000 characters (10,923 for `c`);
 * the bound keeps a hostile server from filling the disk with oversized junk stored as `undecryptable`.
 */
export const MAX_ENVELOPE_TEXT_LENGTH = 16_384;

/** The group's log order: `ts` ascending with unreadable (null) last, then `id`. */
const LOG_ORDER = 'ts IS NULL, ts, id';
const READABLE_IN = `('ok', 'invalid', 'unsupported_body')`;
const UNREOPENABLE_IN = `('undecryptable', 'unsupported_envelope')`;

const MAX_PARAMS = 999;

// ---------- Helpers ----------

function isReadable(status: EventStatus): status is ReadableStatus {
  return (READABLE_STATUSES as readonly string[]).includes(status);
}

function invalid(message: string): never {
  throw new StoreError('invalid_argument', message);
}

function placeholders(count: number): string {
  return new Array<string>(count).fill('?').join(', ');
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Canonical JSON for an envelope: the four protocol fields in a fixed order, nothing else. */
export function envelopeText(envelope: Envelope): string {
  return JSON.stringify({ id: envelope.id, v: envelope.v, n: envelope.n, c: envelope.c });
}

// ---------- Row mapping ----------

interface GroupRecord {
  local_id: string;
  server_url: string;
  epoch: string | null;
  cursor: number;
  my_member_id: string | null;
  name_cache: string | null;
  currency_cache: string | null;
  created_at: number;
  last_synced_at: number | null;
  last_sync_error: string | null;
  state: string;
  epoch_resets_this_cycle: number;
}

const GROUP_COLUMNS =
  'local_id, server_url, epoch, cursor, my_member_id, name_cache, currency_cache, created_at, ' +
  'last_synced_at, last_sync_error, state, epoch_resets_this_cycle';

function toGroupRow(r: GroupRecord): GroupRow {
  return {
    localId: r.local_id,
    serverUrl: r.server_url,
    epoch: r.epoch,
    cursor: r.cursor,
    myMemberId: r.my_member_id,
    nameCache: r.name_cache,
    currencyCache: r.currency_cache,
    createdAt: r.created_at,
    lastSyncedAt: r.last_synced_at,
    lastSyncError: r.last_sync_error,
    state: r.state as GroupLifecycle,
    epochResetsThisCycle: r.epoch_resets_this_cycle,
  };
}

function checkZeroOrOne(value: unknown, what: string): 0 | 1 {
  if (value !== 0 && value !== 1) invalid(`${what} must be 0 or 1`);
  return value;
}

function checkGroupRow(row: GroupRow): SqlValue[] {
  if (typeof row !== 'object' || row === null) invalid('group row must be an object');
  return [
    checkLocalId(row.localId),
    checkServerUrl(row.serverUrl),
    checkNullableString(row.epoch, 'epoch'),
    checkInt(row.cursor, 'cursor'),
    checkNullableId(row.myMemberId, 'myMemberId'),
    checkNullableString(row.nameCache, 'nameCache'),
    checkNullableCurrency(row.currencyCache, 'currencyCache'),
    checkInt(row.createdAt, 'createdAt'),
    checkNullableInt(row.lastSyncedAt, 'lastSyncedAt'),
    checkNullableString(row.lastSyncError, 'lastSyncError'),
    checkEnum(row.state, GROUP_STATES, 'state'),
    checkZeroOrOne(row.epochResetsThisCycle, 'epochResetsThisCycle'),
  ];
}

interface CheckedEvent {
  id: string;
  origin: EventOrigin;
  acked: boolean;
  seq: number | null;
  ts: number | null;
  envelope: string;
  status: EventStatus;
  pushState: PushState;
  /** `events.size`: the stored size as a server counts it, or null for text that is not an envelope. */
  size: number | null;
}

/**
 * Structural rules for a row, beyond the column types: the text is JSON of bounded length; a readable row holds
 * a strict v1 envelope (exactly id, v, n, c; so no `seq` from the pull response) whose id is the row id; an
 * `unsupported_envelope` row holds a well-formed envelope of another `v`; any well-formed envelope carries the
 * row's id; an `ok` row has a `ts`.
 */
function checkNewEvent(row: NewEventRow, index: number): CheckedEvent {
  const at = `rows[${index}]`;
  if (typeof row !== 'object' || row === null) invalid(`${at} must be an object`);
  const id = checkId(row.id, `${at}.id`);
  const status = checkEnum(row.status, EVENT_STATUSES, `${at}.status`);
  const envelope = checkString(row.envelope, `${at}.envelope`);
  const ts = checkNullableInt(row.ts, `${at}.ts`);
  if (envelope.length > MAX_ENVELOPE_TEXT_LENGTH) {
    invalid(`${at}.envelope is longer than ${MAX_ENVELOPE_TEXT_LENGTH} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    invalid(`${at}.envelope is not JSON`);
  }
  const shape = envelopeShape(parsed);
  if (shape.ok && (parsed as { id: string }).id !== id) {
    invalid(`${at}.envelope has id ${(parsed as { id: string }).id}, not the row id ${id}`);
  }
  if (isReadable(status) && !isEnvelope(parsed)) {
    invalid(`${at} has status ${status} but its envelope is not a v1 envelope {id, v, n, c}`);
  }
  if (status === 'unsupported_envelope' && !(shape.ok && shape.v !== 1)) {
    invalid(
      `${at} has status unsupported_envelope but its envelope is not a well-formed envelope with v ≠ 1`,
    );
  }
  if (status === 'ok' && ts === null) invalid(`${at} has status ok but no ts`);
  return {
    id,
    origin: checkEnum(row.origin, ORIGINS, `${at}.origin`),
    acked: checkBoolean(row.acked, `${at}.acked`),
    seq: checkNullableInt(row.seq, `${at}.seq`),
    ts,
    envelope,
    status,
    pushState:
      row.pushState === undefined
        ? 'pending'
        : checkEnum(row.pushState, PUSH_STATES, `${at}.pushState`),
    // The shape was checked above: measured from it, not checked again (insertEvents is on every pulled page).
    size: shape.ok ? envelopeStoredSize(parsed as Envelope) : null,
  };
}

function parseReadable(id: string, text: string): Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isEnvelope(parsed) || parsed.id !== id) {
    throw new StoreError(
      'corrupt_row',
      `event ${id} is marked readable but does not hold a v1 envelope`,
    );
  }
  return parsed;
}

// ---------- The store ----------

export interface SqliteStoreOptions {
  /** Defaults to the app's migrations; tests inject others. */
  migrations?: readonly Migration[];
}

class SqlitePendingDeletes implements PendingDeletes {
  constructor(private readonly db: SqlDriver) {}

  async add(entry: NewPendingDelete): Promise<void> {
    const localId = checkLocalId(entry?.localId);
    const serverUrl = checkServerUrl(entry.serverUrl);
    const authToken = checkAuthToken(entry.authToken);
    const createdAt = checkInt(entry.createdAt, 'createdAt');
    await this.db.run(
      `INSERT INTO pending_deletes (local_id, server_url, auth_token, created_at, attempts)
       VALUES (?, ?, ?, ?, 0) ON CONFLICT DO NOTHING`,
      [localId, serverUrl, authToken, createdAt],
    );
  }

  /** In the order the debts were recorded. */
  async list(): Promise<PendingDeleteRow[]> {
    const rows = await this.db.all<{
      local_id: string;
      server_url: string;
      auth_token: string;
      created_at: number;
      attempts: number;
    }>(
      'SELECT local_id, server_url, auth_token, created_at, attempts FROM pending_deletes ORDER BY rowid',
    );
    return rows.map((r) => ({
      localId: r.local_id,
      serverUrl: r.server_url,
      authToken: r.auth_token,
      createdAt: r.created_at,
      attempts: r.attempts,
    }));
  }

  async recordAttempt(entry: PendingDeleteKey): Promise<void> {
    const localId = checkLocalId(entry?.localId);
    const serverUrl = checkServerUrl(entry.serverUrl);
    await this.db.run(
      'UPDATE pending_deletes SET attempts = attempts + 1 WHERE local_id = ? AND server_url = ?',
      [localId, serverUrl],
    );
  }

  async remove(entry: PendingDeleteKey): Promise<void> {
    const localId = checkLocalId(entry?.localId);
    const serverUrl = checkServerUrl(entry.serverUrl);
    await this.db.run('DELETE FROM pending_deletes WHERE local_id = ? AND server_url = ?', [
      localId,
      serverUrl,
    ]);
  }
}

export class SqliteStore implements Store {
  readonly pendingDeletes: PendingDeletes;
  private readonly migrations: readonly Migration[];

  constructor(
    private readonly db: SqlDriver,
    options: SqliteStoreOptions = {},
  ) {
    this.migrations = options.migrations ?? MIGRATIONS;
    this.pendingDeletes = new SqlitePendingDeletes(db);
  }

  migrate(): Promise<void> {
    return migrate(this.db, this.migrations);
  }

  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new SqliteStore(tx, { migrations: this.migrations })));
  }

  /** Closes the connection after in-flight work. Not part of `Store`: the app keeps one store for its lifetime. */
  close(): Promise<void> {
    return this.db.close();
  }

  // ----- groups -----

  async listGroups(): Promise<GroupRow[]> {
    const rows = await this.db.all<GroupRecord>(
      `SELECT ${GROUP_COLUMNS} FROM groups ORDER BY created_at, local_id`,
    );
    return rows.map(toGroupRow);
  }

  async getGroup(localId: string): Promise<GroupRow | null> {
    checkLocalId(localId);
    const row = await this.db.get<GroupRecord>(
      `SELECT ${GROUP_COLUMNS} FROM groups WHERE local_id = ?`,
      [localId],
    );
    return row ? toGroupRow(row) : null;
  }

  async upsertGroup(row: GroupRow): Promise<void> {
    const values = checkGroupRow(row);
    // ON CONFLICT DO UPDATE, never INSERT OR REPLACE: a replace deletes the row first, and the delete would
    // cascade to the group's events.
    await this.db.run(
      `INSERT INTO groups (${GROUP_COLUMNS}) VALUES (${placeholders(values.length)})
       ON CONFLICT (local_id) DO UPDATE SET
         server_url = excluded.server_url,
         epoch = excluded.epoch,
         cursor = excluded.cursor,
         my_member_id = excluded.my_member_id,
         name_cache = excluded.name_cache,
         currency_cache = excluded.currency_cache,
         created_at = excluded.created_at,
         last_synced_at = excluded.last_synced_at,
         last_sync_error = excluded.last_sync_error,
         state = excluded.state,
         epoch_resets_this_cycle = excluded.epoch_resets_this_cycle`,
      values,
    );
  }

  async setGroupState(localId: string, state: GroupLifecycle): Promise<void> {
    checkLocalId(localId);
    await this.updateGroup(localId, ['state = ?'], [checkEnum(state, GROUP_STATES, 'state')]);
  }

  async setServer(
    localId: string,
    serverUrl: string,
    reencrypted: readonly ReadableEnvelope[],
  ): Promise<void> {
    checkLocalId(localId);
    checkServerUrl(serverUrl);
    if (!Array.isArray(reencrypted)) invalid('reencrypted must be an array');
    const replacements = new Map<string, { text: string; size: number }>();
    reencrypted.forEach((entry, index) => {
      const at = `reencrypted[${index}]`;
      if (typeof entry !== 'object' || entry === null) invalid(`${at} must be an object`);
      const id = checkId(entry.id, `${at}.id`);
      if (!isEnvelope(entry.envelope)) invalid(`${at}.envelope is not a v1 envelope`);
      if (entry.envelope.id !== id) invalid(`${at}.envelope.id must equal ${at}.id`);
      if (replacements.has(id)) invalid(`${at}: id ${id} appears twice`);
      replacements.set(id, {
        text: envelopeText(entry.envelope),
        size: envelopeStoredSize(entry.envelope),
      });
    });

    await this.db.transaction(async (tx) => {
      await requireGroup(tx, localId);
      const rows = await tx.all<{ id: string; status: EventStatus }>(
        'SELECT id, status FROM events WHERE local_id = ?',
        [localId],
      );
      const readable = new Set(rows.filter((r) => isReadable(r.status)).map((r) => r.id));
      const missing = [...readable].filter((id) => !replacements.has(id));
      const extra = [...replacements.keys()].filter((id) => !readable.has(id));
      if (missing.length > 0 || extra.length > 0) {
        throw new StoreError(
          'incomplete_reencryption',
          `the re-encryption must cover exactly the ${readable.size} readable rows: ` +
            `${missing.length} missing (${missing.slice(0, 3).join(', ')}), ` +
            `${extra.length} not readable rows of this group (${extra.slice(0, 3).join(', ')})`,
        );
      }

      await tx.run(`DELETE FROM events WHERE local_id = ? AND status IN ${UNREOPENABLE_IN}`, [
        localId,
      ]);
      // (MAX_PARAMS - 1) / 5: each row binds id and text, then id and size, in the CASEs and id again in the IN list.
      for (const chunk of chunked([...replacements], Math.floor((MAX_PARAMS - 1) / 5))) {
        await tx.run(
          `UPDATE events SET
             envelope = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END,
             size = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END
           WHERE local_id = ? AND id IN (${placeholders(chunk.length)})`,
          [
            ...chunk.flatMap(([id, r]) => [id, r.text]),
            ...chunk.flatMap(([id, r]) => [id, r.size]),
            localId,
            ...chunk.map(([id]) => id),
          ],
        );
      }
      await tx.run(
        `UPDATE events SET acked = 0, seq = NULL, push_state = 'pending' WHERE local_id = ?`,
        [localId],
      );
      await tx.run(
        `UPDATE groups SET server_url = ?, cursor = 0, epoch = NULL,
           state = CASE state WHEN 'blocked' THEN 'active' ELSE state END
         WHERE local_id = ?`,
        [serverUrl, localId],
      );
    });
  }

  async setCursor(localId: string, cursor: number): Promise<void> {
    checkLocalId(localId);
    await this.updateGroup(localId, ['cursor = ?'], [checkInt(cursor, 'cursor')]);
  }

  async setSyncState(localId: string, patch: SyncStatePatch): Promise<void> {
    checkLocalId(localId);
    if (typeof patch !== 'object' || patch === null) invalid('patch must be an object');
    const sets: string[] = [];
    const values: SqlValue[] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      switch (key) {
        case 'epoch':
          sets.push('epoch = ?');
          values.push(checkNullableString(value, 'epoch'));
          break;
        case 'lastSyncedAt':
          sets.push('last_synced_at = ?');
          values.push(checkNullableInt(value, 'lastSyncedAt'));
          break;
        case 'lastSyncError':
          sets.push('last_sync_error = ?');
          values.push(checkNullableString(value, 'lastSyncError'));
          break;
        case 'epochResetsThisCycle':
          sets.push('epoch_resets_this_cycle = ?');
          values.push(checkZeroOrOne(value, 'epochResetsThisCycle'));
          break;
        default:
          invalid(`setSyncState does not write ${JSON.stringify(key)}`);
      }
    }
    await this.updateGroup(localId, sets, values);
  }

  async setMyMember(localId: string, memberId: string | null): Promise<void> {
    checkLocalId(localId);
    await this.updateGroup(localId, ['my_member_id = ?'], [checkNullableId(memberId, 'memberId')]);
  }

  async setNameCache(
    localId: string,
    cache: { name?: string | null; currency?: string | null },
  ): Promise<void> {
    checkLocalId(localId);
    if (typeof cache !== 'object' || cache === null) invalid('cache must be an object');
    const sets: string[] = [];
    const values: SqlValue[] = [];
    if (cache.name !== undefined) {
      sets.push('name_cache = ?');
      values.push(checkNullableString(cache.name, 'name'));
    }
    if (cache.currency !== undefined) {
      sets.push('currency_cache = ?');
      values.push(checkNullableCurrency(cache.currency, 'currency'));
    }
    await this.updateGroup(localId, sets, values);
  }

  async deleteGroup(localId: string): Promise<void> {
    checkLocalId(localId);
    await this.db.transaction(async (tx) => {
      // Explicit even though the foreign key cascades: correctness must not hinge on a pragma.
      await tx.run('DELETE FROM events WHERE local_id = ?', [localId]);
      await tx.run('DELETE FROM groups WHERE local_id = ?', [localId]);
    });
  }

  /** UPDATE one group row; throws `group_not_found` if there is none. `sets` are fixed column assignments. */
  private async updateGroup(localId: string, sets: string[], values: SqlValue[]): Promise<void> {
    if (sets.length === 0) {
      await requireGroup(this.db, localId);
      return;
    }
    const { changes } = await this.db.run(
      `UPDATE groups SET ${sets.join(', ')} WHERE local_id = ?`,
      [...values, localId],
    );
    if (changes === 0) throw groupNotFound(localId);
  }

  // ----- events -----

  async insertEvents(localId: string, rows: readonly NewEventRow[]): Promise<InsertEventsResult> {
    checkLocalId(localId);
    if (!Array.isArray(rows)) invalid('rows must be an array');
    const incoming = rows.map(checkNewEvent);

    return this.db.transaction(async (tx) => {
      await requireGroup(tx, localId);

      // Current acked/seq of every id this call touches, as if the rows were applied one by one.
      const known = new Map<
        string,
        { acked: boolean; seq: number | null; pending?: CheckedEvent }
      >();
      const ids = [...new Set(incoming.map((r) => r.id))];
      for (const chunk of chunked(ids, MAX_PARAMS - 1)) {
        const found = await tx.all<{ id: string; acked: number; seq: number | null }>(
          `SELECT id, acked, seq FROM events WHERE local_id = ? AND id IN (${placeholders(chunk.length)})`,
          [localId, ...chunk],
        );
        for (const r of found) known.set(r.id, { acked: r.acked === 1, seq: r.seq });
      }

      const inserted: CheckedEvent[] = [];
      const updated = new Map<string, number | null>();
      let acked = 0;
      for (const row of incoming) {
        const current = known.get(row.id);
        if (!current) {
          const pending = { ...row };
          inserted.push(pending);
          known.set(row.id, { acked: row.acked, seq: row.seq, pending });
          continue;
        }
        // Insert-or-ignore; only an acked duplicate (a pulled page) touches the existing row, and only its
        // acked flag and seq. A seq is never lowered.
        if (!row.acked) continue;
        const seq =
          row.seq === null
            ? current.seq
            : current.seq === null
              ? row.seq
              : Math.max(current.seq, row.seq);
        if (current.acked && seq === current.seq) continue;
        current.acked = true;
        current.seq = seq;
        acked += 1;
        if (current.pending) {
          current.pending.acked = true;
          current.pending.seq = seq;
        } else {
          updated.set(row.id, seq);
        }
      }

      const COLUMNS = 10;
      for (const chunk of chunked(inserted, Math.floor(MAX_PARAMS / COLUMNS))) {
        await tx.run(
          `INSERT INTO events (local_id, id, origin, acked, seq, ts, envelope, status, push_state, size)
           VALUES ${chunk.map(() => `(${placeholders(COLUMNS)})`).join(', ')}`,
          chunk.flatMap((r) => [
            localId,
            r.id,
            r.origin,
            r.acked ? 1 : 0,
            r.seq,
            r.ts,
            r.envelope,
            r.status,
            r.pushState,
            r.size,
          ]),
        );
      }
      for (const chunk of chunked([...updated], Math.floor((MAX_PARAMS - 1) / 3))) {
        await tx.run(
          `UPDATE events SET acked = 1, seq = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END
           WHERE local_id = ? AND id IN (${placeholders(chunk.length)})`,
          [...chunk.flat(), localId, ...chunk.map(([id]) => id)],
        );
      }
      return { inserted: inserted.map((r) => r.id), acked };
    });
  }

  async outbox(localId: string, limit: number): Promise<OutboxRow[]> {
    checkLocalId(localId);
    checkInt(limit, 'limit');
    return this.db.all<OutboxRow>(
      `SELECT id, ts, envelope FROM events
       WHERE local_id = ? AND acked = 0 AND push_state = 'pending'
       ORDER BY ${LOG_ORDER} LIMIT ?`,
      [localId, limit],
    );
  }

  ack(localId: string, ids: readonly string[]): Promise<void> {
    return this.updateEvents(localId, ids, 'acked = 1');
  }

  markRejected(localId: string, ids: readonly string[]): Promise<void> {
    return this.updateEvents(localId, ids, `push_state = 'rejected'`);
  }

  async resetAcked(localId: string, options?: { clearRejected?: boolean }): Promise<void> {
    checkLocalId(localId);
    const clearRejected =
      options?.clearRejected === undefined
        ? false
        : checkBoolean(options.clearRejected, 'clearRejected');
    await this.db.run(
      clearRejected
        ? `UPDATE events SET acked = 0, seq = NULL, push_state = 'pending' WHERE local_id = ?`
        : 'UPDATE events SET acked = 0, seq = NULL WHERE local_id = ?',
      [localId],
    );
  }

  async listEnvelopes(localId: string): Promise<StoredEnvelopeRow[]> {
    checkLocalId(localId);
    return this.db.all<StoredEnvelopeRow>(
      `SELECT id, origin, ts, envelope, status FROM events WHERE local_id = ? ORDER BY ${LOG_ORDER}`,
      [localId],
    );
  }

  async listReadable(localId: string): Promise<ReadableEnvelope[]> {
    checkLocalId(localId);
    const rows = await this.db.all<{ id: string; envelope: string }>(
      `SELECT id, envelope FROM events WHERE local_id = ? AND status IN ${READABLE_IN}
       ORDER BY ${LOG_ORDER}`,
      [localId],
    );
    return rows.map((r) => ({ id: r.id, envelope: parseReadable(r.id, r.envelope) }));
  }

  async latestTs(localId: string): Promise<number | null> {
    checkLocalId(localId);
    const row = await this.db.get<{ latest: number | null }>(
      'SELECT MAX(ts) AS latest FROM events WHERE local_id = ?',
      [localId],
    );
    return row?.latest ?? null;
  }

  async countByStatus(localId: string): Promise<EventCounts> {
    checkLocalId(localId);
    const rows = await this.db.all<{ status: string; n: number; outbox: number; rejected: number }>(
      `SELECT status, COUNT(*) AS n,
              SUM(acked = 0 AND push_state = 'pending') AS outbox,
              SUM(push_state = 'rejected') AS rejected
       FROM events WHERE local_id = ? GROUP BY status`,
      [localId],
    );
    const counts: EventCounts = {
      byStatus: {
        ok: 0,
        undecryptable: 0,
        invalid: 0,
        unsupported_envelope: 0,
        unsupported_body: 0,
      },
      outbox: 0,
      rejected: 0,
    };
    for (const r of rows) {
      if ((EVENT_STATUSES as readonly string[]).includes(r.status)) {
        counts.byStatus[r.status as EventStatus] = r.n;
      }
      counts.outbox += r.outbox;
      counts.rejected += r.rejected;
    }
    return counts;
  }

  async usage(localId: string): Promise<{ bytes: number; events: number }> {
    checkLocalId(localId);
    const row = await this.db.get<{ bytes: number | null; events: number }>(
      'SELECT SUM(size) AS bytes, COUNT(size) AS events FROM events WHERE local_id = ?',
      [localId],
    );
    return { bytes: row?.bytes ?? 0, events: row?.events ?? 0 };
  }

  async pruneUndecryptable(localId: string, keep: number): Promise<number> {
    return this.pruneStatus(localId, 'undecryptable', keep);
  }

  async pruneUnsupportedEnvelopes(localId: string, keep: number): Promise<number> {
    return this.pruneStatus(localId, 'unsupported_envelope', keep);
  }

  /** Keeps the `keep` most recently inserted rows of one unopenable status (rowid order) and deletes the rest. */
  private async pruneStatus(
    localId: string,
    status: 'undecryptable' | 'unsupported_envelope',
    keep: number,
  ): Promise<number> {
    checkLocalId(localId);
    checkInt(keep, 'keep');
    const { changes } = await this.db.run(
      `DELETE FROM events
       WHERE local_id = ? AND status = ? AND rowid NOT IN (
         SELECT rowid FROM events WHERE local_id = ? AND status = ?
         ORDER BY rowid DESC LIMIT ?
       )`,
      [localId, status, localId, status, keep],
    );
    return changes;
  }

  /** `SET <assignment>` on the given ids of one group; ids that do not exist are ignored. */
  private async updateEvents(
    localId: string,
    ids: readonly string[],
    assignment: string,
  ): Promise<void> {
    checkLocalId(localId);
    const unique = [...new Set(checkIds(ids))];
    if (unique.length === 0) return;
    const chunks = chunked(unique, MAX_PARAMS - 1);
    await this.db.transaction(async (tx) => {
      for (const chunk of chunks) {
        await tx.run(
          `UPDATE events SET ${assignment} WHERE local_id = ? AND id IN (${placeholders(chunk.length)})`,
          [localId, ...chunk],
        );
      }
    });
  }

  // ----- prefs -----

  async getPref(key: PrefKey): Promise<string | null> {
    checkEnum(key, PREF_KEYS, 'key');
    const row = await this.db.get<{ value: string | null }>(
      'SELECT value FROM prefs WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }

  async setPref(key: PrefKey, value: string | null): Promise<void> {
    checkEnum(key, PREF_KEYS, 'key');
    if (value === null) {
      await this.db.run('DELETE FROM prefs WHERE key = ?', [key]);
      return;
    }
    await this.db.run(
      'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, checkString(value, 'value')],
    );
  }
}

function groupNotFound(localId: string): StoreError {
  return new StoreError('group_not_found', `no group ${localId}`);
}

async function requireGroup(db: SqlDriver, localId: string): Promise<void> {
  const row = await db.get('SELECT 1 AS present FROM groups WHERE local_id = ?', [localId]);
  if (!row) throw groupNotFound(localId);
}

/**
 * Applies the per-connection pragmas, migrates, and returns the store. Pass a root driver (not a transaction's).
 */
export async function openSqliteStore(
  driver: SqlDriver,
  options: SqliteStoreOptions = {},
): Promise<SqliteStore> {
  if (driver.inTransaction) invalid('openSqliteStore needs a root driver, not a transaction');
  await applyConnectionPragmas(driver);
  const store = new SqliteStore(driver, options);
  await store.migrate();
  return store;
}
