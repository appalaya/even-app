import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { EvenCryptoInfo } from './EvenCrypto.types';

/**
 * Synchronous functions over JSI: every buffer is a Uint8Array the caller allocated, read and written in place (no
 * base64, no copies through the bridge). The caller owns all validation of what the bytes mean; these check only the
 * lengths they need to stay inside the buffers. Nothing here keeps, logs or sends any argument.
 */
declare class EvenCryptoModule extends NativeModule {
  info(): EvenCryptoInfo;
  /**
   * XChaCha20-Poly1305 (IETF) under a 32-byte `key` and 24-byte `nonce`: writes ciphertext || 16-byte tag into
   * `out`, which must be exactly `plaintext.length + 16` bytes. False (and `out` untouched or zeroed) on any wrong
   * length.
   */
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
    out: Uint8Array,
  ): boolean;
  /**
   * Verifies and decrypts `sealed` (ciphertext || tag) into `out`, exactly `sealed.length - 16` bytes. False when
   * the tag does not verify or a length is wrong; `out` then holds zeros.
   */
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    sealed: Uint8Array,
    out: Uint8Array,
  ): boolean;
  /**
   * `open` for a batch under one key, in one call. `input` holds, per item, nonce (24 bytes) || aad || sealed;
   * `lengths` holds, per item, the aad's and the sealed part's lengths; `out` receives each plaintext (sealed length
   * minus 16 bytes) in turn, zeros for one that did not open; `opened[i]` is set to 1 or 0. Returns how many opened,
   * or -1 when the layout does not add up exactly (then nothing is written).
   */
  openMany(
    key: Uint8Array,
    input: Uint8Array,
    lengths: Int32Array,
    out: Uint8Array,
    opened: Uint8Array,
  ): number;
}

/** Null where the native module is not in the build (web, Node tests, a binary built before it existed). */
export default requireOptionalNativeModule<EvenCryptoModule>('EvenCrypto');
