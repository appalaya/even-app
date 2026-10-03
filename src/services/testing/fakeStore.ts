/**
 * In-memory `Store` for Node tests, honouring the contract in `../storage/types.ts`:
 * - `insertEvents` is insert-or-ignore on (localId, id); an acked incoming duplicate sets `acked`, `seq` and
 *   `receivedAt` on the existing row (a `seq` is never lowered; a null incoming one keeps the stored one, as a null
 *   `receivedAt` does); an unacked duplicate changes nothing; the envelope, status, ts and origin of an existing row
 *   are never replaced, except that a pulled readable row (`ok`, `invalid`, `unsupported_body`) replaces an
 *   `undecryptable` row's envelope, status and ts. A `receivedAt` that is not a usable R is stored as null. Rows are
 *   validated like sqliteStore.ts's `checkNewEvent` (text ≤ 16 KiB, strict v1 for readable statuses, same id,
 *   `ok` has a `ts`), all or nothing, and the group row must exist.
 * - the outbox is `acked = 0 AND push_state = 'pending'`, ordered by `ts` (null last) then `id`.
 * - `resetAcked` keeps rejected rows rejected unless `clearRejected`, and clears `receivedAt` unless `keepReceived`;
 *   `setServer` clears it too. `latestOwnReceipt` looks across every group on the given server.
 * - `setServer` refuses, changing nothing, a re-encryption that misses a readable row, names another row, repeats
 *   an id, or holds an envelope that is not v1 or carries another id; stored text is the canonical `{id, v, n, c}`.
 * - `listGroups` orders by `createdAt`, then `localId` (the SQL `ORDER BY created_at, local_id`).
 * - `transaction` snapshots everything and restores it if `fn` throws; nested calls behave as savepoints, and
 *   top-level transactions run one at a time.
 * The engine suite runs against this and the real store alike (engine.test.ts), so a disagreement shows up there.
 * `fault` lets a test throw from any method (e.g. `setCursor`) to exercise rollback.
 */
import { envelopeShape, isB64url, isEnvelope, isId, isReceivedAt } from '@even/core';

import { storedSizeOfText } from '../storage/envelopeSize';
import type {
  EventCounts,
  EventRow,
  EventStatus,
  GroupLifecycle,
  GroupRow,
  InsertEventsResult,
  NewEventRow,
  OutboxRow,
  OwnReceipt,
  PendingDeleteRow,
  PendingDeletes,
  PrefKey,
  ReadableEnvelope,
  Store,
  StoredEnvelopeRow,
  SyncStatePatch,
} from '../storage/types';

interface StoredRow extends EventRow {
  /** Insertion order, like SQLite's rowid. */
  rowid: number;
}

interface State {
  groups: Map<string, GroupRow>;
  events: Map<string, Map<string, StoredRow>>;
  prefs: Map<PrefKey, string>;
  pendingDeletes: PendingDeleteRow[];
  nextRowid: number;
}

const READABLE: ReadonlySet<EventStatus> = new Set<EventStatus>([
  'ok',
  'invalid',
  'unsupported_body',
]);
const ALL_STATUSES: readonly EventStatus[] = [
  'ok',
  'undecryptable',
  'invalid',
  'unsupported_envelope',
  'unsupported_body',
];

/** sqliteStore.ts `MAX_ENVELOPE_TEXT_LENGTH`. */
export const FAKE_MAX_ENVELOPE_TEXT_LENGTH = 16_384;

/** The structural rules sqliteStore.ts enforces per row before any write. */
function checkRow(row: NewEventRow, index: number): void {
  const at = `FakeStore.insertEvents rows[${index}]`;
  if (!isId(row.id)) throw new Error(`${at}.id is not a 22-char id`);
  if (row.envelope.length > FAKE_MAX_ENVELOPE_TEXT_LENGTH)
    throw new Error(`${at}.envelope is too long`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.envelope);
  } catch {
    throw new Error(`${at}.envelope is not JSON`);
  }
  const shape = envelopeShape(parsed);
  if (shape.ok && (parsed as { id: string }).id !== row.id)
    throw new Error(`${at}: envelope id differs`);
  if (READABLE.has(row.status) && !isEnvelope(parsed)) {
    throw new Error(`${at}: status ${row.status} needs a v1 envelope {id, v, n, c}`);
  }
  if (row.status === 'unsupported_envelope' && !(shape.ok && shape.v !== 1)) {
    throw new Error(`${at}: unsupported_envelope needs a well-formed envelope with v ≠ 1`);
  }
  if (row.status === 'ok' && row.ts === null) throw new Error(`${at}: ok needs a ts`);
}

function cloneState(state: State): State {
  const events = new Map<string, Map<string, StoredRow>>();
  for (const [localId, rows] of state.events) {
    events.set(localId, new Map([...rows].map(([id, row]) => [id, { ...row }])));
  }
  return {
    groups: new Map([...state.groups].map(([id, g]) => [id, { ...g }])),
    events,
    prefs: new Map(state.prefs),
    pendingDeletes: state.pendingDeletes.map((d) => ({ ...d })),
    nextRowid: state.nextRowid,
  };
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `ts` ascending with null last, then `id`. */
function byTsThenId(a: EventRow, b: EventRow): number {
  if (a.ts !== b.ts) {
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return a.ts - b.ts;
  }
  return compareCodeUnits(a.id, b.id);
}

export type FaultHook = (method: string, args: readonly unknown[]) => void;

/** The schema version this fake acts as (sqliteStore's `SCHEMA_VERSION`); see `migrate`. */
export const FAKE_SCHEMA_VERSION = 5;

export class FakeStore implements Store {
  /**
   * The schema version the data stands at, for upgrade tests: a fake made at an older version holds data as that
   * build left it, and `migrate` applies what the later migrations do to data (v5: every group's cursor back to 0, so
   * the next sync pulls the whole log again).
   */
  schemaVersion = FAKE_SCHEMA_VERSION;
  private state: State = {
    groups: new Map(),
    events: new Map(),
    prefs: new Map(),
    pendingDeletes: [],
    nextRowid: 1,
  };
  private queue: Promise<unknown> = Promise.resolve();
  /** Called before every method; throw from it to simulate a storage failure. */
  fault: FaultHook | null = null;
  /** Method names in call order, for assertions. */
  readonly calls: string[] = [];

  readonly pendingDeletes: PendingDeletes = {
    add: async (entry) => {
      this.enter('pendingDeletes.add', [entry]);
      if (!isB64url(entry.authToken, 43))
        throw new Error('FakeStore: authToken must be 43 base64url');
      const exists = this.state.pendingDeletes.some(
        (d) => d.localId === entry.localId && d.serverUrl === entry.serverUrl,
      );
      if (!Number.isSafeInteger(entry.createdAt))
        throw new Error('FakeStore: createdAt must be an integer');
      if (!exists) {
        const { localId, serverUrl, authToken, createdAt } = entry;
        this.state.pendingDeletes.push({ localId, serverUrl, authToken, createdAt, attempts: 0 });
      }
    },
    list: async () => {
      this.enter('pendingDeletes.list', []);
      return this.state.pendingDeletes.map((d) => ({ ...d }));
    },
    recordAttempt: async (entry) => {
      this.enter('pendingDeletes.recordAttempt', [entry]);
      for (const d of this.state.pendingDeletes) {
        if (d.localId === entry.localId && d.serverUrl === entry.serverUrl) d.attempts += 1;
      }
    },
    remove: async (entry) => {
      this.enter('pendingDeletes.remove', [entry]);
      this.state.pendingDeletes = this.state.pendingDeletes.filter(
        (d) => !(d.localId === entry.localId && d.serverUrl === entry.serverUrl),
      );
    },
  };

  private enter(method: string, args: readonly unknown[]): void {
    this.calls.push(method);
    this.fault?.(method, args);
  }

  private rows(localId: string): Map<string, StoredRow> {
    let rows = this.state.events.get(localId);
    if (rows === undefined) {
      rows = new Map();
      this.state.events.set(localId, rows);
    }
    return rows;
  }

  private group(localId: string): GroupRow {
    const group = this.state.groups.get(localId);
    if (group === undefined) throw new Error(`FakeStore: no group ${localId}`);
    return group;
  }

  // ----- test helpers (not part of Store) -----

  /** Every row of a group, in insertion order, copied. */
  dump(localId: string): EventRow[] {
    return [...this.rows(localId).values()]
      .sort((a, b) => a.rowid - b.rowid)
      .map(({ rowid: _rowid, ...row }) => ({ ...row }));
  }

  // ----- Store -----

  async migrate(): Promise<void> {
    this.enter('migrate', []);
    if (this.schemaVersion < 5) {
      for (const group of this.state.groups.values()) group.cursor = 0;
    }
    this.schemaVersion = FAKE_SCHEMA_VERSION;
  }

  /** Top-level transactions run one at a time; `fn` gets a view whose `transaction` is a savepoint. */
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.savepoint(fn));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async savepoint<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    this.enter('transaction', []);
    const snapshot = cloneState(this.state);
    try {
      return await fn(this.txView());
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }

  private txView(): Store {
    const savepoint = <T>(fn: (tx: Store) => Promise<T>): Promise<T> => this.savepoint(fn);
    return new Proxy(this, {
      get(target, property) {
        if (property === 'transaction') return savepoint;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }

  async listGroups(): Promise<GroupRow[]> {
    this.enter('listGroups', []);
    return [...this.state.groups.values()]
      .sort((a, b) => a.createdAt - b.createdAt || compareCodeUnits(a.localId, b.localId))
      .map((g) => ({ ...g }));
  }

  async getGroup(localId: string): Promise<GroupRow | null> {
    this.enter('getGroup', [localId]);
    const group = this.state.groups.get(localId);
    return group === undefined ? null : { ...group };
  }

  async upsertGroup(row: GroupRow): Promise<void> {
    this.enter('upsertGroup', [row]);
    const pinned = this.state.groups.get(row.localId)?.creationId ?? null;
    this.state.groups.set(row.localId, { ...row, creationId: pinned ?? row.creationId });
  }

  async pinCreation(localId: string, envelopeId: string): Promise<boolean> {
    this.enter('pinCreation', [localId, envelopeId]);
    if (!isId(envelopeId)) throw new Error('FakeStore.pinCreation: not a 22-char id');
    const group = this.group(localId);
    if (group.creationId !== null) return false;
    group.creationId = envelopeId;
    return true;
  }

  async setGroupState(localId: string, state: GroupLifecycle): Promise<void> {
    this.enter('setGroupState', [localId, state]);
    this.group(localId).state = state;
  }

  async setServer(
    localId: string,
    serverUrl: string,
    reencrypted: readonly ReadableEnvelope[],
  ): Promise<void> {
    this.enter('setServer', [localId, serverUrl, reencrypted]);
    const replacements = new Map<string, string>();
    for (const { id, envelope } of reencrypted) {
      if (!isEnvelope(envelope) || envelope.id !== id || replacements.has(id)) {
        throw new Error(`FakeStore.setServer: bad re-encryption entry ${id}`);
      }
      replacements.set(id, JSON.stringify({ id, v: envelope.v, n: envelope.n, c: envelope.c }));
    }
    const group = this.group(localId);
    const rows = this.rows(localId);
    const readable = [...rows.values()].filter((row) => READABLE.has(row.status));
    const missing = readable.filter((row) => !replacements.has(row.id));
    const extra = [...replacements.keys()].filter(
      (id) => !READABLE.has(rows.get(id)?.status ?? 'undecryptable'),
    );
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `FakeStore.setServer: incomplete_reencryption (${missing.length} missing, ${extra.length} extra)`,
      );
    }
    group.serverUrl = serverUrl;
    group.cursor = 0;
    group.epoch = null;
    if (group.state === 'blocked') group.state = 'active';
    for (const [id, row] of [...rows]) {
      const replacement = replacements.get(id);
      if (replacement === undefined) {
        rows.delete(id);
        continue;
      }
      row.envelope = replacement;
      row.acked = false;
      row.seq = null;
      row.receivedAt = null;
      row.pushState = 'pending';
    }
  }

  async setCursor(localId: string, cursor: number): Promise<void> {
    this.enter('setCursor', [localId, cursor]);
    this.group(localId).cursor = cursor;
  }

  async setSyncState(localId: string, patch: SyncStatePatch): Promise<void> {
    this.enter('setSyncState', [localId, patch]);
    const group = this.group(localId);
    if (patch.epoch !== undefined) group.epoch = patch.epoch;
    if (patch.lastSyncedAt !== undefined) group.lastSyncedAt = patch.lastSyncedAt;
    if (patch.lastSyncError !== undefined) group.lastSyncError = patch.lastSyncError;
    if (patch.epochResetsThisCycle !== undefined) {
      group.epochResetsThisCycle = patch.epochResetsThisCycle;
    }
  }

  async setMyMember(localId: string, memberId: string | null): Promise<void> {
    this.enter('setMyMember', [localId, memberId]);
    this.group(localId).myMemberId = memberId;
  }

  async setNameCache(
    localId: string,
    cache: { name?: string | null; currency?: string | null },
  ): Promise<void> {
    this.enter('setNameCache', [localId, cache]);
    const group = this.group(localId);
    if (cache.name !== undefined) group.nameCache = cache.name;
    if (cache.currency !== undefined) group.currencyCache = cache.currency;
  }

  async deleteGroup(localId: string): Promise<void> {
    this.enter('deleteGroup', [localId]);
    this.state.groups.delete(localId);
    this.state.events.delete(localId);
  }

  async insertEvents(localId: string, rows: readonly NewEventRow[]): Promise<InsertEventsResult> {
    this.enter('insertEvents', [localId, rows]);
    this.group(localId);
    rows.forEach(checkRow);
    const table = this.rows(localId);
    const inserted: string[] = [];
    let acked = 0;
    for (const row of rows) {
      const existing = table.get(row.id);
      if (existing === undefined) {
        table.set(row.id, {
          localId,
          id: row.id,
          origin: row.origin,
          acked: row.acked,
          seq: row.seq,
          ts: row.ts,
          envelope: row.envelope,
          status: row.status,
          pushState: row.pushState ?? 'pending',
          receivedAt: isReceivedAt(row.receivedAt) ? row.receivedAt : null,
          rowid: this.state.nextRowid++,
        });
        inserted.push(row.id);
        continue;
      }
      if (!row.acked) continue;
      const seq =
        row.seq === null
          ? existing.seq
          : existing.seq === null
            ? row.seq
            : Math.max(existing.seq, row.seq);
      if (!existing.acked || existing.seq !== seq) acked += 1;
      existing.acked = true;
      existing.seq = seq;
      if (isReceivedAt(row.receivedAt)) existing.receivedAt = row.receivedAt;
      if (existing.status === 'undecryptable' && READABLE.has(row.status)) {
        // A pulled envelope replaces an unreadable row of its id (sqliteStore.ts): content, ts, status.
        existing.envelope = row.envelope;
        existing.status = row.status;
        existing.ts = row.ts;
      }
    }
    return { inserted, acked };
  }

  async outbox(localId: string, limit: number): Promise<OutboxRow[]> {
    this.enter('outbox', [localId, limit]);
    return [...this.rows(localId).values()]
      .filter((row) => !row.acked && row.pushState === 'pending')
      .sort(byTsThenId)
      .slice(0, limit)
      .map((row) => ({ id: row.id, ts: row.ts, envelope: row.envelope }));
  }

  async outboxEntry(localId: string, id: string): Promise<OutboxRow | null> {
    this.enter('outboxEntry', [localId, id]);
    const row = this.rows(localId).get(id);
    if (row === undefined || row.acked || row.pushState !== 'pending') return null;
    return { id: row.id, ts: row.ts, envelope: row.envelope };
  }

  async ack(localId: string, ids: readonly string[]): Promise<void> {
    this.enter('ack', [localId, ids]);
    const table = this.rows(localId);
    for (const id of ids) {
      const row = table.get(id);
      if (row !== undefined) row.acked = true;
    }
  }

  async setReceivedAt(
    localId: string,
    values: readonly (readonly [id: string, receivedAt: number])[],
  ): Promise<void> {
    this.enter('setReceivedAt', [localId, values]);
    const table = this.rows(localId);
    for (const [id, receivedAt] of values) {
      if (!isId(id)) throw new Error(`FakeStore.setReceivedAt: ${String(id)} is not a 22-char id`);
      const row = table.get(id);
      if (row !== undefined && isReceivedAt(receivedAt)) row.receivedAt = receivedAt;
    }
  }

  async markRejected(localId: string, ids: readonly string[]): Promise<void> {
    this.enter('markRejected', [localId, ids]);
    const table = this.rows(localId);
    for (const id of ids) {
      const row = table.get(id);
      if (row !== undefined) row.pushState = 'rejected';
    }
  }

  async resetAcked(
    localId: string,
    options?: { clearRejected?: boolean; keepReceived?: boolean },
  ): Promise<void> {
    this.enter('resetAcked', [localId, options]);
    for (const row of this.rows(localId).values()) {
      row.acked = false;
      row.seq = null;
      if (options?.keepReceived !== true) row.receivedAt = null;
      if (options?.clearRejected === true) row.pushState = 'pending';
    }
  }

  async listEnvelopes(localId: string): Promise<StoredEnvelopeRow[]> {
    this.enter('listEnvelopes', [localId]);
    return [...this.rows(localId).values()].sort(byTsThenId).map((row) => ({
      id: row.id,
      origin: row.origin,
      ts: row.ts,
      envelope: row.envelope,
      status: row.status,
      receivedAt: row.receivedAt,
    }));
  }

  async listReadable(localId: string): Promise<ReadableEnvelope[]> {
    this.enter('listReadable', [localId]);
    return [...this.rows(localId).values()]
      .filter((row) => READABLE.has(row.status))
      .sort(byTsThenId)
      .map((row) => ({
        id: row.id,
        envelope: JSON.parse(row.envelope) as ReadableEnvelope['envelope'],
      }));
  }

  async latestTs(localId: string): Promise<number | null> {
    this.enter('latestTs', [localId]);
    let latest: number | null = null;
    for (const row of this.rows(localId).values()) {
      if (row.ts !== null && (latest === null || row.ts > latest)) latest = row.ts;
    }
    return latest;
  }

  async latestOwnReceipt(serverUrl: string): Promise<OwnReceipt | null> {
    this.enter('latestOwnReceipt', [serverUrl]);
    let best: OwnReceipt | null = null;
    for (const [localId, rows] of this.state.events) {
      if (this.state.groups.get(localId)?.serverUrl !== serverUrl) continue;
      for (const row of rows.values()) {
        if (row.origin !== 'local' || row.receivedAt === null || row.ts === null) continue;
        if (
          best === null ||
          row.receivedAt > best.receivedAt ||
          (row.receivedAt === best.receivedAt && row.ts < best.ts)
        ) {
          best = { ts: row.ts, receivedAt: row.receivedAt };
        }
      }
    }
    return best;
  }

  async countByStatus(localId: string): Promise<EventCounts> {
    this.enter('countByStatus', [localId]);
    const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<
      EventStatus,
      number
    >;
    let outbox = 0;
    let rejected = 0;
    for (const row of this.rows(localId).values()) {
      byStatus[row.status] += 1;
      if (!row.acked && row.pushState === 'pending') outbox += 1;
      if (row.pushState === 'rejected') rejected += 1;
    }
    return { byStatus, outbox, rejected };
  }

  /** sqliteStore.ts's `SUM(size)`, measured from each row's text as it would have been stored. */
  async usage(localId: string): Promise<{ bytes: number; events: number }> {
    this.enter('usage', [localId]);
    let bytes = 0;
    let events = 0;
    for (const row of this.rows(localId).values()) {
      const size = storedSizeOfText(row.envelope);
      if (size === null) continue;
      bytes += size;
      events += 1;
    }
    return { bytes, events };
  }

  async pruneUndecryptable(localId: string, keep: number): Promise<number> {
    this.enter('pruneUndecryptable', [localId, keep]);
    return this.pruneStatus(localId, 'undecryptable', keep);
  }

  async pruneUnsupportedEnvelopes(localId: string, keep: number): Promise<number> {
    this.enter('pruneUnsupportedEnvelopes', [localId, keep]);
    return this.pruneStatus(localId, 'unsupported_envelope', keep);
  }

  private pruneStatus(localId: string, status: EventStatus, keep: number): number {
    const table = this.rows(localId);
    const junk = [...table.values()]
      .filter((row) => row.status === status)
      .sort((a, b) => b.rowid - a.rowid);
    const doomed = junk.slice(Math.max(0, keep));
    for (const row of doomed) table.delete(row.id);
    return doomed.length;
  }

  async getPref(key: PrefKey): Promise<string | null> {
    this.enter('getPref', [key]);
    return this.state.prefs.get(key) ?? null;
  }

  async setPref(key: PrefKey, value: string | null): Promise<void> {
    this.enter('setPref', [key, value]);
    if (value === null) this.state.prefs.delete(key);
    else this.state.prefs.set(key, value);
  }
}

export function createFakeStore(options: { schemaVersion?: number } = {}): FakeStore {
  const store = new FakeStore();
  if (options.schemaVersion !== undefined) store.schemaVersion = options.schemaVersion;
  return store;
}
