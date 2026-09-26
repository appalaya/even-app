/**
 * The one error type the state layer throws on purpose. Screens switch on `code`; `message` is for logs only and
 * never carries a body, a secret, or a token.
 */
import { EnvelopeError, InviteError } from '@even/core';

/** Why an invite (a pasted code, a link, or a group file's invite) cannot be used. */
export type InviteProblem =
  /** "That code isn't complete. Copy it again." */
  | 'checksum'
  /** Not an Even invite at all (bad base64url, not JSON, missing fields, bad secret). */
  | 'malformed'
  /** The server URL in it is not a valid https origin. */
  | 'server'
  /** A newer invite version: "Update Even". */
  | 'version';

export type StateErrorCode =
  | InviteProblem
  /** No such group, member, expense, payment, or history entry. */
  | 'not_found'
  /** This device has not picked its member yet ("Which one are you?"), so it cannot sign events. */
  | 'not_claimed'
  /** The permission rules forbid it (another joined member's seat, archiving yourself). */
  | 'not_allowed'
  /** A non-archived member already has this name (case-insensitive, trimmed). */
  | 'name_taken'
  /** The group already has LIMITS.membersMax members. */
  | 'members_full'
  /** The group is closed (rotated away), hidden, or archived. */
  | 'read_only'
  /** The device clock is outside the validator's range: "Check your phone's date." */
  | 'clock'
  /** A field fails validation (title, amount, date, name, emoji, …); `message` names it. */
  | 'invalid'
  /** The split does not resolve to a valid split of the amount. */
  | 'invalid_split'
  /** The sealed event would exceed the size limit (cannot happen for valid events; defensive). */
  | 'too_large'
  /** This phone has the group's row but not its secret. */
  | 'no_secret'
  /** A server URL that is not a valid https origin. */
  | 'invalid_url';

export class StateError extends Error {
  readonly code: StateErrorCode;

  constructor(code: StateErrorCode, message?: string) {
    super(message === undefined ? code : `${code}: ${message}`);
    this.name = 'StateError';
    this.code = code;
  }
}

export function isStateError(error: unknown, code?: StateErrorCode): error is StateError {
  return error instanceof StateError && (code === undefined || error.code === code);
}

/** Maps core's `InviteError` codes onto the three the UI distinguishes, plus `version`. */
export function inviteProblemOf(error: unknown): InviteProblem {
  if (error instanceof InviteError) {
    switch (error.code) {
      case 'checksum':
        return 'checksum';
      case 'server':
        return 'server';
      case 'version':
        return 'version';
      case 'malformed':
      case 'secret':
        return 'malformed';
    }
  }
  return 'malformed';
}

/** Rethrows core's `EnvelopeError('too_large')` as a `StateError`; anything else unchanged. */
export function fromSealError(error: unknown): unknown {
  if (error instanceof EnvelopeError && error.code === 'too_large') {
    return new StateError('too_large', 'the event is larger than the server accepts');
  }
  return error;
}
