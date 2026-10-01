/**
 * Invite plumbing for the Join flow (design.md "Invites"): where an opened invite link goes, what a check of the code
 * field shows and whether the keyboard goes, the preview card's words (a new group, or one this phone is already in),
 * the copy for a code that cannot be used, the line under Join when a
 * usable invite still cannot be joined, and the confirmation for an invite that names a group this phone holds on
 * another server. Pure.
 */
import { PROTOCOL } from '@even/core';

import { hrefs } from '@/features/groups/routes';
import type { InvitePreview, InviteProblem, JoinResult, PreviewResult } from '@/state';

import type { SyncErrorCode } from '../../services/sync/types';

/** `https://even.appalaya.com/i`, lower case: an invite link up to its `#`, which may also end in `/`. */
const INVITE_LINK = `${PROTOCOL.inviteHost}${PROTOCOL.invitePath}`.toLowerCase();

/**
 * The fragment of an invite link on the invite host, as written: the text after the `#` of
 * `https://even.appalaya.com/i#<code>` or `/i/#<code>` (scheme and host in any case), or null for any other text,
 * `even://` links included, since they never carry a payload (design.md "Invites"). The scanner and an opened link
 * both read links with this.
 */
export function inviteLinkFragment(text: string): string | null {
  const hash = text.indexOf('#');
  if (hash === -1) return null;
  const base = text.slice(0, hash).toLowerCase();
  if (base !== INVITE_LINK && base !== `${INVITE_LINK}/`) return null;
  return text.slice(hash + 1);
}

/**
 * The payload of an opened invite link (`https://even.appalaya.com/i#<payload>`, also `/i/#`), trimmed and, if it
 * was percent-encoded, decoded; null when the URL is not an invite link or carries no payload.
 */
export function payloadFromUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const fragment = inviteLinkFragment(url.trim());
  if (fragment === null) return null;
  let payload = fragment.trim();
  try {
    payload = decodeURIComponent(payload);
  } catch {
    // Not percent-encoded: use it as it is.
  }
  return payload === '' ? null : payload;
}

/**
 * Where a URL the system opens the app with goes (`+native-intent`, design.md "Invites" → Open): an invite link with a
 * payload goes straight to Join with it as the `code` param (`/join?code=<payload>`), so the code travels in the route
 * and nothing has to catch the link after the route mounts. Anything else comes back unchanged for the router, a
 * payload-less `/i` included (its route goes to Groups).
 */
export function routeForSystemUrl(url: string): string {
  const code = payloadFromUrl(url);
  return code === null ? url : (hrefs.joinWithCode(code) as string);
}

/** The code field's text as checked: nothing to show yet, an invite that reads, or one that cannot be used. */
export type CodeState =
  | { kind: 'empty' }
  | { kind: 'read'; invite: InvitePreview }
  /** `update`: the invite needs a newer Even; offer the store. */
  | { kind: 'error'; message: string; update?: boolean };

/** What the code sheet does with a check of the field's text (`afterCheck`). */
export interface CheckOutcome {
  /** The preview card for a code that reads, or the line under the field for one that cannot be used. */
  code: CodeState;
  /**
   * Put the keyboard away. A code that reads is complete and nothing is left to type, so the keyboard goes and the
   * preview card and Join (or Open) show; up, it covered them after a paste or a scan. A code that cannot be used keeps
   * the keyboard, to paste or type it again.
   */
  dismissKeyboard: boolean;
}

/** The outcome of checking the field's text (`previewInvite`), pasted, typed, scanned, or handed over by a link. */
export function afterCheck(result: PreviewResult): CheckOutcome {
  if (result.ok) return { code: { kind: 'read', invite: result.invite }, dismissKeyboard: true };
  return {
    code: {
      kind: 'error',
      message: problemMessage(result.error),
      update: result.error === 'version',
    },
    dismissKeyboard: false,
  };
}

/** The preview card's words and its button (JoinCodePreview, JoinCodeHeld). */
export interface PreviewCopy {
  /** The small line with the check: "Code complete" or "You're already in". */
  status: string;
  /** "Join Banff 2026?", or the group's name alone when this phone is already in it. */
  title: string;
  /** The button at the foot: "Join" or "Open". */
  action: string;
}

/**
 * What the preview card says for an invite that reads. A group this phone already holds on the invite's server
 * (`fit` `already`, JoinCodeHeld): "You're already in", the group's name as this phone knows it, and Open, which goes
 * where Join goes for it (the group, or the name pick while this phone has no seat). Anything else reads as a new
 * invite (JoinCodePreview): a held group on another server asks to move after Join ("Already have it"), one closed
 * here says after Join that its invite was regenerated.
 */
export function previewCopy(invite: Pick<InvitePreview, 'name' | 'local' | 'fit'>): PreviewCopy {
  if (invite.fit === 'already') {
    const known = invite.local?.name?.trim() ? invite.local.name : null;
    return {
      status: "You're already in",
      title: known ?? invite.name ?? 'a group',
      action: 'Open',
    };
  }
  return { status: 'Code complete', title: `Join ${invite.name ?? 'a group'}?`, action: 'Join' };
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
