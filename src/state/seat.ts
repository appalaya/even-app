/**
 * Which seat is this phone's, read from the log. A device that claimed a member wrote `member.claimed` with its own
 * device id (design.md "Identity model"), and the device id lives in the secure store, which on iOS outlives an
 * uninstall. So a `groups` row that has lost its `my_member_id` (a keychain recovery after a reinstall, or leaving and
 * joining again) can find its seat again without asking. Pure: the Group screen and the GroupService both use it.
 */
import type { GroupState } from '@even/core';

/**
 * The one member (not archived, not a placeholder) whose claimed devices include `deviceId`, or null when there is
 * none or more than one (then the phone asks "Which name is yours?").
 */
export function deviceSeat(state: GroupState, deviceId: string): string | null {
  let seat: string | null = null;
  for (const member of state.members.values()) {
    if (member.archived || member.unknown || !member.devices.includes(deviceId)) continue;
    if (seat !== null) return null;
    seat = member.id;
  }
  return seat;
}
