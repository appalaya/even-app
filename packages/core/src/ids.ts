/** Random ids and bytes. Uses globalThis.crypto.getRandomValues; the app polyfills it at entry from expo-crypto. */
import { LIMITS } from './constants.js';
import { b64urlEncode, isB64url } from './encoding.js';

type RandomSource = { getRandomValues?: (array: Uint8Array) => unknown };

/** getRandomValues fills at most 65536 bytes per call (Web Crypto quota). */
const MAX_CHUNK = 65536;

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError(`randomBytes: invalid length ${length}`);
  const source = (globalThis as { crypto?: RandomSource }).crypto;
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error('globalThis.crypto.getRandomValues is unavailable; install the CSPRNG polyfill at app entry');
  }
  const out = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MAX_CHUNK) {
    source.getRandomValues(out.subarray(offset, Math.min(length, offset + MAX_CHUNK)));
  }
  // A polyfill that silently fills nothing would yield all-zero secrets and nonces. For ≥ 16 bytes an all-zero
  // result from a real CSPRNG has probability 2^-128, so treat it as a broken source rather than use it.
  if (length >= 16 && out.every((b) => b === 0)) throw new Error('randomBytes: CSPRNG returned all zeros');
  return out;
}

/** 22-char base64url of 16 random bytes. Not time-ordered, on purpose. */
export function newId(): string {
  return b64urlEncode(randomBytes(16));
}

/** Exactly 22 characters from [A-Za-z0-9_-] (PROTOCOL.md §4). Never throws. */
export function isId(text: string): boolean {
  return isB64url(text, LIMITS.idLength);
}
