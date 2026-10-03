/**
 * GroupService: every user action that changes a group, as plain async methods over `Store`, `Secrets`, the sync
 * engine, a clock and this device's id. Screens call these and read `GroupStateStore`; they never write events.
 *
 * The write path (design.md "Ordering", "Validation", "Rotation, moving, closing" → Move):
 * 1. per group, one write at a time, so each event's `ts` sees the previous one;
 * 2. the permission and uniqueness rules are checked against the current derived state (honest clients enforce
 *    them; the reducer cannot);
 * 3. `ts` from core `writeTs(now, log, event, own)` (`nextTs` behind the write gate; `own` is this phone's last push
 *    as a server stamped it, so the gate refuses while the clock runs more than a day ahead of the server's), and the
 *    body must pass `parseEvent` before it is sealed, so this device never produces an event that fails validation on
 *    another phone;
 * 4. the envelope is sealed for the `server_url` read inside the same transaction as its insert (origin `local`,
 *    unacked), so no write can land sealed for an old server's group id;
 * 5. the group's derived state is invalidated and a `local_write` sync is requested.
 *
 * Decisions where design.md leaves room (each is tested in groups.test.ts):
 * - Rotation copies neither the group's own toggles, nor any event the reducer holds, nor any `group.created` but the
 *   one that took effect (design.md "Rotate invite").
 * - Rotation writes the new group, its `group.rotated` (then the re-stated name and archive state, and the optional
 *   `member.archived`) AND the old group's `group.closed` in one local transaction, then pushes the new group, then
 *   syncs the old one. On the network the order is design.md's (new group first, closure after); locally a crash can
 *   never leave a new group without the old one's closure, which would otherwise make this device "recognise" its
 *   own rotation after a restart.
 * - "Recognition done" for the rotating device is persistent and needs no extra column: the old group holds a
 *   `group.closed` of origin `local` naming the new group. Recognition is skipped exactly then.
 * - The one sync a closed group gets during recognition flips it to `active` for that cycle; it ends `hidden`.
 * - Leave runs in the engine's order: rows, then `deleteServerCopy` (refused while an active row syncs to that
 *   server), then the secret, so the pending delete's token is derived while the secret still exists.
 * - A restore writes every field of the chosen version (amount and split together), so it wins every field it names.
 * - Name uniqueness also guards unarchiving (a restored "Maya" may not collide with a newer one).
 */
import {
  canonicalOrigin,
  creationOf,
  decodeInvite,
  deriveLocal,
  deriveServer,
  encodeInvite,
  aheadOfServer,
  hasBidiControl,
  holdBackHorizon,
  inviteLink,
  isCategory,
  isClockSane,
  isCurrency,
  isGroupName,
  isHeldBack,
  isIsoDate,
  LIMITS,
  makeInvite,
  newId,
  newSecret,
  open,
  parseEvent,
  PROTOCOL,
  resealEnvelope,
  seal,
  secretFromInvite,
  writeTs,
  type Category,
  type Event,
  type EventPayload,
  type OwnReceipt,
  type Expense,
  type ExpenseChanges,
  type GroupState,
  type LogEntry,
  type MemberState,
  type Payment,
} from '@even/core';

import { exportGroupCsv } from '../services/csv/csv';
import type { FileIO } from '../services/groupFile/fileIO';
import {
  exportGroupFile as writeGroupFile,
  GroupFileError,
  importGroupFile as readGroupFile,
  type ImportResult,
} from '../services/groupFile/groupFile';
import type { Secrets } from '../services/secrets/types';
import type { GroupLifecycle, GroupRow, NewEventRow, Store } from '../services/storage/types';
import type { InfoCache } from '../services/sync/info';
import type {
  DeleteServerCopyResult,
  MoveServerResult,
  ServerInfo,
  SyncEngine,
  SyncResult,
  SyncTrigger,
  Transport,
} from '../services/sync/types';
import { groupUsage, type GroupUsage } from '../services/sync/usage';
import { pacer, RESEALS_PER_YIELD, yieldToEventLoop } from '../services/yieldToEventLoop';
import { allAcked } from './acks';
import {
  describeForLog,
  fromSealError,
  inviteProblemOf,
  StateError,
  type InviteProblem,
} from './errors';
import type { DerivedGroup, GroupStateStore } from './groupState';
import {
  CONTROL_TYPES,
  GROUP_TOGGLE_TYPES,
  isReadable,
  openType,
  parseEnvelopeText,
  typeOf,
} from './log';
import { MoveOffers, recognitionStep } from './moveOffers';
import { checkEmoji, normaliseName, type PrefsService } from './prefs';
import { deviceSeat } from './seat';
import { resolveSplit, sameSplit, type SplitSpec } from './split';

// ---------- Public shapes ----------

export interface CreateGroupInput {
  name: string;
  /** ISO 4217 code; immutable for the life of the group. */
  currency: string;
  /** Your name in the group. */
  myName: string;
  myEmoji?: string;
  /**
   * Names to pre-add ("People" chips); they pick their name when they join. A chip may carry the member id it will
   * get (chosen when the chip was added, so its avatar previews the colour the member has after Create).
   */
  people?: readonly (string | { name: string; id: string })[];
  /** Your member id, chosen up front so the avatar on the sheet previews your colour. */
  myId?: string;
  /** "Advanced: sync server"; defaults to PROTOCOL.defaultServer. */
  serverUrl?: string;
}

export interface InviteInfo {
  /** The bare code ("Copy code"). */
  code: string;
  /** `https://even.appalaya.com/i#<code>` ("Share link"). */
  link: string;
  /** Share gating: false until `group.created` and the creator's `member.added` are acknowledged. */
  ready: boolean;
}

export interface InvitePreview {
  localId: string;
  /** The invite's group name, or null ("a group"). */
  name: string | null;
  currency: string | null;
  serverUrl: string;
  /** The server's host, for "on sync.even.appalaya.com". */
  host: string;
  /** This phone already holds the group: its row's lifecycle, server, and the name it knows the group by. */
  local: { state: GroupLifecycle; serverUrl: string; name: string | null } | null;
  /** What Join does with this invite on this phone (`inviteFit`): the preview says so before the tap. */
  fit: InviteFit;
}

/**
 * What joining an invite does on this phone, decided from the group row its code names and nothing else: the local
 * id derives from the invite's key (`deriveLocal`), so the answer needs no network. `joinInvite` acts on it and the
 * Join preview shows it (design.md "Invites"):
 * - `join`: this phone does not hold the group; a fresh join ("Join Banff 2026?").
 * - `already`: held, on the invite's server; Join opens it ("You're already in", Open).
 * - `move`: held on another server; a move to confirm ("Already have it").
 * - `closed`: held but closed or hidden here (rotated away); refused ("This group's invite was regenerated.").
 */
export type InviteFit = 'join' | 'already' | 'move' | 'closed';

export function inviteFit(
  serverUrl: string,
  held: { state: GroupLifecycle; serverUrl: string } | null,
): InviteFit {
  if (held === null) return 'join';
  if (held.state === 'closed' || held.state === 'hidden') return 'closed';
  return held.serverUrl === serverUrl ? 'already' : 'move';
}

export type PreviewResult =
  { ok: true; invite: InvitePreview } | { ok: false; error: InviteProblem };

export type JoinResult =
  | {
      kind: 'joined';
      localId: string;
      /** No member claimed yet: show "Which one are you?" once members are known. */
      needsClaim: boolean;
      /** The `first_open` sync. `synced`: the member list is available. Otherwise "Joined, waiting for first sync". */
      firstSync: SyncResult;
      /** The first sync did not complete: the name pick waits until members arrive. */
      waiting: boolean;
    }
  /** Same group, same server: open it. */
  | { kind: 'already'; localId: string }
  /** Same group on another server: confirm "Move <name> from <old host> to <new host>?", then `acceptInviteMove`. */
  | { kind: 'move'; localId: string; fromServer: string; toServer: string }
  /** The invite opens a group this phone has closed or hidden (rotated away): refused. */
  | { kind: 'closedGroupInvite'; localId: string; state: 'closed' | 'hidden' };

export interface ExpenseDraft {
  title: string;
  /** Minor units. */
  amount: number;
  paidBy: string;
  /** YYYY-MM-DD, the day it happened. */
  date: string;
  category: Category;
  note?: string;
  split: SplitSpec;
}

/** Changed fields only. `amount` and `split` travel together or not at all; `note: null` or `''` clears it. */
export interface ExpenseEdit {
  title?: string;
  amount?: number;
  split?: SplitSpec;
  paidBy?: string;
  date?: string;
  category?: Category;
  note?: string | null;
}

export interface PaymentDraft {
  from: string;
  to: string;
  amount: number;
  date: string;
  note?: string;
}

export interface LeaveResult {
  /** This device's events no server has acknowledged: other members will never see them. */
  unsent: number;
  /** When `deleteServerCopy` was asked for. */
  serverCopy: DeleteServerCopyResult | null;
}

export interface RotateResult {
  /** The new group. */
  localId: string;
  invite: InviteInfo;
  /** Step 1: the old group's last sync. */
  lastSync: SyncResult;
  /** Step 5: the new group's first push. */
  pushed: SyncResult;
  /** Step 6: the old group's sync carrying `group.closed`. The old group is hidden once that is acknowledged. */
  closing: SyncResult;
}

export type MoveResult =
  | (MoveServerResult & { fromServer: string })
  /** The current server never acknowledged `group.moved`; nothing was switched. */
  | { localId: string; outcome: 'failed'; error: 'not_acknowledged'; fromServer: string };

export interface UsageReport {
  info: ServerInfo;
  usage: GroupUsage;
}

/**
 * "Report this group": everything the contact page is given, and nothing more. Never the secret, the invite or the
 * group's name (even-server THREAT-MODEL.md, "Abuse posture": a takedown is a group id on a blocklist).
 */
export interface ReportInfo {
  /** The group's id on its current server (PROTOCOL.md §2): base64url(SHA-256(authToken)), 43 characters. */
  groupId: string;
  /** That server's canonical URL (PROTOCOL.md §8.1). */
  server: string;
}

/** `checkServer`: the server's info (and a group's usage against it), or why it cannot be used. */
export type ServerCheck =
  | { ok: true; serverUrl: string; info: ServerInfo; usage: GroupUsage | null }
  | { ok: false; problem: 'invalid_url' | 'not_an_even_server' | 'unreachable' };

export interface GroupServiceDeps {
  store: Store;
  secrets: Secrets;
  engine: SyncEngine;
  groupState: GroupStateStore;
  /** This install's device id (`dev` on every event). */
  deviceId: string;
  now: () => number;
  transportFor: (serverUrl: string) => Transport;
  infoCache: InfoCache;
  files?: FileIO | null;
  prefs?: PrefsService | null;
  log?: (message: string, detail?: unknown) => void;
}

// ---------- Internals ----------

interface Draft {
  payload: EventPayload;
  /** Author override (self-add, claim, create); defaults to this device's claimed member. */
  by?: string;
}

interface WriteContext {
  derived: DerivedGroup;
  state: GroupState;
  row: GroupRow;
  me: string | null;
  currency: string | null;
}

/** What a read-only group still accepts: `join` (claims, self-add), `unarchive`, `control` (group.moved). */
type Allow = 'normal' | 'join' | 'unarchive' | 'control';

/** Length in Unicode code points, the unit every length rule counts. */
function codePoints(text: string): number {
  return [...text].length;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function hostOf(serverUrl: string): string {
  return serverUrl.replace(/^https:\/\//, '');
}

/** Every localId a `group.closed { to }` in this log names: where the group says it was rotated to. */
function closureTargets(entries: readonly LogEntry[]): Set<string> {
  const targets = new Set<string>();
  for (const { event } of entries) {
    if (event.type === 'group.closed' && event.to !== undefined) targets.add(event.to);
  }
  return targets;
}

function requireMember(state: GroupState, id: string): MemberState {
  const member = state.members.get(id);
  if (member === undefined || member.unknown) throw new StateError('not_found', 'no such member');
  return member;
}

function assertNameFree(state: GroupState, name: string, except?: string): void {
  const key = nameKey(name);
  for (const member of state.members.values()) {
    if (member.id === except || member.archived || member.unknown) continue;
    if (nameKey(member.name) === key) {
      throw new StateError('name_taken', 'another member already has this name');
    }
  }
}

function assertRoomForMember(state: GroupState): void {
  let count = 0;
  for (const member of state.members.values()) if (!member.unknown) count += 1;
  if (count >= LIMITS.membersMax) {
    throw new StateError('members_full', `a group has at most ${LIMITS.membersMax} members`);
  }
}

function checkTitle(title: string): string {
  const trimmed = title.trim();
  const length = codePoints(trimmed);
  if (length === 0 || length > LIMITS.titleMax) {
    throw new StateError('invalid', `a title is 1 to ${LIMITS.titleMax} characters`);
  }
  if (hasBidiControl(trimmed)) {
    throw new StateError('invalid', 'a title cannot hold a text-direction control character');
  }
  return trimmed;
}

function checkAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < LIMITS.amountMin || amount > LIMITS.amountMax) {
    throw new StateError('invalid', 'the amount is out of range');
  }
  return amount;
}

function checkDate(date: string): string {
  if (!isIsoDate(date)) throw new StateError('invalid', 'a date is YYYY-MM-DD');
  return date;
}

function checkCategory(category: Category): Category {
  if (!isCategory(category)) throw new StateError('invalid', 'unknown category');
  return category;
}

/** Trimmed; '' means "no note". */
function checkNote(note: string): string {
  const trimmed = note.trim();
  if (codePoints(trimmed) > LIMITS.noteMax) {
    throw new StateError('invalid', `a note is at most ${LIMITS.noteMax} characters`);
  }
  if (hasBidiControl(trimmed)) {
    throw new StateError('invalid', 'a note cannot hold a text-direction control character');
  }
  return trimmed;
}

function checkGroupName(name: string): string {
  const trimmed = name.trim();
  if (!isGroupName(trimmed)) {
    throw new StateError(
      'invalid',
      `a group name is 1 to ${LIMITS.groupNameMax} characters, with no text-direction control character`,
    );
  }
  return trimmed;
}

// ---------- The service ----------

export class GroupService {
  private readonly store: Store;
  private readonly secrets: Secrets;
  private readonly engine: SyncEngine;
  private readonly groupState: GroupStateStore;
  private readonly deviceId: string;
  private readonly now: () => number;
  private readonly transportFor: (serverUrl: string) => Transport;
  private readonly infoCache: InfoCache;
  private readonly files: FileIO | null;
  private readonly prefs: PrefsService | null;
  private readonly log: (message: string, detail?: unknown) => void;

  private readonly locks = new Map<string, Promise<unknown>>();
  /** Old groups whose rescue is running: their closure handling waits for it. */
  private readonly recognizing = new Set<string>();

  constructor(deps: GroupServiceDeps) {
    this.store = deps.store;
    this.secrets = deps.secrets;
    this.engine = deps.engine;
    this.groupState = deps.groupState;
    this.deviceId = deps.deviceId;
    this.now = deps.now;
    this.transportFor = deps.transportFor;
    this.infoCache = deps.infoCache;
    this.files = deps.files ?? null;
    this.prefs = deps.prefs ?? null;
    this.log = deps.log ?? ((message, detail) => console.warn(message, detail));
  }

  // ===== Create, invite, join =====

  /**
   * Creates a group: a new secret and ids, the secret and the row (`active`, name and currency cached, `my_member_id`
   * set), then, in design.md's order, the creator's `member.added` (by = the new member), `member.claimed`,
   * `group.created`, and one `member.added` per pre-added name, each with `ts` from `nextTs`. Requests a sync.
   */
  async createGroup(input: CreateGroupInput): Promise<{ localId: string; memberId: string }> {
    const name = checkGroupName(input.name);
    const currency = input.currency.trim();
    if (!isCurrency(currency)) throw new StateError('invalid', 'unknown currency');
    const myName = normaliseName(input.myName);
    const myEmoji = input.myEmoji === undefined ? undefined : checkEmoji(input.myEmoji);
    const people = (input.people ?? []).map((person) =>
      typeof person === 'string'
        ? { name: normaliseName(person), id: newId() }
        : { name: normaliseName(person.name), id: person.id },
    );
    const keys = [myName, ...people.map((person) => person.name)].map(nameKey);
    if (new Set(keys).size !== keys.length) {
      throw new StateError('name_taken', 'two people have the same name');
    }
    if (keys.length > LIMITS.membersMax) {
      throw new StateError('members_full', `a group has at most ${LIMITS.membersMax} members`);
    }
    const serverUrl = this.canonical(input.serverUrl ?? PROTOCOL.defaultServer);
    const now = this.now();
    const own = await this.store.latestOwnReceipt();
    if (!isClockSane(now) || aheadOfServer(now, own)) {
      throw new StateError('clock', "check your phone's date");
    }

    const secret = newSecret();
    const { localId, encryptionKey: key } = deriveLocal(secret);
    const memberId = input.myId ?? newId();
    const ids = [memberId, ...people.map((person) => person.id)];
    if (new Set(ids).size !== ids.length)
      throw new StateError('invalid', 'two members share an id');
    const drafts: Draft[] = [
      {
        payload: {
          type: 'member.added',
          member:
            myEmoji === undefined
              ? { id: memberId, name: myName }
              : { id: memberId, name: myName, emoji: myEmoji },
        },
        by: memberId,
      },
      { payload: { type: 'member.claimed', id: memberId }, by: memberId },
      { payload: { type: 'group.created', name, currency }, by: memberId },
      ...people.map((person): Draft => ({
        payload: { type: 'member.added', member: { id: person.id, name: person.name } },
        by: memberId,
      })),
    ];
    const entries = this.buildEvents(now, [], drafts, memberId, own);
    const rows = this.sealRows(entries, key, deriveServer(secret, serverUrl).groupId);

    await this.secrets.setSecret(localId, secret, serverUrl);
    try {
      await this.store.transaction(async (tx) => {
        await tx.upsertGroup({
          localId,
          serverUrl,
          epoch: null,
          cursor: 0,
          myMemberId: memberId,
          nameCache: name,
          currencyCache: currency,
          createdAt: now,
          lastSyncedAt: null,
          lastSyncError: null,
          state: 'active',
          epochResetsThisCycle: 0,
        });
        await tx.insertEvents(localId, rows);
      });
    } catch (error) {
      await this.secrets.deleteSecret(localId).catch(() => undefined);
      throw error;
    }
    await this.seedPrefs(myName, myEmoji);
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
    this.engine.requestSync(localId);
    return { localId, memberId };
  }

  /** The group's invite, and whether it may be shared yet. */
  async inviteFor(localId: string): Promise<InviteInfo> {
    const derived = await this.requireDerived(localId);
    const secret = await this.secretOf(localId);
    const extras: { g?: string; cur?: string } = {};
    if (isGroupName(derived.name)) extras.g = derived.name;
    if (derived.currency !== null && isCurrency(derived.currency)) extras.cur = derived.currency;
    const code = encodeInvite(makeInvite(secret, derived.row.serverUrl, extras));
    return { code, link: inviteLink(code), ready: derived.inviteReady };
  }

  /**
   * Decodes a pasted code or link for the Join screen, and looks the group up on this phone by the local id its key
   * derives (no network). Never throws for bad input.
   */
  async previewInvite(text: string): Promise<PreviewResult> {
    let invite: ReturnType<typeof decodeInvite>;
    let localId: string;
    try {
      invite = decodeInvite(text);
      localId = deriveLocal(secretFromInvite(invite)).localId;
    } catch (error) {
      return { ok: false, error: inviteProblemOf(error) };
    }
    const row = await this.store.getGroup(localId);
    return {
      ok: true,
      invite: {
        localId,
        name: invite.g ?? null,
        currency: invite.cur ?? null,
        serverUrl: invite.s,
        host: hostOf(invite.s),
        local:
          row === null ? null : { state: row.state, serverUrl: row.serverUrl, name: row.nameCache },
        fit: inviteFit(invite.s, row),
      },
    };
  }

  /**
   * Joins from an invite. A new group: stores the secret and the row, runs the `first_open` sync, then recognises a
   * rotation if the new group was rotated from one this phone holds. Offline, the group is still created (`active`,
   * `last_sync_error` set) and the name pick waits. Throws `StateError` with an invite problem for bad input.
   */
  async joinInvite(text: string): Promise<JoinResult> {
    let invite: ReturnType<typeof decodeInvite>;
    let secret: Uint8Array;
    try {
      invite = decodeInvite(text);
      secret = secretFromInvite(invite);
    } catch (error) {
      throw new StateError(inviteProblemOf(error), 'the invite cannot be used');
    }
    const { localId } = deriveLocal(secret);
    const existing = await this.store.getGroup(localId);
    // The same decision the preview showed (`inviteFit`).
    const fit = inviteFit(invite.s, existing);
    if (existing !== null) {
      if (fit === 'closed') {
        return {
          kind: 'closedGroupInvite',
          localId,
          state: existing.state === 'hidden' ? 'hidden' : 'closed',
        };
      }
      // A re-shared invite is also the recovery path for a row whose secret is missing (an Android restore).
      const hadSecret = (await this.secrets.getSecret(localId)) !== null;
      // The row's server, not the invite's: a different one is a move the caller confirms first.
      await this.secrets.setSecret(localId, secret, existing.serverUrl);
      if (fit === 'move') {
        return { kind: 'move', localId, fromServer: existing.serverUrl, toServer: invite.s };
      }
      if (!hadSecret) {
        this.groupState.invalidate(localId);
        void this.engine.syncGroup(localId, { trigger: 'first_open' });
      }
      return { kind: 'already', localId };
    }

    await this.secrets.setSecret(localId, secret, invite.s);
    await this.store.upsertGroup({
      localId,
      serverUrl: invite.s,
      epoch: null,
      cursor: 0,
      myMemberId: null,
      nameCache: invite.g ?? null,
      currencyCache: invite.cur ?? null,
      createdAt: this.now(),
      lastSyncedAt: null,
      lastSyncError: null,
      state: 'active',
      epochResetsThisCycle: 0,
    });
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
    const firstSync = await this.engine.syncGroup(localId, { trigger: 'first_open' });
    await this.processLifecycle(localId);
    const row = await this.store.getGroup(localId);
    return {
      kind: 'joined',
      localId,
      needsClaim: row?.myMemberId == null,
      firstSync,
      waiting: firstSync.outcome !== 'synced',
    };
  }

  /** Moves a held group to the server a fresh invite names (the recovery path for a dead server): no `group.moved`. */
  acceptInviteMove(localId: string, toServer: string): Promise<MoveResult> {
    return this.moveServer(localId, toServer, { announce: false });
  }

  // ===== Members =====

  /** "Which one are you?": writes `member.claimed` (by = that member) and sets `my_member_id`. */
  async claimMember(localId: string, memberId: string): Promise<void> {
    await this.append(
      localId,
      ({ state }) => {
        const member = requireMember(state, memberId);
        if (member.archived)
          throw new StateError('not_allowed', 'an archived member cannot be claimed');
        if (member.devices.includes(this.deviceId)) return []; // idempotent per (id, dev)
        return [{ payload: { type: 'member.claimed', id: memberId }, by: memberId }];
      },
      { allow: 'join', afterInsert: (tx) => tx.setMyMember(localId, memberId) },
    );
  }

  /** "I'm not listed": adds yourself (by = the new member, a self-add) and claims the seat. Returns the member id. */
  async joinAsNewMember(
    localId: string,
    name: string,
    emoji?: string,
    options: { id?: string } = {},
  ): Promise<string> {
    const clean = normaliseName(name);
    const cleanEmoji = emoji === undefined ? undefined : checkEmoji(emoji);
    // "I'm not listed" previews the avatar colour the new seat gets: the sheet may choose the id first.
    const memberId = options.id ?? newId();
    await this.append(
      localId,
      ({ state }) => {
        assertRoomForMember(state);
        assertNameFree(state, clean);
        if (state.members.has(memberId)) throw new StateError('invalid', 'that member id is taken');
        const member =
          cleanEmoji === undefined
            ? { id: memberId, name: clean }
            : { id: memberId, name: clean, emoji: cleanEmoji };
        return [
          { payload: { type: 'member.added', member }, by: memberId },
          { payload: { type: 'member.claimed', id: memberId }, by: memberId },
        ];
      },
      { allow: 'join', afterInsert: (tx) => tx.setMyMember(localId, memberId) },
    );
    await this.seedPrefs(clean, cleanEmoji);
    return memberId;
  }

  /**
   * Adds someone else by name (unique among non-archived members, case-insensitive). Returns the member id. `id`
   * lets the Add member sheet preview the avatar colour the new member gets (core `memberColor` of the id): pass
   * one from `newId()`; it must not name an existing member.
   */
  async addMember(
    localId: string,
    name: string,
    emoji?: string,
    options: { id?: string } = {},
  ): Promise<string> {
    const clean = normaliseName(name);
    const cleanEmoji = emoji === undefined ? undefined : checkEmoji(emoji);
    const memberId = options.id ?? newId();
    await this.append(localId, ({ state }) => {
      assertRoomForMember(state);
      assertNameFree(state, clean);
      if (state.members.has(memberId)) throw new StateError('invalid', 'that member id is taken');
      const member =
        cleanEmoji === undefined
          ? { id: memberId, name: clean }
          : { id: memberId, name: clean, emoji: cleanEmoji };
      return [{ payload: { type: 'member.added', member } }];
    });
    return memberId;
  }

  /**
   * Renames a member or changes its avatar (`emoji: null` = initials). Allowed on your own seat and on a member nobody
   * has claimed yet (someone has to fix a typo they typed); `not_allowed` on another joined member.
   */
  async updateMember(
    localId: string,
    memberId: string,
    changes: { name?: string; emoji?: string | null },
  ): Promise<void> {
    const name = changes.name === undefined ? undefined : normaliseName(changes.name);
    const emoji =
      changes.emoji === undefined || changes.emoji === null
        ? changes.emoji
        : checkEmoji(changes.emoji);
    await this.append(localId, ({ state, me }) => {
      const member = requireMember(state, memberId);
      if (memberId !== me && member.devices.length > 0) {
        throw new StateError(
          'not_allowed',
          "another joined member's name and avatar are theirs to change",
        );
      }
      const next: { name?: string; emoji?: string | null } = {};
      if (name !== undefined && name !== member.name) {
        assertNameFree(state, name, memberId);
        next.name = name;
      }
      if (emoji === null && member.emoji !== undefined) next.emoji = null;
      if (typeof emoji === 'string' && emoji !== member.emoji) next.emoji = emoji;
      if (Object.keys(next).length === 0) return [];
      return [{ payload: { type: 'member.updated', id: memberId, changes: next } }];
    });
  }

  /** Archives another member (hidden from pickers; balances kept). Never yourself: that is Leave. */
  async archiveMember(localId: string, memberId: string): Promise<void> {
    await this.append(localId, ({ state, me }) => {
      if (memberId === me)
        throw new StateError('not_allowed', 'you cannot archive yourself; leave instead');
      const member = requireMember(state, memberId);
      return member.archived ? [] : [{ payload: { type: 'member.archived', id: memberId } }];
    });
  }

  async unarchiveMember(localId: string, memberId: string): Promise<void> {
    await this.append(localId, ({ state, me }) => {
      if (memberId === me) throw new StateError('not_allowed', 'you cannot unarchive yourself');
      const member = requireMember(state, memberId);
      if (!member.archived) return [];
      assertNameFree(state, member.name, memberId);
      return [{ payload: { type: 'member.unarchived', id: memberId } }];
    });
  }

  /** "I'm done adding" (your own mark by default). */
  async setDone(localId: string, memberId?: string): Promise<void> {
    await this.append(localId, ({ state, me }) => {
      const id = memberId ?? me;
      if (id === null) throw new StateError('not_claimed');
      requireMember(state, id);
      return state.doneMembers.includes(id) ? [] : [{ payload: { type: 'member.done', id } }];
    });
  }

  /** "Adding more". */
  async setUndone(localId: string, memberId?: string): Promise<void> {
    await this.append(localId, ({ state, me }) => {
      const id = memberId ?? me;
      if (id === null) throw new StateError('not_claimed');
      return state.doneMembers.includes(id) ? [{ payload: { type: 'member.undone', id } }] : [];
    });
  }

  // ===== Expenses and payments =====

  /** Adds an expense; the split spec is resolved (seeded by the new expense id) into the stored split. */
  async addExpense(localId: string, draft: ExpenseDraft): Promise<string> {
    const title = checkTitle(draft.title);
    const amount = checkAmount(draft.amount);
    const date = checkDate(draft.date);
    const category = checkCategory(draft.category);
    const note = draft.note === undefined ? '' : checkNote(draft.note);
    const id = newId();
    await this.append(localId, ({ state, currency }) => {
      if (currency === null) throw new StateError('invalid', 'the group has not arrived yet');
      requireMember(state, draft.paidBy);
      const split = resolveSplit(amount, draft.split, id);
      for (const memberId of Object.keys(split)) requireMember(state, memberId);
      const expense: Expense = {
        id,
        title,
        amount,
        currency,
        paidBy: draft.paidBy,
        date,
        category,
        split,
      };
      if (note !== '') expense.note = note;
      return [{ payload: { type: 'expense.added', expense } }];
    });
    return id;
  }

  /** Edits an expense: only fields that differ are written; amount and split change together or not at all. */
  async updateExpense(localId: string, expenseId: string, edit: ExpenseEdit): Promise<void> {
    if ((edit.amount === undefined) !== (edit.split === undefined)) {
      throw new StateError('invalid', 'the amount and the split change together');
    }
    await this.append(localId, ({ state }) => {
      const current = state.expenses.get(expenseId);
      if (current === undefined) throw new StateError('not_found', 'no such expense');
      const fields: Partial<Pick<Expense, 'title' | 'paidBy' | 'date' | 'category' | 'note'>> = {};
      if (edit.title !== undefined) {
        const title = checkTitle(edit.title);
        if (title !== current.title) fields.title = title;
      }
      if (edit.paidBy !== undefined && edit.paidBy !== current.paidBy) {
        requireMember(state, edit.paidBy);
        fields.paidBy = edit.paidBy;
      }
      if (edit.date !== undefined && checkDate(edit.date) !== current.date) fields.date = edit.date;
      if (edit.category !== undefined && checkCategory(edit.category) !== current.category) {
        fields.category = edit.category;
      }
      if (edit.note !== undefined) {
        const note = edit.note === null ? '' : checkNote(edit.note);
        if (note !== (current.note ?? '')) fields.note = note;
      }
      let changes: ExpenseChanges = fields;
      if (edit.amount !== undefined && edit.split !== undefined) {
        const amount = checkAmount(edit.amount);
        const split = resolveSplit(amount, edit.split, expenseId);
        for (const memberId of Object.keys(split)) requireMember(state, memberId);
        if (amount !== current.amount || !sameSplit(split, current.split)) {
          changes = { ...fields, amount, split };
        }
      }
      if (Object.keys(changes).length === 0) return [];
      return [{ payload: { type: 'expense.updated', id: expenseId, changes } }];
    });
  }

  async deleteExpense(localId: string, expenseId: string): Promise<void> {
    await this.append(localId, ({ state }) => {
      if (!state.expenses.has(expenseId)) throw new StateError('not_found', 'no such expense');
      return [{ payload: { type: 'expense.deleted', id: expenseId } }];
    });
  }

  /**
   * Restores version `historyIndex` of an expense's history: an ordinary `expense.updated` carrying that version's
   * fields, amount and split together. A no-op when the expense already reads that way.
   */
  async restoreExpenseVersion(
    localId: string,
    expenseId: string,
    historyIndex: number,
  ): Promise<void> {
    await this.append(localId, ({ state }) => {
      const current = state.expenses.get(expenseId);
      if (current === undefined) throw new StateError('not_found', 'no such expense');
      const version = current.history[historyIndex];
      if (version === undefined || version.kind === 'deleted') {
        throw new StateError('not_found', 'no such version');
      }
      const snap = version.snapshot;
      const unchanged =
        snap.title === current.title &&
        snap.paidBy === current.paidBy &&
        snap.date === current.date &&
        snap.category === current.category &&
        (snap.note ?? '') === (current.note ?? '') &&
        snap.amount === current.amount &&
        sameSplit(snap.split, current.split);
      if (unchanged) return [];
      const changes: ExpenseChanges = {
        title: snap.title,
        paidBy: snap.paidBy,
        date: snap.date,
        category: snap.category,
        note: snap.note ?? '',
        amount: snap.amount,
        split: { ...snap.split },
      };
      return [{ payload: { type: 'expense.updated', id: expenseId, changes } }];
    });
  }

  /** Records a settlement from one member to another. */
  async addPayment(localId: string, draft: PaymentDraft): Promise<string> {
    const amount = checkAmount(draft.amount);
    const date = checkDate(draft.date);
    const note = draft.note === undefined ? '' : checkNote(draft.note);
    if (draft.from === draft.to) throw new StateError('invalid', 'a payment goes to someone else');
    const id = newId();
    await this.append(localId, ({ state, currency }) => {
      if (currency === null) throw new StateError('invalid', 'the group has not arrived yet');
      requireMember(state, draft.from);
      requireMember(state, draft.to);
      const payment: Payment = { id, from: draft.from, to: draft.to, amount, currency, date };
      if (note !== '') payment.note = note;
      return [{ payload: { type: 'payment.added', payment } }];
    });
    return id;
  }

  async deletePayment(localId: string, paymentId: string): Promise<void> {
    await this.append(localId, ({ state }) => {
      if (!state.payments.has(paymentId)) throw new StateError('not_found', 'no such payment');
      return [{ payload: { type: 'payment.deleted', id: paymentId } }];
    });
  }

  // ===== The group =====

  async renameGroup(localId: string, name: string): Promise<void> {
    const clean = checkGroupName(name);
    await this.append(
      localId,
      ({ state }) =>
        state.name === clean ? [] : [{ payload: { type: 'group.renamed', name: clean } }],
      { afterInsert: (tx) => tx.setNameCache(localId, { name: clean }) },
    );
  }

  /** Read-only by choice; still syncs; reversible. */
  async archiveGroup(localId: string): Promise<void> {
    await this.append(localId, ({ state }) =>
      state.archived ? [] : [{ payload: { type: 'group.archived' } }],
    );
  }

  async unarchiveGroup(localId: string): Promise<void> {
    await this.append(
      localId,
      ({ state }) => (state.archived ? [{ payload: { type: 'group.unarchived' } }] : []),
      { allow: 'unarchive' },
    );
  }

  /** How many of this device's events no server has acknowledged (the Leave confirmation's number). */
  async unsentCount(localId: string): Promise<number> {
    const counts = await this.store.countByStatus(localId);
    if (counts.outbox === 0) return counts.rejected;
    const pending = new Set((await this.store.outbox(localId, counts.outbox)).map((row) => row.id));
    let unsent = 0;
    for (const row of await this.store.listEnvelopes(localId)) {
      if (row.origin === 'local' && pending.has(row.id)) unsent += 1;
    }
    return unsent + counts.rejected;
  }

  /**
   * Leave is local only: the group's rows, then (when asked) the server copy's delete, then the secret. That is the
   * engine's order: `deleteServerCopy` refuses the server an active row still syncs through, and it records the debt
   * with its token (derived from the secret) before sending, so the delete is retried even after the secret is gone.
   */
  async leaveGroup(
    localId: string,
    options: { deleteServerCopy?: boolean } = {},
  ): Promise<LeaveResult> {
    return this.withLock(localId, async () => {
      const row = await this.store.getGroup(localId);
      if (row === null) throw new StateError('not_found', 'no such group');
      const unsent = await this.unsentCount(localId);
      await this.store.deleteGroup(localId);
      const serverCopy =
        options.deleteServerCopy === true
          ? await this.engine.deleteServerCopy(localId, row.serverUrl)
          : null;
      await this.secrets.deleteSecret(localId);
      this.groupState.evict(localId);
      this.groupState.groupsChanged();
      return { unsent, serverCopy };
    });
  }

  /** Two concurrent rotations: the user picked the other group, so this one is hidden. */
  async hideGroup(localId: string): Promise<void> {
    await this.store.setGroupState(localId, 'hidden');
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
  }

  /** Settings → "clear unreadable entries". Returns how many were deleted. */
  async clearUnreadable(localId: string): Promise<number> {
    const deleted = await this.store.pruneUndecryptable(localId, 0);
    this.groupState.invalidate(localId);
    return deleted;
  }

  /**
   * Pull to refresh, a tap on the status line's sync glyph (`manual`, debounced by the engine), or the app returning
   * to the foreground while a group is open (`foreground`: waits out a backoff; shares a running cycle).
   */
  sync(
    localId: string,
    trigger: Extract<SyncTrigger, 'pull_to_refresh' | 'manual' | 'foreground'>,
  ): Promise<SyncResult> {
    return this.engine.syncGroup(localId, { trigger });
  }

  /**
   * "Check" on Move server, and a custom server on Create: reads the server's `/v1/info` (through the info cache,
   * which fetches it on first use in this process). Problems use the error-copy panel's cases (Groups, create and join, extra states): not an https URL, not
   * an Even server (wrong shape, 404, or no protocol 1), or no answer. With `localId`, also measures that group
   * against the server's caps ("This group: 246 KB · 5% of the limit").
   */
  async checkServer(url: string, localId?: string): Promise<ServerCheck> {
    let origin: string;
    try {
      origin = canonicalOrigin(url);
    } catch {
      return { ok: false, problem: 'invalid_url' };
    }
    let info: ServerInfo;
    try {
      info = await this.infoCache.get(origin, this.transportFor(origin));
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      return {
        ok: false,
        problem: code === 'not_an_even_server' ? 'not_an_even_server' : 'unreachable',
      };
    }
    if (!info.protocol.includes(PROTOCOL.version))
      return { ok: false, problem: 'not_an_even_server' };
    const usage = localId === undefined ? null : await groupUsage(this.store, localId, info);
    return { ok: true, serverUrl: origin, info, usage };
  }

  // ===== Rotation =====

  /**
   * Regenerate the invite (design.md "Rotate invite", steps 1–6). Returns the new group and its invite. The old group
   * keeps syncing until its `group.closed` is acknowledged and is then hidden (by `processLifecycle`, on the engine's
   * `finished` events, including after a restart).
   */
  async rotateInvite(
    localId: string,
    options: { removeMemberId?: string; serverUrl?: string } = {},
  ): Promise<RotateResult> {
    const server = options.serverUrl === undefined ? undefined : this.canonical(options.serverUrl);
    return this.withLock(localId, async () => {
      const before = await this.requireDerived(localId);
      const beforeState = this.stateOf(before);
      if (before.readOnly === 'hidden' || before.readOnly === 'closed') {
        throw new StateError('read_only', 'this group was already rotated');
      }
      const me = before.row.myMemberId;
      if (me === null) throw new StateError('not_claimed');
      const removed = options.removeMemberId;
      if (removed !== undefined) {
        if (removed === me) throw new StateError('not_allowed', 'you cannot remove yourself');
        requireMember(beforeState, removed);
      }

      // 1. One last sync, so nothing pushed by others in the last minutes is lost.
      const lastSync = await this.engine.syncGroup(localId, { trigger: 'pull_to_refresh' });
      const derived = await this.requireDerived(localId);
      const state = this.stateOf(derived);
      if (derived.readOnly === 'closed')
        throw new StateError('read_only', 'someone rotated this group first');
      const oldLog = await this.groupState.entries(localId);
      // What this phone's reducer holds now (a claimed ts more than a day past the latest R) stays behind too: on the
      // new group's copy it would have no R until pushed, and take effect at its claim meanwhile.
      const horizon = holdBackHorizon(oldLog);
      const held = new Set(oldLog.filter((e) => isHeldBack(e, horizon)).map((e) => e.id));
      // Only the creation that took effect crosses: a duplicate one (a hostile member's, claiming an earlier ts in
      // another currency) stays behind, so the new group is created once, in the group's own currency.
      const creation = creationOf(oldLog);
      const oldSecret = await this.secretOf(localId);
      const oldKey = deriveLocal(oldSecret).encryptionKey;
      const now = this.now();
      const own = await this.store.latestOwnReceipt();
      if (!isClockSane(now) || aheadOfServer(now, own)) {
        throw new StateError('clock', "check your phone's date");
      }

      // 2. A new secret: new local id, new key.
      const secret = newSecret();
      const { localId: newLocalId, encryptionKey: newKey } = deriveLocal(secret);
      const plannedServer = server ?? derived.row.serverUrl;
      let newServer = plannedServer;
      let carried: { id: string; text: string; event: Event | null; type: string | null }[] = [];
      let carriedGroupId = '';
      await this.secrets.setSecret(newLocalId, secret, plannedServer);
      try {
        await this.store.transaction(async (tx) => {
          const row = await tx.getGroup(localId);
          if (row === null) throw new StateError('not_found', 'no such group');
          const serverUrl = server ?? row.serverUrl;
          newServer = serverUrl;
          const oldGroupId = deriveServer(oldSecret, row.serverUrl).groupId;
          const newGroupId = deriveServer(secret, serverUrl).groupId;
          carried = [];
          carriedGroupId = newGroupId;

          // 3. Every readable envelope, same id and bytes, fresh nonce, same origin; control events, the group's
          // name and archive toggles, every event the reducer holds, and every group.created but the one that took
          // effect stay behind. The thread is handed back every
          // few hundred, so the screen still draws while a large group is copied.
          // What the derive already opened is not opened again: the copy only re-encrypts it, and the new group's
          // first derive finds the bodies under the new envelopes (`carried`, put once this commits).
          const copied: NewEventRow[] = [];
          const newLog: LogEntry[] = [];
          const pace = pacer(RESEALS_PER_YIELD);
          for (const stored of await tx.listEnvelopes(localId)) {
            if (!isReadable(stored.status) || held.has(stored.id)) continue;
            if (pace()) await yieldToEventLoop();
            const envelope = parseEnvelopeText(stored.envelope);
            if (envelope === null) continue;
            let opened = this.groupState.decodeCache.get(
              localId,
              stored.id,
              stored.envelope,
              oldGroupId,
            );
            if (opened === undefined || (opened.event === null && opened.type === null)) {
              let body: unknown;
              try {
                body = open({ key: oldKey, groupId: oldGroupId, envelope });
              } catch {
                continue;
              }
              const event = stored.status === 'ok' ? parseEvent(body) : null;
              opened = { text: stored.envelope, groupId: oldGroupId, event, type: typeOf(body) };
            }
            const type = opened.type ?? '';
            if (CONTROL_TYPES.has(type) || GROUP_TOGGLE_TYPES.has(type)) continue;
            if (type === 'group.created' && stored.id !== creation?.id) continue;
            const resealed = resealEnvelope({
              key: oldKey,
              groupId: oldGroupId,
              newKey,
              newGroupId,
              envelope,
            });
            const text = JSON.stringify(resealed);
            copied.push({
              id: stored.id,
              origin: stored.origin,
              acked: false,
              seq: null,
              ts: stored.ts,
              envelope: text,
              status: stored.status,
            });
            const event = stored.status === 'ok' ? opened.event : null;
            carried.push({ id: stored.id, text, event, type: opened.type });
            if (event !== null) newLog.push({ id: stored.id, event });
          }
          await tx.upsertGroup({
            localId: newLocalId,
            serverUrl,
            epoch: null,
            cursor: 0,
            myMemberId: row.myMemberId,
            nameCache: row.nameCache,
            currencyCache: row.currencyCache,
            createdAt: now,
            lastSyncedAt: null,
            lastSyncError: null,
            state: 'active',
            epochResetsThisCycle: 0,
          });
          if (copied.length > 0) await tx.insertEvents(newLocalId, copied);

          // 4. The link from the new group; the group's name and archive state as they read now, re-stated at this
          // clock since their toggles stayed behind (the new group's name is otherwise its `group.created` one); and
          // the removal the user picked.
          const marks: Draft[] = [{ payload: { type: 'group.rotated', from: localId } }];
          const created = creationOf(newLog)?.event;
          const createdName = created?.type === 'group.created' ? created.name : null;
          if (state.created && state.name !== createdName) {
            marks.push({ payload: { type: 'group.renamed', name: state.name } });
          }
          if (state.archived) marks.push({ payload: { type: 'group.archived' } });
          // The removal holds in either order, so `writeTs` writes it at the group clock when a far-future event about
          // the member leaves nothing below the top of the range to outrank it: the rotation never fails on one.
          if (removed !== undefined && state.members.get(removed)?.archived !== true) {
            marks.push({ payload: { type: 'member.archived', id: removed } });
          }
          const markEntries = this.buildEvents(now, newLog, marks, me, own);
          await tx.insertEvents(newLocalId, this.sealRows(markEntries, newKey, newGroupId));

          // 6. The closure of the old group (pushed after the new group; see the header).
          const closure = this.buildEvents(
            now,
            oldLog,
            [{ payload: { type: 'group.closed', reason: 'rotated', to: newLocalId } }],
            me,
            own,
          );
          await tx.insertEvents(localId, this.sealRows(closure, oldKey, oldGroupId));
        });
      } catch (error) {
        await this.secrets.deleteSecret(newLocalId).catch(() => undefined);
        throw error;
      }
      for (const c of carried) {
        this.groupState.decodeCache.put(newLocalId, c.id, {
          text: c.text,
          groupId: carriedGroupId,
          event: c.event,
          type: c.type,
        });
      }
      // The old group moved while this ran (the new group follows the row, not the snapshot).
      if (newServer !== plannedServer) await this.recordServer(newLocalId, newServer);
      this.groupState.invalidate(localId);
      this.groupState.invalidate(newLocalId);
      this.groupState.groupsChanged();

      // 5. Push the new group.
      const pushed = await this.engine.syncGroup(newLocalId, { trigger: 'pull_to_refresh' });
      // 6. Sync the old group until the closure is acknowledged; hide it then.
      const closing = await this.engine.syncGroup(localId, { trigger: 'pull_to_refresh' });
      await this.processLifecycle(localId);
      return {
        localId: newLocalId,
        invite: await this.inviteFor(newLocalId),
        lastSync,
        pushed,
        closing,
      };
    });
  }

  /**
   * Checks one group's lifecycle after it changed (a sync finished, a join, an import, app start): gives the row back
   * its seat when the log says which one is this phone's (`restoreSeat`), refreshes the name/currency cache, applies
   * a closure, and recognises a rotation. Runs one at a time per group.
   */
  processLifecycle(localId: string): Promise<void> {
    return this.withLock(`lifecycle|${localId}`, async () => {
      const derived = await this.groupState.get(localId);
      if (derived === null || derived.state === null) return;
      await this.restoreSeat(localId, derived);
      await this.refreshNameCache(derived);
      await this.handleClosure(localId, derived);
      if (derived.state.rotatedFrom.length > 0) await this.recognizeRotation(localId, derived);
      if (derived.state.closed !== null) await this.recognizeRotationInto(localId);
    });
  }

  /**
   * A row with no seat (`my_member_id` null) whose log has exactly one member claimed by this device: sets
   * `my_member_id` to it, silently. That is this phone's own seat, lost from the row by a keychain recovery after a
   * reinstall (the device id outlives the uninstall; the row does not) or by leaving and joining again. No event is
   * written: the member already lists this device, so a `member.claimed` would change nothing. The row is re-read
   * in the transaction, so a name picked meanwhile wins. None, or more than one: nothing changes, and the phone asks
   * "Which name is yours?". Returns whether the seat was restored. Runs on every `processLifecycle`; the Group screen
   * also calls it when it finds such a seat before the lifecycle check has run.
   */
  async restoreSeat(localId: string, known?: DerivedGroup): Promise<boolean> {
    const derived = known ?? (await this.groupState.get(localId));
    if (derived === null || derived.state === null || derived.row.myMemberId !== null) return false;
    const seat = deviceSeat(derived.state, this.deviceId);
    if (seat === null) return false;
    const restored = await this.store.transaction(async (tx) => {
      const row = await tx.getGroup(localId);
      if (row === null || row.myMemberId !== null) return false;
      await tx.setMyMember(localId, seat);
      return true;
    });
    if (restored) {
      this.groupState.invalidate(localId);
      this.groupState.groupsChanged();
    }
    return restored;
  }

  /**
   * App start: brings the keychain index's server URLs in line with the `groups` rows (an entry from the first
   * index format has none; a crash between a move and its index update leaves the old one), then runs
   * `processLifecycle` for every group that is not hidden (resumes a pending closure).
   */
  async reconcile(): Promise<void> {
    const rows = await this.store.listGroups();
    try {
      const indexed = new Map(
        (await this.secrets.listGroups()).map((entry) => [entry.localId, entry.serverUrl]),
      );
      for (const row of rows) {
        if (indexed.has(row.localId) && indexed.get(row.localId) !== row.serverUrl) {
          await this.secrets.setServerUrl(row.localId, row.serverUrl);
        }
      }
    } catch (error) {
      this.log('state: keychain index update failed', describeForLog(error));
    }
    for (const row of rows) {
      if (row.state === 'hidden') continue;
      try {
        await this.processLifecycle(row.localId);
      } catch (error) {
        this.log('state: lifecycle check failed', describeForLog(error));
      }
    }
  }

  /**
   * Reinstall recovery (design.md "Keys"): the iOS keychain outlives an uninstall, so the `even.groups` index can
   * name groups this store does not hold. For each index entry with a server URL, a readable secret and no `groups`
   * row, creates the row (`active`, cursor 0, no epoch, nothing cached, no member claimed) so the next sync pulls
   * the whole log. Entries without a URL (the first index format) or without their secret are skipped. Returns the
   * number of rows created. The app offers this on first launch when the store is empty but the index is not.
   */
  async recoverGroupsFromSecrets(): Promise<number> {
    let recovered = 0;
    for (const { localId, serverUrl } of await this.secrets.listGroups()) {
      if (serverUrl === null || (await this.store.getGroup(localId)) !== null) continue;
      let origin: string;
      let secret: Uint8Array | null;
      try {
        origin = canonicalOrigin(serverUrl);
        secret = await this.secrets.getSecret(localId);
      } catch (error) {
        this.log('state: cannot recover a group', describeForLog(error));
        continue;
      }
      if (secret === null || deriveLocal(secret).localId !== localId) continue;
      const created = await this.store.transaction(async (tx) => {
        if ((await tx.getGroup(localId)) !== null) return false;
        await tx.upsertGroup({
          localId,
          serverUrl: origin,
          epoch: null,
          cursor: 0,
          myMemberId: null,
          nameCache: null,
          currencyCache: null,
          createdAt: this.now(),
          lastSyncedAt: null,
          lastSyncError: null,
          state: 'active',
          epochResetsThisCycle: 0,
        });
        return true;
      });
      if (created) {
        recovered += 1;
        this.groupState.invalidate(localId);
      }
    }
    if (recovered > 0) this.groupState.groupsChanged();
    return recovered;
  }

  /**
   * "Recognising a closure": a `group.closed` from another device sets the group `closed` (read-only, never syncs;
   * "ask a member for the new invite"). This device's own closure (it rotated the group) instead hides the group once
   * the server has acknowledged it.
   */
  async handleClosure(localId: string, known?: DerivedGroup): Promise<void> {
    const derived = known ?? (await this.groupState.get(localId));
    if (derived?.state?.closed == null) return;
    if (this.recognizing.has(localId)) return;
    const { row } = derived;
    if (row.state !== 'active' && row.state !== 'blocked') return;
    if (derived.localClosure !== null) {
      const { eventId, ts } = derived.localClosure;
      // A blocked server will never acknowledge it: nothing is gained by keeping the group.
      const done = row.state === 'blocked' || (await allAcked(this.store, localId, [eventId], ts));
      if (!done) return;
      await this.store.setGroupState(localId, 'hidden');
    } else {
      await this.store.setGroupState(localId, 'closed');
    }
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
  }

  /**
   * "Recognising a rotation": for each `group.rotated { from }` in this group naming a local group that is not
   * hidden and whose own log holds a `group.closed { to }` naming this group, sync the old group one last time, then
   * re-encrypt into this group every old-group envelope of origin `local` whose id this group lacks (this device's
   * own writes, the unpushed outbox included, and nothing else; control events never), unacked; hide the old group
   * and carry over `my_member_id`. When there are such envelopes, it asks first (MoveEntriesPrompt, `rescueFrom`).
   */
  async recognizeRotation(localId: string, known?: DerivedGroup): Promise<void> {
    const derived = known ?? (await this.groupState.get(localId));
    for (const from of derived?.state?.rotatedFrom ?? []) {
      if (from !== localId) await this.rescueFrom(localId, from);
    }
  }

  /**
   * The same recognition seen from the old group: for each group this group's `group.closed { to }` names, held here
   * and not hidden, whose log names this group in a `group.rotated`. The rotator pushes the new group before the
   * old group's closure, so the closure often arrives second, and a closed group never syncs again: without this the
   * rescue would wait for the new group's next sync.
   */
  private async recognizeRotationInto(oldLocalId: string): Promise<void> {
    for (const to of closureTargets(await this.groupState.entries(oldLocalId))) {
      if (to === oldLocalId) continue;
      const target = await this.store.getGroup(to);
      if (target === null || target.state === 'hidden') continue;
      const derived = await this.groupState.get(to);
      if (derived?.state?.rotatedFrom.includes(oldLocalId) === true) {
        await this.rescueFrom(to, oldLocalId);
      }
    }
  }

  // ----- MoveEntriesPrompt -----

  private moveOfferStore: MoveOffers | null = null;

  /**
   * MoveEntriesPrompt's offers (state/moveOffers.ts): recognition publishes one when the old group holds entries this
   * phone wrote that the new group lacks. The Group screen asks over the new group; the old group's settings offer
   * "Move entries".
   */
  get moveOffers(): MoveOffers {
    this.moveOfferStore ??= new MoveOffers(this.store);
    return this.moveOfferStore;
  }

  /**
   * Move (MoveEntriesPrompt, or "Move entries" in the old group's settings): the rescue as written, for one
   * recognised rotation. Nothing happens unless recognition would act (the old group's closure names the new group).
   * Both groups' lifecycle checks wait for it: the old group's last sync starts one, which must not act on a row it
   * read before the move hid the group. (Nothing takes these two locks in the other order.)
   */
  moveEntries(newLocalId: string, oldLocalId: string): Promise<void> {
    return this.withLock(`lifecycle|${newLocalId}`, () =>
      this.withLock(`lifecycle|${oldLocalId}`, () => this.rescueFrom(newLocalId, oldLocalId, true)),
    );
  }

  /**
   * Not now: asked once per rotation. The old group stays on Groups, closed and read-only and un-rescued, and its
   * settings keep "Move entries".
   */
  notNowMove(oldLocalId: string): Promise<void> {
    return this.moveOffers.notNow(oldLocalId);
  }

  /** The two groups' keys and server group ids, or null when either secret is missing or not that group's. */
  private rescueKeys(
    oldSecret: Uint8Array | null,
    newSecret: Uint8Array | null,
    oldRow: GroupRow,
    newRow: GroupRow,
  ): RescueKeys | null {
    if (
      oldSecret === null ||
      newSecret === null ||
      deriveLocal(oldSecret).localId !== oldRow.localId ||
      deriveLocal(newSecret).localId !== newRow.localId
    ) {
      return null;
    }
    return {
      oldKey: deriveLocal(oldSecret).encryptionKey,
      newKey: deriveLocal(newSecret).encryptionKey,
      oldGroupId: deriveServer(oldSecret, oldRow.serverUrl).groupId,
      newGroupId: deriveServer(newSecret, newRow.serverUrl).groupId,
    };
  }

  /**
   * What a rescue carries from the old group into the new one: every old-group envelope of origin `local` (this
   * device's own writes, the unpushed outbox included, and nothing else) that it can open, that the new group lacks,
   * and that is not a control event.
   */
  private async rescuable(
    store: Store,
    newLocalId: string,
    oldLocalId: string,
    keys: RescueKeys,
  ): Promise<{ stored: StoredRow; envelope: ParsedEnvelope }[]> {
    const have = new Set((await store.listEnvelopes(newLocalId)).map((row) => row.id));
    const pace = pacer(RESEALS_PER_YIELD);
    const found: { stored: StoredRow; envelope: ParsedEnvelope }[] = [];
    for (const stored of await store.listEnvelopes(oldLocalId)) {
      if (stored.origin !== 'local' || !isReadable(stored.status) || have.has(stored.id)) continue;
      if (pace()) await yieldToEventLoop();
      const envelope = parseEnvelopeText(stored.envelope);
      if (envelope === null) continue;
      const known = this.groupState.decodeCache.get(
        oldLocalId,
        stored.id,
        stored.envelope,
        keys.oldGroupId,
      )?.type;
      if (CONTROL_TYPES.has(known ?? openType(keys.oldKey, keys.oldGroupId, envelope) ?? '')) {
        continue;
      }
      found.push({ stored, envelope });
    }
    return found;
  }

  /** How many entries a rescue would carry into the new group now (MoveEntriesPrompt's count). */
  private async rescuableCount(newLocalId: string, oldLocalId: string): Promise<number> {
    const oldRow = await this.store.getGroup(oldLocalId);
    const newRow = await this.store.getGroup(newLocalId);
    if (oldRow === null || newRow === null) return 0;
    const keys = this.rescueKeys(
      await this.secrets.getSecret(oldLocalId),
      await this.secrets.getSecret(newLocalId),
      oldRow,
      newRow,
    );
    return keys === null
      ? 0
      : (await this.rescuable(this.store, newLocalId, oldLocalId, keys)).length;
  }

  /**
   * The rescue (design.md "Recognising a rotation"). Recognition calls it for each rotation it sees; `move` is the
   * person's Move. Before copying anything of this phone's into a group whose other members never saw it, it asks:
   * with entries to carry and no Move yet, it only publishes the offer (asked once per rotation, then kept in the old
   * group's settings) and leaves both groups as they are. With none, or on Move, it syncs the old group once,
   * re-encrypts those entries into the new group unacked, hides the old group and carries over the name pick.
   */
  private async rescueFrom(newLocalId: string, oldLocalId: string, move = false): Promise<void> {
    const old = await this.store.getGroup(oldLocalId);
    if (old === null || old.state === 'hidden' || this.recognizing.has(oldLocalId)) return;
    const oldDerived = await this.groupState.get(oldLocalId);
    if (oldDerived?.localClosure?.to === newLocalId) return; // this device rotated it: recognition done
    // A `group.rotated` is only a claim: anyone in the new group can write one naming any group they know the localId
    // of. The old group's own log must agree, through the `group.closed { to }` its rotator always writes there
    // (design.md "Recognising a rotation"). Until that closure is on this phone nothing happens, and the next
    // lifecycle check of either group looks again (`recognizeRotation`, `recognizeRotationInto`).
    if (!closureTargets(await this.groupState.entries(oldLocalId)).has(newLocalId)) return;
    if (!move) {
      const count = await this.rescuableCount(newLocalId, oldLocalId);
      const notNow = count > 0 && (await this.moveOffers.answeredNotNow(oldLocalId));
      const step = recognitionStep(count, notNow);
      if (step !== 'rescue') {
        this.moveOffers.publish({
          to: newLocalId,
          from: oldLocalId,
          fromName: oldDerived?.name ?? '',
          count,
          asked: step === 'offer',
        });
        return;
      }
    }
    if (this.recognizing.has(oldLocalId)) return; // again: the reads above awaited
    this.recognizing.add(oldLocalId);
    let rescued = 0;
    try {
      // Another recognition may have hidden it while the reads above awaited.
      const current = await this.store.getGroup(oldLocalId);
      if (current === null || current.state === 'hidden') return;
      // The one exception to "closed groups never sync".
      if (current.state !== 'active') await this.store.setGroupState(oldLocalId, 'active');
      await this.engine.syncGroup(oldLocalId, { trigger: 'pull_to_refresh' });
      const oldSecret = await this.secrets.getSecret(oldLocalId);
      const newSecret = await this.secrets.getSecret(newLocalId);
      rescued = await this.store.transaction(async (tx) => {
        const oldRow = await tx.getGroup(oldLocalId);
        const newRow = await tx.getGroup(newLocalId);
        if (oldRow === null || newRow === null) return 0;
        const rows: NewEventRow[] = [];
        const keys = this.rescueKeys(oldSecret, newSecret, oldRow, newRow);
        if (keys !== null) {
          for (const { stored, envelope } of await this.rescuable(
            tx,
            newLocalId,
            oldLocalId,
            keys,
          )) {
            let resealed;
            try {
              resealed = resealEnvelope({
                key: keys.oldKey,
                groupId: keys.oldGroupId,
                newKey: keys.newKey,
                newGroupId: keys.newGroupId,
                envelope,
              });
            } catch {
              continue;
            }
            rows.push({
              id: stored.id,
              origin: 'local',
              acked: false,
              seq: null,
              ts: stored.ts,
              envelope: JSON.stringify(resealed),
              status: stored.status,
            });
          }
          if (rows.length > 0) await tx.insertEvents(newLocalId, rows);
        }
        await tx.setGroupState(oldLocalId, 'hidden');
        if (newRow.myMemberId === null && oldRow.myMemberId !== null) {
          await tx.setMyMember(newLocalId, oldRow.myMemberId);
        }
        return rows.length;
      });
    } finally {
      this.recognizing.delete(oldLocalId);
    }
    this.moveOffers.drop(oldLocalId);
    await this.moveOffers.forget(oldLocalId);
    this.groupState.invalidate(oldLocalId);
    this.groupState.invalidate(newLocalId);
    this.groupState.groupsChanged();
    if (rescued > 0) this.engine.requestSync(newLocalId);
  }

  // ===== Moving =====

  /**
   * Settings → server → move. Writes `group.moved { server }` and waits for the current server's acknowledgement
   * (two sync attempts), then switches through the engine's `moveServer` (re-encrypt, `setServer`, full push). A
   * blocked group skips the announcement (its server refuses it); so does `announce: false`, used when a fresh invite
   * names the new server (the old one may be dead).
   */
  async moveServer(
    localId: string,
    serverUrl: string,
    options: { announce?: boolean } = {},
  ): Promise<MoveResult> {
    const origin = this.canonical(serverUrl);
    const row = await this.store.getGroup(localId);
    if (row === null) throw new StateError('not_found', 'no such group');
    const fromServer = row.serverUrl;
    const announce =
      (options.announce ?? true) && row.state === 'active' && row.serverUrl !== origin;
    if (announce) {
      const [moved] = await this.append(
        localId,
        () => [{ payload: { type: 'group.moved', server: origin } }],
        { allow: 'control' },
      );
      if (moved === undefined) throw new StateError('invalid', 'group.moved was not written');
      let acked = false;
      for (let attempt = 0; attempt < 2 && !acked; attempt += 1) {
        await this.engine.syncGroup(localId, { trigger: 'pull_to_refresh' });
        acked = await allAcked(this.store, localId, [moved.id], moved.event.ts);
      }
      if (!acked) return { localId, outcome: 'failed', error: 'not_acknowledged', fromServer };
    }
    const result = await this.engine.moveServer(localId, origin);
    if (result.outcome === 'moved') await this.recordServer(localId, result.serverUrl);
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
    return { ...result, fromServer };
  }

  /** "Follow to <host>": another member moved the group; the same switch, without writing `group.moved`. */
  async followMove(localId: string): Promise<MoveResult> {
    const derived = await this.requireDerived(localId);
    if (derived.moveOffer === null) throw new StateError('not_found', 'no move to follow');
    const result = await this.engine.moveServer(localId, derived.moveOffer);
    if (result.outcome === 'moved') await this.recordServer(localId, result.serverUrl);
    this.groupState.invalidate(localId);
    this.groupState.groupsChanged();
    return { ...result, fromServer: derived.row.serverUrl };
  }

  /** "Delete the copy on <old host>" after a move (never the current server; the engine refuses that). */
  deleteServerCopy(localId: string, serverUrl: string): Promise<DeleteServerCopyResult> {
    return this.engine.deleteServerCopy(localId, serverUrl);
  }

  /** A server's `/v1/info` from the cache (fetched on first use); null when it cannot be read. */
  async serverInfo(serverUrl: string): Promise<ServerInfo | null> {
    let origin: string;
    try {
      origin = canonicalOrigin(serverUrl);
    } catch {
      return null;
    }
    try {
      return await this.infoCache.get(origin, this.transportFor(origin));
    } catch {
      return this.infoCache.peek(origin) ?? null;
    }
  }

  /**
   * "Report this group": the group's id on the server it syncs through now, derived from the secret and that server's
   * origin exactly as sync derives it (so it is the id the server stores and an operator's blocklist takes), and
   * that server. A group moved elsewhere reports its id there; the old server's id is a different hash.
   */
  async reportInfo(localId: string): Promise<ReportInfo> {
    const row = await this.store.getGroup(localId);
    if (row === null) throw new StateError('not_found', 'no such group');
    const secret = await this.secretOf(localId);
    return { groupId: deriveServer(secret, row.serverUrl).groupId, server: row.serverUrl };
  }

  /** The usage meter: this group's envelopes against the server's caps; null when the server's info is unknown. */
  async usage(localId: string): Promise<UsageReport | null> {
    const row = await this.store.getGroup(localId);
    if (row === null) throw new StateError('not_found', 'no such group');
    let info: ServerInfo | undefined;
    try {
      info = await this.infoCache.get(row.serverUrl, this.transportFor(row.serverUrl));
    } catch {
      info = this.infoCache.peek(row.serverUrl);
    }
    if (info === undefined) return null;
    return { info, usage: await groupUsage(this.store, localId, info) };
  }

  // ===== Files =====

  /** Group settings → group file export (the share sheet warns that it is as sensitive as the invite). */
  async exportGroupFile(localId: string, options: { dialogTitle?: string } = {}): Promise<void> {
    const files = this.requireFiles();
    try {
      await writeGroupFile({ store: this.store, secrets: this.secrets, files }, localId, options);
    } catch (error) {
      if (error instanceof GroupFileError) throw new StateError(error.code, error.message);
      throw error;
    }
  }

  /** Lets the user pick a group file; its text, or null if they cancel. Pass it to `importGroupFile`. */
  async pickGroupFile(): Promise<string | null> {
    return (await this.requireFiles().pick())?.text ?? null;
  }

  /**
   * Imports a group file (Groups screen, or App settings). `refused` means the group is closed or hidden here: ask
   * whether to revive it, then call again with `force`.
   */
  async importGroupFile(text: string, options: { force?: boolean } = {}): Promise<ImportResult> {
    const result = await readGroupFile(
      { store: this.store, secrets: this.secrets, now: this.now },
      text,
      options,
    );
    if (result.outcome === 'imported') {
      this.groupState.invalidate(result.localId);
      this.groupState.groupsChanged();
      await this.processLifecycle(result.localId);
      this.engine.requestSync(result.localId);
    }
    return result;
  }

  /** Group settings → export CSV. */
  async exportCsv(localId: string): Promise<void> {
    const files = this.requireFiles();
    const derived = await this.requireDerived(localId);
    await exportGroupCsv(files, this.stateOf(derived), derived.name);
  }

  // ===== Internals =====

  /**
   * Records a group's server in the keychain index after its row changed server. The row is the truth, so a failed
   * keychain write is logged, not thrown; `reconcile` repairs the entry on the next launch.
   */
  private async recordServer(localId: string, serverUrl: string): Promise<void> {
    try {
      await this.secrets.setServerUrl(localId, serverUrl);
    } catch (error) {
      this.log('state: keychain index update failed', describeForLog(error));
    }
  }

  private requireFiles(): FileIO {
    if (this.files === null) throw new StateError('not_found', 'file sharing is not available');
    return this.files;
  }

  private canonical(url: string): string {
    try {
      return canonicalOrigin(url);
    } catch {
      throw new StateError('invalid_url', 'that is not an https server URL');
    }
  }

  private async requireDerived(localId: string): Promise<DerivedGroup> {
    const derived = await this.groupState.get(localId);
    if (derived === null) throw new StateError('not_found', 'no such group');
    return derived;
  }

  private stateOf(derived: DerivedGroup): GroupState {
    if (derived.state === null)
      throw new StateError('no_secret', 'this phone has no key for the group');
    return derived.state;
  }

  private async secretOf(localId: string): Promise<Uint8Array> {
    const secret = await this.secrets.getSecret(localId);
    if (secret === null || deriveLocal(secret).localId !== localId) {
      throw new StateError('no_secret', 'this phone has no key for the group');
    }
    return secret;
  }

  private async seedPrefs(name: string, emoji: string | undefined): Promise<void> {
    if (this.prefs === null) return;
    try {
      await this.prefs.seedMe(name, emoji);
    } catch (error) {
      this.log('state: could not remember the default name', describeForLog(error));
    }
  }

  private async refreshNameCache(derived: DerivedGroup): Promise<void> {
    const { state, row } = derived;
    if (state === null || !state.created) return;
    if (row.nameCache === state.name && row.currencyCache === state.currency) return;
    await this.store.setNameCache(row.localId, { name: state.name, currency: state.currency });
    this.groupState.invalidate(row.localId);
    this.groupState.groupsChanged();
  }

  /** One task at a time per key; a failure does not block the next one. */
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }

  /**
   * Events for `drafts`, in order, each with `ts = writeTs(now, log so far, event, own)`, validated by `parseEvent`.
   * Refused ("check your phone's date") while the clock is outside the validator's range or `own`, this phone's last
   * push, shows it more than a day ahead of the server. A write that holds in either order (a delete, a member's
   * archive, done mark or claim) is not refused for a target a far-future event with no R pins at the top of the
   * range: it takes the group clock's `ts` (design.md "Ordering").
   */
  private buildEvents(
    now: number,
    log: readonly LogEntry[],
    drafts: readonly Draft[],
    by: string | null,
    own: OwnReceipt | null,
  ): LogEntry[] {
    const working: LogEntry[] = [...log];
    const out: LogEntry[] = [];
    for (const draft of drafts) {
      const author = draft.by ?? by;
      if (author === null)
        throw new StateError('not_claimed', 'pick your name in this group first');
      const provisional = {
        sv: 1,
        ts: now,
        at: now,
        by: author,
        dev: this.deviceId,
        ...draft.payload,
      } as Event;
      const ts = writeTs(now, working, provisional, own);
      if (ts === null) throw new StateError('clock', "check your phone's date");
      const event = parseEvent({ ...provisional, ts });
      if (event === null) {
        throw new StateError(
          'invalid',
          `this ${draft.payload.type} would not be valid on other phones`,
        );
      }
      const entry: LogEntry = { id: newId(), event };
      working.push(entry);
      out.push(entry);
    }
    return out;
  }

  private sealRows(entries: readonly LogEntry[], key: Uint8Array, groupId: string): NewEventRow[] {
    return entries.map(({ id, event }) => {
      let envelope;
      try {
        envelope = seal({ key, groupId, body: event, id });
      } catch (error) {
        throw fromSealError(error);
      }
      return {
        id,
        origin: 'local',
        acked: false,
        seq: null,
        ts: event.ts,
        envelope: JSON.stringify(envelope),
        status: 'ok',
      };
    });
  }

  private checkWritable(derived: DerivedGroup, allow: Allow): void {
    switch (derived.readOnly) {
      case null:
        return;
      case 'no_secret':
        throw new StateError('no_secret', 'this phone has no key for the group');
      case 'hidden':
      case 'closed':
        throw new StateError(
          'read_only',
          'this group was rotated; ask a member for the new invite',
        );
      case 'archived':
        if (allow === 'normal') throw new StateError('read_only', 'this group is archived');
        return;
    }
  }

  /**
   * The write path (see the header). `build` sees the current derived state and returns the events to write (none:
   * nothing changes, though `afterInsert` still runs). Returns the written entries.
   */
  private append(
    localId: string,
    build: (context: WriteContext) => Draft[],
    options: { allow?: Allow; afterInsert?: (tx: Store) => Promise<void> } = {},
  ): Promise<LogEntry[]> {
    return this.withLock(localId, async () => {
      const derived = await this.requireDerived(localId);
      const state = this.stateOf(derived);
      const allow = options.allow ?? 'normal';
      this.checkWritable(derived, allow);
      // Every event but a join's own (a claim, a self-add) is signed by this device's member.
      if (allow !== 'join' && derived.row.myMemberId === null) {
        throw new StateError('not_claimed', 'pick your name in this group first');
      }
      const context: WriteContext = {
        derived,
        state,
        row: derived.row,
        me: derived.row.myMemberId,
        currency: derived.currency,
      };
      const drafts = build(context);
      const afterInsert = options.afterInsert;
      if (drafts.length === 0) {
        if (afterInsert !== undefined) {
          await this.store.transaction((tx) => afterInsert(tx));
          this.groupState.invalidate(localId);
        }
        return [];
      }
      const log = await this.groupState.entries(localId);
      const own = await this.store.latestOwnReceipt();
      const entries = this.buildEvents(this.now(), log, drafts, context.me, own);
      const secret = await this.secretOf(localId);
      const key = deriveLocal(secret).encryptionKey;
      await this.store.transaction(async (tx) => {
        const row = await tx.getGroup(localId);
        if (row === null) throw new StateError('not_found', 'no such group');
        // Sealed for the server read in this transaction, so a move committing meanwhile cannot strand it.
        const { groupId } = deriveServer(secret, row.serverUrl);
        await tx.insertEvents(localId, this.sealRows(entries, key, groupId));
        if (afterInsert !== undefined) await afterInsert(tx);
      });
      this.groupState.invalidate(localId);
      this.engine.requestSync(localId);
      return entries;
    });
  }
}

/** The keys a rescue opens the old group's envelopes with and seals them for the new group with. */
interface RescueKeys {
  oldKey: Uint8Array;
  newKey: Uint8Array;
  oldGroupId: string;
  newGroupId: string;
}

type StoredRow = Awaited<ReturnType<Store['listEnvelopes']>>[number];
type ParsedEnvelope = NonNullable<ReturnType<typeof parseEnvelopeText>>;
