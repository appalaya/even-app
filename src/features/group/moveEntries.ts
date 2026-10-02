/**
 * MoveEntriesPrompt's words (boards MoveEntriesPrompt, MoveEntriesPromptDark; design.md Copy, "Boards added
 * 2 October 2026"), and which offer a screen shows. Pure.
 */
import type { MoveOffer } from '../../state';

export interface MoveEntriesCopy {
  question: string;
  body: string;
}

/**
 * "Move your Banff 2026 entries into the new group?" and "3 entries you added on this phone aren't in it yet.
 * Everyone in the new group will see them." (one entry: "1 entry you added on this phone isn't in it yet.").
 */
export function moveEntriesCopy(groupName: string, count: number): MoveEntriesCopy {
  const name = groupName.trim();
  const counted =
    count === 1
      ? "1 entry you added on this phone isn't in it yet."
      : `${count} entries you added on this phone aren't in it yet.`;
  return {
    question: `Move your ${name === '' ? '' : `${name} `}entries into the new group?`,
    body: `${counted} Everyone in the new group will see them.`,
  };
}

/** The question the new group's screen asks: an offer into it not yet answered Not now. */
export function promptFor(offers: readonly MoveOffer[], localId: string): MoveOffer | null {
  return offers.find((offer) => offer.to === localId && !offer.asked) ?? null;
}

/** The old group's "Move entries" row: any offer out of it, answered or not. */
export function moveFrom(offers: readonly MoveOffer[], localId: string): MoveOffer | null {
  return offers.find((offer) => offer.from === localId) ?? null;
}
