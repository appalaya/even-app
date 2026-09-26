/**
 * Invite plumbing for the Join flow (design.md "Invites"): the `/i` route's fragment, the copy for a code that cannot
 * be used, and the confirmation for an invite that names a group this phone holds on another server. Pure.
 */
import type { InviteProblem } from '@/state';

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
 * The line under the code field when a pasted code cannot be used. JoinCodeError draws the checksum case; the
 * boards draw no other, so every problem shows the same line (listed in the stack report).
 */
export function problemMessage(problem: InviteProblem): string {
  switch (problem) {
    case 'checksum':
    case 'malformed':
    case 'server':
    case 'version':
      return "That code isn't complete. Copy it again.";
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

/** The first-launch recovery offer: "Recover 2 groups from your keychain?" */
export function recoverQuestion(count: number): string {
  return `Recover ${count} ${count === 1 ? 'group' : 'groups'} from your keychain?`;
}
