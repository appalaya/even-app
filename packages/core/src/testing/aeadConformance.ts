/**
 * Checks for an `Aead` implementation, runnable anywhere (Node under Vitest, or Hermes on a phone through the
 * development crypto harness): the known-answer vectors @noble/ciphers is tested against, and a seeded cross-check
 * against a reference implementation in both directions. Each returns a report instead of throwing, so a phone can
 * show and log every result. Failures name the vector or case, never print key material (it is test data anyway).
 */
import { AEAD_TAG_BYTES, type Aead, type AeadSealed } from '../aead.js';
import { bytesEqual, bytesToHex, hexToBytes, seededBytes } from './bytes.js';
import { STABLELIB, WYCHEPROOF, type AeadVectorRow } from './xchachaVectors.js';

export interface CheckReport {
  name: string;
  passed: number;
  failed: number;
  /** The first few failures, by vector id or case number. */
  failures: string[];
  ms: number;
}

const MAX_LISTED = 20;

function report(name: string): CheckReport & { pass: () => void; fail: (what: string) => void; done: () => CheckReport } {
  const started = Date.now();
  const r = {
    name,
    passed: 0,
    failed: 0,
    failures: [] as string[],
    ms: 0,
    pass() {
      r.passed += 1;
    },
    fail(what: string) {
      r.failed += 1;
      if (r.failures.length < MAX_LISTED) r.failures.push(what);
    },
    done(): CheckReport {
      return { name: r.name, passed: r.passed, failed: r.failed, failures: r.failures, ms: Date.now() - started };
    },
  };
  return r;
}

/** Runs `fn`, turning a throw into its message so one bad case cannot stop a run. */
function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

function tamperLast(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  if (copy.length > 0) copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 1;
  return copy;
}

/** One vector table: a valid row must seal to exactly `sealed` and open back; an invalid row must not open. */
function checkRows(impl: Aead, name: string, rows: readonly AeadVectorRow[]): CheckReport {
  const r = report(name);
  for (const [id, keyHex, nonceHex, aadHex, msgHex, sealedHex, valid] of rows) {
    const key = hexToBytes(keyHex);
    const nonce = hexToBytes(nonceHex);
    const aad = hexToBytes(aadHex);
    const msg = hexToBytes(msgHex);
    const sealed = hexToBytes(sealedHex);
    if (valid === 1) {
      const s = attempt(() => impl.seal(key, nonce, aad, msg));
      if (!s.ok) r.fail(`#${id} seal threw ${s.error}`);
      else if (bytesToHex(s.value) !== sealedHex) r.fail(`#${id} seal gave other bytes`);
      else r.pass();
      const o = attempt(() => impl.open(key, nonce, aad, sealed));
      if (!o.ok) r.fail(`#${id} open threw ${o.error}`);
      else if (o.value === null || bytesToHex(o.value) !== msgHex) r.fail(`#${id} open did not give the message`);
      else r.pass();
      const t = attempt(() => impl.open(key, nonce, aad, tamperLast(sealed)));
      if (!t.ok) r.fail(`#${id} open (tag changed) threw ${t.error}`);
      else if (t.value !== null) r.fail(`#${id} open accepted a changed tag`);
      else r.pass();
    } else {
      const o = attempt(() => impl.open(key, nonce, aad, sealed));
      if (!o.ok) r.fail(`#${id} open (invalid) threw ${o.error}`);
      else if (o.value !== null) r.fail(`#${id} open accepted an invalid vector`);
      else r.pass();
      if (nonce.length !== 24) {
        // A wrong-size nonce: seal must refuse it rather than use some other construction.
        const s = attempt(() => impl.seal(key, nonce, aad, msg));
        if (s.ok) r.fail(`#${id} seal accepted a ${nonce.length}-byte nonce`);
        else r.pass();
      }
    }
  }
  return r.done();
}

/** Every Wycheproof row with a 24-byte nonce, opened per key in one `openMany` call, against the single-call answers. */
function checkBatch(impl: Aead): CheckReport {
  const r = report('openMany (Wycheproof, batched per key)');
  const byKey = new Map<string, AeadVectorRow[]>();
  for (const row of WYCHEPROOF) {
    if (row[2].length !== 48) continue;
    const list = byKey.get(row[1]) ?? [];
    list.push(row);
    byKey.set(row[1], list);
  }
  for (const [keyHex, rows] of byKey) {
    const key = hexToBytes(keyHex);
    // Each row as given, and each valid row again with its tag changed, so every batch mixes good and bad items.
    // (Not an invalid row: Wycheproof's modified tags include one bit flipped, which flipping again would repair.)
    const items: AeadSealed[] = [];
    const expected: (string | null)[] = [];
    for (const [, , nonceHex, aadHex, msgHex, sealedHex, valid] of rows) {
      const sealed = hexToBytes(sealedHex);
      items.push({ nonce: hexToBytes(nonceHex), aad: hexToBytes(aadHex), sealed });
      expected.push(valid === 1 ? msgHex : null);
      if (valid === 1) {
        items.push({ nonce: hexToBytes(nonceHex), aad: hexToBytes(aadHex), sealed: tamperLast(sealed) });
        expected.push(null);
      }
    }
    const got = attempt(() => impl.openMany(key, items));
    if (!got.ok) {
      r.fail(`key ${rows[0]?.[0]}: openMany threw ${got.error}`);
      continue;
    }
    if (got.value.length !== items.length) {
      r.fail(`key ${rows[0]?.[0]}: ${got.value.length} results for ${items.length} items`);
      continue;
    }
    got.value.forEach((value, i) => {
      const want = expected[i] ?? null;
      const ok = want === null ? value === null : value !== null && bytesToHex(value) === want;
      if (ok) r.pass();
      else r.fail(`key ${rows[0]?.[0]} item ${i}: ${want === null ? 'accepted a forgery' : 'wrong plaintext'}`);
    });
  }
  // Empty batch.
  const empty = attempt(() => impl.openMany(new Uint8Array(32), []));
  if (empty.ok && empty.value.length === 0) r.pass();
  else r.fail('an empty batch did not give an empty answer');
  return r.done();
}

/**
 * Inputs that are views into larger buffers (a non-zero byteOffset), as `subarray` and base64url decoding make: the
 * answer must be the same as for fresh copies, and no input may be written to. noble-ciphers checks the same
 * ("handle byte offsets correctly").
 */
function checkOffsets(impl: Aead): CheckReport {
  const r = report('byte offsets and inputs left unchanged');
  const src = seededBytes(7);
  for (const size of [0, 1, 16, 63, 64, 65, 239, 240, 1000]) {
    const key = src.bytes(32);
    const nonce = src.bytes(24);
    const aad = src.bytes(size % 50);
    const plain = src.bytes(size);
    const view = (bytes: Uint8Array): Uint8Array => {
      const big = src.bytes(bytes.length + 7);
      big.set(bytes, 3);
      return big.subarray(3, 3 + bytes.length);
    };
    const [k2, n2, a2, p2] = [view(key), view(nonce), view(aad), view(plain)];
    const before = [k2, n2, a2, p2].map((b) => bytesToHex(b));
    const plainSeal = attempt(() => impl.seal(key, nonce, aad, plain));
    const viewSeal = attempt(() => impl.seal(k2, n2, a2, p2));
    if (!plainSeal.ok || !viewSeal.ok) {
      r.fail(`size ${size}: seal threw`);
      continue;
    }
    if (bytesEqual(plainSeal.value, viewSeal.value)) r.pass();
    else r.fail(`size ${size}: seal of views differs`);
    const sealedView = view(viewSeal.value);
    const before2 = bytesToHex(sealedView);
    const opened = attempt(() => impl.open(k2, n2, a2, sealedView));
    if (opened.ok && bytesEqual(opened.value, plain)) r.pass();
    else r.fail(`size ${size}: open of views failed`);
    const batch = attempt(() => impl.openMany(k2, [{ nonce: n2, aad: a2, sealed: sealedView }]));
    if (batch.ok && bytesEqual(batch.value[0] ?? null, plain)) r.pass();
    else r.fail(`size ${size}: openMany of views failed`);
    const after = [k2, n2, a2, p2].map((b) => bytesToHex(b));
    if (after.every((hex, i) => hex === before[i]) && bytesToHex(sealedView) === before2) r.pass();
    else r.fail(`size ${size}: an input was modified`);
  }
  return r.done();
}

/** The known-answer checks: Wycheproof (315), StableLib / draft A.3.1, batching, offsets. */
export function aeadVectorChecks(impl: Aead): CheckReport[] {
  return [
    checkRows(impl, 'Wycheproof xchacha20_poly1305_test.json', WYCHEPROOF),
    checkRows(impl, 'StableLib (draft-irtf-cfrg-xchacha-03 A.3.1)', STABLELIB),
    checkBatch(impl),
    checkOffsets(impl),
  ];
}

export interface CrossCheckOptions {
  /** Cases, each one seal and open in both directions plus a forgery each way. */
  cases: number;
  /** Plaintext sizes are drawn from 0 to this, inclusive, with the edges always included. Default 8192. */
  maxPlaintext?: number;
  /** Additional data sizes are drawn from 0 to this. Default 128 (the app's is 75 bytes). */
  maxAad?: number;
  seed?: number;
  /** Items per `openMany` batch, under one key. Default 64. */
  batch?: number;
}

const EDGE_SIZES = [0, 1, 15, 16, 17, 63, 64, 65, 239, 240, 255, 256, 495, 496, 4096, 8175, 8176, 8191, 8192];

/**
 * Random keys, nonces, additional data and plaintexts (sizes 0..maxPlaintext): `impl` seals and `reference` opens,
 * `reference` seals and `impl` opens, both seals must be the same bytes (the construction is deterministic for a
 * nonce), and a changed byte anywhere in the ciphertext or the additional data must fail to open on both. Batches go
 * through `impl.openMany` with a forgery mixed in.
 */
export function aeadCrossCheck(impl: Aead, reference: Aead, options: CrossCheckOptions): CheckReport {
  const maxPlaintext = options.maxPlaintext ?? 8192;
  const maxAad = options.maxAad ?? 128;
  const seed = options.seed ?? 1;
  const batchSize = options.batch ?? 64;
  const r = report(`cross-check against ${reference.name} (${options.cases} cases, seed ${seed})`);
  const src = seededBytes(seed);
  let batchKey = src.bytes(32);
  let batch: { item: AeadSealed; want: Uint8Array | null; label: string }[] = [];

  const flushBatch = (): void => {
    if (batch.length === 0) return;
    const got = attempt(() => impl.openMany(batchKey, batch.map((b) => b.item)));
    if (!got.ok || got.value.length !== batch.length) {
      r.fail(`batch ending ${batch[batch.length - 1]?.label}: openMany ${got.ok ? 'gave the wrong count' : `threw ${got.error}`}`);
    } else {
      batch.forEach((b, i) => {
        if (bytesEqual(got.value[i] ?? null, b.want)) r.pass();
        else r.fail(`${b.label}: openMany ${b.want === null ? 'accepted a forgery' : 'gave other bytes'}`);
      });
    }
    batch = [];
    batchKey = src.bytes(32);
  };

  for (let i = 0; i < options.cases; i++) {
    const label = `case ${i}`;
    const size = i < EDGE_SIZES.length ? Math.min(EDGE_SIZES[i] ?? 0, maxPlaintext) : src.int(maxPlaintext + 1);
    const key = src.bytes(32);
    const nonce = src.bytes(24);
    const aad = src.bytes(src.int(maxAad + 1));
    const plain = src.bytes(size);

    const mine = attempt(() => impl.seal(key, nonce, aad, plain));
    const theirs = attempt(() => reference.seal(key, nonce, aad, plain));
    if (!mine.ok || !theirs.ok) {
      r.fail(`${label} (${size} bytes): seal threw ${mine.ok ? '' : mine.error} ${theirs.ok ? '' : theirs.error}`.trim());
      continue;
    }
    if (mine.value.length === size + AEAD_TAG_BYTES && bytesEqual(mine.value, theirs.value)) r.pass();
    else r.fail(`${label} (${size} bytes): seals differ`);

    const theyOpen = attempt(() => reference.open(key, nonce, aad, mine.value));
    if (theyOpen.ok && bytesEqual(theyOpen.value, plain)) r.pass();
    else r.fail(`${label} (${size} bytes): ${reference.name} could not open ${impl.name}'s seal`);

    const iOpen = attempt(() => impl.open(key, nonce, aad, theirs.value));
    if (iOpen.ok && bytesEqual(iOpen.value, plain)) r.pass();
    else r.fail(`${label} (${size} bytes): ${impl.name} could not open ${reference.name}'s seal`);

    // One changed byte: in the ciphertext or tag, or in the additional data.
    const forged = theirs.value.slice();
    const at = src.int(forged.length);
    forged[at] = (forged[at] ?? 0) ^ (1 + src.int(255));
    const forgedAad = aad.length > 0 ? aad.slice() : Uint8Array.of(0);
    const aadAt = src.int(forgedAad.length);
    forgedAad[aadAt] = (forgedAad[aadAt] ?? 0) ^ 0x80;
    const f1 = attempt(() => impl.open(key, nonce, aad, forged));
    const f2 = attempt(() => impl.open(key, nonce, forgedAad, theirs.value));
    const f3 = attempt(() => reference.open(key, nonce, aad, forged));
    if (f1.ok && f1.value === null && f2.ok && f2.value === null && f3.ok && f3.value === null) r.pass();
    else r.fail(`${label} (${size} bytes): a forgery opened`);

    // The batch path, under the batch's own key.
    const batchSealed = attempt(() => reference.seal(batchKey, nonce, aad, plain));
    if (batchSealed.ok) {
      batch.push({ item: { nonce, aad, sealed: batchSealed.value }, want: plain, label });
      if (i % 7 === 3) batch.push({ item: { nonce, aad, sealed: tamperLast(batchSealed.value) }, want: null, label: `${label} forged` });
    }
    if (batch.length >= batchSize) flushBatch();
  }
  flushBatch();
  return r.done();
}
