/**
 * The sync engine (design.md "Sync engine"): push → pull → record, per `active` group, as pure orchestration
 * over `Store`, `Secrets`, and `Transport`, so it runs in Node under Vitest with fakes. No React Native imports.
 *
 * Also owns the two operations that re-derive per-server keys: `moveServer` (re-encrypt, `setServer`, full push)
 * and `deleteServerCopy` (record the debt with its token, then DELETE).
 *
 * Decisions made here, all now written into design.md "Sync engine":
 * - `'unknown'` (stored after a reset caused by a `null` epoch) is a placeholder, not an epoch: the next non-null
 *   epoch is adopted without a second reset, and a `null` response while it is stored is no change. Read
 *   literally, the epoch rule would call the recreated group's first epoch a second change and stop every
 *   delete/expiry self-heal with `epoch_unstable`.
 * - `epoch_resets_this_cycle` is reset when a cycle ends, successful or not (design.md step 4), so an
 *   `epoch_unstable` group recovers on a later cycle instead of staying stuck.
 * - 5xx: the same outbox head is retried in the cycle after a short sleep; every third consecutive 5xx halves
 *   the group's batch size (floor 1, kept for the process); the cycle gives up after six.
 * - `Retry-After` (429, and 5xx carrying one) is waited out in the cycle when short, else it becomes the retry
 *   time, which every trigger honours, manual taps included. `503 over_budget` pauses pushes to that server
 *   until then while pulls continue ("reads still work").
 * - Outbox rows that are not sendable envelopes (junk, or larger than `max_event_bytes`) are quarantined
 *   locally without a request; a `415` for an envelope whose `v ≠ 1` quarantines it, other `415`s stop.
 * - Backoff (30 s → 2 m → 10 m) binds `foreground`, `local_write` and `background`; `manual`,
 *   `pull_to_refresh`, `first_open` and `server_move` bypass it. The engine schedules its own retry at `retryAt`.
 * - `group_full`: pushing stops, the pull still runs, the cycle reports `failed` with `retryAt: null` (the user
 *   must act) and no backoff, so later triggers still pull.
 * - A server is whoever the invite names, so what it publishes is bounded here (design.md "Cycle, per group"):
 *   `max_batch` is used up to 100 and `max_page` up to 1,000 (the protocol lets a client send and ask for less),
 *   one cycle pulls at most 20,000 entries' worth of pages (twice the public server's 10,000-event cap: a whole
 *   group before and after one epoch reset), and `undecryptable` and `unsupported_envelope` rows are capped at
 *   1,000 each, pruned with every page that brings one.
 * - `pending_deletes` are retried at the start of `syncAll` (every debt) and of a group's cycle (that group's):
 *   204, or 404 (nothing left), pays the debt; no answer, 5xx, 429 and 503 keep it; any other answer (401, 410, …)
 *   drops it with a local log line, since retrying cannot change it.
 * - A sync failure is logged as fixed words, its code and HTTP status (`sync failed code=unauthorized status=401`):
 *   never the server URL or host, the error's message, or any text from a response. React Native writes every
 *   console line to the device log, release builds included, and the server is whoever the invite names. A local
 *   failure outside a cycle (the store, a listener) adds its error's name and message. Never a group id, token,
 *   envelope, or body (../even-server/THREAT-MODEL.md "What we log").
 */
import {
  b64urlDecode,
  b64urlEncode,
  canonicalOrigin,
  deriveLocal,
  deriveServer,
  envelopeShape,
  EVENT_TYPES,
  groupIdForToken,
  InvalidServerUrlError,
  isId,
  LIMITS,
  open,
  parseEvent,
  PROTOCOL,
  reduce,
  resealEnvelope,
  type Envelope,
  type Event,
  type LogEntry,
} from '@even/core';

import type { Secrets } from '../secrets/types';
import type {
  GroupRow,
  NewEventRow,
  OutboxRow,
  PendingDeleteRow,
  ReadableEnvelope,
  Store,
} from '../storage/types';
import { SyncError, toSyncError } from './errors';
import { createInfoCache, type InfoCache } from './info';
import type {
  DeleteServerCopyResult,
  MoveServerResult,
  PullResponse,
  PushResponse,
  ServerInfo,
  SyncEngine,
  SyncErrorCode,
  SyncEvent,
  SyncOptions,
  SyncResult,
  SyncTrigger,
  Transport,
} from './types';

/** Stored in `groups.epoch` after a reset caused by a `null` epoch (design.md, the epoch rule). */
export const UNKNOWN_EPOCH = 'unknown';

/** Most envelopes sent in one append, whatever the server publishes as `max_batch` (PROTOCOL.md §6.2: 1 to it). */
export const CLIENT_MAX_BATCH = 100;
/** Largest page asked for, whatever the server publishes as `max_page` (PROTOCOL.md §6.3: values above it clamp). */
export const CLIENT_MAX_PAGE = 1_000;

export interface SyncTuning {
  /** `requestSync` debounce (design.md "Triggers"). */
  writeDebounceMs: number;
  /** A manual tap this soon after a successful cycle only replays the spinner. */
  manualDebounceMs: number;
  /** Per-group backoff after consecutive failed cycles; the last step repeats. */
  backoffScheduleMs: readonly number[];
  /** Background refresh syncs only groups with an event `ts` this recent (design.md "Background refresh"). */
  backgroundWindowMs: number;
  /** In-cycle retry delay after the n-th consecutive transient failure: base × 2^(n−1), capped. */
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Every this many consecutive 5xx for the same outbox head, halve the batch (floor 1). */
  halveAfterServerErrors: number;
  /** Give up the cycle after this many consecutive 5xx while pushing. */
  maxPushServerErrors: number;
  /** Give up the cycle after this many consecutive 5xx while pulling. */
  maxPullServerErrors: number;
  /** Longest `Retry-After` or retry delay waited out inside a cycle; longer ones end the cycle. */
  maxInlineWaitMs: number;
  /** In-cycle `Retry-After` waits allowed per cycle. */
  maxInlineWaits: number;
  /** `undecryptable` rows kept per group (design.md "Local storage"). */
  undecryptableKeep: number;
  /** `unsupported_envelope` rows kept per group, the same way. */
  unsupportedEnvelopeKeep: number;
  /**
   * Entries one cycle may pull, epoch restarts included. Each page is charged the entries it asked for (or the
   * entries it brought, if more), so a server that answers `more` forever, with or without entries, ends the cycle.
   */
  pullEntriesPerCycle: number;
}

export const DEFAULT_TUNING: SyncTuning = {
  writeDebounceMs: 1_000,
  manualDebounceMs: 10_000,
  backoffScheduleMs: [30_000, 120_000, 600_000],
  backgroundWindowMs: 30 * 24 * 60 * 60 * 1000,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 2_000,
  halveAfterServerErrors: 3,
  maxPushServerErrors: 6,
  maxPullServerErrors: 3,
  maxInlineWaitMs: 5_000,
  maxInlineWaits: 2,
  undecryptableKeep: 1_000,
  unsupportedEnvelopeKeep: 1_000,
  pullEntriesPerCycle: 2 * 10_000,
};

export interface SyncEngineDeps {
  store: Store;
  secrets: Pick<Secrets, 'getSecret'>;
  /** The transport for a canonical server URL (the app: `new HttpTransport(url)`). */
  transportFor: (serverUrl: string) => Transport;
  /** Shared with settings; defaults to a private cache. */
  infoCache?: InfoCache;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Runs `fn` after `ms`; returns a cancel function. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Local diagnostics (`unauthorized`, `local_error`). Never receives keys, tokens, or bodies. */
  log?: (message: string, detail?: unknown) => void;
  tuning?: Partial<SyncTuning>;
}

export interface SyncEngineHandle extends SyncEngine {
  /** Cancels pending debounce and retry timers; later reruns and retries are dropped. */
  dispose(): void;
}

// ---------- Small pure helpers ----------

/**
 * A sync failure for a log line: fixed words, the code, and the HTTP status when there was one. Never its message,
 * which a transport may have filled from the response, or the local error it wraps.
 */
export function describeFailure(what: string, error: SyncError): string {
  return error.status === undefined
    ? `${what} code=${error.code}`
    : `${what} code=${error.code} status=${error.status}`;
}

/**
 * A local error for a log line: its name and message only, never a `cause` chain or an attached object. A
 * `SyncError` is described by `describeFailure`, and an `InvalidServerUrlError` by its name alone (its message
 * quotes the URL).
 */
export function describeError(error: unknown): string {
  if (error instanceof SyncError) return describeFailure('SyncError', error);
  if (error instanceof InvalidServerUrlError) return 'InvalidServerUrlError';
  return error instanceof Error ? `${error.name}: ${error.message}` : typeof error;
}

// ---------- Epoch rule (pure) ----------

export type EpochDecision =
  | { kind: 'same' }
  | { kind: 'adopt'; epoch: string }
  | { kind: 'reset'; epoch: string }
  | { kind: 'unstable' };

/**
 * design.md "Epoch rule" / PROTOCOL.md §10. `stored` null (never synced) or `'unknown'` (already reset for a
 * missing group) adopts the first non-null epoch without a reset. A different epoch, or `null` where one is
 * stored, resets once per cycle; a second change is `unstable`.
 */
export function decideEpoch(
  stored: string | null,
  response: string | null,
  resetsThisCycle: number,
): EpochDecision {
  if (stored === null || stored === UNKNOWN_EPOCH) {
    return response === null ? { kind: 'same' } : { kind: 'adopt', epoch: response };
  }
  if (response === stored) return { kind: 'same' };
  if (resetsThisCycle >= 1) return { kind: 'unstable' };
  return { kind: 'reset', epoch: response ?? UNKNOWN_EPOCH };
}

// ---------- Pulled envelope classification (pure) ----------

export interface ClassifiedEnvelope {
  row: NewEventRow;
  /** The parsed body for `ok` rows. */
  event: Event | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KNOWN_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);

/**
 * An opened body `parseEvent` rejected is `unsupported_body` when a newer client may read it: a later `sv`, or
 * `sv: 1` with a `type` this client does not know. Everything else is `invalid`. (`parseEvent` returns null
 * for both, so the distinction is made here.)
 */
export function isUnsupportedBody(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const { sv, type } = body;
  if (typeof sv === 'number' && Number.isSafeInteger(sv) && sv > 1) return true;
  return sv === 1 && typeof type === 'string' && !KNOWN_TYPES.has(type);
}

/** `ts` of a body that opened but did not validate, when it is a plausible timestamp; else null. */
function bodyTs(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const { ts } = body;
  return typeof ts === 'number' &&
    Number.isSafeInteger(ts) &&
    ts >= LIMITS.tsMin &&
    ts < LIMITS.tsMax
    ? ts
    : null;
}

/**
 * Longest text kept for a pulled entry that is not an envelope at all. The store refuses envelope text over
 * 16 KiB (`MAX_ENVELOPE_TEXT_LENGTH`), so one oversized junk item must not be able to fail a whole page.
 */
export const MAX_JUNK_TEXT_LENGTH = 4096;

/** The junk entry as JSON, or, when that is too long, its id plus a bounded prefix of it. */
function junkText(id: string, rest: Record<string, unknown>): string {
  const full = JSON.stringify(rest);
  if (full.length <= MAX_JUNK_TEXT_LENGTH) return full;
  // JSON-escaping can grow the prefix (up to 6× for control characters), so shrink until it fits.
  for (let keep = MAX_JUNK_TEXT_LENGTH; ; keep = Math.floor(keep / 2)) {
    const text = JSON.stringify({ id, truncated: true, raw: full.slice(0, keep) });
    if (text.length <= MAX_JUNK_TEXT_LENGTH) return text;
  }
}

/**
 * design.md "Cycle, per group", step 2, for one pulled envelope. Returns null only when the entry has no usable
 * id (it cannot be stored or deduplicated; a conforming server never sends one).
 */
export function classifyPulled(
  raw: unknown,
  key: Uint8Array,
  groupId: string,
): ClassifiedEnvelope | null {
  if (!isRecord(raw)) return null;
  const { seq, ...rest } = raw;
  const id = rest.id;
  if (typeof id !== 'string' || !isId(id)) return null;
  const base = {
    id,
    origin: 'remote' as const,
    acked: true,
    seq: typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 ? seq : null,
  };

  const shape = envelopeShape(rest);
  if (!shape.ok) {
    return {
      row: { ...base, ts: null, envelope: junkText(id, rest), status: 'undecryptable' },
      event: null,
    };
  }
  const envelope = { id, v: rest.v, n: rest.n, c: rest.c } as Envelope;
  const text = JSON.stringify(envelope);
  if (shape.v !== PROTOCOL.version) {
    return {
      row: { ...base, ts: null, envelope: text, status: 'unsupported_envelope' },
      event: null,
    };
  }

  let body: unknown;
  try {
    body = open({ key, groupId, envelope });
  } catch {
    return { row: { ...base, ts: null, envelope: text, status: 'undecryptable' }, event: null };
  }
  const event = parseEvent(body);
  if (event !== null) {
    return { row: { ...base, ts: event.ts, envelope: text, status: 'ok' }, event };
  }
  const status = isUnsupportedBody(body) ? 'unsupported_body' : 'invalid';
  return { row: { ...base, ts: bodyTs(body), envelope: text, status }, event: null };
}

// ---------- Engine ----------

/** Triggers that wait out a group's backoff; the others are the user asking (design.md "Error handling"). */
const RESPECTS_BACKOFF: ReadonlySet<SyncTrigger> = new Set<SyncTrigger>([
  'foreground',
  'local_write',
  'background',
]);

/** Answers after which a pending DELETE is kept for the next cycle; any other refusal drops the debt. */
const DEBT_TRANSIENT: ReadonlySet<SyncErrorCode> = new Set<SyncErrorCode>([
  'network',
  'server_error',
  'rate_limited',
  'over_budget',
]);

type DebtOutcome =
  { outcome: 'deleted' } | { outcome: 'pending' } | { outcome: 'dropped'; error: SyncErrorCode };

type PhaseOutcome =
  | { kind: 'done' }
  | { kind: 'restart' }
  | { kind: 'stop'; error: SyncError }
  | { kind: 'stop_pushing'; error: SyncError };

interface Backoff {
  failures: number;
  until: number;
  /** Set by a server's `Retry-After`: binds every trigger. */
  hard: boolean;
}

interface Cycle {
  localId: string;
  serverUrl: string;
  deadline: number | undefined;
  transport: Transport;
  key: Uint8Array;
  groupId: string;
  token: Uint8Array;
  info: ServerInfo;
  epoch: string | null;
  resets: number;
  cursor: number;
  pushed: number;
  pulled: number;
  newOkIds: string[];
  epochResets: number;
  nameEventPulled: boolean;
  /** Entries charged against `pullEntriesPerCycle` so far. */
  pullCharged: number;
  inlineWaits: number;
}

interface SendableEnvelope {
  id: string;
  envelope: Envelope;
}

function decodedLength(base64urlChars: number): number {
  return Math.floor((base64urlChars * 3) / 4);
}

/** Splits an outbox batch into envelopes a conforming server can accept and local junk to quarantine. */
function splitSendable(
  rows: readonly OutboxRow[],
  maxEventBytes: number,
): { sendable: SendableEnvelope[]; junk: string[] } {
  const sendable: SendableEnvelope[] = [];
  const junk: string[] = [];
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.envelope);
    } catch {
      junk.push(row.id);
      continue;
    }
    const shape = envelopeShape(value);
    const envelope = value as Envelope;
    if (!shape.ok || envelope.id !== row.id || decodedLength(envelope.c.length) > maxEventBytes) {
      junk.push(row.id);
      continue;
    }
    sendable.push({ id: row.id, envelope });
  }
  return { sendable, junk };
}

type Synced = Extract<SyncResult, { outcome: 'synced' }>;

function skipped(
  localId: string,
  reason: Extract<SyncResult, { outcome: 'skipped' }>['reason'],
): SyncResult {
  return { localId, outcome: 'skipped', reason };
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngineHandle {
  const { store, secrets, transportFor } = deps;
  const infoCache = deps.infoCache ?? createInfoCache();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    });
  const log =
    deps.log ??
    ((message: string, detail?: unknown) =>
      detail === undefined ? console.warn(message) : console.warn(message, detail));
  const tuning: SyncTuning = { ...DEFAULT_TUNING, ...deps.tuning };

  const listeners = new Set<(event: SyncEvent) => void>();
  const inFlight = new Map<string, Promise<SyncResult>>();
  const rerun = new Map<string, SyncTrigger>();
  const writeTimers = new Map<string, () => void>();
  const retryTimers = new Map<string, () => void>();
  const backoff = new Map<string, Backoff>();
  const batchLimit = new Map<string, number>();
  const pushPausedUntil = new Map<string, number>();
  /** Groups whose server switch is running: new cycles are skipped until the move's own full push. */
  const moving = new Set<string>();
  /** `localId|serverUrl` of debts whose DELETE is in flight, so two callers never send it twice. */
  const debtsInFlight = new Set<string>();
  let disposed = false;

  function emit(event: SyncEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        log('sync: listener threw', describeError(error));
      }
    }
  }

  function cancelTimer(timers: Map<string, () => void>, localId: string): void {
    timers.get(localId)?.();
    timers.delete(localId);
  }

  function retryDelay(consecutive: number): number {
    return Math.min(tuning.retryMaxDelayMs, tuning.retryBaseDelayMs * 2 ** (consecutive - 1));
  }

  /** Sleeps inside the cycle when the wait is short and the caller's deadline allows; false means give up. */
  async function waitInCycle(cycle: Cycle, ms: number): Promise<boolean> {
    if (ms > tuning.maxInlineWaitMs) return false;
    if (cycle.deadline !== undefined && now() + ms > cycle.deadline) return false;
    await sleep(ms);
    return true;
  }

  function batchSize(cycle: Cycle): number {
    const limit = batchLimit.get(cycle.localId) ?? Number.POSITIVE_INFINITY;
    return Math.max(1, Math.min(cycle.info.limits.max_batch, CLIENT_MAX_BATCH, limit));
  }

  /** The epoch rule's reset: new epoch, cursor 0, every event unacked, in one transaction. */
  async function resetForEpoch(cycle: Cycle, epoch: string): Promise<void> {
    const resets = cycle.resets + 1;
    await store.transaction(async (tx) => {
      await tx.setSyncState(cycle.localId, { epoch, epochResetsThisCycle: resets });
      await tx.setCursor(cycle.localId, 0);
      await tx.resetAcked(cycle.localId);
    });
    cycle.epoch = epoch;
    cycle.resets = resets;
    cycle.cursor = 0;
    cycle.epochResets = 1;
  }

  async function refreshInfo(cycle: Cycle): Promise<void> {
    cycle.info = await infoCache.refresh(cycle.serverUrl, cycle.transport);
  }

  // ----- push -----

  async function pushPhase(cycle: Cycle): Promise<PhaseOutcome> {
    const pausedUntil = pushPausedUntil.get(cycle.serverUrl);
    if (pausedUntil !== undefined && now() < pausedUntil) {
      if ((await store.outbox(cycle.localId, 1)).length === 0) return { kind: 'done' };
      const error = new SyncError('over_budget', 'pushes paused by the server', {
        retryAfterMs: pausedUntil - now(),
      });
      return { kind: 'stop_pushing', error };
    }

    let serverErrors = 0;
    let refreshed = false;
    let lastAcked: ReadonlySet<string> = new Set();
    for (;;) {
      const rows = await store.outbox(cycle.localId, batchSize(cycle));
      if (rows.length === 0) return { kind: 'done' };
      if (rows.some((row) => lastAcked.has(row.id))) {
        throw new SyncError('local_error', 'acked rows are still in the outbox');
      }
      const { sendable, junk } = splitSendable(rows, cycle.info.limits.max_event_bytes);
      if (junk.length > 0) {
        await store.markRejected(cycle.localId, junk);
        continue;
      }

      let response: PushResponse;
      try {
        response = await cycle.transport.push(
          cycle.groupId,
          cycle.token,
          sendable.map((s) => s.envelope),
        );
      } catch (thrown) {
        const error = toSyncError(thrown);
        const offender = error.index === undefined ? undefined : sendable[error.index];
        switch (error.code) {
          case 'invalid_envelope':
            if (offender === undefined) break; // no usable index: non-conforming; handled as 5xx
            await store.markRejected(cycle.localId, [offender.id]);
            serverErrors = 0;
            continue;
          case 'unsupported_version':
            // A kept envelope of a newer version (re-pushed after a reset) must not stop the group.
            if (offender !== undefined && offender.envelope.v !== PROTOCOL.version) {
              await store.markRejected(cycle.localId, [offender.id]);
              continue;
            }
            return { kind: 'stop', error };
          case 'invalid_request':
            if (refreshed) break; // refreshed once already: treat as 5xx
            refreshed = true;
            await refreshInfo(cycle);
            continue;
          case 'group_full':
            return { kind: 'stop_pushing', error };
          case 'over_budget':
            pushPausedUntil.set(
              cycle.serverUrl,
              now() + (error.retryAfterMs ?? tuning.backoffScheduleMs[0] ?? 0),
            );
            return { kind: 'stop_pushing', error };
          case 'rate_limited':
            if (
              error.retryAfterMs !== undefined &&
              cycle.inlineWaits < tuning.maxInlineWaits &&
              (await waitInCycle(cycle, error.retryAfterMs))
            ) {
              cycle.inlineWaits += 1;
              continue;
            }
            return { kind: 'stop', error };
          case 'server_error':
            break;
          default:
            return { kind: 'stop', error };
        }
        // 5xx (and what is treated as one): retry the same head; halve every third time.
        serverErrors += 1;
        if (serverErrors % tuning.halveAfterServerErrors === 0) {
          batchLimit.set(cycle.localId, Math.max(1, Math.floor(batchSize(cycle) / 2)));
        }
        if (serverErrors >= tuning.maxPushServerErrors) return { kind: 'stop', error };
        const delay = error.retryAfterMs ?? retryDelay(serverErrors);
        if (!(await waitInCycle(cycle, delay))) return { kind: 'stop', error };
        continue;
      }

      serverErrors = 0;
      refreshed = false;
      const decision = decideEpoch(cycle.epoch, response.epoch, cycle.resets);
      if (decision.kind === 'unstable') {
        return { kind: 'stop', error: new SyncError('epoch_unstable', 'epoch changed twice') };
      }
      if (decision.kind === 'reset') {
        await resetForEpoch(cycle, decision.epoch);
        return { kind: 'restart' };
      }
      const ids = sendable.map((s) => s.id);
      await store.transaction(async (tx) => {
        await tx.ack(cycle.localId, ids);
        if (decision.kind === 'adopt')
          await tx.setSyncState(cycle.localId, { epoch: decision.epoch });
      });
      if (decision.kind === 'adopt') cycle.epoch = decision.epoch;
      cycle.pushed += ids.length;
      lastAcked = new Set(ids);
    }
  }

  // ----- pull -----

  async function pullPhase(cycle: Cycle): Promise<PhaseOutcome> {
    let serverErrors = 0;
    let refreshed = false;
    for (;;) {
      const since = cycle.cursor;
      const limit = Math.max(1, Math.min(cycle.info.limits.max_page, CLIENT_MAX_PAGE));
      let page: PullResponse;
      try {
        page = await cycle.transport.pull(cycle.groupId, cycle.token, since, limit);
      } catch (thrown) {
        const error = toSyncError(thrown);
        if (error.code === 'invalid_request' && !refreshed) {
          refreshed = true;
          await refreshInfo(cycle);
          continue;
        }
        if (
          error.code === 'rate_limited' &&
          error.retryAfterMs !== undefined &&
          cycle.inlineWaits < tuning.maxInlineWaits &&
          (await waitInCycle(cycle, error.retryAfterMs))
        ) {
          cycle.inlineWaits += 1;
          continue;
        }
        if (error.code !== 'server_error' && error.code !== 'invalid_request') {
          return { kind: 'stop', error };
        }
        serverErrors += 1;
        if (serverErrors >= tuning.maxPullServerErrors) return { kind: 'stop', error };
        const delay = error.retryAfterMs ?? retryDelay(serverErrors);
        if (!(await waitInCycle(cycle, delay))) return { kind: 'stop', error };
        continue;
      }
      serverErrors = 0;
      refreshed = false;

      // The epoch rule runs before the page is committed.
      const decision = decideEpoch(cycle.epoch, page.epoch, cycle.resets);
      if (decision.kind === 'unstable') {
        return { kind: 'stop', error: new SyncError('epoch_unstable', 'epoch changed twice') };
      }
      if (decision.kind === 'reset') {
        await resetForEpoch(cycle, decision.epoch);
        return { kind: 'restart' };
      }
      if (page.more && page.next <= since) {
        return { kind: 'stop', error: new SyncError('server_error', 'pull made no progress') };
      }

      const byId = new Map<string, ClassifiedEnvelope>();
      for (const raw of page.events) {
        const classified = classifyPulled(raw, cycle.key, cycle.groupId);
        if (classified !== null && !byId.has(classified.row.id))
          byId.set(classified.row.id, classified);
      }
      const rows = [...byId.values()].map((c) => c.row);
      const inserted = await store.transaction(async (tx) => {
        const result = await tx.insertEvents(cycle.localId, rows);
        await tx.setCursor(cycle.localId, page.next);
        if (decision.kind === 'adopt')
          await tx.setSyncState(cycle.localId, { epoch: decision.epoch });
        // The caps hold page by page, so a server sending nothing else cannot fill the disk within a cycle.
        const statuses = new Set(result.inserted.map((id) => byId.get(id)?.row.status));
        if (statuses.has('undecryptable'))
          await tx.pruneUndecryptable(cycle.localId, tuning.undecryptableKeep);
        if (statuses.has('unsupported_envelope'))
          await tx.pruneUnsupportedEnvelopes(cycle.localId, tuning.unsupportedEnvelopeKeep);
        return result.inserted;
      });
      cycle.cursor = page.next;
      if (decision.kind === 'adopt') cycle.epoch = decision.epoch;

      cycle.pulled += inserted.length;
      for (const id of inserted) {
        const classified = byId.get(id);
        if (classified === undefined) continue;
        if (classified.row.status === 'ok') cycle.newOkIds.push(id);
        const type = classified.event?.type;
        if (type === 'group.created' || type === 'group.renamed') cycle.nameEventPulled = true;
      }
      if (!page.more) return { kind: 'done' };
      cycle.pullCharged += Math.max(limit, page.events.length);
      if (cycle.pullCharged >= tuning.pullEntriesPerCycle) {
        // What was pulled stays committed: the next cycle carries on from this cursor.
        return { kind: 'stop', error: new SyncError('server_error', 'pull over the cycle budget') };
      }
    }
  }

  /** Re-derives the cached name and currency from the whole log when a pull brought a naming event. */
  async function refreshNameCache(cycle: Cycle): Promise<void> {
    const entries: LogEntry[] = [];
    for (const { id, envelope } of await store.listReadable(cycle.localId)) {
      let body: unknown;
      try {
        body = open({ key: cycle.key, groupId: cycle.groupId, envelope });
      } catch {
        continue;
      }
      const event = parseEvent(body);
      if (event?.type === 'group.created' || event?.type === 'group.renamed') {
        entries.push({ id, event });
      }
    }
    if (entries.length === 0) return;
    const state = reduce(entries);
    const cache: { name?: string; currency?: string } = {};
    if (state.name !== '') cache.name = state.name;
    if (state.created) cache.currency = state.currency;
    if (cache.name !== undefined || cache.currency !== undefined) {
      await store.setNameCache(cycle.localId, cache);
    }
  }

  // ----- one cycle -----

  async function runCycle(group: GroupRow, deadline: number | undefined): Promise<Synced> {
    const { localId, serverUrl } = group;
    const secret = await secrets.getSecret(localId);
    if (secret === null) throw new SyncError('no_secret', 'no secret for this group');
    const local = deriveLocal(secret);
    if (local.localId !== localId) throw new SyncError('no_secret', 'secret derives another group');
    const server = deriveServer(secret, serverUrl);
    const transport = transportFor(serverUrl);
    const info = await infoCache.get(serverUrl, transport);
    if (!info.protocol.includes(PROTOCOL.version)) {
      throw new SyncError(
        'unsupported_version',
        `server speaks protocol ${info.protocol.join(', ')}`,
      );
    }

    const cycle: Cycle = {
      localId,
      serverUrl,
      deadline,
      transport,
      key: local.encryptionKey,
      groupId: server.groupId,
      token: server.authToken,
      info,
      epoch: group.epoch,
      resets: group.epochResetsThisCycle,
      cursor: group.cursor,
      pushed: 0,
      pulled: 0,
      newOkIds: [],
      epochResets: 0,
      nameEventPulled: false,
      pullCharged: 0,
      inlineWaits: 0,
    };

    let pushStopped: SyncError | null;
    for (;;) {
      pushStopped = null;
      const push = await pushPhase(cycle);
      if (push.kind === 'restart') continue;
      if (push.kind === 'stop') throw push.error;
      if (push.kind === 'stop_pushing') pushStopped = push.error;
      const pull = await pullPhase(cycle);
      if (pull.kind === 'restart') continue;
      if (pull.kind === 'stop') throw pull.error;
      break;
    }

    if (cycle.nameEventPulled) await refreshNameCache(cycle);
    if (pushStopped !== null) throw pushStopped;

    return {
      localId,
      outcome: 'synced',
      pushed: cycle.pushed,
      pulled: cycle.pulled,
      newOkIds: cycle.newOkIds,
      epochResets: cycle.epochResets,
      at: now(),
    };
  }

  function scheduleRetry(localId: string, at: number, trigger: SyncTrigger): void {
    cancelTimer(retryTimers, localId);
    if (disposed) return;
    const cancel = schedule(
      () => {
        retryTimers.delete(localId);
        void syncGroup(localId, { trigger });
      },
      Math.max(0, at - now()),
    );
    retryTimers.set(localId, cancel);
  }

  /** Records a failed cycle on the group row (when there is one), backs off, and schedules the retry. */
  async function recordFailure(
    localId: string,
    error: SyncError,
    trigger: SyncTrigger,
  ): Promise<SyncResult> {
    const code = error.code;
    if (code === 'unauthorized' || code === 'local_error') {
      log(describeFailure('sync failed', error));
    }
    let retryAt: number | null;
    if (code === 'group_blocked' || code === 'no_secret' || code === 'group_full') {
      retryAt = null;
    } else if (code === 'over_budget') {
      // Pushes are paused for the server; pulls go on, so the group itself is not backed off.
      retryAt = now() + (error.retryAfterMs ?? tuning.backoffScheduleMs[0] ?? 0);
    } else {
      const failures = (backoff.get(localId)?.failures ?? 0) + 1;
      const steps = tuning.backoffScheduleMs;
      const step = steps[Math.min(failures - 1, steps.length - 1)] ?? 0;
      const until = now() + (error.retryAfterMs ?? step);
      backoff.set(localId, { failures, until, hard: error.retryAfterMs !== undefined });
      retryAt = until;
    }
    try {
      if (code === 'group_blocked') await store.setGroupState(localId, 'blocked');
      await store.setSyncState(localId, { lastSyncError: code, epochResetsThisCycle: 0 });
    } catch (storeError) {
      log('sync: could not record the failure', describeError(storeError));
    }
    if (retryAt !== null) scheduleRetry(localId, retryAt, trigger);
    return { localId, outcome: 'failed', error: code, retryAt };
  }

  async function execute(
    localId: string,
    options: SyncOptions,
    payDebts: boolean,
  ): Promise<SyncResult> {
    const { trigger, deadline } = options;
    if (deadline !== undefined && now() >= deadline) return skipped(localId, 'deadline');
    let group: GroupRow | null;
    try {
      group = await store.getGroup(localId);
    } catch (error) {
      // The row cannot be read, so the error cannot be written to it either; it is still announced and retried.
      log('sync: could not read the group', describeError(error));
      emit({ type: 'started', localId, trigger });
      const result = await recordFailure(
        localId,
        new SyncError('local_error', describeError(error)),
        trigger,
      );
      emit({ type: 'finished', localId, trigger, result });
      return result;
    }
    if (group === null || group.state !== 'active') return skipped(localId, 'not_active');

    if (
      trigger === 'manual' &&
      group.lastSyncError === null &&
      group.lastSyncedAt !== null &&
      now() - group.lastSyncedAt < tuning.manualDebounceMs
    ) {
      const result = skipped(localId, 'debounced');
      emit({ type: 'started', localId, trigger });
      emit({ type: 'finished', localId, trigger, result });
      return result;
    }
    const wait = backoff.get(localId);
    if (wait !== undefined && now() < wait.until && (wait.hard || RESPECTS_BACKOFF.has(trigger))) {
      return skipped(localId, 'backoff');
    }

    // This cycle reads the outbox fresh, so a pending write debounce or retry is covered by it.
    cancelTimer(writeTimers, localId);
    cancelTimer(retryTimers, localId);
    emit({ type: 'started', localId, trigger });
    let result: SyncResult;
    try {
      // design.md: "The next sync cycle retries outstanding debts first." Never throws.
      if (payDebts) await payPendingDeletes(localId, deadline);
      const synced = await runCycle(group, deadline);
      await store.setSyncState(localId, {
        lastSyncedAt: synced.at,
        lastSyncError: null,
        epochResetsThisCycle: 0,
      });
      backoff.delete(localId);
      result = synced;
    } catch (thrown) {
      result = await recordFailure(localId, toSyncError(thrown), trigger);
    }
    emit({ type: 'finished', localId, trigger, result });
    return result;
  }

  function syncGroup(localId: string, options: SyncOptions): Promise<SyncResult> {
    return startCycle(localId, options, true);
  }

  function startCycle(
    localId: string,
    options: SyncOptions,
    payDebts: boolean,
  ): Promise<SyncResult> {
    // A server switch is rewriting the group; its own full push follows and covers this request.
    if (moving.has(localId)) return Promise.resolve(skipped(localId, 'in_flight'));
    const running = inFlight.get(localId);
    if (running !== undefined) {
      // Taps during an in-flight sync are ignored; everything else shares the running cycle.
      return options.trigger === 'manual'
        ? Promise.resolve(skipped(localId, 'in_flight'))
        : running;
    }
    const run = execute(localId, options, payDebts).finally(() => {
      inFlight.delete(localId);
      const again = rerun.get(localId);
      rerun.delete(localId);
      if (again !== undefined && !disposed) void syncGroup(localId, { trigger: again });
    });
    inFlight.set(localId, run);
    return run;
  }

  async function syncAll(options: SyncOptions): Promise<SyncResult[]> {
    await payPendingDeletes(undefined, options.deadline);
    let groups: GroupRow[];
    try {
      groups = (await store.listGroups()).filter((g) => g.state === 'active');
      if (options.trigger === 'background') {
        const since = now() - tuning.backgroundWindowMs;
        const recent: GroupRow[] = [];
        for (const group of groups) {
          const ts = await store.latestTs(group.localId);
          if (ts !== null && ts >= since) recent.push(group);
        }
        groups = recent;
      }
    } catch (error) {
      log('sync: could not list groups', describeError(error));
      return [];
    }
    const results: SyncResult[] = [];
    for (const group of groups) {
      if (options.deadline !== undefined && now() >= options.deadline) {
        results.push(skipped(group.localId, 'deadline'));
        continue;
      }
      // The debts were just retried above; the group's cycle does not retry them again.
      results.push(await startCycle(group.localId, options, false));
    }
    return results;
  }

  // ----- pending deletes -----

  /** One DELETE with the stored token; settles the debt per the rules in the header. Never throws. */
  async function payDebt(debt: PendingDeleteRow): Promise<DebtOutcome> {
    const key = `${debt.localId}|${debt.serverUrl}`;
    if (debtsInFlight.has(key)) return { outcome: 'pending' };
    debtsInFlight.add(key);
    try {
      let outcome: DebtOutcome;
      try {
        const token = b64urlDecode(debt.authToken);
        await transportFor(debt.serverUrl).delete(groupIdForToken(token), token);
        outcome = { outcome: 'deleted' };
      } catch (thrown) {
        const error = toSyncError(thrown);
        if (error.status === 404) {
          outcome = { outcome: 'deleted' }; // nothing left to delete there
        } else if (DEBT_TRANSIENT.has(error.code)) {
          return { outcome: 'pending' };
        } else {
          log(describeFailure('sync dropped a pending delete', error));
          outcome = { outcome: 'dropped', error: error.code };
        }
      }
      try {
        await store.pendingDeletes.remove(debt);
      } catch (error) {
        // The debt stays and is paid again next time; a DELETE is idempotent.
        log('sync: could not clear a pending delete', describeError(error));
      }
      return outcome;
    } finally {
      debtsInFlight.delete(key);
    }
  }

  /** Retries the outstanding debts (all, or one group's), in the order recorded, until the deadline. */
  async function payPendingDeletes(
    only: string | undefined,
    deadline: number | undefined,
  ): Promise<void> {
    let debts: PendingDeleteRow[];
    try {
      debts = await store.pendingDeletes.list();
    } catch (error) {
      log('sync: could not read pending deletes', describeError(error));
      return;
    }
    for (const debt of debts) {
      if (only !== undefined && debt.localId !== only) continue;
      if (deadline !== undefined && now() >= deadline) return;
      await payDebt(debt);
    }
  }

  async function deleteServerCopy(
    localId: string,
    serverUrl: string,
  ): Promise<DeleteServerCopyResult> {
    let origin: string;
    try {
      origin = canonicalOrigin(serverUrl);
    } catch {
      return { outcome: 'failed', error: 'invalid_url' };
    }
    try {
      const group = await store.getGroup(localId);
      if (group !== null && group.state === 'active' && group.serverUrl === origin) {
        return { outcome: 'failed', error: 'current_server' };
      }
      const secret = await secrets.getSecret(localId);
      if (secret === null || deriveLocal(secret).localId !== localId) {
        return { outcome: 'failed', error: 'no_secret' };
      }
      const debt: PendingDeleteRow = {
        localId,
        serverUrl: origin,
        authToken: b64urlEncode(deriveServer(secret, origin).authToken),
      };
      // Debt first, request second: a failure, or the app being killed mid-request, leaves it to be retried.
      await store.pendingDeletes.add(debt);
      const paid = await payDebt(debt);
      return paid.outcome === 'dropped' ? { outcome: 'failed', error: paid.error } : paid;
    } catch (error) {
      log('sync: could not delete a server copy', describeError(error));
      return { outcome: 'failed', error: 'local_error' };
    }
  }

  // ----- moving to another server -----

  async function moveServer(localId: string, serverUrl: string): Promise<MoveServerResult> {
    const failed = (error: Extract<MoveServerResult, { outcome: 'failed' }>['error']) =>
      ({ localId, outcome: 'failed', error }) as const;
    let origin: string;
    try {
      origin = canonicalOrigin(serverUrl);
    } catch {
      return failed('invalid_url');
    }
    if (moving.has(localId)) return failed('in_flight');
    moving.add(localId);
    let dropped: number;
    try {
      // Let a running cycle finish; while `moving` is set, no new one starts.
      for (let running = inFlight.get(localId); running; running = inFlight.get(localId)) {
        await running;
      }
      const group = await store.getGroup(localId);
      if (group === null) return failed('not_found');
      if (group.state === 'closed' || group.state === 'hidden') return failed('not_movable');
      if (group.serverUrl === origin) return failed('same_server');
      const secret = await secrets.getSecret(localId);
      if (secret === null) return failed('no_secret');
      const { encryptionKey: key, localId: derived } = deriveLocal(secret);
      if (derived !== localId) return failed('no_secret');
      const from = deriveServer(secret, group.serverUrl).groupId;
      const to = deriveServer(secret, origin).groupId;

      // Read, re-encrypt, and switch in one transaction, so a write landing meanwhile cannot be left behind
      // sealed for the old group id.
      dropped = await store.transaction(async (tx) => {
        const { byStatus } = await tx.countByStatus(localId);
        // Byte-exact: bodies are never parsed, so an unsupported one crosses unchanged.
        const reencrypted: ReadableEnvelope[] = (await tx.listReadable(localId)).map(
          ({ id, envelope }) => ({
            id,
            envelope: resealEnvelope({ key, groupId: from, newKey: key, newGroupId: to, envelope }),
          }),
        );
        await tx.setServer(localId, origin, reencrypted);
        // A debt to delete the copy on the server this group now syncs through would wipe it.
        await tx.pendingDeletes.remove({ localId, serverUrl: origin });
        return byStatus.undecryptable + byStatus.unsupported_envelope;
      });
    } catch (error) {
      log('sync: could not move a group', describeError(error));
      return failed('local_error');
    } finally {
      moving.delete(localId);
    }
    // Backoff and batch size were learned from the old server.
    backoff.delete(localId);
    batchLimit.delete(localId);
    cancelTimer(retryTimers, localId);
    const sync = await startCycle(localId, { trigger: 'server_move' }, true);
    return { localId, outcome: 'moved', serverUrl: origin, dropped, sync };
  }

  function requestSync(localId: string): void {
    if (disposed) return;
    cancelTimer(writeTimers, localId);
    const cancel = schedule(() => {
      writeTimers.delete(localId);
      // A write during a cycle may have missed its outbox read: run again after it.
      if (inFlight.has(localId)) rerun.set(localId, 'local_write');
      else void syncGroup(localId, { trigger: 'local_write' });
    }, tuning.writeDebounceMs);
    writeTimers.set(localId, cancel);
  }

  function subscribe(listener: (event: SyncEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    disposed = true;
    for (const cancel of [...writeTimers.values(), ...retryTimers.values()]) cancel();
    writeTimers.clear();
    retryTimers.clear();
    rerun.clear();
  }

  return {
    syncGroup,
    syncAll,
    moveServer,
    deleteServerCopy,
    requestSync,
    subscribe,
    dispose,
  };
}
