/**
 * The AEAD under every envelope (PROTOCOL.md §3): XChaCha20-Poly1305, the IETF construction (HChaCha20 subkey,
 * ChaCha20-Poly1305 per RFC 8439 under it), 32-byte key, 24-byte nonce, 16-byte tag appended to the ciphertext.
 *
 * Pluggable: `envelope.ts` seals and opens through whichever implementation `setAead` installed, and @noble/ciphers
 * (`nobleAead`) is the default, the reference and the fallback. The app installs a native one at startup when the
 * build has it and it passes a self-test against this one (design.md "Crypto"); tests and the web keep @noble. An
 * implementation only ever sees bytes that envelope.ts has already framed: the key, a nonce envelope.ts drew, the AAD
 * it built, the padded plaintext or the decoded ciphertext. Choosing one changes nothing on the wire.
 *
 * Key derivation is not here: it stays in JavaScript (`keys.ts`, @noble/hashes HKDF).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

export const AEAD_KEY_BYTES = 32;
export const AEAD_NONCE_BYTES = 24;
export const AEAD_TAG_BYTES = 16;

/** One envelope's worth of `openMany` input: everything but the key, which a batch shares. */
export interface AeadSealed {
  nonce: Uint8Array;
  aad: Uint8Array;
  /** Ciphertext || 16-byte tag. */
  sealed: Uint8Array;
}

export interface Aead {
  /** What implements it, for the startup log and Diagnostics: `noble`, or a native module's name. Never secret. */
  readonly name: string;
  /**
   * Ciphertext || tag, `plaintext.length + 16` bytes. Throws RangeError for a key that is not 32 bytes or a nonce
   * that is not 24. Never keeps or logs any argument.
   */
  seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array;
  /**
   * The plaintext, or null when the tag does not verify or an argument has the wrong length (a forgery and a
   * malformed input look the same to the caller). Never throws on account of the data.
   */
  open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Uint8Array | null;
  /**
   * `open` for many envelopes under one key, in order: one call where the implementation crosses a boundary per call
   * (a native module), so a derive of thousands of envelopes pays for that boundary once per batch.
   */
  openMany(key: Uint8Array, items: readonly AeadSealed[]): (Uint8Array | null)[];
}

function lengthsOk(key: Uint8Array, nonce: Uint8Array): boolean {
  return key.length === AEAD_KEY_BYTES && nonce.length === AEAD_NONCE_BYTES;
}

/** @noble/ciphers' `xchacha20poly1305`: the reference, and what runs wherever no native implementation is installed. */
export const nobleAead: Aead = {
  name: 'noble',
  seal(key, nonce, aad, plaintext) {
    if (!lengthsOk(key, nonce)) throw new RangeError('XChaCha20-Poly1305 needs a 32-byte key and a 24-byte nonce');
    return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
  },
  open(key, nonce, aad, sealed) {
    if (!lengthsOk(key, nonce) || sealed.length < AEAD_TAG_BYTES) return null;
    try {
      return xchacha20poly1305(key, nonce, aad).decrypt(sealed);
    } catch {
      return null;
    }
  },
  openMany(key, items) {
    return items.map((item) => nobleAead.open(key, item.nonce, item.aad, item.sealed));
  },
};

let current: Aead = nobleAead;

/** The implementation envelope.ts uses now. */
export function aead(): Aead {
  return current;
}

/** Installs `next` for every later seal and open; null goes back to @noble. The app calls it once, at startup. */
export function setAead(next: Aead | null): void {
  current = next ?? nobleAead;
}
