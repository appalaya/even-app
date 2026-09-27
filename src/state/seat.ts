/**
 * Which seat is this phone's, read from the log. A device that claimed a member wrote `member.claimed` with its own
 * device id (design.md "Identity model"), and the device id lives in the secure store, which on iOS outlives an
 * uninstall. So a `groups` row that has lost its `my_member_id` (a keychain recovery after a reinstall, or leaving and
 * joining again) can find its seat again without asking. Pure: the Group screen and the GroupService both use it.
 */
import type { GroupState } from '@even/core';

/**
 * Every member (not archived, not a placeholder) whose claimed devices include `deviceId`, in member order. Two or
 * more happen when this phone claimed one name, lost its seat, and claimed another (SeatSameDevice: Maya and Maya K.).
 */
export function deviceSeats(state: GroupState, deviceId: string): string[] {
  const seats: string[] = [];
  for (const member of state.members.values()) {
    if (member.archived || member.unknown || !member.devices.includes(deviceId)) continue;
    seats.push(member.id);
  }
  return seats;
}

/**
 * The one member (not archived, not a placeholder) whose claimed devices include `deviceId`, or null when there is
 * none or more than one (then the phone asks "Which name is yours?").
 */
export function deviceSeat(state: GroupState, deviceId: string): string | null {
  const seats = deviceSeats(state, deviceId);
  return seats.length === 1 ? (seats[0] ?? null) : null;
}
