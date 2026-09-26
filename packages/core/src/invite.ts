import type { Invite } from './types.js';
export type InviteErrorCode = 'malformed' | 'version' | 'checksum' | 'server' | 'secret';
export class InviteError extends Error { constructor(public readonly code: InviteErrorCode, message?: string) { super(message ?? code); } }
/** First 4 bytes of SHA-256(secret bytes), base64url (6 chars). */
export function inviteChecksum(secret: Uint8Array): string { throw new Error('not implemented'); }
/** Builds a complete invite; `server` is canonicalised. */
export function makeInvite(secret: Uint8Array, server: string, extras?: { g?: string; cur?: string }): Invite { throw new Error('not implemented'); }
/** base64url(JSON(invite)) — the "code". */
export function encodeInvite(invite: Invite): string { throw new Error('not implemented'); }
/** Accepts a bare code or a full link (fragment after '#'); verifies version, checksum, secret length, and server; returns the invite with `s` canonical. */
export function decodeInvite(text: string): Invite { throw new Error('not implemented'); }
/** `https://even.appalaya.com/i#<code>` */
export function inviteLink(code: string, host?: string): string { throw new Error('not implemented'); }
export function secretFromInvite(invite: Invite): Uint8Array { throw new Error('not implemented'); }
