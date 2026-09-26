/**
 * On-device check of the expo-sqlite path, which no Node test can cover: open a scratch database through the
 * same driver, pragmas, migrations, and store the app uses; write one group and one event; read them back;
 * close and delete the file. Returns one line for the startup self-check to log. Never throws.
 *
 * Uses its own database file, never `even.db`, so it cannot touch the user's groups.
 */
import {
  b64urlEncode,
  deriveLocal,
  newId,
  newSecret,
  PROTOCOL,
  randomBytes,
  type Envelope,
} from '@even/core';
import * as SQLite from 'expo-sqlite';

import { openExpoDriver } from './expoDriver';
import { readSchemaVersion } from './schema';
import { envelopeText, openSqliteStore } from './sqliteStore';

const SMOKE_DATABASE = 'even-smoke.db';

export async function runStorageSmokeTest(): Promise<string> {
  const started = performance.now();
  try {
    await SQLite.deleteDatabaseAsync(SMOKE_DATABASE).catch(() => undefined);
    const driver = await openExpoDriver(SMOKE_DATABASE);
    const store = await openSqliteStore(driver);
    try {
      const journal = (await driver.get<{ journal_mode: string }>('PRAGMA journal_mode'))
        ?.journal_mode;
      const foreignKeys = (await driver.get<{ foreign_keys: number }>('PRAGMA foreign_keys'))
        ?.foreign_keys;
      const version = await readSchemaVersion(driver);

      const { localId } = deriveLocal(newSecret());
      await store.upsertGroup({
        localId,
        serverUrl: PROTOCOL.defaultServer,
        epoch: null,
        cursor: 0,
        myMemberId: null,
        nameCache: 'Smoke test',
        currencyCache: 'EUR',
        createdAt: Date.now(),
        lastSyncedAt: null,
        lastSyncError: null,
        state: 'active',
        epochResetsThisCycle: 0,
      });
      // Structurally valid v1 envelope; the store checks shape, not ciphertext.
      const envelope: Envelope = {
        id: newId(),
        v: 1,
        n: b64urlEncode(randomBytes(24)),
        c: b64urlEncode(randomBytes(256)),
      };
      const { inserted } = await store.insertEvents(localId, [
        {
          id: envelope.id,
          origin: 'local',
          acked: false,
          seq: null,
          ts: Date.now(),
          envelope: envelopeText(envelope),
          status: 'ok',
        },
      ]);
      const [readBack] = await store.listReadable(localId);
      const outbox = await store.outbox(localId, 10);
      const ok =
        inserted.length === 1 &&
        readBack?.envelope.c === envelope.c &&
        outbox.length === 1 &&
        journal === 'wal' &&
        foreignKeys === 1;
      const ms = (performance.now() - started).toFixed(1);
      return `[even] storage smoke ${ok ? 'ok' : 'FAILED'}: schema v${version}, journal=${journal}, foreign_keys=${foreignKeys}, insert+read ${readBack ? 1 : 0} row, outbox ${outbox.length}, ${ms} ms`;
    } finally {
      await store.close();
      await SQLite.deleteDatabaseAsync(SMOKE_DATABASE).catch(() => undefined);
    }
  } catch (error) {
    return `[even] storage smoke FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }
}
