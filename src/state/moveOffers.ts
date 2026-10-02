/**
 * MoveEntriesPrompt (design.md "Recognising a rotation"). Recognition used to copy this phone's own entries from a
 * rotated-away group into its successor without asking. Now, when there are such entries (origin `local`, readable,
 * not control events, missing from the new group), it asks once per rotation: "Move your Banff 2026 entries into the
 * new group?", over the new group. Move is the rescue as written; Not now copies and hides nothing, and the old group
 * stays on Groups, closed and read-only, with "Move entries" in its settings, which runs the same move. With no such
 * entries nothing is asked and the old group is hidden as before.
 *
 * The offers live in memory (recognition publishes them after each sync of either group, and at app start), with a
 * snapshot screens subscribe to. The one thing kept on disk is which old groups were answered Not now: the `prefs`
 * row `rotation.notNow`, a JSON array of local ids (nothing decrypted, as `notifications.ledger`).
 */
import type { Store } from '../services/storage/types';

export interface MoveOffer {
  /** The new group: the prompt shows over it. */
  to: string;
  /** The old group, closed, whose entries this phone wrote. */
  from: string;
  /** The old group's name ("Move your Banff 2026 entries into the new group?"). */
  fromName: string;
  /** How many of this phone's entries in the old group the new group lacks; at least 1. */
  count: number;
  /** Answered Not now: the prompt is not shown again, and the old group's settings offer the move. */
  asked: boolean;
}

/**
 * What recognition does once the old group's closure names the new group (the M1 check):
 * - `rescue`: nothing of this phone's is missing from the new group, so there is nothing to ask; the old group is
 *   synced once and hidden, as before the prompt existed;
 * - `ask`: offer the move over the new group;
 * - `offer`: asked once already (Not now): nothing is asked, and the old group's settings keep the move.
 */
export type RecognitionStep = 'rescue' | 'ask' | 'offer';

export function recognitionStep(rescuable: number, answeredNotNow: boolean): RecognitionStep {
  if (rescuable === 0) return 'rescue';
  return answeredNotNow ? 'offer' : 'ask';
}

const NOT_NOW: 'rotation.notNow' = 'rotation.notNow';

/** The `rotation.notNow` row as a list of local ids; anything else reads as empty. */
export function parseNotNow(text: string | null): string[] {
  if (text === null) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export class MoveOffers {
  private offers: readonly MoveOffer[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: Pick<Store, 'getPref' | 'setPref' | 'getGroup'>) {}

  /** Every offer, replaced (never mutated) on each change. */
  peek(): readonly MoveOffer[] {
    return this.offers;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Recognition found entries to move: replaces any offer for the same two groups. */
  publish(offer: MoveOffer): void {
    const current = this.offers.find((o) => o.from === offer.from && o.to === offer.to);
    if (
      current !== undefined &&
      current.count === offer.count &&
      current.asked === offer.asked &&
      current.fromName === offer.fromName
    ) {
      return;
    }
    this.replace([...this.offers.filter((o) => o !== current), offer]);
  }

  /** The old group's entries moved, or it is gone: its offers go. */
  drop(from: string): void {
    if (this.offers.some((o) => o.from === from)) {
      this.replace(this.offers.filter((o) => o.from !== from));
    }
  }

  /** Whether the question about this old group was answered Not now. */
  async answeredNotNow(from: string): Promise<boolean> {
    return parseNotNow(await this.store.getPref(NOT_NOW)).includes(from);
  }

  /**
   * Not now: never asked again for this old group. The row keeps only groups this phone still shows (a moved or
   * left group drops out the next time it is written).
   */
  async notNow(from: string): Promise<void> {
    const kept: string[] = [];
    for (const id of new Set([...parseNotNow(await this.store.getPref(NOT_NOW)), from])) {
      const row = await this.store.getGroup(id);
      if (row !== null && row.state !== 'hidden') kept.push(id);
    }
    await this.store.setPref(NOT_NOW, kept.length === 0 ? null : JSON.stringify(kept));
    if (this.offers.some((o) => o.from === from && !o.asked)) {
      this.replace(this.offers.map((o) => (o.from === from ? { ...o, asked: true } : o)));
    }
  }

  /** The move ran: the old group needs no answer kept. */
  async forget(from: string): Promise<void> {
    const ids = parseNotNow(await this.store.getPref(NOT_NOW));
    if (!ids.includes(from)) return;
    const kept = ids.filter((id) => id !== from);
    await this.store.setPref(NOT_NOW, kept.length === 0 ? null : JSON.stringify(kept));
  }

  private replace(next: readonly MoveOffer[]): void {
    this.offers = next;
    for (const listener of [...this.listeners]) listener();
  }
}
