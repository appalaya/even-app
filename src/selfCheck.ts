/**
 * Development self-check, run once at startup. Logs one line covering the three things no Node test can prove on
 * the device:
 * 1. crypto: seals and opens one envelope through @even/core, so a missing CSPRNG, a broken workspace resolution
 *    of @even/core, or a Hermes gap in an API core relies on (TextEncoder/TextDecoder, BigInt, Intl) shows up;
 * 2. storage: `runStorageSmokeTest()` opens a scratch database through expo-sqlite, migrates it, writes and reads
 *    one row, and deletes it (never `even.db`);
 * 3. secrets: `secrets.deviceId()` from expo-secure-store returns a 22-character id.
 *
 * No network. The only lasting effect is the one the app has anyway: the first `deviceId()` call creates the
 * device id. Never throws and never rejects; failures are logged in the same line.
 */
import {
  deriveLocal,
  deriveServer,
  isId,
  newId,
  newSecret,
  open,
  parseEvent,
  PROTOCOL,
  seal,
  type Event,
} from '@even/core';

import { rngSource } from './polyfills';
import { secrets } from './services/secrets/secureStore';
import { runStorageSmokeTest } from './services/storage/expoDriver.smoke';

interface Check {
  ok: boolean;
  summary: string;
}

function failure(what: string, error: unknown): Check {
  return {
    ok: false,
    summary: `${what} FAILED: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function checkCrypto(): Check {
  try {
    const secret = newSecret();
    const { encryptionKey } = deriveLocal(secret);
    const { groupId } = deriveServer(secret, PROTOCOL.defaultServer);
    const now = Date.now();
    const body: Event = {
      sv: 1,
      ts: now,
      at: now,
      by: newId(),
      dev: newId(),
      type: 'group.created',
      name: 'Self-check',
      currency: 'EUR',
    };
    const envelope = seal({ key: encryptionKey, groupId, body });
    const opened = parseEvent(open({ key: encryptionKey, groupId, envelope }));
    if (opened?.type !== 'group.created' || opened.name !== body.name || opened.ts !== body.ts) {
      throw new Error('opened body does not match the sealed one');
    }
    return {
      ok: true,
      summary: `crypto ok: rng=${rngSource}, sealed+opened ${envelope.c.length}-char ciphertext`,
    };
  } catch (error) {
    return failure(`crypto (rng=${rngSource})`, error);
  }
}

async function checkStorage(): Promise<Check> {
  try {
    return await runStorageSmokeTest(); // never throws by contract; guarded anyway
  } catch (error) {
    return failure('storage', error);
  }
}

async function checkDeviceId(): Promise<Check> {
  try {
    const id = await secrets.deviceId();
    // The id itself is not logged: it has no diagnostic value and tags every event this device writes.
    return isId(id)
      ? { ok: true, summary: 'device id ok: 22 chars' }
      : { ok: false, summary: `device id FAILED: ${id.length} chars, not a 22-char base64url id` };
  } catch (error) {
    return failure('device id', error);
  }
}

async function runChecks(): Promise<void> {
  const started = performance.now();
  const checks = [checkCrypto(), await checkStorage(), await checkDeviceId()];
  const ok = checks.every((check) => check.ok);
  const ms = (performance.now() - started).toFixed(1);
  const line = `[even] self-check ${ok ? 'ok' : 'FAILED'} in ${ms} ms | ${checks.map((c) => c.summary).join(' | ')}`;
  if (ok) console.log(line);
  else console.error(line);
}

/** Starts the checks and returns at once; the line is logged when they finish. */
export function runStartupSelfCheck(): void {
  runChecks().catch((error: unknown) => {
    // Only reachable if logging itself failed.
    try {
      console.error('[even] self-check could not run:', error);
    } catch {
      // Nothing left to report to.
    }
  });
}
