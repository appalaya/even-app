/** Key derivation and server-origin canonicalisation (PROTOCOL.md §2, §8.1). */
export class InvalidServerUrlError extends Error {}
export function newSecret(): Uint8Array { throw new Error('not implemented'); }
/** Server-independent: encryptionKey = HKDF(secret, "even/v1", "enc"); localId = b64url(HKDF(secret, "even/v1", "local")). */
export function deriveLocal(secret: Uint8Array): { encryptionKey: Uint8Array; localId: string } { throw new Error('not implemented'); }
/** Per server: authToken = HKDF(secret, "even/v1", "auth|" + origin); groupId = b64url(SHA-256(authToken)). `origin` must already be canonical. */
export function deriveServer(secret: Uint8Array, origin: string): { authToken: Uint8Array; groupId: string } { throw new Error('not implemented'); }
/**
 * Canonical server URL: https only, lowercase scheme/host, ASCII host only, no userinfo, no :443, other ports kept,
 * optional path without trailing slash, no query/fragment. Throws InvalidServerUrlError. Pure TS parser; does not use URL.
 */
export function canonicalOrigin(url: string): string { throw new Error('not implemented'); }
