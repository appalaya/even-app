/**
 * Dev only: the native-crypto harness (design.md "Crypto"), on a simulator, an emulator or a phone, through
 * `even://dev/crypto` or the Metro debugger (`globalThis.__evenCryptoHarness` holds the last report). What no Node
 * test can prove, because Node has no native module:
 *
 * 1. Conformance: the known-answer vectors @noble is tested against (`aeadVectorChecks`), the envelope tests
 *    (`envelopeSuite`, through `createMiniRunner`) with the native implementation installed, and a seeded random
 *    cross-check against @noble in both directions, plaintexts of 0 to 8192 bytes.
 * 2. Timings: a large group's cold derive (decrypt, validate, reduce, balances) in a fresh state store on @noble and
 *    on the native implementation, with the time spent inside the AEAD counted separately, and the AEAD alone over
 *    the same envelopes. The group lives in a scratch database (`even-crypto-harness.db`, deleted afterwards) with
 *    its secret in memory: nothing here reads or writes `even.db`, the keychain, or the network.
 *
 * Nothing that ships imports this (metro.config.js leaves src/dev/ out of release bundles).
 */
import {
  aadFor,
  aead,
  b64urlDecode,
  deriveLocal,
  deriveServer,
  nobleAead,
  newSecret,
  seal,
  setAead,
  type Aead,
  type AeadSealed,
} from '@even/core';
import {
  aeadCrossCheck,
  aeadVectorChecks,
  createMiniRunner,
  envelopeSuite,
  type CheckReport,
} from '@even/core/testing';
import * as SQLite from 'expo-sqlite';
import * as fc from 'fast-check';
import { Platform } from 'react-native';

import EvenCrypto from '../../modules/even-crypto';
import { aeadStatus, nativeAeadFrom } from '../services/crypto/nativeAead';
import { openExpoDriver } from '../services/storage/expoDriver';
import { openSqliteStore, type SqliteStore } from '../services/storage/sqliteStore';
import type { NewEventRow } from '../services/storage/types';
import { GroupStateStore } from '../state/groupState';
import { parseEnvelopeText } from '../state/log';
import { largeGroup } from './largeGroup';

const SCRATCH_DATABASE = 'even-crypto-harness.db';
/** A group's server, for its key derivation only: the dev server's https form. Nothing here connects to it. */
const SCRATCH_SERVER = 'https://127.0.0.1:8787';

export interface HarnessOptions {
  /** Random cross-check cases against @noble. Default 3000. */
  cases?: number;
  seed?: number;
  /** Group sizes to time. Default [3400, 10000]. Empty skips the timings. */
  sizes?: number[];
  /** Cold derives per implementation and size. Default 2. */
  runs?: number;
  /** Skip the conformance part (timings only). */
  timingsOnly?: boolean;
  onLine?: (line: string) => void;
}

export interface DeriveTiming {
  ms: number[];
  /** Longest stretch with no timer firing, per run. */
  blockMs: number[];
  /** Time inside the AEAD's open/openMany, per run. */
  aeadMs: number[];
}

export interface SizeTiming {
  events: number;
  expenses: number;
  noble: DeriveTiming;
  native: DeriveTiming | null;
  /** The AEAD alone over the group's envelopes, already decoded from base64url. */
  aeadOnly: { nobleMs: number; nativeMs: number | null; nativeBatchMs: number | null };
  /** Parsing the stored envelope text and decoding base64url, for every envelope: the JavaScript left around it. */
  parseAndDecodeMs: number;
}

export interface HarnessReport {
  platform: string;
  installed: string;
  native: string | null;
  checks: (CheckReport & { implementation: string })[];
  timings: SizeTiming[];
  ok: boolean;
  ms: number;
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Counts the time spent inside `impl`'s open and openMany. */
function timed(impl: Aead): { aead: Aead; ms: () => number; reset: () => void } {
  let ms = 0;
  return {
    aead: {
      name: impl.name,
      seal: (k, n, a, p) => impl.seal(k, n, a, p),
      open: (k, n, a, s) => {
        const t = performance.now();
        try {
          return impl.open(k, n, a, s);
        } finally {
          ms += performance.now() - t;
        }
      },
      openMany: (k, items) => {
        const t = performance.now();
        try {
          return impl.openMany(k, items);
        } finally {
          ms += performance.now() - t;
        }
      },
    },
    ms: () => ms,
    reset: () => {
      ms = 0;
    },
  };
}

/** Longest stretch in which no zero-delay timer could fire, from start() to the returned stop(). */
function blockMonitor(): () => number {
  let last = performance.now();
  let block = 0;
  let running = true;
  const tick = () => {
    const now = performance.now();
    block = Math.max(block, now - last);
    last = now;
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return () => {
    running = false;
    tick();
    return block;
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;

async function conformance(
  native: Aead | null,
  options: HarnessOptions,
  line: (text: string) => void,
): Promise<(CheckReport & { implementation: string })[]> {
  const checks: (CheckReport & { implementation: string })[] = [];
  const add = (implementation: string, report: CheckReport) => {
    checks.push({ ...report, implementation });
    line(
      `${implementation} · ${report.name}: ${report.passed} passed, ${report.failed} failed (${report.ms} ms)` +
        (report.failures.length > 0 ? ` · ${report.failures.slice(0, 3).join(' · ')}` : ''),
    );
  };
  const before = aead();
  for (const impl of native === null ? [nobleAead] : [native, nobleAead]) {
    for (const report of aeadVectorChecks(impl)) add(impl.name, report);
    await turn();
    // The envelope tests with this implementation installed, collected and run as Vitest would.
    setAead(impl);
    try {
      const runner = createMiniRunner();
      envelopeSuite(runner.api, fc);
      const result = runner.run();
      add(impl.name, {
        name: 'envelope tests (envelopeSuite)',
        passed: result.passed,
        failed: result.failed,
        failures: result.failures,
        ms: result.ms,
      });
    } finally {
      setAead(before);
    }
    await turn();
  }
  if (native !== null) {
    // Random cases in slices of 100, so the screen can draw in between; each slice has its own seed.
    const cases = options.cases ?? 3000;
    const seed = options.seed ?? 20261002;
    const total: CheckReport = {
      name: `cross-check against noble (${cases} cases, seeds ${seed}…)`,
      passed: 0,
      failed: 0,
      failures: [],
      ms: 0,
    };
    for (let done = 0, slice = 0; done < cases; done += 100, slice++) {
      const r = aeadCrossCheck(native, nobleAead, {
        cases: Math.min(100, cases - done),
        seed: seed + slice,
      });
      total.passed += r.passed;
      total.failed += r.failed;
      total.ms += r.ms;
      total.failures.push(...r.failures.slice(0, Math.max(0, 20 - total.failures.length)));
      await turn();
    }
    add(native.name, total);
  }
  return checks;
}

interface ScratchGroup {
  store: SqliteStore;
  localId: string;
  secret: Uint8Array;
  key: Uint8Array;
  groupId: string;
  texts: string[];
}

/** A group of `events` events in largeGroup's mix (as the dev seed's `large` state), in the scratch database. */
async function scratchGroup(events: number): Promise<ScratchGroup> {
  await SQLite.deleteDatabaseAsync(SCRATCH_DATABASE).catch(() => undefined);
  const store = await openSqliteStore(await openExpoDriver(SCRATCH_DATABASE));
  const secret = newSecret();
  const { localId, encryptionKey: key } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, SCRATCH_SERVER);
  const now = Date.now();
  const group = largeGroup({ events, end: now - 60_000, name: 'Harness' });
  const texts: string[] = [];
  const rows: NewEventRow[] = group.entries.map(({ id, event }) => {
    const text = JSON.stringify(seal({ key, groupId, body: event, id }));
    texts.push(text);
    return {
      id,
      origin: 'remote',
      acked: true,
      seq: null,
      ts: event.ts,
      envelope: text,
      status: 'ok',
    };
  });
  await store.upsertGroup({
    localId,
    serverUrl: SCRATCH_SERVER,
    epoch: null,
    cursor: 0,
    myMemberId: group.members[4]?.id ?? null,
    nameCache: group.name,
    currencyCache: group.currency,
    createdAt: group.entries[0]?.event.at ?? now,
    lastSyncedAt: now,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
    creationId: null,
  });
  for (let i = 0; i < rows.length; i += 1000)
    await store.insertEvents(localId, rows.slice(i, i + 1000));
  return { store, localId, secret, key, groupId, texts };
}

async function coldDerives(
  group: ScratchGroup,
  impl: Aead,
  runs: number,
): Promise<{ timing: DeriveTiming; expenses: number }> {
  const counter = timed(impl);
  const before = aead();
  setAead(counter.aead);
  const timing: DeriveTiming = { ms: [], blockMs: [], aeadMs: [] };
  let expenses = 0;
  try {
    for (let run = 0; run < runs; run++) {
      const fresh = new GroupStateStore({
        store: group.store,
        secrets: { getSecret: async (id) => (id === group.localId ? group.secret : null) },
        engine: { subscribe: () => () => {} },
        log: () => {},
      });
      counter.reset();
      await turn();
      const stop = blockMonitor();
      const t0 = performance.now();
      const derived = await fresh.get(group.localId);
      timing.ms.push(round(performance.now() - t0));
      timing.blockMs.push(round(stop()));
      timing.aeadMs.push(round(counter.ms()));
      expenses = derived?.state?.expenses.size ?? 0;
      fresh.dispose();
      await turn();
    }
  } finally {
    setAead(before);
  }
  return { timing, expenses };
}

function aeadInputs(group: ScratchGroup): { items: AeadSealed[]; ms: number } {
  const t0 = performance.now();
  const items: AeadSealed[] = [];
  for (const text of group.texts) {
    const envelope = parseEnvelopeText(text);
    if (envelope === null) continue;
    items.push({
      nonce: b64urlDecode(envelope.n),
      aad: aadFor(group.groupId, envelope.v, envelope.id),
      sealed: b64urlDecode(envelope.c),
    });
  }
  return { items, ms: round(performance.now() - t0) };
}

function timeOpens(
  impl: Aead,
  key: Uint8Array,
  items: readonly AeadSealed[],
  batch: boolean,
): number {
  const t0 = performance.now();
  if (batch) {
    for (let i = 0; i < items.length; i += 200) impl.openMany(key, items.slice(i, i + 200));
  } else {
    for (const item of items) impl.open(key, item.nonce, item.aad, item.sealed);
  }
  return round(performance.now() - t0);
}

export async function runCryptoHarness(options: HarnessOptions = {}): Promise<HarnessReport> {
  const started = performance.now();
  const lines: string[] = [];
  const line = (text: string) => {
    lines.push(text);
    console.log(`[crypto-harness] ${text}`);
    options.onLine?.(text);
  };
  const status = aeadStatus();
  const native = EvenCrypto === null ? null : nativeAeadFrom(EvenCrypto);
  const installed = aead().name;
  line(
    `installed: ${installed}; native module: ${native?.name ?? 'none'}; startup decision: ${status === null ? 'not yet' : JSON.stringify(status)}`,
  );

  const checks = options.timingsOnly ? [] : await conformance(native, options, line);

  const timings: SizeTiming[] = [];
  for (const events of options.sizes ?? [3400, 10000]) {
    line(`timings: building a ${events}-event group in the scratch database…`);
    const group = await scratchGroup(events);
    try {
      const runs = options.runs ?? 2;
      const noble = await coldDerives(group, nobleAead, runs);
      const nat = native === null ? null : await coldDerives(group, native, runs);
      const { items, ms: parseAndDecodeMs } = aeadInputs(group);
      const timing: SizeTiming = {
        events,
        expenses: noble.expenses,
        noble: noble.timing,
        native: nat?.timing ?? null,
        aeadOnly: {
          nobleMs: timeOpens(nobleAead, group.key, items, false),
          nativeMs: native === null ? null : timeOpens(native, group.key, items, false),
          nativeBatchMs: native === null ? null : timeOpens(native, group.key, items, true),
        },
        parseAndDecodeMs,
      };
      timings.push(timing);
      line(
        `${events} events (${timing.expenses} expenses): cold derive noble ${timing.noble.ms.join('/')} ms ` +
          `(aead ${timing.noble.aeadMs.join('/')}, block ${timing.noble.blockMs.join('/')})` +
          (timing.native === null
            ? ''
            : `, native ${timing.native.ms.join('/')} ms (aead ${timing.native.aeadMs.join('/')}, block ${timing.native.blockMs.join('/')})`) +
          ` · aead alone: noble ${timing.aeadOnly.nobleMs}, native ${timing.aeadOnly.nativeMs ?? '-'}, native batched ${timing.aeadOnly.nativeBatchMs ?? '-'} ms · parse+base64url ${parseAndDecodeMs} ms`,
      );
    } finally {
      await group.store.close();
      await SQLite.deleteDatabaseAsync(SCRATCH_DATABASE).catch(() => undefined);
    }
  }

  const ok =
    checks.every((c) => c.failed === 0) && (options.timingsOnly === true || checks.length > 0);
  const report: HarnessReport = {
    platform: Platform.OS,
    installed,
    native: native?.name ?? null,
    checks,
    timings,
    ok,
    ms: Math.round(performance.now() - started),
  };
  line(`${ok ? 'PASS' : 'FAIL'} in ${report.ms} ms`);
  (globalThis as { __evenCryptoHarness?: HarnessReport }).__evenCryptoHarness = report;
  return report;
}
