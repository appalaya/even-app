import { describe, expect, it } from 'vitest';

import type { JoinResult } from '@/state';

import {
  hostOf,
  joinFailureMessage,
  joinFailureOf,
  moveQuestion,
  payloadFromUrl,
  problemMessage,
  recoverQuestion,
} from './invite';

describe('join invite helpers', () => {
  it('takes the payload from an invite link', () => {
    expect(payloadFromUrl('https://even.appalaya.com/i#eyJ2IjoxfQ')).toBe('eyJ2IjoxfQ');
    expect(payloadFromUrl('https://even.appalaya.com/i/#xyz')).toBe('xyz');
    expect(payloadFromUrl('https://even.appalaya.com/i')).toBeNull();
    expect(payloadFromUrl('https://even.appalaya.com/i#')).toBeNull();
    expect(payloadFromUrl(null)).toBeNull();
  });

  it('words the checksum problem as the board does', () => {
    expect(problemMessage('checksum')).toBe("That code isn't complete. Copy it again.");
    expect(problemMessage('version')).toBe('This invite needs a newer Even.');
  });

  it('words the move and recovery confirmations', () => {
    expect(hostOf('https://sync.even.appalaya.com')).toBe('sync.even.appalaya.com');
    expect(
      moveQuestion('Banff 2026', 'https://sync.even.appalaya.com', 'https://sync.example.net'),
    ).toBe('Move Banff 2026 from sync.even.appalaya.com to sync.example.net?');
    expect(recoverQuestion(2)).toBe('Recover 2 groups?');
    expect(recoverQuestion(1)).toBe('Recover 1 group?');
  });

  it('words a join that could not go through (JoinCodeFailed, JoinCodeRefused)', () => {
    const host = 'sync.even.appalaya.com';
    expect(joinFailureMessage('network', host)).toBe(
      "Couldn't reach sync.even.appalaya.com. Check your connection and try again.",
    );
    expect(joinFailureMessage('group_blocked', host)).toBe(
      "This group is blocked on its server, so you can't join it.",
    );
    expect(joinFailureMessage('not_an_even_server', host)).toBe(
      "That URL isn't an Even server. Check the address.",
    );
    expect(joinFailureMessage('unsupported_version', host)).toBe('This server needs updating.');
    for (const other of ['server_error', 'rate_limited', 'local_error', 'unknown'] as const) {
      expect(joinFailureMessage(other, host)).toBe("Couldn't join. Try again.");
    }
  });

  it('takes the failure from a fresh join whose first sync failed, and only from that', () => {
    const joined = (
      firstSync: Extract<JoinResult, { kind: 'joined' }>['firstSync'],
    ): JoinResult => ({
      kind: 'joined',
      localId: 'g1',
      needsClaim: true,
      firstSync,
      waiting: firstSync.outcome !== 'synced',
    });
    expect(
      joinFailureOf(joined({ localId: 'g1', outcome: 'failed', error: 'network', retryAt: 5 })),
    ).toBe('network');
    expect(
      joinFailureOf(
        joined({ localId: 'g1', outcome: 'failed', error: 'group_blocked', retryAt: null }),
      ),
    ).toBe('group_blocked');
    expect(
      joinFailureOf(
        joined({
          localId: 'g1',
          outcome: 'synced',
          pushed: 0,
          pulled: 3,
          newOkIds: [],
          epochResets: 0,
          at: 1,
        }),
      ),
    ).toBeNull();
    // A cycle already running for the group is not a failure: the join goes on and waits for it.
    expect(
      joinFailureOf(joined({ localId: 'g1', outcome: 'skipped', reason: 'in_flight' })),
    ).toBeNull();
    expect(joinFailureOf({ kind: 'already', localId: 'g1' })).toBeNull();
    expect(joinFailureOf({ kind: 'closedGroupInvite', localId: 'g1', state: 'closed' })).toBeNull();
  });
});
