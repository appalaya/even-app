/**
 * Invite plumbing for the Join flow (design.md "Invites"): the `/i` route's fragment, the copy for a code that cannot
 * be used, the line under Join when a usable invite still cannot be joined, and the confirmation for an invite that
 * names a group this phone holds on another server. Pure.
 */
import type { InviteProblem, JoinResult } from '@/state';

import type { SyncErrorCode } from '../../services/sync/types';

/**
 * The payload of an invite link: everything after the first `#` of `https://even.appalaya.com/i#<payload>` (also
 * `/i/#`), or null when the URL carries none. The router may not surface fragments, so `/i` parses the full URL
 * itself (`Linking.useURL()`); `even://` never carries a payload.
 */
export function payloadFromUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const hash = url.indexOf('#');
  if (hash === -1) return null;
  let payload = url.slice(hash + 1).trim();
  try {
    payload = decodeURIComponent(payload);
  } catch {
    // Not percent-encoded: use it as it is.
  }
  return payload === '' ? null : payload;
}

/**
 * The line under the code field when a pasted code cannot be used, as the error-copy panel words it (Groups, create
 * and join, extra states): a damaged or cut-short code, or one for a newer Even (which also offers Update).
 */
export function problemMessage(problem: InviteProblem): string {
  switch (problem) {
    case 'checksum':
    case 'malformed':
    case 'server':
      return "That code isn't complete. Copy it again.";
    case 'version':
      return 'This invite needs a newer Even.';
  }
}

/** The host of a canonical server URL ("https://sync.even.appalaya.com" → "sync.even.appalaya.com"). */
export function hostOf(serverUrl: string): string {
  return serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
}

/** The move confirmation (design.md "Already have it"): "Move Banff 2026 from <old host> to <new host>?" */
export function moveQuestion(name: string, fromServer: string, toServer: string): string {
  return `Move ${name} from ${hostOf(fromServer)} to ${hostOf(toServer)}?`;
}

/** The first-launch recovery offer: "Recover 2 groups?" */
export function recoverQuestion(count: number): string {
  return `Recover ${count} ${count === 1 ? 'group' : 'groups'}?`;
}

/**
 * A first sync's definitive answer from a reachable server that the group cannot be joined there. Anything else
 * (no answer at all, a 5xx, a rate limit) leaves the join as it is: "Joined, waiting for first sync".
 */
const REFUSALS = ['group_blocked', 'not_an_even_server', 'unsupported_version'] as const;
type JoinRefusal = (typeof REFUSALS)[number];

/** Why Join did not go through for an invite that reads: the server's refusal, or `unknown` when the call threw. */
export type JoinFailure = JoinRefusal | 'unknown';

function isRefusal(error: SyncErrorCode): error is JoinRefusal {
  return (REFUSALS as readonly SyncErrorCode[]).includes(error);
}

/**
 * The server's refusal of a fresh join (its first sync failed with one), or null when the join goes on: it synced,
 * it waits for the server (unreachable, or any other failure), or it was not a fresh join at all.
 */
export function joinFailureOf(result: JoinResult): JoinRefusal | null {
  if (result.kind !== 'joined' || result.firstSync.outcome !== 'failed') return null;
  return isRefusal(result.firstSync.error) ? result.firstSync.error : null;
}

/**
 * The line under Join when a usable invite cannot be joined (JoinCodeRefused): the server refuses the group, is not
 * an Even server, or needs updating; a join call that threw is "Couldn't join".
 */
export function joinFailureMessage(failure: JoinFailure): string {
  switch (failure) {
    case 'group_blocked':
      return "This group is blocked on its server, so you can't join it.";
    case 'not_an_even_server':
      return "That URL isn't an Even server. Check the address.";
    case 'unsupported_version':
      return 'This server needs updating.';
    case 'unknown':
      return "Couldn't join. Try again.";
  }
}
