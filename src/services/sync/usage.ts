/**
 * Usage meter (design.md "Error handling" → "Usage meter"): the group's own envelope sizes against the server's
 * published caps, for group settings, with a warning at 80%. Sizes follow PROTOCOL.md §4's stored size
 * (decoded `c` + 64), the same definition the server enforces.
 */
import type { Store } from '../storage/types';
import type { ServerInfo } from './types';

export const USAGE_WARN_FRACTION = 0.8;

export interface GroupUsage {
  /** Sum of stored sizes of this group's envelopes. */
  bytes: number;
  /** Envelopes counted. */
  events: number;
  maxBytes: number;
  maxEvents: number;
  /** `bytes / maxBytes`, 0..1+ (can exceed 1 after a move to a server with smaller caps). */
  bytesFraction: number;
  /** `events / maxEvents`. */
  eventsFraction: number;
  /** The larger of the two: what the meter shows. */
  fraction: number;
  /** `fraction ≥ 0.8`. */
  warn: boolean;
}

/**
 * Counts every stored envelope that a server would hold. Rows that are not structurally valid envelopes (junk
 * pulled as `undecryptable`) are never accepted by a server and are not counted. One SQL sum over each row's stored
 * size (`events.size`), kept since the row was written: no envelope is read or parsed (pre-launch review H3).
 */
export async function groupUsage(
  store: Pick<Store, 'usage'>,
  localId: string,
  info: ServerInfo,
): Promise<GroupUsage> {
  const { bytes, events } = await store.usage(localId);
  const maxBytes = info.limits.max_group_bytes;
  const maxEvents = info.limits.max_group_events;
  const bytesFraction = maxBytes > 0 ? bytes / maxBytes : 0;
  const eventsFraction = maxEvents > 0 ? events / maxEvents : 0;
  const fraction = Math.max(bytesFraction, eventsFraction);
  return {
    bytes,
    events,
    maxBytes,
    maxEvents,
    bytesFraction,
    eventsFraction,
    fraction,
    warn: fraction >= USAGE_WARN_FRACTION,
  };
}
