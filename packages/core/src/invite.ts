import { sha256 } from '@noble/hashes/sha2.js';
import { LIMITS, PROTOCOL } from './constants.js';
import { b64urlDecode, b64urlEncode, isB64url, utf8Decode, utf8Encode } from './encoding.js';
import { canonicalOrigin, InvalidServerUrlError } from './keys.js';
import { hasBidiControl, isGroupName } from './schema.js';
import type { Invite } from './types.js';

export type InviteErrorCode = 'malformed' | 'version' | 'checksum' | 'server' | 'secret';
export class InviteError extends Error { constructor(public readonly code: InviteErrorCode, message?: string) { super(message ?? code); } }

/** Longest group name an invite carries, in code points: the same bound as group.created / group.renamed. */
const GROUP_NAME_MAX = LIMITS.groupNameMax;
const CURRENCY = /^[A-Z]{3}$/;
/** 32 bytes → 43 base64url characters. */
const SECRET_CHARS = Math.ceil((LIMITS.secretLength * 4) / 3);

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function checkExtras(g: unknown, cur: unknown, gPresent: boolean, curPresent: boolean): void {
  if (gPresent && (typeof g !== 'string' || [...g].length > GROUP_NAME_MAX)) {
    throw new InviteError('malformed', `group name must be a string of at most ${GROUP_NAME_MAX} characters`);
  }
  if (curPresent && (typeof cur !== 'string' || !CURRENCY.test(cur))) {
    throw new InviteError('malformed', 'currency must be three uppercase ASCII letters');
  }
}

function serverOrThrow(server: string): string {
  try {
    return canonicalOrigin(server);
  } catch (e) {
    throw new InviteError('server', e instanceof InvalidServerUrlError ? e.message : 'invalid server URL');
  }
}

/** First 4 bytes of SHA-256(secret bytes), base64url (6 chars). */
export function inviteChecksum(secret: Uint8Array): string {
  return b64urlEncode(sha256(secret).subarray(0, LIMITS.inviteChecksumBytes));
}

/**
 * Builds a complete invite; `server` is canonicalised. `g`, when given, must satisfy the group-name rule of
 * group.created / group.renamed (`isGroupName`: 1..groupNameMax code points, trimmed, no bidirectional-control
 * character), since it is the group's name. decodeInvite is deliberately looser (any string up to groupNameMax, and
 * one holding a bidirectional-control character is dropped rather than refused): `g` is display-only and must never
 * make a valid secret unusable.
 */
export function makeInvite(secret: Uint8Array, server: string, extras?: { g?: string; cur?: string }): Invite {
  if (!(secret instanceof Uint8Array) || secret.length !== LIMITS.secretLength) {
    throw new InviteError('secret', `secret must be ${LIMITS.secretLength} bytes`);
  }
  const s = serverOrThrow(server);
  const g = extras?.g;
  const cur = extras?.cur;
  checkExtras(g, cur, g !== undefined, cur !== undefined);
  if (g !== undefined && !isGroupName(g)) {
    throw new InviteError('malformed', `group name must be 1 to ${GROUP_NAME_MAX} characters without surrounding spaces`);
  }
  const invite: Invite = { v: 1, s, k: b64urlEncode(secret), h: inviteChecksum(secret) };
  if (g !== undefined) invite.g = g;
  if (cur !== undefined) invite.cur = cur;
  return invite;
}

/** base64url(JSON(invite)) — the "code". Keys are written in the order v, s, k, h, g, cur; absent optionals are omitted. */
export function encodeInvite(invite: Invite): string {
  const ordered: Record<string, unknown> = { v: invite.v, s: invite.s, k: invite.k, h: invite.h };
  if (invite.g !== undefined) ordered['g'] = invite.g;
  if (invite.cur !== undefined) ordered['cur'] = invite.cur;
  return b64urlEncode(utf8Encode(JSON.stringify(ordered)));
}

/**
 * Accepts a bare code or a full link (fragment after '#'); verifies version, checksum, secret length, and server; returns the invite with `s` canonical.
 *
 * Check order: decoding/JSON/object shape and field types → `malformed`; `v` ≠ 1 → `version` (checked before the
 * other fields, since another version may have another shape); `k` → `secret`; `h` → `checksum`; `s` → `server`.
 * Unknown extra fields are ignored and dropped, so an additive v1 field does not lock out older clients. A `g` holding
 * a bidirectional-control character (`hasBidiControl`) is dropped too, as if absent.
 * The returned `k` is re-encoded canonically from the decoded secret.
 */
export function decodeInvite(text: string): Invite {
  if (typeof text !== 'string') throw new InviteError('malformed', 'invite is not text');
  const hash = text.lastIndexOf('#');
  const code = (hash === -1 ? text : text.slice(hash + 1)).trim();
  if (code === '' || !isB64url(code)) throw new InviteError('malformed', 'invite code is not valid base64url');

  let payload: unknown;
  try {
    payload = JSON.parse(utf8Decode(b64urlDecode(code)));
  } catch {
    throw new InviteError('malformed', 'invite code does not contain a JSON payload');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InviteError('malformed', 'invite payload is not a JSON object');
  }
  const fields = payload as Record<string, unknown>;

  const v = fields['v'];
  if (typeof v !== 'number') throw new InviteError('malformed', 'invite version is missing');
  if (v !== 1) throw new InviteError('version', `invite version ${v} is not supported; update the app`);

  const { s, k, h } = fields;
  if (typeof s !== 'string' || typeof k !== 'string' || typeof h !== 'string') {
    throw new InviteError('malformed', 'invite is missing its server, secret, or checksum');
  }
  const g = fields['g'];
  const cur = fields['cur'];
  const gPresent = hasOwn(fields, 'g');
  const curPresent = hasOwn(fields, 'cur');
  checkExtras(g, cur, gPresent, curPresent);

  if (!isB64url(k, SECRET_CHARS)) throw new InviteError('secret', `secret must be ${SECRET_CHARS} base64url characters`);
  const secret = b64urlDecode(k);
  if (secret.length !== LIMITS.secretLength) throw new InviteError('secret', `secret must be ${LIMITS.secretLength} bytes`);
  if (h !== inviteChecksum(secret)) throw new InviteError('checksum', 'invite checksum does not match its secret');

  const invite: Invite = { v: 1, s: serverOrThrow(s), k: b64urlEncode(secret), h };
  // A `g` with a bidirectional-control character is dropped, never the invite: it is display-only.
  if (gPresent && !hasBidiControl(g as string)) invite.g = g as string;
  if (curPresent) invite.cur = cur as string;
  return invite;
}

/** `https://even.appalaya.com/i#<code>` */
export function inviteLink(code: string, host: string = PROTOCOL.inviteHost): string {
  return `${host}${PROTOCOL.invitePath}#${code}`;
}

export function secretFromInvite(invite: Invite): Uint8Array {
  if (!isB64url(invite.k, SECRET_CHARS)) throw new InviteError('secret', `secret must be ${SECRET_CHARS} base64url characters`);
  const secret = b64urlDecode(invite.k);
  if (secret.length !== LIMITS.secretLength) throw new InviteError('secret', `secret must be ${LIMITS.secretLength} bytes`);
  return secret;
}
