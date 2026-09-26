/**
 * base64url without padding (RFC 4648 §5) and UTF-8 helpers. Pure; no Buffer, no Node APIs.
 *
 * Decoding is strict about the alphabet (no `=`, `+`, `/`, whitespace, or anything else) and rejects impossible
 * lengths (length % 4 === 1). It does not reject non-zero trailing pad bits (RFC 4648 §3.5 leaves that to the
 * decoder): the protocol's structural rules are "exact length + charset", so this module accepts exactly what a
 * conforming server accepts. Encoding always produces the canonical form.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** charCode → 6-bit value, or -1 for characters outside the base64url alphabet. */
const LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function sextet(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return code < 128 ? (LOOKUP[code] ?? -1) : -1;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]! + ALPHABET[(n >>> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = len - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]!;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += ALPHABET[(n >>> 18) & 63]! + ALPHABET[(n >>> 12) & 63]! + ALPHABET[(n >>> 6) & 63]!;
  }
  return out;
}

export function b64urlDecode(text: string): Uint8Array {
  if (typeof text !== 'string') throw new TypeError('base64url input must be a string');
  const len = text.length;
  if (len % 4 === 1) throw new RangeError(`invalid base64url length ${len}`);
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const a = sextet(text, i), b = sextet(text, i + 1), c = sextet(text, i + 2), d = sextet(text, i + 3);
    if ((a | b | c | d) < 0) throw invalidChar(text, i);
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >>> 16) & 255;
    out[o++] = (n >>> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest >= 2) {
    const a = sextet(text, i), b = sextet(text, i + 1);
    const c = rest === 3 ? sextet(text, i + 2) : 0;
    if ((a | b | c) < 0) throw invalidChar(text, i);
    const n = (a << 18) | (b << 12) | (c << 6);
    out[o++] = (n >>> 16) & 255;
    if (rest === 3) out[o++] = (n >>> 8) & 255;
  }
  return out;
}

function invalidChar(text: string, from: number): Error {
  let at = from;
  while (at < text.length && sextet(text, at) >= 0) at++;
  return new RangeError(`invalid base64url character at index ${at}`);
}

/** True if `text` is base64url without padding and, when given, of exactly `length` characters. */
export function isB64url(text: string, length?: number): boolean {
  if (typeof text !== 'string') return false;
  if (length !== undefined && text.length !== length) return false;
  if (text.length % 4 === 1) return false; // no byte string encodes to this length
  for (let i = 0; i < text.length; i++) if (sextet(text, i) < 0) return false;
  return true;
}

let encoder: TextEncoder | undefined;
let decoder: TextDecoder | undefined;

export function utf8Encode(text: string): Uint8Array {
  encoder ??= new TextEncoder();
  return encoder.encode(text);
}

/** Strict: throws a TypeError on malformed UTF-8 instead of substituting U+FFFD. A leading BOM is preserved. */
export function utf8Decode(bytes: Uint8Array): string {
  decoder ??= new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return decoder.decode(bytes);
}
