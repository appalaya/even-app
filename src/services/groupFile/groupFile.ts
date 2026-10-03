/**
 * The group file (design.md "Group file"): not a transport, two functions.
 *
 * - `exportGroupFile` writes `{ format: "even-group", v: 1, invite, envelopes, received }` and hands it to the share
 *   sheet. `invite` is the invite code (base64url, checksummed), so the file carries the secret next to the
 *   ciphertext: it is exactly as sensitive as the invite. It is called a group file, never "encrypted export".
 *   `received` (optional) maps envelope ids to the R the exporter's server reported for them; it sits beside the
 *   envelopes, never inside one, since an older importer's `envelopeShape` refuses an envelope with any other key.
 * - `importGroupFile` works for groups this phone does not have yet: verifies the invite checksum, stores the secret
 *   if new, insert-or-ignores every envelope with `origin = 'remote'` (re-encrypting readable ones for the current
 *   server's group id when the file's server differs, dropping the unreadable), with the file's `received` value as a
 *   provisional R (design.md "Group file"), and sets `acked = 0` on all of the group's events so the server copy is
 *   fully restored on the next sync, whose push responses then report this server's own R for every row. A group that
 *   is locally `closed` or `hidden` (rotated away) is refused unless the caller passes `force` after the user confirms
 *   reviving it.
 *
 * Every re-encryption is core's byte-exact `resealEnvelope`, so a body this client cannot read crosses bit for bit.
 * No decrypted content is written anywhere; the only plaintext derived is the name/currency cache.
 */
import {
  decodeInvite,
  deriveLocal,
  deriveServer,
  encodeInvite,
  envelopeShape,
  isCurrency,
  isGroupName,
  isReceivedAt,
  LIMITS,
  makeInvite,
  open,
  parseEvent,
  PROTOCOL,
  reduce,
  resealEnvelope,
  secretFromInvite,
  type Envelope,
  type InviteErrorCode,
  type LogEntry,
} from '@even/core';

import type { Secrets } from '../secrets/types';
import type { EventStatus, GroupLifecycle, NewEventRow, Store } from '../storage/types';
import { isUnsupportedBody } from '../sync/engine';
import type { FileIO } from './fileIO';

export const GROUP_FILE_FORMAT = 'even-group';
export const GROUP_FILE_VERSION = 1;
export const GROUP_FILE_EXTENSION = 'even';
/** Opaque on purpose: iOS would otherwise append a `.json` extension to the `.even` file. */
export const GROUP_FILE_MIME = 'application/octet-stream';
export const GROUP_FILE_UTI = 'public.data';

/** An envelope as carried in the file: any positive `v` (one this client cannot open is still passed on). */
export interface FileEnvelope {
  id: string;
  v: number;
  n: string;
  c: string;
}

export interface GroupFileV1 {
  format: typeof GROUP_FILE_FORMAT;
  v: typeof GROUP_FILE_VERSION;
  /** The invite code (what "Copy code" gives): server, secret, checksum, name, currency. */
  invite: string;
  envelopes: FileEnvelope[];
  /**
   * Optional: the R (Unix ms) the exporter's server reported for an envelope, by envelope id, for those it had one
   * for. An importer takes it as a provisional R until its own server reports one. Never inside an envelope.
   */
  received?: Record<string, number>;
}

export class GroupFileError extends Error {
  constructor(
    readonly code: 'not_found' | 'no_secret',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GroupFileError';
  }
}

/** Characters no file system is happy with, plus control characters. */
const UNSAFE_FILE_CHARS = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;

/** A share-sheet-safe file name for a group, without the extension. */
export function fileBaseName(groupName: string, fallback = 'Even group'): string {
  const cleaned = groupName.replace(UNSAFE_FILE_CHARS, '-').replace(/\s+/g, ' ').trim();
  const clipped = [...cleaned].slice(0, 60).join('').trim();
  return clipped === '' || clipped === '.' || clipped === '..' ? fallback : clipped;
}

interface ExportDeps {
  store: Pick<Store, 'getGroup' | 'listEnvelopes'>;
  secrets: Pick<Secrets, 'getSecret'>;
}

/** Builds the group file's JSON text. Throws `GroupFileError` for a missing group or secret. */
export async function buildGroupFile(
  deps: ExportDeps,
  localId: string,
): Promise<{ fileName: string; contents: string; file: GroupFileV1 }> {
  const row = await deps.store.getGroup(localId);
  if (row === null) throw new GroupFileError('not_found');
  const secret = await deps.secrets.getSecret(localId);
  if (secret === null || deriveLocal(secret).localId !== localId) {
    throw new GroupFileError('no_secret');
  }
  const extras: { g?: string; cur?: string } = {};
  if (row.nameCache !== null && isGroupName(row.nameCache)) extras.g = row.nameCache;
  if (row.currencyCache !== null && isCurrency(row.currencyCache)) extras.cur = row.currencyCache;
  const invite = encodeInvite(makeInvite(secret, row.serverUrl, extras));

  const envelopes: FileEnvelope[] = [];
  const received: Record<string, number> = {};
  let anyReceived = false;
  for (const stored of await deps.store.listEnvelopes(localId)) {
    // Undecryptable rows cannot be read by anyone holding this secret; junk is not an envelope at all.
    if (stored.status === 'undecryptable') continue;
    let value: unknown;
    try {
      value = JSON.parse(stored.envelope);
    } catch {
      continue;
    }
    if (!envelopeShape(value).ok) continue;
    const { id, v, n, c } = value as FileEnvelope;
    envelopes.push({ id, v, n, c });
    if (stored.receivedAt !== null) {
      // A data property even for an id like `__proto__`: plain assignment would set the prototype instead.
      Object.defineProperty(received, id, {
        value: stored.receivedAt,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      anyReceived = true;
    }
  }
  const file: GroupFileV1 = {
    format: GROUP_FILE_FORMAT,
    v: GROUP_FILE_VERSION,
    invite,
    envelopes,
    ...(anyReceived ? { received } : {}),
  };
  return {
    fileName: `${fileBaseName(row.nameCache ?? '')}.${GROUP_FILE_EXTENSION}`,
    contents: JSON.stringify(file),
    file,
  };
}

/** Writes the group file and opens the share sheet. */
export async function exportGroupFile(
  deps: ExportDeps & { files: FileIO },
  localId: string,
  options: { dialogTitle?: string } = {},
): Promise<void> {
  const { fileName, contents } = await buildGroupFile(deps, localId);
  await deps.files.share({
    name: fileName,
    contents,
    mimeType: GROUP_FILE_MIME,
    uti: GROUP_FILE_UTI,
    ...(options.dialogTitle === undefined ? {} : { dialogTitle: options.dialogTitle }),
  });
}

// ---------- Import ----------

export type ImportProblem =
  /** Not an Even group file (not JSON, wrong `format`, missing fields). */
  | 'format'
  /** A newer group file or invite version. */
  | 'version'
  /** The invite inside fails its checksum. */
  | 'checksum'
  /** The invite inside is malformed. */
  | 'malformed'
  /** The invite's server URL is invalid. */
  | 'server';

export type ImportResult =
  | {
      outcome: 'imported';
      localId: string;
      /** The group was new on this phone. */
      created: boolean;
      /** A locally closed or hidden group was revived (`force`). */
      revived: boolean;
      /** Rows that were not on this phone before. */
      inserted: number;
      /** Envelopes skipped: not envelopes, unreadable, or of an unknown version when re-encryption was needed. */
      dropped: number;
      /** The file's server differs from the group's current one, so readable envelopes were re-encrypted. */
      reencrypted: boolean;
      /** The group's state after the import. */
      state: GroupLifecycle;
    }
  | { outcome: 'refused'; localId: string; state: GroupLifecycle }
  | { outcome: 'invalid'; problem: ImportProblem };

export interface ImportDeps {
  store: Store;
  secrets: Pick<Secrets, 'getSecret' | 'setSecret'>;
  now: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses and checks the file's outer shape. */
export function parseGroupFile(
  text: string,
): { ok: true; file: GroupFileV1 } | { ok: false; problem: ImportProblem } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'format' };
  }
  if (!isRecord(value) || value.format !== GROUP_FILE_FORMAT)
    return { ok: false, problem: 'format' };
  if (value.v !== GROUP_FILE_VERSION) {
    return {
      ok: false,
      problem: typeof value.v === 'number' && value.v > GROUP_FILE_VERSION ? 'version' : 'format',
    };
  }
  if (typeof value.invite !== 'string' || !Array.isArray(value.envelopes)) {
    return { ok: false, problem: 'format' };
  }
  const file: GroupFileV1 = {
    format: GROUP_FILE_FORMAT,
    v: GROUP_FILE_VERSION,
    invite: value.invite,
    envelopes: value.envelopes as FileEnvelope[],
  };
  // Optional and additive: anything but an object there is read as no map at all, never as a bad file.
  if (isRecord(value.received)) file.received = value.received as Record<string, number>;
  return { ok: true, file };
}

/**
 * The file's `received` map as provisional R values, by envelope id: only usable ones (core `isReceivedAt`), and none
 * later than a day past this phone's clock, since no server can have stored an envelope in the future. A hostile file
 * could otherwise claim a late R for its own far writes and release them until the next sync replaces it.
 */
export function provisionalReceived(
  received: Record<string, unknown> | undefined,
  nowMs: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (received === undefined) return out;
  for (const [id, value] of Object.entries(received)) {
    if (isReceivedAt(value) && value <= nowMs + LIMITS.clockAbsorbWindowMs) out.set(id, value);
  }
  return out;
}

function problemOf(code: InviteErrorCode): ImportProblem {
  switch (code) {
    case 'checksum':
      return 'checksum';
    case 'server':
      return 'server';
    case 'version':
      return 'version';
    default:
      return 'malformed';
  }
}

/** `ts` of a body that opened but did not validate, when it is a plausible timestamp. */
function plausibleTs(body: unknown): number | null {
  if (!isRecord(body)) return null;
  const { ts } = body;
  return typeof ts === 'number' &&
    Number.isSafeInteger(ts) &&
    ts >= LIMITS.tsMin &&
    ts < LIMITS.tsMax
    ? ts
    : null;
}

/** True if the group's stored log holds a `group.closed` that does not name the group itself. */
async function hasClosure(
  store: Pick<Store, 'listReadable'>,
  key: Uint8Array,
  groupId: string,
  localId: string,
): Promise<boolean> {
  for (const { envelope } of await store.listReadable(localId)) {
    let body: unknown;
    try {
      body = open({ key, groupId, envelope });
    } catch {
      continue;
    }
    const event = parseEvent(body);
    if (event?.type === 'group.closed' && event.to !== localId) return true;
  }
  return false;
}

/** Imports a group file's text. Never partially applies: the rows and the ack reset are one transaction. */
export async function importGroupFile(
  deps: ImportDeps,
  text: string,
  options: { force?: boolean } = {},
): Promise<ImportResult> {
  const parsed = parseGroupFile(text);
  if (!parsed.ok) return { outcome: 'invalid', problem: parsed.problem };
  let secret: Uint8Array;
  let fileServer: string;
  let invite: ReturnType<typeof decodeInvite>;
  try {
    invite = decodeInvite(parsed.file.invite);
    secret = secretFromInvite(invite);
    fileServer = invite.s;
  } catch (error) {
    const code = (error as { code?: InviteErrorCode }).code;
    return { outcome: 'invalid', problem: code === undefined ? 'malformed' : problemOf(code) };
  }
  const { localId, encryptionKey: key } = deriveLocal(secret);

  const existing = await deps.store.getGroup(localId);
  const locallyGone =
    existing !== null && (existing.state === 'closed' || existing.state === 'hidden');
  if (locallyGone && options.force !== true) {
    return { outcome: 'refused', localId, state: existing.state };
  }
  const targetServer = existing?.serverUrl ?? fileServer;
  const reencrypt = targetServer !== fileServer;
  const received = provisionalReceived(parsed.file.received, deps.now());
  const fileGroupId = deriveServer(secret, fileServer).groupId;
  const targetGroupId = deriveServer(secret, targetServer).groupId;

  const rows: NewEventRow[] = [];
  const seen = new Set<string>();
  const naming: LogEntry[] = [];
  let dropped = 0;
  let closedInFile = false;
  for (const raw of parsed.file.envelopes) {
    const shape = envelopeShape(raw);
    if (!shape.ok) {
      dropped += 1;
      continue;
    }
    const { id, v, n, c } = raw;
    if (seen.has(id)) continue;
    if (shape.v !== PROTOCOL.version) {
      // Kept for a future client, but it cannot be opened, so it cannot be re-encrypted for another server.
      if (reencrypt) {
        dropped += 1;
        continue;
      }
      seen.add(id);
      rows.push({
        id,
        origin: 'remote',
        acked: false,
        seq: null,
        ts: null,
        envelope: JSON.stringify({ id, v, n, c }),
        status: 'unsupported_envelope',
        receivedAt: received.get(id) ?? null,
      });
      continue;
    }
    const envelope: Envelope = { id, v: PROTOCOL.version, n, c };
    let body: unknown;
    try {
      body = open({ key, groupId: fileGroupId, envelope });
    } catch {
      dropped += 1; // unreadable under this secret: nobody holding the invite could read it either
      continue;
    }
    const event = parseEvent(body);
    const status: EventStatus =
      event !== null ? 'ok' : isUnsupportedBody(body) ? 'unsupported_body' : 'invalid';
    const stored = reencrypt
      ? resealEnvelope({
          key,
          groupId: fileGroupId,
          newKey: key,
          newGroupId: targetGroupId,
          envelope,
        })
      : envelope;
    seen.add(id);
    const receivedAt = received.get(id);
    rows.push({
      id,
      origin: 'remote',
      acked: false,
      seq: null,
      ts: event?.ts ?? plausibleTs(body),
      envelope: JSON.stringify(stored),
      status,
      receivedAt: receivedAt ?? null,
    });
    if (event?.type === 'group.created' || event?.type === 'group.renamed') {
      naming.push(receivedAt === undefined ? { id, event } : { id, event, receivedAt });
    }
    if (event?.type === 'group.closed' && event.to !== localId) closedInFile = true;
  }

  let name = invite.g ?? null;
  let currency = invite.cur ?? null;
  if (naming.length > 0) {
    const named = reduce(naming);
    if (named.name !== '') name = named.name;
    if (named.created) currency = named.currency;
  }

  // A group the log says was rotated away is a read-only copy: `closed`, never syncing. A revived group without a
  // closure (one hidden after a concurrent rotation) syncs again.
  let finalState: GroupLifecycle;
  if (existing === null) finalState = closedInFile ? 'closed' : 'active';
  else if (locallyGone) {
    finalState =
      closedInFile || (await hasClosure(deps.store, key, targetGroupId, localId))
        ? 'closed'
        : 'active';
  } else finalState = existing.state;

  await deps.secrets.setSecret(localId, secret, targetServer);
  const result = await deps.store.transaction(async (tx) => {
    if (existing === null) {
      await tx.upsertGroup({
        localId,
        serverUrl: fileServer,
        epoch: null,
        cursor: 0,
        myMemberId: null,
        nameCache: name,
        currencyCache: currency,
        createdAt: deps.now(),
        lastSyncedAt: null,
        lastSyncError: null,
        state: finalState,
        epochResetsThisCycle: 0,
      });
    } else if (locallyGone) {
      await tx.setGroupState(localId, finalState);
    }
    const inserted = rows.length === 0 ? [] : (await tx.insertEvents(localId, rows)).inserted;
    // Every row is pushed again, and each push response reports this server's R for it; until then the R this phone
    // already had (same server, same epoch) and the file's provisional ones stay.
    await tx.resetAcked(localId, { keepReceived: true });
    return inserted;
  });

  return {
    outcome: 'imported',
    localId,
    created: existing === null,
    revived: locallyGone,
    inserted: result.length,
    dropped,
    reencrypted: reencrypt,
    state: finalState,
  };
}
