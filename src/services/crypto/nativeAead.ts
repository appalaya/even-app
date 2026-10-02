/**
 * The native XChaCha20-Poly1305 (modules/even-crypto: libsodium on iOS, Tink on Android) as core's `Aead`, installed
 * at startup only when the build has it and it agrees with @noble on a self-test (design.md "Crypto"). The rest of
 * the app keeps calling core's seal and open; this decides only which implementation they run on. On any doubt the
 * app stays on @noble, which is correct everywhere, only slower.
 *
 * Free of React Native and Expo imports (the module itself is passed in), so it is tested in Node with stand-ins.
 */
import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  nobleAead,
  setAead,
  type Aead,
  type AeadSealed,
} from '@even/core';

/** What modules/even-crypto exposes (its `EvenCryptoModule.ts`), as far as this file uses it. */
export interface NativeCrypto {
  info(): { library: string; version: string };
  seal(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    plaintext: Uint8Array,
    out: Uint8Array,
  ): boolean;
  open(
    key: Uint8Array,
    nonce: Uint8Array,
    aad: Uint8Array,
    sealed: Uint8Array,
    out: Uint8Array,
  ): boolean;
  /** One call for a batch: see modules/even-crypto/src/EvenCryptoModule.ts for the layout. -1 for a bad layout. */
  openMany(
    key: Uint8Array,
    input: Uint8Array,
    lengths: Int32Array,
    out: Uint8Array,
    opened: Uint8Array,
  ): number;
}

function lengthsOk(key: Uint8Array, nonce: Uint8Array): boolean {
  return key.length === AEAD_KEY_BYTES && nonce.length === AEAD_NONCE_BYTES;
}

/** The module behind core's interface: JavaScript allocates every output, the module fills it in place. */
export function nativeAeadFrom(native: NativeCrypto): Aead {
  const info = native.info();
  const aead: Aead = {
    name: `${info.library} ${info.version}`,
    seal(key, nonce, aad, plaintext) {
      if (!lengthsOk(key, nonce)) {
        throw new RangeError('XChaCha20-Poly1305 needs a 32-byte key and a 24-byte nonce');
      }
      const out = new Uint8Array(plaintext.length + AEAD_TAG_BYTES);
      if (!native.seal(key, nonce, aad, plaintext, out)) throw new Error('native seal refused');
      return out;
    },
    open(key, nonce, aad, sealed) {
      if (!lengthsOk(key, nonce) || sealed.length < AEAD_TAG_BYTES) return null;
      const out = new Uint8Array(sealed.length - AEAD_TAG_BYTES);
      return native.open(key, nonce, aad, sealed, out) ? out : null;
    },
    openMany(key, items: readonly AeadSealed[]) {
      return openBatch(native, key, items);
    },
  };
  return aead;
}

/**
 * The batch in one native call: every item's nonce, additional data and sealed bytes packed into one array, their
 * lengths into another, and one output array for all the plaintexts, so the boundary is crossed once and the key
 * passed once. An item with a wrong-size nonce or too short to hold a tag is answered null here, as `open` would.
 */
function openBatch(
  native: NativeCrypto,
  key: Uint8Array,
  items: readonly AeadSealed[],
): (Uint8Array | null)[] {
  const results: (Uint8Array | null)[] = items.map(() => null);
  if (key.length !== AEAD_KEY_BYTES) return results;
  const batch: number[] = [];
  let inputBytes = 0;
  let outBytes = 0;
  items.forEach((item, i) => {
    if (item.nonce.length !== AEAD_NONCE_BYTES || item.sealed.length < AEAD_TAG_BYTES) return;
    batch.push(i);
    inputBytes += AEAD_NONCE_BYTES + item.aad.length + item.sealed.length;
    outBytes += item.sealed.length - AEAD_TAG_BYTES;
  });
  if (batch.length === 0) return results;

  const input = new Uint8Array(inputBytes);
  const lengths = new Int32Array(batch.length * 2);
  const out = new Uint8Array(outBytes);
  const opened = new Uint8Array(batch.length);
  let at = 0;
  batch.forEach((i, k) => {
    const item = items[i]!;
    input.set(item.nonce, at);
    at += AEAD_NONCE_BYTES;
    input.set(item.aad, at);
    at += item.aad.length;
    input.set(item.sealed, at);
    at += item.sealed.length;
    lengths[2 * k] = item.aad.length;
    lengths[2 * k + 1] = item.sealed.length;
  });

  const count = native.openMany(key, input, lengths, out, opened);
  let flagged = 0;
  for (const flag of opened) if (flag === 1) flagged += 1;
  // core's openMany opens one by one when this throws.
  if (count < 0 || count !== flagged) throw new Error('native openMany refused the batch');

  let outAt = 0;
  batch.forEach((i, k) => {
    const length = items[i]!.sealed.length - AEAD_TAG_BYTES;
    if (opened[k] === 1) results[i] = out.subarray(outAt, outAt + length);
    outAt += length;
  });
  return results;
}

// ---------- The self-test ----------

/** draft-irtf-cfrg-xchacha-03 §A.3.1, the vector @noble and libsodium are both tested with. */
export const SELF_TEST_VECTOR = {
  key: '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f',
  nonce: '404142434445464748494a4b4c4d4e4f5051525354555657',
  aad: '50515253c0c1c2c3c4c5c6c7',
  msg:
    '4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c' +
    '64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20' +
    '776f756c642062652069742e',
  sealed:
    'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6' +
    '708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c9763' +
    '7da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49',
};

/** Why a candidate failed the self-test: fixed words, logged as they are. */
export type SelfTestCode =
  | 'vector-seal'
  | 'vector-open'
  | 'forgery-opened'
  | 'empty'
  | 'offsets'
  | 'batch'
  | 'cross-check'
  | 'threw';

function hex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function same(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A copy of `bytes` as a view at offset 3 into a larger buffer, as base64url decoding and subarray make. */
function offsetView(bytes: Uint8Array): Uint8Array {
  const big = new Uint8Array(bytes.length + 5).fill(0xa5);
  big.set(bytes, 3);
  return big.subarray(3, 3 + bytes.length);
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 1;
  return copy;
}

/**
 * Seals and opens the known vector and a few edge cases on `candidate` and compares every answer with `reference`
 * (@noble): byte-equal seals, the right plaintexts, forgeries refused (a changed tag, ciphertext byte or AAD), empty
 * inputs, offset views, a batch with a forgery in it, and one random case both ways. `random` fills test bytes only.
 * Null when it passes. Never throws.
 */
export function selfTestAead(
  candidate: Aead,
  reference: Aead = nobleAead,
  random: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) =>
    globalThis.crypto.getRandomValues(bytes),
): SelfTestCode | null {
  try {
    const key = hex(SELF_TEST_VECTOR.key);
    const nonce = hex(SELF_TEST_VECTOR.nonce);
    const aad = hex(SELF_TEST_VECTOR.aad);
    const msg = hex(SELF_TEST_VECTOR.msg);
    const sealed = hex(SELF_TEST_VECTOR.sealed);
    const empty = new Uint8Array(0);

    if (!same(candidate.seal(key, nonce, aad, msg), sealed)) return 'vector-seal';
    if (!same(candidate.open(key, nonce, aad, sealed), msg)) return 'vector-open';
    if (
      candidate.open(key, nonce, aad, flipped(sealed, sealed.length - 1)) !== null ||
      candidate.open(key, nonce, aad, flipped(sealed, 0)) !== null ||
      candidate.open(key, nonce, flipped(aad, 0), sealed) !== null ||
      candidate.open(key, flipped(nonce, 23), aad, sealed) !== null
    ) {
      return 'forgery-opened';
    }

    const emptySealed = candidate.seal(key, nonce, empty, empty);
    if (!same(emptySealed, reference.seal(key, nonce, empty, empty))) return 'empty';
    if (!same(candidate.open(key, nonce, empty, emptySealed), empty)) return 'empty';

    if (
      !same(
        candidate.seal(offsetView(key), offsetView(nonce), offsetView(aad), offsetView(msg)),
        sealed,
      )
    ) {
      return 'offsets';
    }
    if (
      !same(
        candidate.open(offsetView(key), offsetView(nonce), offsetView(aad), offsetView(sealed)),
        msg,
      )
    ) {
      return 'offsets';
    }

    let batch: (Uint8Array | null)[];
    try {
      batch = candidate.openMany(key, [
        { nonce, aad, sealed },
        { nonce, aad, sealed: flipped(sealed, 7) },
        { nonce, aad: empty, sealed: emptySealed },
      ]);
    } catch {
      return 'batch';
    }
    if (batch.length !== 3 || !same(batch[0], msg) || batch[1] !== null || !same(batch[2], empty)) {
      return 'batch';
    }

    const k = new Uint8Array(32);
    const n = new Uint8Array(24);
    const a = new Uint8Array(75); // the size of the app's own additional data
    const p = new Uint8Array(752);
    for (const bytes of [k, n, a, p]) random(bytes);
    const mine = candidate.seal(k, n, a, p);
    const theirs = reference.seal(k, n, a, p);
    if (!same(mine, theirs)) return 'cross-check';
    if (!same(reference.open(k, n, a, mine), p) || !same(candidate.open(k, n, a, theirs), p)) {
      return 'cross-check';
    }
    return null;
  } catch {
    return 'threw';
  }
}

// ---------- Installing it ----------

export type AeadStatus =
  | { kind: 'native'; name: string; selfTestMs: number }
  | { kind: 'js'; reason: 'unavailable' }
  | { kind: 'js'; reason: 'self-test'; code: SelfTestCode };

let installed: AeadStatus | null = null;

/** What `installNativeAead` decided, or null before it ran. */
export function aeadStatus(): AeadStatus | null {
  return installed;
}

/**
 * Once per process: when `native` is present (null where the module is not in the build) and passes `selfTestAead`,
 * installs it for every seal and open; otherwise leaves @noble. Logs one line of fixed words either way, never a
 * key, nonce, or byte of data. Never throws.
 */
export function installNativeAead(
  native: NativeCrypto | null,
  log: (line: string) => void = (line) => console.log(line),
): AeadStatus {
  if (installed !== null) return installed;
  let status: AeadStatus;
  if (native === null) {
    status = { kind: 'js', reason: 'unavailable' };
  } else {
    const started = performance.now();
    let candidate: Aead | null = null;
    let code: SelfTestCode | null;
    try {
      candidate = nativeAeadFrom(native);
      code = selfTestAead(candidate);
    } catch {
      code = 'threw';
    }
    const ms = Math.round((performance.now() - started) * 10) / 10;
    if (code === null && candidate !== null) {
      setAead(candidate);
      status = { kind: 'native', name: candidate.name, selfTestMs: ms };
    } else {
      status = { kind: 'js', reason: 'self-test', code: code ?? 'threw' };
    }
  }
  installed = status;
  log(
    status.kind === 'native'
      ? `[even] crypto: native ${status.name}, self-test passed in ${status.selfTestMs} ms`
      : status.reason === 'unavailable'
        ? '[even] crypto: @noble (no native module in this build)'
        : `[even] crypto: @noble, the native module failed its self-test (${status.code})`,
  );
  return status;
}

/** Tests only: forget the decision and go back to @noble. */
export function resetNativeAeadForTests(): void {
  installed = null;
  setAead(null);
}
