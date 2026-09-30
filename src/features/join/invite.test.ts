import { decodeInvite, encodeInvite, inviteLink, makeInvite } from '@even/core';
import { describe, expect, it } from 'vitest';

import type { JoinResult } from '@/state';

import type { SyncErrorCode } from '../../services/sync/types';

import {
  hostOf,
  inviteLinkFragment,
  joinFailureMessage,
  joinFailureOf,
  moveQuestion,
  payloadFromUrl,
  problemMessage,
  recoverQuestion,
  routeForSystemUrl,
} from './invite';

const code = encodeInvite(
  makeInvite(new Uint8Array(32).fill(7), 'https://sync.example.net', {
    g: 'Banff 2026',
    cur: 'CAD',
  }),
);

describe('join invite helpers', () => {
  it('takes the payload from an invite link', () => {
    expect(payloadFromUrl('https://even.appalaya.com/i#eyJ2IjoxfQ')).toBe('eyJ2IjoxfQ');
    expect(payloadFromUrl('https://even.appalaya.com/i/#xyz')).toBe('xyz');
    expect(payloadFromUrl('https://even.appalaya.com/i')).toBeNull();
    expect(payloadFromUrl('https://even.appalaya.com/i#')).toBeNull();
    expect(payloadFromUrl(null)).toBeNull();
  });

  it('reads a payload only from an invite link on the invite host, never from even://', () => {
    expect(payloadFromUrl(inviteLink(code))).toBe(code);
    expect(payloadFromUrl(`HTTPS://EVEN.APPALAYA.COM/i#${code}`)).toBe(code);
    expect(payloadFromUrl(` https://even.appalaya.com/i# ${code}\n`)).toBe(code);
    expect(payloadFromUrl(`https://even.appalaya.com/i#${encodeURIComponent('a b')}`)).toBe('a b');
    expect(payloadFromUrl(`https://example.com/i#${code}`)).toBeNull();
    expect(payloadFromUrl(`https://even.appalaya.com/join#${code}`)).toBeNull();
    expect(payloadFromUrl(`http://even.appalaya.com/i#${code}`)).toBeNull();
    expect(payloadFromUrl(`even://i#${code}`)).toBeNull();
    expect(payloadFromUrl(`even://join#${code}`)).toBeNull();
    expect(payloadFromUrl('even://join')).toBeNull();
  });

  it('gives the fragment of an invite link as written', () => {
    expect(inviteLinkFragment(`https://even.appalaya.com/i#${code}`)).toBe(code);
    expect(inviteLinkFragment('https://even.appalaya.com/i/#%20x ')).toBe('%20x ');
    expect(inviteLinkFragment('https://even.appalaya.com/i#')).toBe('');
    expect(inviteLinkFragment('https://even.appalaya.com/i')).toBeNull();
    expect(inviteLinkFragment(code)).toBeNull();
  });

  it('sends an opened invite link straight to Join with its code, and leaves every other URL to the router', () => {
    const route = routeForSystemUrl(inviteLink(code));
    expect(route).toBe(`/join?code=${code}`);
    // The code survives the trip through the route's query intact.
    const param = new URLSearchParams(route.slice(route.indexOf('?'))).get('code');
    expect(param).toBe(code);
    expect(decodeInvite(param ?? '')).toEqual(decodeInvite(code));
    expect(routeForSystemUrl(`https://even.appalaya.com/i/#${code}`)).toBe(`/join?code=${code}`);
    // A payload with characters a query cannot carry as they are is encoded for it.
    expect(routeForSystemUrl('https://even.appalaya.com/i#a&b=c')).toBe('/join?code=a%26b%3Dc');

    // Payload-less, not an invite link, or even:// (which never carries a payload): unchanged.
    for (const url of [
      'https://even.appalaya.com/i',
      'https://even.appalaya.com/i#',
      'https://even.appalaya.com/i/',
      `https://example.com/i#${code}`,
      'even://join',
      `even://i#${code}`,
      'even:///',
      'even://dev/seed?state=groups',
      '/settings',
    ]) {
      expect(routeForSystemUrl(url)).toBe(url);
    }
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
