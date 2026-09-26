import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { LIMITS, PROTOCOL } from './constants.js';
import { b64urlDecode, b64urlEncode, isB64url, utf8Decode, utf8Encode } from './encoding.js';
import { isId, newId, randomBytes } from './ids.js';
import type { Envelope, Event } from './types.js';

export type EnvelopeErrorCode = 'malformed' | 'unsupported_envelope' | 'undecryptable' | 'too_large';
export class EnvelopeError extends Error { constructor(public readonly code: EnvelopeErrorCode, message?: string) { super(message ?? code); } }

const ENVELOPE_KEYS = ['c', 'id', 'n', 'v'] as const;
/** Longest base64url text whose decoded length is ≤ maxEventBytes (8192 bytes → 10923 chars). */
const MAX_C_CHARS = Math.ceil((LIMITS.maxEventBytes * 4) / 3);
/** Smallest ciphertext the protocol admits structurally: the 16-byte tag plus one padding byte. */
const MIN_C_BYTES = LIMITS.tagLength + 1;

/** Decoded byte length of valid unpadded base64url text of this many characters. */
function decodedLength(chars: number): number {
  return Math.floor((chars * 3) / 4);
}

export type EnvelopeShape = { ok: true; v: number } | { ok: false };

/**
 * PROTOCOL.md §4 structure with any positive integer `v`: exactly the four fields id, v, n, c; id 22 and n 32
 * base64url characters; c base64url with a decoded length in [17, 8192]. Never throws.
 *
 * This is the check the sync engine runs first on every pulled envelope (design.md "Sync engine"), because §10 requires
 * keeping envelopes of an unknown version: `{ ok: false }` → junk, stored as `undecryptable`; `ok` with `v ≠ 1` →
 * `unsupported_envelope`, kept for a future client; `ok` with `v = 1` → `open`. `isEnvelope` is the strict v1 check.
 */
export function envelopeShape(value: unknown): EnvelopeShape {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false };
    const keys = Object.keys(value).sort();
    if (keys.length !== ENVELOPE_KEYS.length || keys.some((k, i) => k !== ENVELOPE_KEYS[i])) return { ok: false };
    const { id, v, n, c } = value as Record<string, unknown>;
    if (typeof id !== 'string' || !isId(id)) return { ok: false };
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return { ok: false };
    if (typeof n !== 'string' || !isB64url(n, LIMITS.nonceEncodedLength)) return { ok: false };
    if (typeof c !== 'string' || c.length > MAX_C_CHARS || !isB64url(c)) return { ok: false };
    const bytes = decodedLength(c.length);
    return bytes >= MIN_C_BYTES && bytes <= LIMITS.maxEventBytes ? { ok: true, v } : { ok: false };
  } catch {
    return { ok: false }; // hostile getters / proxies
  }
}

/**
 * Strict structural check for a v1 envelope: `envelopeShape` plus `v === 1`, since that is what the `Envelope` type
 * promises. An envelope with another positive integer `v` is structurally valid on the wire but returns false here;
 * use `envelopeShape` to classify it (`unsupported_envelope`), as `open` does. Never throws.
 */
export function isEnvelope(value: unknown): value is Envelope {
  const shape = envelopeShape(value);
  return shape.ok && shape.v === PROTOCOL.version;
}

/** Stored size per §4: decoded length of c + 64. */
export function envelopeStoredSize(envelope: Envelope): number {
  return decodedLength(envelope.c.length) + LIMITS.envelopeOverheadBytes;
}

/** ISO/IEC 7816-4 padding so that len(padded) + 16 is a multiple of 256; throws too_large if len(plain) > maxPlaintextBytes. */
export function pad(plain: Uint8Array): Uint8Array {
  if (plain.length > LIMITS.maxPlaintextBytes) {
    throw new EnvelopeError('too_large', `event body is ${plain.length} bytes; the maximum is ${LIMITS.maxPlaintextBytes}`);
  }
  const block = LIMITS.padBlock;
  const sealed = Math.ceil((plain.length + 1 + LIMITS.tagLength) / block) * block;
  const padded = new Uint8Array(sealed - LIMITS.tagLength); // zero-filled
  padded.set(plain);
  padded[plain.length] = 0x80;
  return padded;
}

/**
 * Strips trailing zeros and the single 0x80 marker. Throws EnvelopeError('undecryptable') if there is no marker.
 * Does not insist on the 256-byte alignment: §3 only obliges clients to produce it.
 */
export function unpad(padded: Uint8Array): Uint8Array {
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0x00) end--;
  if (end < 0 || padded[end] !== 0x80) throw new EnvelopeError('undecryptable', 'invalid padding');
  return padded.slice(0, end);
}

/** aad = UTF-8("even/v1|" + groupId + "|" + v + "|" + id) */
export function aadFor(groupId: string, v: number, id: string): Uint8Array {
  return utf8Encode(`${PROTOCOL.aadPrefix}|${groupId}|${v}|${id}`);
}

function checkKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new RangeError('encryption key must be 32 bytes');
}

/** Pads `plain` and encrypts it with XChaCha20-Poly1305 under `key` for `groupId` and `id`, with a fresh random nonce. */
function sealBytes(key: Uint8Array, groupId: string, id: string, plain: Uint8Array): Envelope {
  const padded = pad(plain);
  const v = PROTOCOL.version;
  const nonce = randomBytes(LIMITS.nonceLength);
  const ciphertext = xchacha20poly1305(key, nonce, aadFor(groupId, v, id)).encrypt(padded);
  return { id, v, n: b64urlEncode(nonce), c: b64urlEncode(ciphertext) };
}

/**
 * Checks the structure, decrypts and unpads: the exact plaintext bytes, not decoded or parsed. Throws EnvelopeError
 * `malformed`, `unsupported_envelope` or `undecryptable` (AEAD or padding), in that order.
 */
function openBytes(key: Uint8Array, groupId: string, envelope: Envelope): Uint8Array {
  const shape = envelopeShape(envelope);
  if (!shape.ok) throw new EnvelopeError('malformed', 'not a structurally valid envelope');
  if (shape.v !== PROTOCOL.version) {
    throw new EnvelopeError('unsupported_envelope', `envelope version ${shape.v} is not supported`);
  }
  let padded: Uint8Array;
  try {
    const cipher = xchacha20poly1305(key, b64urlDecode(envelope.n), aadFor(groupId, shape.v, envelope.id));
    padded = cipher.decrypt(b64urlDecode(envelope.c));
  } catch {
    throw new EnvelopeError('undecryptable', 'authentication failed');
  }
  return unpad(padded);
}

/** Encrypts JSON(body) with XChaCha20-Poly1305 under `key` for `groupId`. A fresh random nonce every call. */
export function seal(args: { key: Uint8Array; groupId: string; body: Event; id?: string }): Envelope {
  checkKey(args.key);
  const id = args.id ?? newId();
  if (!isId(id)) throw new EnvelopeError('malformed', 'envelope id must be 22 base64url characters');
  const json = JSON.stringify(args.body);
  if (typeof json !== 'string') throw new EnvelopeError('malformed', 'event body is not JSON-serialisable');
  return sealBytes(args.key, args.groupId, id, utf8Encode(json));
}

/**
 * Decrypts and JSON-parses; returns the raw parsed value (run parseEvent on it). Throws EnvelopeError:
 * `malformed` (envelopeShape fails, checked first, as the server checks 400 before 415), `unsupported_envelope`
 * (well-formed, v ≠ 1), `undecryptable` (AEAD, padding, UTF-8 or JSON failure).
 */
export function open(args: { key: Uint8Array; groupId: string; envelope: Envelope }): unknown {
  checkKey(args.key);
  const plain = openBytes(args.key, args.groupId, args.envelope);
  let text: string;
  try {
    text = utf8Decode(plain);
  } catch {
    throw new EnvelopeError('undecryptable', 'body is not valid UTF-8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EnvelopeError('undecryptable', 'body is not valid JSON');
  }
}

/**
 * Re-encrypts an envelope for another key and/or group id (moving to another server, rotating): opens it under
 * (`key`, `groupId`) to its exact plaintext bytes and seals those same bytes under (`newKey`, `newGroupId`) with a fresh
 * nonce, keeping the envelope's `id` and `v`. Byte-exact: the body is never decoded or parsed, so one this client
 * cannot read (a newer `sv` or `type`, integers beyond 2^53, any formatting) crosses bit for bit. Throws RangeError
 * for a key that is not 32 bytes, and EnvelopeError `malformed`, `unsupported_envelope` or `undecryptable` as `open`
 * does, except that it does not check that the body is UTF-8 JSON.
 */
export function resealEnvelope(args: {
  key: Uint8Array;
  groupId: string;
  newKey: Uint8Array;
  newGroupId: string;
  envelope: Envelope;
}): Envelope {
  checkKey(args.key);
  checkKey(args.newKey);
  const plain = openBytes(args.key, args.groupId, args.envelope);
  return sealBytes(args.newKey, args.newGroupId, args.envelope.id, plain);
}
