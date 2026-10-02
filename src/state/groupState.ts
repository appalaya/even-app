/**
 * Derived state per group (design.md "Architecture Overview", "Reducer", "Balances and simplification", "Key
 * patterns"): decrypts the readable envelopes into `LogEntry[]` held in memory only, replays them through `reduce`,
 * computes balances (wrapped: a hostile log can make `nets` throw, and then the group shows "balances unavailable"),
 * and adds what the screens need beside the reducer's output: skipped counts, the update-required flag, invite
 * readiness, sync status, and read-only reasons.
 *
 * Memoised per group and invalidated on the engine's `finished` events and on local writes. Each envelope is
 * decrypted once per (id, ciphertext), in a `DecodeCache` shared with the sync engine: what a pull opened to store
 * is not opened again here, a re-derive after a sync opens only what is new, and a server move carries the bodies
 * over to the re-encrypted rows. Nothing decrypted is ever written anywhere.
 *
 * The React layer reads snapshots synchronously (`peek`, `peekList`) and re-renders on `subscribe`; a snapshot object
 * is replaced, never mutated, so identity comparison tells a hook whether anything changed.
 */
import {
  creationOf,
  deriveLocal,
  deriveServer,
  formatMinor,
  isCurrency,
  nets as computeNets,
  openMany,
  parseEvent,
  reduce,
  simplify,
  type Envelope,
  type GroupState,
  type LogEntry,
  type MemberState,
  type Transfer,
} from '@even/core';

import type { Secrets } from '../services/secrets/types';
import type {
  EventCounts,
  EventOrigin,
  GroupLifecycle,
  GroupRow,
  Store,
  StoredEnvelopeRow,
} from '../services/storage/types';
import { DecodeCache, type Decoded } from '../services/sync/decodeCache';
import type { SyncEngine, SyncEvent, SyncResult } from '../services/sync/types';
import { OPENS_PER_YIELD, yieldToEventLoop } from '../services/yieldToEventLoop';
import { pendingAmong } from './acks';
import { describeForLog } from './errors';
import { firstEntry, isMoneyType, isReadable, lastEntry, parseEnvelopeText, typeOf } from './log';

// ---------- Pure pieces ----------

export interface SkippedCounts {
  undecryptable: number;
  invalid: number;
  unsupported_envelope: number;
  unsupported_body: number;
  total: number;
}

export interface Balances {
  /** Net per member (paid − owed ± payments), or null when unavailable. */
  nets: ReadonlyMap<string, number> | null;
  /** The simplified settle list. */
  transfers: readonly Transfer[];
  /** `nets` threw `RangeError` (only a hostile log can do that): show "balances unavailable". */
  balancesUnavailable: boolean;
}

/** `nets` and `simplify`, wrapped so a hostile log shows "balances unavailable" instead of crashing (design.md). */
export function balancesOf(state: GroupState): Balances {
  try {
    const nets = computeNets(state);
    return { nets, transfers: simplify(nets), balancesUnavailable: false };
  } catch (error) {
    if (error instanceof RangeError)
      return { nets: null, transfers: [], balancesUnavailable: true };
    throw error;
  }
}

/** Why a group cannot be written to right now. `null` means it can. */
export type ReadOnlyReason = 'no_secret' | 'hidden' | 'closed' | 'archived';

/** A `group.closed` this device wrote (it rotated the group away): the old group hides once it is acknowledged. */
export interface LocalClosure {
  eventId: string;
  ts: number;
  to: string | null;
}

export interface DerivedGroup {
  localId: string;
  /** The `groups` row as last read. */
  row: GroupRow;
  /** The reduced state; null only when this phone has no secret for the group (`noSecret`). */
  state: GroupState | null;
  /** The group name: from the log once `group.created` arrived, else the invite's. */
  name: string;
  /** ISO 4217 code: from `group.created`, else the invite's; null if neither is known yet. */
  currency: string | null;
  myMemberId: string | null;
  /** This device's member, once claimed and known. */
  me: MemberState | null;
  /** No member claimed yet on this device: show "Which one are you?" once members are known. */
  needsClaim: boolean;
  nets: ReadonlyMap<string, number> | null;
  transfers: readonly Transfer[];
  /** Your net ("you're owed 44.00" / "you owe 12.00" / "settled"), or null if unknown or unavailable. */
  myNet: number | null;
  balancesUnavailable: boolean;
  /** Rows that could not be applied, by `events.status` (design.md "Skipped-item visibility"). */
  skipped: SkippedCounts;
  /** A money event is skipped as invalid or unsupported, or an envelope of an unknown version is held: balances are
   *  known to be incomplete, so the group shows the hard "Update Even" banner. Also when the group's currency is one
   *  this build's ISO 4217 table does not know: its amounts can only be shown as plain integers, and none can be
   *  entered (Group offers no Add expense then). */
  updateRequired: boolean;
  counts: EventCounts;
  /** Share gating: `group.created` and its creator's `member.added` are acknowledged by the server. */
  inviteReady: boolean;
  /** A `group.moved` names a server other than the current one: offer "Follow to <host>". */
  moveOffer: string | null;
  readOnly: ReadOnlyReason | null;
  localClosure: LocalClosure | null;
  /** Newest `at` in the activity feed (wall clock), or null for an empty log. */
  lastActivityAt: number | null;
  noSecret: boolean;
}

export interface SyncStatus {
  lifecycle: GroupLifecycle;
  /** A cycle for this group is running. */
  syncing: boolean;
  lastSyncedAt: number | null;
  /** `groups.last_sync_error`: a `SyncErrorCode`, or null. */
  lastSyncError: string | null;
  serverUrl: string;
  /** The last `finished` result seen in this process, if any. */
  lastResult: SyncResult | null;
}

export interface GroupSnapshot {
  status: 'loading' | 'ready' | 'missing' | 'error';
  derived: DerivedGroup | null;
  sync: SyncStatus | null;
  /** While the first derive runs: the group's cached name (`name_cache`), so the nav bar can already say it. */
  name?: string;
}

export interface GroupListRow {
  localId: string;
  name: string;
  currency: string | null;
  /** Your net in minor units; null when unknown or balances are unavailable. */
  myNet: number | null;
  /** Members who count on a card ("4 people"): not archived, not placeholders; null before the log is readable. */
  memberCount: number | null;
  /** This phone's events no server has acknowledged yet (the card's "waiting to sync"). */
  outbox: number;
  /** At least one live expense or payment: only then does a zero net mean "settled" on the card. */
  hasActivity: boolean;
  balancesUnavailable: boolean;
  lifecycle: GroupLifecycle;
  /** `group.archived`: sits in the collapsed Archived section. */
  archived: boolean;
  /** Rotated away (read-only): "Ask a member for the new invite." */
  closed: boolean;
  needsClaim: boolean;
  sync: SyncStatus;
  /** For ordering: newest activity, else when this phone created or joined the group. */
  lastActivityAt: number;
  /**
   * Other visible groups rotated from the same old group (two members rotated concurrently). The app shows both and
   * lets the user pick; `GroupService.hideGroup` hides the other (design.md "Recognising a rotation").
   */
  rotationSiblings: string[];
}

export interface GroupListSnapshot {
  status: 'loading' | 'ready';
  rows: readonly GroupListRow[];
}

/** Active groups by latest activity, newest first, then archived ones the same way; ties by id. */
export function sortGroupRows(rows: readonly GroupListRow[]): GroupListRow[] {
  return [...rows].sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.lastActivityAt !== b.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
    return a.localId < b.localId ? -1 : a.localId > b.localId ? 1 : 0;
  });
}

function syncStatusOf(row: GroupRow, syncing: boolean, lastResult: SyncResult | null): SyncStatus {
  return {
    lifecycle: row.state,
    syncing,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
    serverUrl: row.serverUrl,
    lastResult,
  };
}

// ---------- The store ----------

interface Memo {
  derived: DerivedGroup;
  /** Valid (`ok`) entries, the reducer's input and the writers' `nextTs` log. */
  entries: readonly LogEntry[];
}

export interface GroupStateDeps {
  store: Store;
  secrets: Pick<Secrets, 'getSecret'>;
  engine: Pick<SyncEngine, 'subscribe'>;
  /** Locale for activity summaries' amounts; the device default when omitted. */
  locale?: string;
  /** Shared with the sync engine, which fills it as it pulls; defaults to a private one. */
  decodeCache?: DecodeCache;
  log?: (message: string, detail?: unknown) => void;
}

const LOADING: GroupSnapshot = Object.freeze({ status: 'loading', derived: null, sync: null });
const MISSING: GroupSnapshot = Object.freeze({ status: 'missing', derived: null, sync: null });
const ERROR: GroupSnapshot = Object.freeze({ status: 'error', derived: null, sync: null });
const LOADING_LIST: GroupListSnapshot = Object.freeze({ status: 'loading', rows: [] });

/**
 * Opens stored envelope texts of one group in one batch (core's `openMany`: one call into the AEAD, native when it
 * is installed), each to what opening it alone gives: its validated event, or null for text that is not an envelope,
 * does not open, or does not validate.
 */
function decodeMany(key: Uint8Array, groupId: string, texts: readonly string[]): Decoded[] {
  const parsed = texts.map(parseEnvelopeText);
  const outcomes = openMany({
    key,
    groupId,
    envelopes: parsed.filter((envelope): envelope is Envelope => envelope !== null),
  });
  let next = 0;
  return texts.map((text, i) => {
    if (parsed[i] === null) return { text, groupId, event: null, type: null };
    const outcome = outcomes[next++];
    if (outcome === undefined || !outcome.ok) return { text, groupId, event: null, type: null };
    return { text, groupId, event: parseEvent(outcome.body), type: typeOf(outcome.body) };
  });
}

export class GroupStateStore {
  private readonly store: Store;
  private readonly secrets: Pick<Secrets, 'getSecret'>;
  private readonly locale: string | undefined;
  private readonly log: (message: string, detail?: unknown) => void;
  private readonly unsubscribeEngine: () => void;

  private readonly memo = new Map<string, Memo | null>();
  private readonly versions = new Map<string, number>();
  private readonly memoVersions = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Memo | null>>();
  /** What each envelope decrypted to, shared with the engine (and rotation, through `GroupService`). */
  readonly decodeCache: DecodeCache;
  /** Whether `decodeCache` is this store's own (cleared on `dispose`) rather than one shared with the engine. */
  private readonly ownsDecoded: boolean;
  private readonly snapshots = new Map<string, GroupSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly syncing = new Set<string>();
  private readonly lastResults = new Map<string, SyncResult>();

  private listSnapshot: GroupListSnapshot = LOADING_LIST;
  private readonly listListeners = new Set<() => void>();
  private listVersion = 0;
  private listInflight: Promise<GroupListSnapshot> | null = null;
  /** Each listed group's `rotatedFrom`, from its last derive (the Groups rows' rotation siblings). */
  private readonly rotatedFromOf = new Map<string, readonly string[]>();

  private finishedHook: ((localId: string, result: SyncResult) => void) | null = null;
  private disposed = false;

  constructor(deps: GroupStateDeps) {
    this.store = deps.store;
    this.secrets = deps.secrets;
    this.locale = deps.locale;
    this.decodeCache = deps.decodeCache ?? new DecodeCache();
    this.ownsDecoded = deps.decodeCache === undefined;
    this.log = deps.log ?? ((message, detail) => console.warn(message, detail));
    this.unsubscribeEngine = deps.engine.subscribe((event) => this.onSync(event));
  }

  /** Called after each `finished` event, once the group has been invalidated (the lifecycle checks hang here). */
  setFinishedHook(hook: ((localId: string, result: SyncResult) => void) | null): void {
    this.finishedHook = hook;
  }

  // ----- reads -----

  /** The derived state, re-deriving if it was invalidated; null if the group does not exist. */
  async get(localId: string): Promise<DerivedGroup | null> {
    return (await this.load(localId))?.derived ?? null;
  }

  /** The group's valid decrypted entries (for `nextTs` and permission checks); empty if the group does not exist. */
  async entries(localId: string): Promise<readonly LogEntry[]> {
    return (await this.load(localId))?.entries ?? [];
  }

  /** The current snapshot, synchronously. `loading` until the first derive finishes. */
  peek(localId: string): GroupSnapshot {
    return this.snapshots.get(localId) ?? LOADING;
  }

  /** Re-renders on every change of this group's snapshot. Starts a derive if none is current. */
  subscribe(localId: string, listener: () => void): () => void {
    let set = this.listeners.get(localId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(localId, set);
    }
    set.add(listener);
    if (!this.isFresh(localId)) this.refresh(localId);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(localId);
    };
  }

  /** The Groups list (hidden groups excluded), sorted by `sortGroupRows`. */
  async list(): Promise<readonly GroupListRow[]> {
    return (await this.loadList()).rows;
  }

  peekList(): GroupListSnapshot {
    return this.listSnapshot;
  }

  /**
   * The reduced states of the groups derived so far, `first`'s before the others: the category chip's history
   * (design.md "Model refinement"). Synchronous and in memory only: it never derives, decrypts or reads the store, so
   * a group not opened yet this launch is simply not in it. A left group is gone (`evict`).
   */
  peekStates(first: string | null = null): GroupState[] {
    const states: GroupState[] = [];
    for (const [localId, snapshot] of this.snapshots) {
      const state = snapshot.derived?.state;
      if (state == null) continue;
      if (localId === first) states.unshift(state);
      else states.push(state);
    }
    return states;
  }

  subscribeList(listener: () => void): () => void {
    this.listListeners.add(listener);
    if (this.listSnapshot === LOADING_LIST || this.listInflight === null) this.refreshList();
    return () => {
      this.listListeners.delete(listener);
    };
  }

  // ----- invalidation -----

  /** Marks the group stale (a local write, a sync, a lifecycle change). Observed groups re-derive at once. */
  invalidate(localId: string): void {
    this.versions.set(localId, this.version(localId) + 1);
    if (this.listeners.has(localId) || this.listListeners.size > 0) this.refresh(localId);
    this.refreshList();
  }

  /** Forgets a group entirely (Leave): drops its decrypted entries from memory. */
  evict(localId: string): void {
    this.versions.set(localId, this.version(localId) + 1);
    this.memo.delete(localId);
    this.memoVersions.delete(localId);
    this.decodeCache.drop(localId);
    this.rotatedFromOf.delete(localId);
    this.lastResults.delete(localId);
    this.syncing.delete(localId);
    this.setSnapshot(localId, MISSING);
    this.refreshList();
  }

  /** A group was created, joined, left, hidden or revived: rebuild the list. */
  groupsChanged(): void {
    this.refreshList();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeEngine();
    this.listeners.clear();
    this.listListeners.clear();
    this.memo.clear();
    if (this.ownsDecoded) this.decodeCache.clear();
  }

  // ----- internals -----

  private version(localId: string): number {
    return this.versions.get(localId) ?? 0;
  }

  private isFresh(localId: string): boolean {
    return this.memo.has(localId) && this.memoVersions.get(localId) === this.version(localId);
  }

  private onSync(event: SyncEvent): void {
    if (this.disposed) return;
    const { localId } = event;
    if (event.type === 'started') {
      this.syncing.add(localId);
      this.updateSync(localId);
      return;
    }
    this.syncing.delete(localId);
    this.lastResults.set(localId, event.result);
    this.updateSync(localId);
    this.invalidate(localId);
    try {
      this.finishedHook?.(localId, event.result);
    } catch (error) {
      this.log('state: finished hook threw', describeForLog(error));
    }
  }

  private updateSync(localId: string): void {
    const snapshot = this.snapshots.get(localId);
    if (snapshot?.derived == null) return;
    this.setSnapshot(localId, {
      ...snapshot,
      sync: syncStatusOf(
        snapshot.derived.row,
        this.syncing.has(localId),
        this.lastResults.get(localId) ?? null,
      ),
    });
    this.refreshList();
  }

  private setSnapshot(localId: string, snapshot: GroupSnapshot): void {
    this.snapshots.set(localId, snapshot);
    for (const listener of [...(this.listeners.get(localId) ?? [])]) {
      try {
        listener();
      } catch (error) {
        this.log('state: listener threw', describeForLog(error));
      }
    }
  }

  private refresh(localId: string): void {
    this.load(localId).catch((error: unknown) => {
      this.log('state: could not derive a group', describeForLog(error));
      if (!this.snapshots.has(localId)) this.setSnapshot(localId, ERROR);
    });
  }

  /** Derives until the result matches the latest version (an invalidation mid-derive runs it again). */
  private load(localId: string): Promise<Memo | null> {
    if (this.isFresh(localId)) return Promise.resolve(this.memo.get(localId) ?? null);
    const running = this.inflight.get(localId);
    if (running !== undefined) return running;
    const run = (async (): Promise<Memo | null> => {
      for (;;) {
        const version = this.version(localId);
        const memo = await this.derive(localId);
        if (version !== this.version(localId) && !this.disposed) continue;
        this.memo.set(localId, memo);
        this.memoVersions.set(localId, version);
        if (memo === null) {
          this.decodeCache.drop(localId);
          this.setSnapshot(localId, MISSING);
        } else {
          this.setSnapshot(localId, {
            status: 'ready',
            derived: memo.derived,
            sync: syncStatusOf(
              memo.derived.row,
              this.syncing.has(localId),
              this.lastResults.get(localId) ?? null,
            ),
          });
        }
        return memo;
      }
    })().finally(() => this.inflight.delete(localId));
    this.inflight.set(localId, run);
    return run;
  }

  private async derive(localId: string): Promise<Memo | null> {
    const row = await this.store.getGroup(localId);
    if (row === null) return null;
    // A large group takes a while to open: until it has, the screen draws its loading state under the group's name.
    const shown = this.snapshots.get(localId);
    if (shown === undefined || (shown.status === 'loading' && shown.name === undefined)) {
      this.setSnapshot(localId, { ...LOADING, name: row.nameCache ?? '' });
    }
    const counts = await this.store.countByStatus(localId);
    const secret = await this.secrets.getSecret(localId);
    const local = secret === null ? null : deriveLocal(secret);
    const noSecret = secret === null || local === null || local.localId !== localId;

    const entries: LogEntry[] = [];
    const origins = new Map<string, EventOrigin>();
    let skippedMoney = false;
    let readFailures = 0;
    if (!noSecret) {
      const key = local.encryptionKey;
      const groupId = deriveServer(secret, row.serverUrl).groupId;
      // Each envelope is opened once per (text, group id): by the pull that stored it (the engine shares this cache), or
      // by the first derive that reads it. A re-derive after a sync opens only what is new.
      const since = this.decodeCache.mark();
      const seen = new Set<string>();
      const readable = (await this.store.listEnvelopes(localId)).filter((stored) =>
        isReadable(stored.status),
      );
      // In log order, a window at a time: each holds at most OPENS_PER_YIELD envelopes not cached yet, opened in one
      // batch call into the AEAD, and the thread is handed back before each window after the first that opens any,
      // so the screen can draw and answer while a large group derives (pre-launch review H3). With @noble the AEAD
      // is most of a window (about 0.2 ms an envelope without a JIT); natively it is a few percent of it, and
      // parsing and validating the bodies is the rest.
      let windowsOpened = 0;
      for (let start = 0; start < readable.length;) {
        const window: { stored: StoredEnvelopeRow; decoded: Decoded | undefined }[] = [];
        let misses = 0;
        while (start + window.length < readable.length && misses < OPENS_PER_YIELD) {
          const stored = readable[start + window.length]!;
          const decoded = this.decodeCache.get(localId, stored.id, stored.envelope, groupId);
          if (decoded === undefined) misses += 1;
          window.push({ stored, decoded });
        }
        start += window.length;
        if (misses > 0) {
          if (windowsOpened > 0) await yieldToEventLoop();
          windowsOpened += 1;
          const pending = window.filter((item) => item.decoded === undefined);
          const opened = decodeMany(
            key,
            groupId,
            pending.map((item) => item.stored.envelope),
          );
          pending.forEach((item, k) => {
            item.decoded = opened[k]!;
            this.decodeCache.put(localId, item.stored.id, item.decoded);
          });
        }
        for (const { stored, decoded } of window) {
          seen.add(stored.id);
          if (decoded === undefined) continue; // cannot happen: every miss was just decoded
          if (stored.status === 'ok') {
            if (decoded.event === null) {
              readFailures += 1;
            } else {
              // The server's arrival time rides beside the body: the reducer orders and holds by it.
              entries.push(
                stored.receivedAt === null
                  ? { id: stored.id, event: decoded.event }
                  : { id: stored.id, event: decoded.event, receivedAt: stored.receivedAt },
              );
              origins.set(stored.id, stored.origin);
            }
          } else if (isMoneyType(decoded.type)) {
            skippedMoney = true;
          }
        }
      }
      // And once more after the last of several, so a large group's last window and its reduce are separate blocks.
      if (windowsOpened > 1) await yieldToEventLoop();
      this.decodeCache.retain(localId, seen, since);
    }

    // The creation the reducer applies (the first to arrive; a later one is ignored), so the currency agrees with it.
    const created = creationOf(entries);
    const createdEvent = created?.event.type === 'group.created' ? created.event : null;
    const currency = createdEvent?.currency ?? row.currencyCache;
    const locale = this.locale;
    const state = noSecret
      ? null
      : reduce(entries, {
          selfLocalId: localId,
          ...(currency === null
            ? {}
            : { format: (minor: number) => formatMinor(minor, currency, locale) }),
        });

    const balances: Balances =
      state === null
        ? { nets: null, transfers: [], balancesUnavailable: false }
        : balancesOf(state);
    const myMemberId = row.myMemberId;
    const me = myMemberId === null ? null : (state?.members.get(myMemberId) ?? null);
    const myNet =
      myMemberId === null || balances.nets === null ? null : (balances.nets.get(myMemberId) ?? 0);

    const byStatus = counts.byStatus;
    const skipped: SkippedCounts = {
      undecryptable: byStatus.undecryptable + readFailures,
      invalid: byStatus.invalid,
      unsupported_envelope: byStatus.unsupported_envelope,
      unsupported_body: byStatus.unsupported_body,
      total:
        byStatus.undecryptable +
        readFailures +
        byStatus.invalid +
        byStatus.unsupported_envelope +
        byStatus.unsupported_body,
    };
    // An envelope of an unknown version cannot be opened, so it may well be money: balances may be incomplete.
    const unknownCurrency = currency !== null && !isCurrency(currency);
    const updateRequired = skippedMoney || byStatus.unsupported_envelope > 0 || unknownCurrency;

    let inviteReady = false;
    if (state !== null && created !== null && createdEvent !== null && row.state === 'active') {
      const creatorAdd = firstEntry(
        entries,
        (e) => e.event.type === 'member.added' && e.event.member.id === createdEvent.by,
      );
      if (creatorAdd !== null && state.closed === null) {
        const pending = await pendingAmong(
          this.store,
          localId,
          [created.id, creatorAdd.id],
          Math.max(created.event.ts, creatorAdd.event.ts),
        );
        inviteReady = pending.size === 0;
      }
    }

    const closing = lastEntry(
      entries,
      (e) =>
        e.event.type === 'group.closed' && origins.get(e.id) === 'local' && e.event.to !== localId,
    );
    const localClosure: LocalClosure | null =
      closing !== null && closing.event.type === 'group.closed'
        ? { eventId: closing.id, ts: closing.event.ts, to: closing.event.to ?? null }
        : null;

    let readOnly: ReadOnlyReason | null = null;
    if (noSecret) readOnly = 'no_secret';
    else if (row.state === 'hidden') readOnly = 'hidden';
    else if (row.state === 'closed' || state?.closed != null) readOnly = 'closed';
    else if (state?.archived === true) readOnly = 'archived';

    let lastActivityAt: number | null = null;
    for (const item of state?.activity ?? []) {
      if (lastActivityAt === null || item.at > lastActivityAt) lastActivityAt = item.at;
    }

    const movedTo = state?.movedTo ?? null;
    const derived: DerivedGroup = {
      localId,
      row,
      state,
      name: state !== null && state.name !== '' ? state.name : (row.nameCache ?? ''),
      currency,
      myMemberId,
      me,
      needsClaim: myMemberId === null,
      nets: balances.nets,
      transfers: balances.transfers,
      myNet,
      balancesUnavailable: balances.balancesUnavailable,
      skipped,
      updateRequired,
      counts,
      inviteReady,
      moveOffer: movedTo !== null && movedTo !== row.serverUrl ? movedTo : null,
      readOnly,
      localClosure,
      lastActivityAt,
      noSecret,
    };
    return { derived, entries };
  }

  // ----- the list -----

  private refreshList(): void {
    if (this.listListeners.size === 0 && this.listSnapshot === LOADING_LIST) return;
    this.listVersion += 1;
    this.loadList().catch((error: unknown) => {
      this.log('state: could not build the groups list', describeForLog(error));
    });
  }

  private loadList(): Promise<GroupListSnapshot> {
    if (this.listInflight !== null) return this.listInflight;
    const run = (async (): Promise<GroupListSnapshot> => {
      for (;;) {
        const version = this.listVersion;
        const rows = await this.buildList(version);
        if (version !== this.listVersion && !this.disposed) continue;
        this.publishList(rows);
        return this.listSnapshot;
      }
    })().finally(() => {
      this.listInflight = null;
    });
    this.listInflight = run;
    return run;
  }

  private publishList(rows: readonly GroupListRow[]): void {
    this.listSnapshot = { status: 'ready', rows };
    for (const listener of [...this.listListeners]) {
      try {
        listener();
      } catch (error) {
        this.log('state: list listener threw', describeForLog(error));
      }
    }
  }

  /**
   * The Groups rows (pre-launch review H3: launch no longer waits for the sum of every group's decrypt). Groups whose
   * derived state is current are rows at once. The others show first as they last were, or, the first time, as a
   * placeholder from the `groups` row alone (the cached name, no member count or net yet, as a group whose log is not
   * readable shows); then each is derived, newest activity first, and its row published as it lands. A newer
   * `version` (an invalidation meanwhile) stops publishing; the caller builds again.
   */
  private async buildList(version: number): Promise<GroupListRow[]> {
    const shown = new Map(this.listSnapshot.rows.map((row) => [row.localId, row]));
    const rows = new Map<string, GroupListRow>();
    const pending: GroupRow[] = [];
    for (const group of await this.store.listGroups()) {
      if (group.state === 'hidden') continue;
      if (this.isFresh(group.localId)) {
        const derived = this.memo.get(group.localId)?.derived;
        if (derived !== undefined) rows.set(group.localId, this.listRowOf(derived));
        continue;
      }
      const before = shown.get(group.localId);
      rows.set(
        group.localId,
        before === undefined
          ? await this.placeholderRow(group)
          : { ...before, lifecycle: group.state, sync: this.syncOf(group) },
      );
      pending.push(group);
    }
    if (pending.length === 0) return this.listed(rows);

    this.publishList(this.listed(rows));
    const newestFirst = [...pending].sort(
      (a, b) =>
        (rows.get(b.localId)?.lastActivityAt ?? 0) - (rows.get(a.localId)?.lastActivityAt ?? 0),
    );
    for (const group of newestFirst) {
      if (version !== this.listVersion || this.disposed) break;
      const derived = await this.get(group.localId);
      if (derived === null) rows.delete(group.localId);
      else rows.set(group.localId, this.listRowOf(derived));
      if (version === this.listVersion && !this.disposed) this.publishList(this.listed(rows));
    }
    return this.listed(rows);
  }

  /** Sorted, with each row's rotation siblings: other rows rotated from the same old group. */
  private listed(rows: ReadonlyMap<string, GroupListRow>): GroupListRow[] {
    const rotatedFrom = new Map<string, string[]>();
    for (const localId of rows.keys()) {
      for (const from of this.rotatedFromOf.get(localId) ?? []) {
        rotatedFrom.set(from, [...(rotatedFrom.get(from) ?? []), localId]);
      }
    }
    const out: GroupListRow[] = [];
    for (const row of rows.values()) {
      const siblings = new Set<string>();
      for (const ids of rotatedFrom.values()) {
        if (!ids.includes(row.localId)) continue;
        for (const id of ids) if (id !== row.localId) siblings.add(id);
      }
      out.push({ ...row, rotationSiblings: [...siblings].sort() });
    }
    return sortGroupRows(out);
  }

  private syncOf(row: GroupRow): SyncStatus {
    return syncStatusOf(
      row,
      this.syncing.has(row.localId),
      this.lastResults.get(row.localId) ?? null,
    );
  }

  private listRowOf(derived: DerivedGroup): GroupListRow {
    this.rotatedFromOf.set(derived.localId, derived.state?.rotatedFrom ?? []);
    let memberCount: number | null = null;
    if (derived.state !== null) {
      memberCount = 0;
      for (const m of derived.state.members.values())
        if (!m.archived && !m.unknown) memberCount += 1;
    }
    return {
      localId: derived.localId,
      name: derived.name,
      currency: derived.currency,
      myNet: derived.myNet,
      memberCount,
      outbox: derived.counts.outbox,
      hasActivity:
        derived.state !== null &&
        (derived.state.expenses.size > 0 || derived.state.payments.size > 0),
      balancesUnavailable: derived.balancesUnavailable,
      lifecycle: derived.row.state,
      archived: derived.state?.archived ?? false,
      closed: derived.readOnly === 'closed',
      needsClaim: derived.needsClaim,
      sync: this.syncOf(derived.row),
      lastActivityAt: derived.lastActivityAt ?? derived.row.createdAt,
      rotationSiblings: [],
    };
  }

  /**
   * A group not derived yet, from SQL alone: the cached name and currency, the unsent count, and its newest event's
   * `ts` for the order. No member count, net or archive state: those are in the log.
   */
  private async placeholderRow(group: GroupRow): Promise<GroupListRow> {
    const counts = await this.store.countByStatus(group.localId);
    const latest = await this.store.latestTs(group.localId);
    return {
      localId: group.localId,
      name: group.nameCache ?? '',
      currency: group.currencyCache,
      myNet: null,
      memberCount: null,
      outbox: counts.outbox,
      hasActivity: false,
      balancesUnavailable: false,
      lifecycle: group.state,
      archived: false,
      closed: group.state === 'closed',
      needsClaim: group.myMemberId === null,
      sync: this.syncOf(group),
      lastActivityAt: latest ?? group.createdAt,
      rotationSiblings: [],
    };
  }
}
