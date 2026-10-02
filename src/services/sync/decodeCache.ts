/**
 * What each envelope decrypted to this launch, per group and envelope id: one cache for the app, shared by the sync
 * engine (which opens every pulled envelope to classify it), the derived group state (which opens every readable
 * one to reduce the log) and the group service (rotation), so an envelope is opened once (pre-launch review H3: a
 * join used to open each one three times, in the pull, for the name cache and in the derive).
 *
 * Decrypted bodies only ever live in memory (design.md "Architecture Overview"), and this is where they live. An
 * entry holds the exact envelope text and the server group id it was opened for, and a lookup with other text or
 * another group id misses: a re-encryption for a move changes both, so an entry can never stand in for an envelope
 * that is not the one stored. A group's entries go when it is left (`drop`) and when a derive finds them no longer
 * stored (`retain`).
 */
import type { Event } from '@even/core';

export interface Decoded {
  /** The envelope text, exactly as stored. */
  text: string;
  /** The server group id it was opened for (part of the associated data). */
  groupId: string;
  /** The validated event, or null when the body did not open or did not validate. */
  event: Event | null;
  /** The opened body's `type`, when it has one: whether a skipped body was money. */
  type: string | null;
}

interface Entry extends Decoded {
  /** When it was put, for `retain`. */
  stamp: number;
}

export class DecodeCache {
  private readonly groups = new Map<string, Map<string, Entry>>();
  private stamp = 0;

  /** What envelope `id` of the group decrypted to, if it was opened from exactly `text` for `groupId`. */
  get(localId: string, id: string, text: string, groupId: string): Decoded | undefined {
    const entry = this.groups.get(localId)?.get(id);
    return entry !== undefined && entry.text === text && entry.groupId === groupId
      ? entry
      : undefined;
  }

  put(localId: string, id: string, decoded: Decoded): void {
    let group = this.groups.get(localId);
    if (group === undefined) {
      group = new Map();
      this.groups.set(localId, group);
    }
    this.stamp += 1;
    const { text, groupId, event, type } = decoded;
    group.set(id, { text, groupId, event, type, stamp: this.stamp });
  }

  /**
   * After a byte-exact re-encryption (`resealEnvelope`, a server move): the entry opened from `from` for
   * `fromGroupId` now stands for `to`, sealed for `toGroupId`. The body is the same bytes, so nothing is opened again.
   */
  resealed(
    localId: string,
    id: string,
    from: { text: string; groupId: string },
    to: { text: string; groupId: string },
  ): void {
    const entry = this.groups.get(localId)?.get(id);
    if (entry === undefined || entry.text !== from.text || entry.groupId !== from.groupId) return;
    this.put(localId, id, {
      text: to.text,
      groupId: to.groupId,
      event: entry.event,
      type: entry.type,
    });
  }

  /** A point to pass to `retain`: entries put after it are kept whatever the derive saw. */
  mark(): number {
    return this.stamp;
  }

  /**
   * Keeps the group's entries for the envelope ids in `ids` and any put after `since` (a sync committing a page
   * while a derive ran), and drops the rest: envelopes no longer stored, or not readable now.
   */
  retain(localId: string, ids: ReadonlySet<string>, since: number): void {
    const group = this.groups.get(localId);
    if (group === undefined) return;
    for (const [id, entry] of group) {
      if (!ids.has(id) && entry.stamp <= since) group.delete(id);
    }
    if (group.size === 0) this.groups.delete(localId);
  }

  /** Forgets a group (Leave). */
  drop(localId: string): void {
    this.groups.delete(localId);
  }

  clear(): void {
    this.groups.clear();
  }

  /** Entries held for a group. */
  size(localId: string): number {
    return this.groups.get(localId)?.size ?? 0;
  }
}
