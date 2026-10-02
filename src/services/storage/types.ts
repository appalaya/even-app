/**
 * Storage contract: the app's only access to SQLite (expo-sqlite). Types only; the implementation lives
 * beside this file. Source of truth for the tables: design.md "Local storage" → "SQLite schema".
 *
 * Rules the implementation must keep:
 * - SQLite holds envelopes, never decrypted bodies. The only plaintext derived from bodies is `events.ts`,
 *   `groups.name_cache` and `groups.currency_cache` (design.md "Architecture Overview", rule 2). Secrets live in
 *   secure store, not here. The one credential in SQLite is `pending_deletes.auth_token`: a per-server bearer
 *   token (it cannot decrypt anything), kept so a DELETE can be retried after Leave removed the secret.
 * - Row types are camelCase mirrors of the snake_case columns; the column is named on each field.
 * - SQLite booleans (0/1) surface as `boolean`.
 * - Every method is async and safe to call from a background task.
 *
 * Errors (implementation: sqliteStore.ts): deliberate failures are `StoreError`s (errors.ts) with a `code`.
 * Every argument is validated before any SQL runs (ids are 22 base64url chars, local ids 43, server URLs
 * canonical), so malformed input rejects with `invalid_argument` and changes nothing. Methods that update a
 * group row, and `insertEvents`, reject with `group_not_found` when the row is missing (for example Leave ran
 * mid-sync), which also rolls back the surrounding `transaction`.
 */
import type { Envelope } from '@even/core';

// ---------- Column enums ----------

/** `groups.state`. Only `active` groups sync (design.md "Sync engine" → "Cycle, per group"). */
export type GroupLifecycle = 'active' | 'closed' | 'hidden' | 'blocked';

/**
 * `events.status`, decided on pull (design.md "Cycle, per group", step 2):
 * - `ok`: opened and passed `parseEvent`.
 * - `undecryptable`: failed `envelopeShape`, or AEAD failed under the correct key. Capped per group.
 * - `invalid`: opened, failed `parseEvent`. Kept.
 * - `unsupported_envelope`: well-formed, `v ≠ 1`; cannot be opened by this client. Kept, capped per group.
 * - `unsupported_body`: opened, unknown `sv` or `type`. Kept.
 */
export type EventStatus =
  'ok' | 'undecryptable' | 'invalid' | 'unsupported_envelope' | 'unsupported_body';

/** Statuses whose envelope is a valid v1 envelope that this client opened (and can re-encrypt). */
export type ReadableStatus = 'ok' | 'invalid' | 'unsupported_body';

/** `events.origin`. Never synced. Only `local` rows are carried into a rotated successor. */
export type EventOrigin = 'local' | 'remote';

/** `events.push_state`. `rejected` = the server answered `invalid_envelope` for it; it leaves the outbox. */
export type PushState = 'pending' | 'rejected';

// ---------- Rows ----------

/** One row of `groups`. */
export interface GroupRow {
  /** `local_id` (PK): 43-char id derived from the secret; server-independent. */
  localId: string;
  /** `server_url`: canonical form (PROTOCOL.md §8.1), from `canonicalOrigin`. */
  serverUrl: string;
  /** `epoch`: last epoch seen from `serverUrl`; null until first sync. `'unknown'` after a null-epoch reset. */
  epoch: string | null;
  /** `cursor`: highest `seq` committed from the current server and epoch. */
  cursor: number;
  /** `my_member_id`: the member this device claimed; null until claimed. */
  myMemberId: string | null;
  /** `name_cache`: seeded from the invite's `g`, updated from `group.created` / `group.renamed` on sync. */
  nameCache: string | null;
  /** `currency_cache`: from the invite's `cur`, confirmed by `group.created`. */
  currencyCache: string | null;
  /** `created_at`: unix ms, when this phone created or joined the group. */
  createdAt: number;
  /** `last_synced_at`: unix ms of the last successful cycle. */
  lastSyncedAt: number | null;
  /** `last_sync_error`: a sync error code (PROTOCOL.md §7 name or `epoch_unstable`), or null. */
  lastSyncError: string | null;
  /** `state`. */
  state: GroupLifecycle;
  /** `epoch_resets_this_cycle`: 0 or 1; see the epoch rule. */
  epochResetsThisCycle: number;
}

/** One row of `events`. */
export interface EventRow {
  /** `local_id` (PK part 1). */
  localId: string;
  /** `id` (PK part 2): the envelope id, 22-char base64url. */
  id: string;
  /** `origin`. */
  origin: EventOrigin;
  /** `acked`: the current server has acknowledged it. Pulled rows arrive acked. */
  acked: boolean;
  /** `seq`: from the current server and epoch; null if unknown. */
  seq: number | null;
  /** `ts`: the body's ordering timestamp, cached; null when the body could not be read. */
  ts: number | null;
  /**
   * `envelope`: the envelope's JSON text exactly as stored, ciphertext for the CURRENT server's group id.
   * Kept as text because `undecryptable` and `unsupported_envelope` rows are not v1 `Envelope`s.
   */
  envelope: string;
  /** `status`. */
  status: EventStatus;
  /** `push_state`. */
  pushState: PushState;
}

/** Input to `insertEvents`. `localId` comes from the call; `pushState` defaults to `pending`. */
export type NewEventRow = Omit<EventRow, 'localId' | 'pushState'> & { pushState?: PushState };

/** One row of `pending_deletes`: a server copy we still owe a DELETE to. */
export interface PendingDeleteRow {
  /** `local_id`. */
  localId: string;
  /** `server_url`: canonical origin of the server holding the copy. */
  serverUrl: string;
  /**
   * `auth_token`: `deriveServer(secret, serverUrl).authToken` as 43-char base64url, derived while the secret still
   * existed. The server group id is `base64url(SHA-256(token))`, so this is all a DELETE needs (design.md
   * "Rotation, moving, closing").
   */
  authToken: string;
  /** `created_at`: when the debt was recorded, unix ms. Given up 30 days after it (design.md "Pending deletes"). */
  createdAt: number;
  /** `attempts`: DELETEs that got no answer, or a transient one (5xx, 429, 503). Given up at 20. */
  attempts: number;
}

/** Input to `pendingDeletes.add`: a new debt has made no attempt yet. */
export type NewPendingDelete = Omit<PendingDeleteRow, 'attempts'>;

/** Identifies a debt: `pending_deletes`' primary key. */
export type PendingDeleteKey = Pick<PendingDeleteRow, 'localId' | 'serverUrl'>;

/** An outbox entry, in push order. */
export type OutboxRow = Pick<EventRow, 'id' | 'ts' | 'envelope'>;

/** A readable envelope, parsed: statuses `ok`, `invalid`, `unsupported_body`. */
export interface ReadableEnvelope {
  id: string;
  envelope: Envelope;
}

/** An envelope of any status, for the group file and the usage meter. */
export type StoredEnvelopeRow = Pick<EventRow, 'id' | 'origin' | 'ts' | 'envelope' | 'status'>;

/** Result of `insertEvents`. */
export interface InsertEventsResult {
  /** Ids that were not present before this call, in input order. */
  inserted: string[];
  /** Existing rows whose `acked`/`seq` were updated by an acked input row. */
  acked: number;
}

/** Counts for settings, banners, and the Leave confirmation. */
export interface EventCounts {
  byStatus: Record<EventStatus, number>;
  /** Rows in the outbox (`acked = 0 AND push_state = 'pending'`). */
  outbox: number;
  /** Rows with `push_state = 'rejected'`. */
  rejected: number;
}

/** Sync bookkeeping written by the engine; omitted fields are left unchanged. */
export type SyncStatePatch = Partial<
  Pick<GroupRow, 'epoch' | 'lastSyncedAt' | 'lastSyncError' | 'epochResetsThisCycle'>
>;

/** Keys of the `prefs` table (local, never synced). Adding a pref is adding a key here. */
export type PrefKey =
  /** Default member name prefilled on join and create. */
  | 'me.name'
  /** Default member emoji; absent means initials. */
  | 'me.emoji'
  /** App settings → Appearance: `system` | `light` | `dark`. */
  | 'appearance'
  /** App theme id (themes are a later feature); absent means `even`. */
  | 'theme'
  /**
   * `1` once notification permission has been asked for: the contextual request (the first time a group with more
   * than one member is opened; design.md "Background refresh") or the App settings switch. The group screen asks
   * again only while `notifications.unanswered` says the last prompt closed with no answer.
   */
  | 'notifications.asked'
  /**
   * How many notification prompts in a row closed with no answer (Android 13 and later: Back, or a tap outside);
   * absent means none. Below the limit (state/prefs.ts `UNANSWERED_PROMPT_LIMIT`) the switch reads off-but-askable
   * and the group screen asks again.
   */
  | 'notifications.unanswered'
  /**
   * "Last notified", per group, as JSON: `{ [localId]: { at, count } }` (services/notifications/coalesce.ts). Local
   * ids and counts only, nothing decrypted.
   */
  | 'notifications.ledger'
  /**
   * The old groups whose "Move your entries into the new group?" was answered Not now (state/moveOffers.ts), as a
   * JSON array of local ids: asked once per rotation. Local ids only, nothing decrypted.
   */
  | 'rotation.notNow';

// ---------- The store ----------

export interface PendingDeletes {
  /**
   * Records a debt with its token; a duplicate (localId, serverUrl) is a no-op (both derive from the same secret,
   * so the token for a pair never changes). Needs no `groups` row: debts outlive Leave.
   */
  add(entry: NewPendingDelete): Promise<void>;
  /** In the order the debts were recorded. */
  list(): Promise<PendingDeleteRow[]>;
  /** Counts one more failed attempt on a debt. Missing rows are a no-op. */
  recordAttempt(entry: PendingDeleteKey): Promise<void>;
  /** Clears a debt (the DELETE succeeded, or the server refused it for good). Missing rows are a no-op. */
  remove(entry: PendingDeleteKey): Promise<void>;
}

export interface Store {
  /**
   * Brings the schema to the current version: `PRAGMA user_version` with an ordered array of migration
   * functions, each run in a transaction (design.md "Migrations", same pattern as Stow). Idempotent; called
   * once when the database is opened, before any other method.
   */
  migrate(): Promise<void>;

  /**
   * Runs `fn` in one exclusive SQLite transaction, committing if it resolves and rolling back if it throws.
   * `fn` must use the `tx` store it is given, never the outer one. Used for "commit each page and the
   * cursor update together" and for multi-step rewrites.
   *
   * Other callers' statements wait until the transaction ends (they never join it). Calling the outer store
   * from inside `fn` therefore waits on itself and fails with `lock_timeout`. Calling `tx.transaction` nests
   * as a savepoint in the same transaction: a nested failure undoes only the nested writes and rethrows.
   */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // ----- groups -----

  /** All groups, any state, ordered by `createdAt` ascending. */
  listGroups(): Promise<GroupRow[]>;
  getGroup(localId: string): Promise<GroupRow | null>;
  /** Inserts the row, or replaces every column of an existing row with the same `localId`. */
  upsertGroup(row: GroupRow): Promise<void>;
  setGroupState(localId: string, state: GroupLifecycle): Promise<void>;
  /**
   * Switches the group to another server in one transaction (design.md "Local storage", the paragraph on
   * `server_url`): sets `serverUrl`; `cursor = 0`; `epoch = null`; `state = 'active'` if it was `blocked`;
   * replaces the envelope of every readable row with the given re-encryption for the new group id;
   * deletes `undecryptable` and `unsupported_envelope` rows; then sets `acked = 0`, `seq = null`,
   * `push_state = 'pending'` on every remaining row. Throws, changing nothing, if a readable row has no
   * entry in `reencrypted`. The caller does the crypto; storage only swaps text.
   *
   * Also throws `incomplete_reencryption`, changing nothing, if `reencrypted` names an id that is not a readable
   * row of this group, and `invalid_argument` for a duplicate id or an envelope that is not v1 or whose `id`
   * differs from the entry's.
   */
  setServer(
    localId: string,
    serverUrl: string,
    reencrypted: readonly ReadableEnvelope[],
  ): Promise<void>;
  /** Sets `cursor`. Call inside the same `transaction` as the page's `insertEvents`. */
  setCursor(localId: string, cursor: number): Promise<void>;
  /** Sync bookkeeping: epoch, last success, last error, epoch reset counter. */
  setSyncState(localId: string, patch: SyncStatePatch): Promise<void>;
  setMyMember(localId: string, memberId: string | null): Promise<void>;
  /** Updates the cached group name and/or currency; an omitted field is left unchanged. */
  setNameCache(
    localId: string,
    cache: { name?: string | null; currency?: string | null },
  ): Promise<void>;
  /** Deletes the group row and all of its events (Leave). Does not touch secure store or pending_deletes. */
  deleteGroup(localId: string): Promise<void>;

  // ----- events -----

  /**
   * Inserts rows for a group; insert-or-ignore on `(local_id, id)`. When a row already exists and the
   * incoming row is acked (a pulled page), the existing row gets `acked = 1` and the incoming `seq`; its
   * envelope, status, ts, and origin are never replaced. An unacked incoming duplicate changes nothing.
   * Local writes: `origin 'local'`, `acked false`. Pulls: `origin 'remote'`, `acked true`, with `seq`.
   *
   * Details: rows apply in order, so a duplicate id later in the same call behaves like a duplicate of the
   * earlier row. A `seq` is never lowered (the larger one is kept) and a null incoming `seq` keeps the stored
   * one. `acked` in the result counts rows whose `acked` or `seq` actually changed. All or nothing: one
   * invalid row rejects the whole call. Structural rules per row, checked before any write:
   * - `envelope` is JSON text of at most 16,384 characters (`MAX_ENVELOPE_TEXT_LENGTH`); oversized junk
   *   from a server must be replaced or truncated by the caller before it is stored as `undecryptable`.
   * - statuses `ok`, `invalid`, `unsupported_body`: a strict v1 envelope (`isEnvelope`: exactly id, v, n, c,
   *   so strip the pull response's `seq`) whose `id` is the row id.
   * - `unsupported_envelope`: well-formed per `envelopeShape` with `v ≠ 1`, same id.
   * - `undecryptable`: any JSON; if it is a well-formed envelope, same id.
   * - `ok` rows have a `ts`.
   */
  insertEvents(localId: string, rows: readonly NewEventRow[]): Promise<InsertEventsResult>;
  /**
   * Up to `limit` rows with `acked = 0 AND push_state = 'pending'`, ordered by `ts` ascending (null last),
   * then `id`. The push batch.
   */
  outbox(localId: string, limit: number): Promise<OutboxRow[]>;
  /** Sets `acked = 1` on these ids (a push answered `200`: every envelope in the batch). Unknown ids are ignored. */
  ack(localId: string, ids: readonly string[]): Promise<void>;
  /** Sets `push_state = 'rejected'` on these ids (`invalid_envelope` at `index`). */
  markRejected(localId: string, ids: readonly string[]): Promise<void>;
  /**
   * Sets `acked = 0` and `seq = null` on every event of the group, so the whole log is re-pushed: the epoch
   * rule and group-file import. With `clearRejected`, also `push_state = 'pending'`.
   * Without it, rejected rows stay rejected: the server refused them as structurally invalid, and a new epoch
   * or an import does not make them valid; a server move (`setServer`) re-queues them with fresh envelopes.
   */
  resetAcked(localId: string, options?: { clearRejected?: boolean }): Promise<void>;
  /** Every event of the group, any status, ordered by `ts` (null last) then `id`. Group file, usage meter. */
  listEnvelopes(localId: string): Promise<StoredEnvelopeRow[]>;
  /**
   * Parsed envelopes of status `ok`, `invalid`, or `unsupported_body`, ordered by `ts` then `id`. Opening
   * these and passing the `ok` ones to `reduce` is how group state is derived; also the input to rotation
   * and server-move re-encryption.
   */
  listReadable(localId: string): Promise<ReadableEnvelope[]>;
  /**
   * The newest cached `ts` among the group's events, any status (`MAX(ts)`, served by the `events_ts` index), or
   * null when no event has one. Background refresh syncs only groups whose latest event is within 30 days.
   */
  latestTs(localId: string): Promise<number | null>;
  countByStatus(localId: string): Promise<EventCounts>;
  /**
   * The usage meter's figures: the group's rows that hold a structurally valid envelope (any status, any `v`; not
   * junk), and the sum of their stored sizes (PROTOCOL.md §4: decoded `c` + 64), from `events.size` in one query.
   */
  usage(localId: string): Promise<{ bytes: number; events: number }>;
  /**
   * Keeps the `keep` most recently inserted `undecryptable` rows (SQLite rowid order; `seq` is not usable
   * because `resetAcked` clears it) and deletes the rest; returns how many were deleted. The sync engine calls it
   * with 1000 in each pulled page's transaction that brought one; settings' "clear unreadable entries" calls it
   * with 0.
   */
  pruneUndecryptable(localId: string, keep: number): Promise<number>;
  /**
   * `pruneUndecryptable` for `unsupported_envelope` rows: keeps the `keep` most recently inserted and deletes the
   * rest. The sync engine calls it with 1000 after each pulled page that brought one, so a server sending nothing
   * but envelopes of an unknown `v` cannot fill the disk (design.md "Local storage").
   */
  pruneUnsupportedEnvelopes(localId: string, keep: number): Promise<number>;

  // ----- prefs -----

  getPref(key: PrefKey): Promise<string | null>;
  /** `null` deletes the row. */
  setPref(key: PrefKey, value: string | null): Promise<void>;

  // ----- pending deletes -----

  readonly pendingDeletes: PendingDeletes;
}

/** Opens (creating if needed) the database and runs `migrate()`. One store per process. */
export type OpenStore = (databaseName?: string) => Promise<Store>;
