/** base64url without padding (RFC 4648 §5) and UTF-8 helpers. Pure; no Buffer, no Node APIs. */
export function b64urlEncode(bytes: Uint8Array): string { throw new Error('not implemented'); }
export function b64urlDecode(text: string): Uint8Array { throw new Error('not implemented'); }
/** True if `text` is base64url without padding and, when given, of exactly `length` characters. */
export function isB64url(text: string, length?: number): boolean { throw new Error('not implemented'); }
export function utf8Encode(text: string): Uint8Array { throw new Error('not implemented'); }
export function utf8Decode(bytes: Uint8Array): string { throw new Error('not implemented'); }
