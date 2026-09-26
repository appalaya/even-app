/**
 * From a background cycle's results to the notifications to post: reads each synced group's derived state (the
 * activity feed, decrypted in memory only) and plans one notification per group with `planGroupNotification`.
 * No Expo imports (local.ts posts them), so the whole path is tested in Node against the state layer's harness.
 */
import type { SyncResult } from '../sync/types';
import type { GroupStateStore } from '../../state/groupState';
import {
  planGroupNotification,
  type PlannedNotification,
  type ShownNotification,
} from './coalesce';

export interface ActivitySource {
  groupState: Pick<GroupStateStore, 'get'>;
  /** This install's device id. */
  deviceId: string;
}

export async function planActivityNotifications(
  source: ActivitySource,
  results: readonly SyncResult[],
  shown: (localId: string) => ShownNotification | null = () => null,
): Promise<PlannedNotification[]> {
  const planned: PlannedNotification[] = [];
  for (const result of results) {
    if (result.outcome !== 'synced' || result.newOkIds.length === 0) continue;
    const derived = await source.groupState.get(result.localId);
    if (derived?.state == null) continue;
    // A group rotated away or hidden meanwhile is no longer one the user reads.
    if (derived.readOnly === 'hidden' || derived.readOnly === 'closed') continue;
    const plan = planGroupNotification({
      localId: result.localId,
      groupName: derived.name,
      deviceId: source.deviceId,
      activity: derived.state.activity,
      newOkIds: result.newOkIds,
      shown: shown(result.localId),
    });
    if (plan !== null) planned.push(plan);
  }
  return planned;
}
