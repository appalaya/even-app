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
  aead,
  nobleAead,
  onAeadDisagreement,
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

/** Items per native openMany call: the derive's slice (OPENS_PER_YIELD), and a cap for any other caller. */
export const NATIVE_BATCH_ITEMS = 200;

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
      // At most NATIVE_BATCH_ITEMS a call, whoever asks: one call never carries more than about 1.6 MB.
      const results: (Uint8Array | null)[] = [];
      for (let from = 0; from < items.length; from += NATIVE_BATCH_ITEMS) {
        results.push(...openBatch(native, key, items.slice(from, from + NATIVE_BATCH_ITEMS)));
      }
      return results;
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
  | 'wrong-key-opened'
  | 'empty'
  | 'offsets'
  | 'batch'
  | 'sizes'
  | 'max-size'
  | 'large-batch'
  | 'cross-check'
  | 'threw';

// ---------- Deterministic cases with @noble's answers ----------

/**
 * Deterministic bytes (xorshift32, a word at a time): test data for the self-test only, not random and not secret.
 * Returned at offset 0 of its buffer, so `fingerprint` can read it a word at a time.
 */
function patterned(length: number, seed: number): Uint8Array {
  const words = new Uint32Array(Math.ceil(length / 4));
  let x = (seed ^ 0x9e3779b9) >>> 0 || 1;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x;
  }
  return new Uint8Array(words.buffer, 0, length);
}

/**
 * FNV-1a over 32-bit little-endian words, then the trailing bytes: a fingerprint of a sealed output or a plaintext,
 * to compare with @noble's without running @noble and without a byte-by-byte loop. Not a security measure: these
 * are fixed, public test cases, and the question is only whether two implementations agree.
 */
export function fingerprint(bytes: Uint8Array): number {
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const count = aligned.length >>> 2;
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, count);
  let h = 0x811c9dc5;
  for (let i = 0; i < count; i++) h = Math.imul(h ^ words[i]!, 0x01000193);
  for (let i = count * 4; i < aligned.length; i++) h = Math.imul(h ^ aligned[i]!, 0x01000193);
  return h >>> 0;
}

/** Same length and fingerprint, or both null: how the self-test compares a plaintext with the expected one. */
function agrees(answer: Uint8Array | null | undefined, expected: Uint8Array | null): boolean {
  if (answer == null || expected === null) return answer == null && expected === null;
  return answer.length === expected.length && fingerprint(answer) === fingerprint(expected);
}

/** The app's own additional data is 75 bytes ("even/v1|" + 43-character group id + "|1|" + 22-character id). */
const AAD_BYTES = 75;

/** Plaintext lengths sealed singly: either side of 64 bytes (one ChaCha20 block) and of 4096. */
const SIZE_CASES = [63, 64, 65, 4095, 4096, 4097];

/** The largest padded plaintext a v1 envelope holds (8192 - 16), sealed and opened against @noble both ways. */
export const MAX_PADDED_BYTES = 8176;

/** A batch's plaintext lengths: 64 items up to 8,176 bytes, block and padding edges first, then smaller ones. */
const BATCH_SIZES = [
  0, 1, 15, 16, 17, 63, 64, 65, 127, 128, 129, 239, 240, 241, 255, 256, 257, 495, 496, 511, 512,
  513, 751, 752, 1007, 1008, 1023, 1024, 1025, 2047, 2048, 2049, 4095, 4096, 4097, 8175, 8176, 31,
  32, 33, 47, 48, 49, 79, 80, 81, 95, 96, 97, 111, 112, 113, 143, 144, 145, 159, 160, 161, 175, 176,
  177, 191, 192, 193,
];

/** Items of the batch that are forged, and how: the self-test expects null for exactly these. */
const BATCH_FORGERIES: Record<number, 'tag' | 'ciphertext' | 'aad' | 'nonce'> = {
  3: 'tag',
  17: 'ciphertext',
  31: 'aad',
  42: 'nonce',
  63: 'tag',
};

export interface SelfTestCase {
  key: Uint8Array;
  nonce: Uint8Array;
  aad: Uint8Array;
  plaintext: Uint8Array;
}

/** The deterministic cases: the single sizes, the largest, and the batch (one key, as a derive has). */
export function selfTestCases(): {
  sizes: SelfTestCase[];
  max: SelfTestCase;
  batch: SelfTestCase[];
} {
  const one = (length: number, seed: number, key?: Uint8Array): SelfTestCase => ({
    key: key ?? patterned(32, seed),
    nonce: patterned(24, seed + 1),
    aad: patterned(AAD_BYTES, seed + 2),
    plaintext: patterned(length, seed + 3),
  });
  const batchKey = patterned(32, 7000);
  return {
    sizes: SIZE_CASES.map((length, i) => one(length, 100 * (i + 1))),
    max: one(MAX_PADDED_BYTES, 9000),
    batch: BATCH_SIZES.map((length, i) => one(length, 10_000 + 10 * i, batchKey)),
  };
}

/**
 * `fingerprint` of @noble's seal of each deterministic case, so the candidate's seals are compared with @noble's
 * without running @noble at startup. nativeAead.test.ts recomputes every one with @noble.
 */
export const SELF_TEST_DIGESTS = {
  sizes: [0x9f2a24a7, 0x1d616c27, 0x5552d6b0, 0x0d7dd99a, 0x0def9279, 0x307b6320],
  batch: [
    0xd3e207bf, 0x0792e092, 0x22436bfd, 0x0a42de1a, 0x6ae1a02a, 0x4f7b5713, 0x2d4b80f0, 0xf7a6715e,
    0x0e1dfa95, 0x124d103d, 0xc58509a0, 0x52c407b8, 0x2fd79125, 0xcd10bc59, 0xc6845dcd, 0xc797d04a,
    0x46c3ca1f, 0x454fad4a, 0xddb2c14b, 0x73430082, 0x43e69f63, 0x60f237c1, 0x86f36410, 0x9b517ac5,
    0x44842153, 0x86d4fef0, 0x0bb99100, 0x46714711, 0xb751e0ea, 0x13ff3d0d, 0x657d8ed0, 0xdbd96dfc,
    0xb58e7bc1, 0xe62a3554, 0x057c3201, 0xa7b53732, 0x56843232, 0x057dc7d7, 0x83a2570e, 0xafcc2091,
    0xdff93072, 0x6be3acc8, 0xdee45ac8, 0xf71ee530, 0xe21a796e, 0x0170f09b, 0xe5a9fb6a, 0x6d6faf01,
    0x4e694424, 0x7be3bc46, 0xfd04d370, 0x966a80da, 0xc94dac1e, 0x91f33447, 0xc3039720, 0x4023c149,
    0x8c2102e3, 0x6739b3ed, 0x665500b3, 0xaa54135f, 0xb5b0494c, 0x01cae532, 0x3b142fbc, 0xa70233f7,
  ],
};

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
 * Seals and opens on `candidate` and compares every answer with `reference` (@noble), directly or through
 * @noble's fingerprints of deterministic cases (`SELF_TEST_DIGESTS`), so that it costs a few milliseconds:
 * - the draft A.3.1 vector: the published bytes, and back;
 * - forgeries refused: a changed tag, ciphertext, AAD or nonce byte, and a key with one byte changed;
 * - empty AAD and plaintext, and inputs that are offset views;
 * - plaintexts of 63, 64, 65, 4095, 4096 and 4097 bytes with a 75-byte AAD (the app's), by fingerprint;
 * - 8,176 bytes (the largest padded body) with a 75-byte AAD against @noble itself, both ways;
 * - a 64-item batch under one key, plaintexts up to 8,176 bytes, five items forged at known positions, each answer
 *   checked item by item, and the same batch under a wrong key;
 * - one random 752-byte case (`random` fills test bytes only), both ways against @noble itself.
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

    // A key with one byte changed must not open anything, alone or in a batch.
    const wrongKey = flipped(key, 13);
    if (candidate.open(wrongKey, nonce, aad, sealed) !== null) return 'wrong-key-opened';

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

    const cases = selfTestCases();

    // Either side of 64 and of 4096 bytes: the candidate's seal is @noble's (by fingerprint), and it opens back.
    for (const [i, c] of cases.sizes.entries()) {
      const mine = candidate.seal(c.key, c.nonce, c.aad, c.plaintext);
      if (fingerprint(mine) !== SELF_TEST_DIGESTS.sizes[i]) return 'sizes';
      if (!agrees(candidate.open(c.key, c.nonce, c.aad, mine), c.plaintext)) return 'sizes';
    }

    // The largest padded body an envelope holds, with the app's 75-byte AAD, against @noble itself both ways: the
    // candidate's seal must be @noble's seal byte for byte (so @noble opens it exactly as it opens its own; opening
    // it again would only repeat that, at 2 ms), and the candidate must open @noble's seal.
    {
      const c = cases.max;
      const mine = candidate.seal(c.key, c.nonce, c.aad, c.plaintext);
      const theirs = reference.seal(c.key, c.nonce, c.aad, c.plaintext);
      if (!same(mine, theirs)) return 'max-size';
      if (!agrees(candidate.open(c.key, c.nonce, c.aad, theirs), c.plaintext)) return 'max-size';
      if (candidate.open(flipped(c.key, 0), c.nonce, c.aad, theirs) !== null)
        return 'wrong-key-opened';
    }

    // A derive-sized batch under one key: 64 items up to 8,176 bytes, sealed by the candidate (each seal checked
    // against @noble's fingerprint), five of them forged at known positions; every answer is checked item by item.
    {
      const items: AeadSealed[] = [];
      for (const [i, c] of cases.batch.entries()) {
        let sealed = candidate.seal(c.key, c.nonce, c.aad, c.plaintext);
        if (fingerprint(sealed) !== SELF_TEST_DIGESTS.batch[i]) return 'large-batch';
        let itemAad = c.aad;
        let itemNonce = c.nonce;
        switch (BATCH_FORGERIES[i]) {
          case 'tag':
            sealed = flipped(sealed, sealed.length - 1);
            break;
          case 'ciphertext':
            sealed = flipped(sealed, 0);
            break;
          case 'aad':
            itemAad = flipped(c.aad, AAD_BYTES - 1);
            break;
          case 'nonce':
            itemNonce = flipped(c.nonce, 0);
            break;
        }
        items.push({ nonce: itemNonce, aad: itemAad, sealed });
      }
      const batchKey = cases.batch[0]!.key;
      const answers = candidate.openMany(batchKey, items);
      if (answers.length !== items.length) return 'large-batch';
      for (const [i, c] of cases.batch.entries()) {
        const want = BATCH_FORGERIES[i] === undefined ? c.plaintext : null;
        if (!agrees(answers[i], want)) return 'large-batch';
      }
      const underWrongKey = candidate.openMany(flipped(batchKey, 31), items.slice(0, 3));
      if (underWrongKey.length !== 3 || underWrongKey.some((answer) => answer !== null)) {
        return 'wrong-key-opened';
      }
    }

    // And one random case, both ways against @noble itself.
    const k = new Uint8Array(32);
    const n = new Uint8Array(24);
    const a = new Uint8Array(AAD_BYTES);
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
  | { kind: 'js'; reason: 'self-test'; code: SelfTestCode }
  /** It was installed, then refused an envelope @noble opens: @noble for the rest of the process. */
  | { kind: 'js'; reason: 'disagreed'; name: string };

let installed: AeadStatus | null = null;

/** What `installNativeAead` decided, or null before it ran. */
export function aeadStatus(): AeadStatus | null {
  return installed;
}

/**
 * Once per process: when `native` is present (null where the module is not in the build) and passes `selfTestAead`,
 * installs it for every seal and open; otherwise leaves @noble. Logs one line of fixed words either way, never a
 * key, nonce, or byte of data. If the installed module later refuses an envelope that @noble opens, the app goes
 * back to @noble for the rest of the process and logs one more fixed line (`aeadStatus` says `disagreed`). Never
 * throws.
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
      const native = candidate;
      setAead(native);
      // A refusal @noble overrules (envelope.ts asks it about every one) means this implementation cannot be trusted
      // to agree: @noble for the rest of the process, and one line of fixed words.
      onAeadDisagreement(() => {
        if (aead() !== native) return;
        setAead(null);
        onAeadDisagreement(null);
        installed = { kind: 'js', reason: 'disagreed', name: native.name };
        log(
          '[even] crypto: @noble from now on, the native module refused an envelope @noble opens',
        );
      });
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
  onAeadDisagreement(null);
}
