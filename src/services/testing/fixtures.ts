/**
 * Builders for sync tests: a group's keys, a `groups` row, valid event bodies, sealed envelopes, and local writes
 * inserted the way the app's write path does (origin `local`, unacked, `ts` cached).
 */
import {
  deriveLocal,
  deriveServer,
  newId,
  newSecret,
  seal,
  type Envelope,
  type Event,
} from '@even/core';

import type { GroupRow, Store } from '../storage/types';

export const TEST_SERVER = 'https://sync.test';

export interface GroupKeys {
  secret: Uint8Array;
  localId: string;
  key: Uint8Array;
  serverUrl: string;
  groupId: string;
  token: Uint8Array;
}

export function groupKeys(serverUrl = TEST_SERVER, secret = newSecret()): GroupKeys {
  const { encryptionKey, localId } = deriveLocal(secret);
  const { authToken, groupId } = deriveServer(secret, serverUrl);
  return { secret, localId, key: encryptionKey, serverUrl, groupId, token: authToken };
}

export function groupRow(keys: GroupKeys, overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    localId: keys.localId,
    serverUrl: keys.serverUrl,
    epoch: null,
    cursor: 0,
    myMemberId: null,
    nameCache: null,
    currencyCache: null,
    createdAt: 1_760_000_000_000,
    lastSyncedAt: null,
    lastSyncError: null,
    state: 'active',
    epochResetsThisCycle: 0,
    ...overrides,
  };
}

/** Valid event bodies with increasing `ts`, one author and device. */
export class Events {
  readonly by = newId();
  readonly dev = newId();
  constructor(private ts = 1_760_000_000_000) {}

  private base(): { sv: 1; ts: number; at: number; by: string; dev: string } {
    this.ts += 1;
    return { sv: 1, ts: this.ts, at: this.ts, by: this.by, dev: this.dev };
  }

  created(name = 'Banff 2026', currency = 'CAD'): Event {
    return { ...this.base(), type: 'group.created', name, currency };
  }

  renamed(name: string): Event {
    return { ...this.base(), type: 'group.renamed', name };
  }

  member(name: string, id = newId()): Event {
    return { ...this.base(), type: 'member.added', member: { id, name } };
  }

  expense(title: string, amount = 1000, paidBy = this.by, currency = 'CAD'): Event {
    return {
      ...this.base(),
      type: 'expense.added',
      expense: {
        id: newId(),
        title,
        amount,
        currency,
        paidBy,
        date: '2026-01-15',
        category: 'food',
        split: { [paidBy]: amount },
      },
    };
  }
}

export function sealFor(keys: GroupKeys, body: unknown, id = newId()): Envelope {
  return seal({ key: keys.key, groupId: keys.groupId, body: body as Event, id });
}

/** A local write: sealed for the group's current server, inserted unacked with `origin: 'local'`. */
export async function writeLocal(store: Store, keys: GroupKeys, event: Event): Promise<string> {
  const envelope = sealFor(keys, event);
  await store.insertEvents(keys.localId, [
    {
      id: envelope.id,
      origin: 'local',
      acked: false,
      seq: null,
      ts: event.ts,
      envelope: JSON.stringify(envelope),
      status: 'ok',
    },
  ]);
  return envelope.id;
}
