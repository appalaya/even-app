/**
 * "Has the server acknowledged this event yet?" The store answers it only through the outbox query
 * (`acked = 0 AND push_state = 'pending'`, ordered by `ts` then `id`), so this probes the outbox from its head and
 * stops as soon as it has read past the newest `ts` of interest. The events asked about are almost always at the
 * head (the group's first events, or a closure just pushed), so this is usually one small read.
 */
import type { Store } from '../services/storage/types';

const FIRST_PROBE = 16;

/**
 * The subset of `ids` still waiting in the group's outbox. `maxTs` is the largest cached `ts` among them; outbox
 * rows sort by `ts` ascending (null last), so once a row past it is read, none of `ids` can follow.
 */
export async function pendingAmong(
  store: Pick<Store, 'outbox'>,
  localId: string,
  ids: readonly string[],
  maxTs: number,
): Promise<Set<string>> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return new Set();
  for (let limit = FIRST_PROBE; ; limit *= 2) {
    const rows = await store.outbox(localId, limit);
    const pending = new Set(rows.filter((row) => wanted.has(row.id)).map((row) => row.id));
    const last = rows[rows.length - 1];
    if (
      pending.size === wanted.size ||
      rows.length < limit ||
      last === undefined ||
      last.ts === null ||
      last.ts > maxTs
    ) {
      return pending;
    }
  }
}

/** True once every id has left the outbox (acknowledged, or rejected by the server). */
export async function allAcked(
  store: Pick<Store, 'outbox'>,
  localId: string,
  ids: readonly string[],
  maxTs: number,
): Promise<boolean> {
  return (await pendingAmong(store, localId, ids, maxTs)).size === 0;
}
