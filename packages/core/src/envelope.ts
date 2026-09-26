import type { Envelope, Event } from './types.js';
export type EnvelopeErrorCode = 'malformed' | 'unsupported_envelope' | 'undecryptable' | 'too_large';
export class EnvelopeError extends Error { constructor(public readonly code: EnvelopeErrorCode, message?: string) { super(message ?? code); } }
/** Structural check per PROTOCOL.md §4 (exactly the four fields, lengths, charset, decoded c length in [17, 8192]). */
export function isEnvelope(value: unknown): value is Envelope { throw new Error('not implemented'); }
/** Stored size per §4: decoded length of c + 64. */
export function envelopeStoredSize(envelope: Envelope): number { throw new Error('not implemented'); }
/** ISO/IEC 7816-4 padding so that len(padded) + 16 is a multiple of 256; throws too_large if len(plain) > maxPlaintextBytes. */
export function pad(plain: Uint8Array): Uint8Array { throw new Error('not implemented'); }
export function unpad(padded: Uint8Array): Uint8Array { throw new Error('not implemented'); }
/** aad = UTF-8("even/v1|" + groupId + "|" + v + "|" + id) */
export function aadFor(groupId: string, v: number, id: string): Uint8Array { throw new Error('not implemented'); }
/** Encrypts JSON(body) with XChaCha20-Poly1305 under `key` for `groupId`. A fresh random nonce every call. */
export function seal(args: { key: Uint8Array; groupId: string; body: Event; id?: string }): Envelope { throw new Error('not implemented'); }
/** Decrypts and JSON-parses; returns the raw parsed value (run parseEvent on it). Throws EnvelopeError. */
export function open(args: { key: Uint8Array; groupId: string; envelope: Envelope }): unknown { throw new Error('not implemented'); }
