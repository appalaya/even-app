/// <reference types="node" />
/**
 * A second XChaCha20-Poly1305 for Node tests only: OpenSSL's IETF ChaCha20-Poly1305 (node:crypto) under an
 * HChaCha20 subkey, which is the whole XChaCha construction (draft-irtf-cfrg-xchacha-03 §2.3): subkey =
 * HChaCha20(key, nonce[0..16]), then ChaCha20-Poly1305 with that subkey and the 12-byte nonce 0x00000000 ||
 * nonce[16..24]. Independent of @noble, so the envelope tests and the cross-check prove the pluggable path with an
 * implementation that shares no code with the reference. Imports node:crypto: never exported to the app.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { AEAD_KEY_BYTES, AEAD_NONCE_BYTES, AEAD_TAG_BYTES, type Aead } from '../aead.js';

const rotl = (v: number, n: number): number => (v << n) | (v >>> (32 - n));

function readLe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24)) >>> 0;
}

/** HChaCha20 (draft-irtf-cfrg-xchacha-03 §2.2): 20 ChaCha rounds over key and a 16-byte nonce, no feed-forward. */
export function hchacha20(key: Uint8Array, nonce16: Uint8Array): Uint8Array {
  if (key.length !== 32 || nonce16.length !== 16) throw new RangeError('HChaCha20 needs a 32-byte key and a 16-byte nonce');
  const s = new Uint32Array(16);
  s[0] = 0x61707865;
  s[1] = 0x3320646e;
  s[2] = 0x79622d32;
  s[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) s[4 + i] = readLe(key, 4 * i);
  for (let i = 0; i < 4; i++) s[12 + i] = readLe(nonce16, 4 * i);
  const qr = (a: number, b: number, c: number, d: number): void => {
    s[a] = (s[a]! + s[b]!) | 0; s[d] = rotl(s[d]! ^ s[a]!, 16);
    s[c] = (s[c]! + s[d]!) | 0; s[b] = rotl(s[b]! ^ s[c]!, 12);
    s[a] = (s[a]! + s[b]!) | 0; s[d] = rotl(s[d]! ^ s[a]!, 8);
    s[c] = (s[c]! + s[d]!) | 0; s[b] = rotl(s[b]! ^ s[c]!, 7);
  };
  for (let round = 0; round < 10; round++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(32);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((word, i) => {
    const v = s[word]!;
    out[4 * i] = v & 0xff;
    out[4 * i + 1] = (v >>> 8) & 0xff;
    out[4 * i + 2] = (v >>> 16) & 0xff;
    out[4 * i + 3] = (v >>> 24) & 0xff;
  });
  return out;
}

function ietfNonce(nonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(12);
  out.set(nonce.subarray(16, 24), 4);
  return out;
}

export const nodeAead: Aead = {
  name: 'node:crypto',
  seal(key, nonce, aad, plaintext) {
    if (key.length !== AEAD_KEY_BYTES || nonce.length !== AEAD_NONCE_BYTES) throw new RangeError('bad key or nonce length');
    const cipher = createCipheriv('chacha20-poly1305', hchacha20(key, nonce.subarray(0, 16)), ietfNonce(nonce), {
      authTagLength: AEAD_TAG_BYTES,
    });
    cipher.setAAD(aad, { plaintextLength: plaintext.length });
    const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length));
  },
  open(key, nonce, aad, sealed) {
    if (key.length !== AEAD_KEY_BYTES || nonce.length !== AEAD_NONCE_BYTES || sealed.length < AEAD_TAG_BYTES) return null;
    const decipher = createDecipheriv('chacha20-poly1305', hchacha20(key, nonce.subarray(0, 16)), ietfNonce(nonce), {
      authTagLength: AEAD_TAG_BYTES,
    });
    const split = sealed.length - AEAD_TAG_BYTES;
    decipher.setAuthTag(sealed.subarray(split));
    decipher.setAAD(aad, { plaintextLength: split });
    try {
      const body = Buffer.concat([decipher.update(sealed.subarray(0, split)), decipher.final()]);
      return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.length));
    } catch {
      return null;
    }
  },
  openMany(key, items) {
    return items.map((item) => nodeAead.open(key, item.nonce, item.aad, item.sealed));
  },
};
