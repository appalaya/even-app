import { describe, expect, it } from 'vitest';

import type { JoinResult } from '@/state';

import type { SyncErrorCode } from '../../services/sync/types';

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

  it('words a join the server refused, or one whose call threw (JoinCodeRefused)', () => {
    expect(joinFailureMessage('group_blocked')).toBe(
      "This group is blocked on its server, so you can't join it.",
    );
    expect(joinFailureMessage('not_an_even_server')).toBe(
      "That URL isn't an Even server. Check the address.",
    );
    expect(joinFailureMessage('unsupported_version')).toBe('This server needs updating.');
    expect(joinFailureMessage('unknown')).toBe("Couldn't join. Try again.");
  });

  it("takes only a reachable server's refusal of a fresh join as a failure", () => {
    const joined = (
      firstSync: Extract<JoinResult, { kind: 'joined' }>['firstSync'],
    ): JoinResult => ({
      kind: 'joined',
      localId: 'g1',
      needsClaim: true,
      firstSync,
      waiting: firstSync.outcome !== 'synced',
    });
    const failed = (error: SyncErrorCode) =>
      joinFailureOf(joined({ localId: 'g1', outcome: 'failed', error, retryAt: null }));
    expect(failed('group_blocked')).toBe('group_blocked');
    expect(failed('not_an_even_server')).toBe('not_an_even_server');
    expect(failed('unsupported_version')).toBe('unsupported_version');
    // No answer, or no definitive one: the join goes on as "Joined, waiting for first sync".
    for (const error of [
      'network',
      'server_error',
      'rate_limited',
      'over_budget',
      'local_error',
    ] as const) {
      expect(failed(error)).toBeNull();
    }
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
