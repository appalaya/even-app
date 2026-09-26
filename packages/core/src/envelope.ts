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

/**
 * §4 structure with any integer `v`. Separate from `isEnvelope` so `open` can tell a well-formed envelope of an
 * unknown version (unsupported_envelope) from a broken one (malformed), as the server does (§6.2: 400 before 415).
 */
function isEnvelopeShape(value: unknown): value is Omit<Envelope, 'v'> & { v: number } {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    if (keys.length !== ENVELOPE_KEYS.length || keys.some((k, i) => k !== ENVELOPE_KEYS[i])) return false;
    const { id, v, n, c } = value as Record<string, unknown>;
    if (typeof id !== 'string' || !isId(id)) return false;
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) return false;
    if (typeof n !== 'string' || !isB64url(n, LIMITS.nonceEncodedLength)) return false;
    if (typeof c !== 'string' || c.length > MAX_C_CHARS || !isB64url(c)) return false;
    const bytes = decodedLength(c.length);
    return bytes >= MIN_C_BYTES && bytes <= LIMITS.maxEventBytes;
  } catch {
    return false; // hostile getters / proxies
  }
}

/**
 * Structural check per PROTOCOL.md §4 (exactly the four fields, lengths, charset, decoded c length in [17, 8192]).
 * Also requires `v === 1`, since that is what the `Envelope` type promises; an envelope with another integer `v`
 * is structurally valid on the wire but returns false here, and `open` reports it as `unsupported_envelope`.
 * Never throws.
 */
export function isEnvelope(value: unknown): value is Envelope {
  return isEnvelopeShape(value) && value.v === PROTOCOL.version;
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

/** Encrypts JSON(body) with XChaCha20-Poly1305 under `key` for `groupId`. A fresh random nonce every call. */
export function seal(args: { key: Uint8Array; groupId: string; body: Event; id?: string }): Envelope {
  checkKey(args.key);
  const id = args.id ?? newId();
  if (!isId(id)) throw new EnvelopeError('malformed', 'envelope id must be 22 base64url characters');
  const json = JSON.stringify(args.body);
  if (typeof json !== 'string') throw new EnvelopeError('malformed', 'event body is not JSON-serialisable');
  const padded = pad(utf8Encode(json));
  const v = PROTOCOL.version;
  const nonce = randomBytes(LIMITS.nonceLength);
  const ciphertext = xchacha20poly1305(args.key, nonce, aadFor(args.groupId, v, id)).encrypt(padded);
  return { id, v, n: b64urlEncode(nonce), c: b64urlEncode(ciphertext) };
}

/** Decrypts and JSON-parses; returns the raw parsed value (run parseEvent on it). Throws EnvelopeError. */
export function open(args: { key: Uint8Array; groupId: string; envelope: Envelope }): unknown {
  checkKey(args.key);
  const envelope: unknown = args.envelope;
  if (!isEnvelopeShape(envelope)) throw new EnvelopeError('malformed', 'not a structurally valid envelope');
  if (envelope.v !== PROTOCOL.version) {
    throw new EnvelopeError('unsupported_envelope', `envelope version ${envelope.v} is not supported`);
  }
  let padded: Uint8Array;
  try {
    const cipher = xchacha20poly1305(args.key, b64urlDecode(envelope.n), aadFor(args.groupId, envelope.v, envelope.id));
    padded = cipher.decrypt(b64urlDecode(envelope.c));
  } catch {
    throw new EnvelopeError('undecryptable', 'authentication failed');
  }
  const plain = unpad(padded);
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
