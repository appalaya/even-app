/**
 * Builders for storage tests and for the sync engine's fakes. Plain TypeScript (no Node imports), but only
 * tests should import it: the envelopes are structurally valid v1 envelopes around random bytes, not
 * ciphertext.
 */
import { b64urlEncode, newId, PROTOCOL, randomBytes, type Envelope } from '@even/core';

import { envelopeText } from './sqliteStore';
import type { GroupRow, NewEventRow } from './types';

export function newLocalId(): string {
  return b64urlEncode(randomBytes(32));
}

export function makeGroup(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    localId: newLocalId(),
    serverUrl: PROTOCOL.defaultServer,
    epoch: null,
    cursor: 0,
    myMemberId: null,
    nameCache: 'Banff 2026',
    currencyCache: 'CAD',
    createdAt: 1_760_000_000_000,
    lastSyncedAt: null,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
    ...overrides,
  };
}

export function makeEnvelope(id: string = newId(), v = 1): Envelope {
  return { id, v: v as 1, n: b64urlEncode(randomBytes(24)), c: b64urlEncode(randomBytes(256)) };
}

/** A row as a local write stores it: `origin 'local'`, unacked, status `ok`. */
export function localRow(ts: number, overrides: Partial<NewEventRow> = {}): NewEventRow {
  const id = overrides.id ?? newId();
  return {
    id,
    origin: 'local',
    acked: false,
    seq: null,
    ts,
    envelope: envelopeText(makeEnvelope(id)),
    status: 'ok',
    ...overrides,
  };
}

/** A row as a pull stores it: `origin 'remote'`, acked, with `seq`. */
export function pulledRow(
  seq: number,
  ts: number | null,
  overrides: Partial<NewEventRow> = {},
): NewEventRow {
  const id = overrides.id ?? newId();
  return {
    id,
    origin: 'remote',
    acked: true,
    seq,
    ts,
    envelope: envelopeText(makeEnvelope(id)),
    status: ts === null ? 'undecryptable' : 'ok',
    ...overrides,
  };
}
