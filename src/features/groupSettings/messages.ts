/**
 * Sentences for what can go wrong in Group settings. Where design.md has the words they are used as written
 * ("Check your phone's date", "That URL isn't an Even server. Check the address.", "Can't reach this group's
 * server"); the rest are plain statements of the state layer's error codes. No board draws these alerts.
 */
import { LIMITS } from '@even/core';

import { isStateError } from '../../state';
import type { MoveResult } from '../../state';

export function errorMessage(error: unknown, name?: string): string {
  if (isStateError(error)) {
    switch (error.code) {
      case 'name_taken':
        return name === undefined
          ? 'Someone here already has that name.'
          : `Someone here is already called ${name.trim()}.`;
      case 'members_full':
        return `A group has at most ${LIMITS.membersMax} members.`;
      case 'invalid':
        return `A name is 1 to ${LIMITS.nameMax} characters.`;
      case 'read_only':
        return 'This group is read-only.';
      case 'clock':
        return "Check your phone's date.";
      case 'not_claimed':
        return 'Pick your name in this group first.';
      case 'not_allowed':
        return "Another member's name and avatar are theirs to change.";
      case 'no_secret':
        return "This phone can't write to this group.";
      case 'invalid_url':
        return "That URL isn't an Even server. Check the address.";
      default:
        break;
    }
  }
  return "That didn't work. Try again.";
}

/** Why a move did not happen, or null when it did. */
export function moveFailure(result: MoveResult, host: string): string | null {
  if (result.outcome === 'moved') return null;
  switch (result.error) {
    case 'not_acknowledged':
      return `Can't reach this group's server (${host}). Try again when you're online.`;
    case 'invalid_url':
      return "That URL isn't an Even server. Check the address.";
    case 'same_server':
      return `This group already syncs through ${host}.`;
    case 'in_flight':
      return 'This group is already moving.';
    case 'not_movable':
      return 'This group is read-only.';
    case 'no_secret':
      return "This phone can't write to this group.";
    default:
      return "That didn't work. Try again.";
  }
}
