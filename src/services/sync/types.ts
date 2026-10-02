/**
 * Sync contract: the transport, its errors, and the engine the screens and the background task drive.
 * Types only. Source of truth: design.md "Sync engine" and "Background refresh"; wire shapes and error
 * names from ../even-server/PROTOCOL.md §6–§7.
 */
import type { Envelope, StoredEnvelope } from '@even/core';

export type { Envelope, StoredEnvelope };

// ---------- Wire shapes (PROTOCOL.md §6) ----------

/** `GET /v1/info` (§6.1). Snake case, as on the wire. Every enforced limit appears here. */
export interface ServerInfo {
  protocol: number[];
  limits: {
    max_event_bytes: number;
    max_group_bytes: number;
    max_group_events: number;
    max_batch: number;
    max_page: number;
    /** 0 means no daily budget. */
    daily_write_budget: number;
    rate: {
      requests_per_minute: number;
      writes_per_minute: number;
      group_creates_per_minute: number;
    };
  };
  retention_days: number;
  push: boolean;
  operator?: string;
  terms?: string;
}

/** `POST /v1/groups/{groupId}/events` → 200 (§6.2). A 200 acknowledges every envelope in the request. */
export interface PushResponse {
  accepted: number;
  duplicates: number;
  /** The group's highest `seq` after the write. */
  seq: number;
  epoch: string;
  /**
   * R for every envelope sent, in request order (a duplicate reports its stored value): when the server first stored
   * it in this epoch (§4, §6.2). Absent from a server that predates it. Entries are as the server sent them: the
   * engine keeps the usable ones (core `isReceivedAt`) and only when there is exactly one per envelope.
   */
  received_at?: readonly unknown[];
}

/** `GET /v1/groups/{groupId}/events` → 200 (§6.3). A missing group is an empty page with `epoch: null`. */
export interface PullResponse {
  events: StoredEnvelope[];
  /** `seq` of the last returned envelope, or `since` if none. */
  next: number;
  /** Loop while true; never on counts. */
  more: boolean;
  epoch: string | null;
}

/**
 * One server, one origin. `HttpTransport` is `fetch` against the group's canonical `server_url`; it refuses
 * non-HTTPS URLs at construction and has no certificate options. `token` is the raw auth token from
 * `deriveServer`; the transport sends it as `Authorization: Bearer <base64url>`.
 * Every method rejects with a `SyncError` on failure.
 */
export interface Transport {
  info(): Promise<ServerInfo>;
  push(groupId: string, token: Uint8Array, envelopes: Envelope[]): Promise<PushResponse>;
  pull(groupId: string, token: Uint8Array, since: number, limit: number): Promise<PullResponse>;
  delete(groupId: string, token: Uint8Array): Promise<void>;
}

// ---------- Errors ----------

/** The `error` names of PROTOCOL.md §7 (plus §6.5's `not_implemented`). */
export type ProtocolErrorCode =
  | 'invalid_request'
  | 'invalid_envelope'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'group_full'
  | 'unsupported_version'
  | 'group_blocked'
  | 'rate_limited'
  | 'over_budget'
  | 'server_error'
  | 'not_implemented';

/**
 * Everything a sync can fail with. Beyond the protocol names:
 * - `epoch_unstable`: the epoch changed twice in one cycle; the group stops (the epoch rule).
 * - `network`: no HTTP response at all (offline, DNS, TLS, timeout). Transient, like 5xx.
 * - `not_an_even_server`: a `404`/`405` on a documented route, or a `200` whose body is not the documented
 *   shape (PROTOCOL.md §10). The transport reports this instead of `not_found` / `method_not_allowed`, which
 *   therefore never reach the engine. UI: "That URL isn't an Even server. Check the address."
 * - `no_secret`: this phone has the group's row but no secret for it (or one that derives another local id),
 *   e.g. an Android restore (design.md "Keys"). Nothing can be decrypted or authenticated; the engine does not
 *   retry on its own. Recovery is a re-shared invite or the group file.
 * - `local_error`: the cycle stopped on a local failure (storage, a bug), not a server answer. Logged; retried
 *   with backoff.
 * This is what `groups.last_sync_error` holds.
 */
export type SyncErrorCode =
  | ProtocolErrorCode
  | 'epoch_unstable'
  | 'network'
  | 'not_an_even_server'
  | 'no_secret'
  | 'local_error';

/** What a `Transport` rejects with, and what the engine records. */
export interface SyncError extends Error {
  readonly code: SyncErrorCode;
  /** HTTP status when there was a response. */
  readonly status?: number;
  /** `invalid_envelope` / `unsupported_version`: index of the first offender in the pushed batch. */
  readonly index?: number;
  /** `group_full`: which cap. */
  readonly reason?: 'bytes' | 'events';
  /** From `Retry-After`, in ms, when the server sent one (429, 503). */
  readonly retryAfterMs?: number;
}

// ---------- Engine ----------

/**
 * Why a sync started (design.md "Triggers"). `server_move` is the full push `moveServer` runs right after the
 * switch; like `manual`, `pull_to_refresh` and `first_open`, it is not held back by the group's backoff.
 */
export type SyncTrigger =
  | 'foreground'
  | 'local_write'
  | 'pull_to_refresh'
  | 'manual'
  | 'background'
  | 'first_open'
  | 'server_move';

/** The outcome of one group's cycle. */
export type SyncResult =
  | {
      localId: string;
      outcome: 'synced';
      /** Envelopes acknowledged by push (accepted + duplicates). */
      pushed: number;
      /** Envelopes newly inserted from pull. */
      pulled: number;
      /** Ids newly inserted with status `ok`; background refresh builds notifications from these. */
      newOkIds: string[];
      /** 0 or 1: whether the epoch rule restarted the cycle. */
      epochResets: number;
      /** `last_synced_at` written. */
      at: number;
    }
  | {
      localId: string;
      outcome: 'skipped';
      /**
       * `not_active`: closed, hidden, or blocked. `in_flight`: a cycle for this group is running.
       * `debounced`: a manual tap within 10 s of the last success. `backoff`: waiting after a transient error.
       * `deadline`: the caller's time budget ran out before this group started.
       */
      reason: 'not_active' | 'in_flight' | 'debounced' | 'backoff' | 'deadline';
    }
  | {
      localId: string;
      outcome: 'failed';
      error: SyncErrorCode;
      /** When the engine will try again on its own (unix ms), or null if it will not (terminal). */
      retryAt: number | null;
    };

/** What `subscribe` listeners receive. `finished` is also the cue to invalidate memoised group state. */
export type SyncEvent =
  | { type: 'started'; localId: string; trigger: SyncTrigger }
  | { type: 'finished'; localId: string; trigger: SyncTrigger; result: SyncResult };

export interface SyncOptions {
  trigger: SyncTrigger;
  /**
   * Unix ms after which no new group is started. The background task passes now + 25 s
   * (design.md "Background refresh").
   */
  deadline?: number;
}

/** The outcome of `moveServer`. */
export type MoveServerResult =
  | {
      localId: string;
      outcome: 'moved';
      /** The canonical URL now in `groups.server_url`. */
      serverUrl: string;
      /** `undecryptable` and `unsupported_envelope` rows dropped: they cannot be re-encrypted. */
      dropped: number;
      /** The full push to the new server that followed the switch (trigger `server_move`). */
      sync: SyncResult;
    }
  | {
      localId: string;
      outcome: 'failed';
      /**
       * Nothing changed. `invalid_url`: not a valid https server URL. `not_found`: no such group. `not_movable`:
       * the group is `closed` or `hidden`. `same_server`: it already syncs there. `in_flight`: another move of
       * this group is running. `no_secret`: see `SyncErrorCode`. `local_error`: storage or crypto failed (logged).
       */
      error:
        | 'invalid_url'
        | 'not_found'
        | 'not_movable'
        | 'same_server'
        | 'in_flight'
        | 'no_secret'
        | 'local_error';
    };

/** The outcome of `deleteServerCopy`. */
export type DeleteServerCopyResult =
  /** The server answered 204 (or 404: nothing left to delete). */
  | { outcome: 'deleted' }
  /** No answer, 5xx, 429 or 503: the debt stays in `pending_deletes` and is retried at the start of later cycles. */
  | { outcome: 'pending' }
  /**
   * `invalid_url`, `current_server` (refused: the group still syncs there and would recreate it), `no_secret` and
   * `local_error` change nothing. Any other code is the server's refusal (401, 410, …): the debt was dropped.
   */
  | { outcome: 'failed'; error: SyncErrorCode | 'invalid_url' | 'current_server' };

export interface SyncEngine {
  /**
   * One push → pull → recompute cycle for an `active` group (design.md "Cycle, per group"), after retrying the
   * group's outstanding `pending_deletes`. Never throws; failures come back as `outcome: 'failed'`, are recorded
   * on the group row, and are announced with a `finished` event. Concurrent calls for the same group share the
   * in-flight cycle.
   */
  syncGroup(localId: string, options: SyncOptions): Promise<SyncResult>;
  /**
   * Retries every outstanding `pending_deletes` debt, then syncs every `active` group, sequentially; one group's
   * failure does not stop the others. The background trigger restricts this to groups with an event dated within
   * the last 30 days.
   */
  syncAll(options: SyncOptions): Promise<SyncResult[]>;
  /**
   * Switches the group to another server (design.md "Rotation, moving, closing" → Move, and "Local storage"):
   * waits for any running cycle, re-encrypts every readable envelope for the new server's group id (same ids and
   * bodies, fresh nonces), drops the rows that cannot be re-encrypted, and calls `Store.setServer`, which also
   * turns a `blocked` group `active`; then runs a full push to the new server. Refuses `closed` and `hidden`
   * groups. Writing and acknowledging `group.moved` on the old server first is the caller's job (a fresh invite
   * naming a dead server's replacement skips it). Never throws.
   */
  moveServer(localId: string, serverUrl: string): Promise<MoveServerResult>;
  /**
   * Deletes the group's copy on `serverUrl`: after a move ("Delete the copy on <old host>"), or as part of Leave.
   * Records the debt with its token first, then tries the DELETE, so a failure or a killed app is retried by later
   * cycles even after the secret is gone. Refused (`current_server`) for the server an `active` group still syncs
   * through, since its next sync would recreate the copy; Leave therefore deletes the group's rows first, then
   * calls this, then removes the secret. Never throws.
   */
  deleteServerCopy(localId: string, serverUrl: string): Promise<DeleteServerCopyResult>;
  /** Schedules `syncGroup(localId, { trigger: 'local_write' })`, debounced 1 s. Call after any local write. */
  requestSync(localId: string): void;
  /** Adds a listener; returns the unsubscribe function. */
  subscribe(listener: (event: SyncEvent) => void): () => void;
}
