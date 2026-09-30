/**
 * What the invite scanner accepts (JoinScan, JoinScanNotInvite, JoinScanFound). Pure.
 *
 * A QR code is an Even invite when its text is a bare invite code or an invite link on the invite host
 * (`https://even.appalaya.com/i#<code>`, also `/i/#`), and the code decodes as an invite. The `even://` scheme is not
 * accepted: it never carries a payload (design.md "Invites"). Anything else, a web page, a Wi-Fi code, a code that is
 * not an invite, is "That QR code isn't an Even invite." and the scanner keeps looking.
 *
 * A code shaped like an invite that still cannot be used (a newer invite version, a checksum or server problem) counts
 * as found: Join with code then names the problem as it does for a pasted code ("This invite needs a newer Even.").
 */
import { decodeInvite, InviteError, isB64url } from '@even/core';

import { inviteLinkFragment } from './invite';

export type ScanVerdict =
  /**
   * `code`: the bare code, for the code field (JoinScanFound leads to JoinCodePreview, which shows the code, not the
   * link); `previewInvite` then reads it as it reads a pasted one.
   */
  { kind: 'invite'; code: string } | { kind: 'notInvite' };

const NOT_INVITE: ScanVerdict = { kind: 'notInvite' };

/** The code in a scanned text: the fragment of an invite link on the invite host, or the text itself if bare. */
function codeOf(text: string): string | null {
  if (!text.includes('#')) return isB64url(text) ? text : null;
  const code = inviteLinkFragment(text);
  return code !== null && isB64url(code) ? code : null;
}

/** Whether a scanned QR code's text is an Even invite. */
export function readScan(raw: string): ScanVerdict {
  const text = raw.trim();
  const code = codeOf(text);
  if (code === null || code === '') return NOT_INVITE;
  try {
    decodeInvite(code);
  } catch (error) {
    if (!(error instanceof InviteError)) return NOT_INVITE;
    if (error.code === 'malformed' || error.code === 'secret') return NOT_INVITE;
  }
  return { kind: 'invite', code };
}
