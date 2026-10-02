import { describe, expect, it } from 'vitest';

import type { MoveOffer } from '../../state';

import { moveEntriesCopy, moveFrom, promptFor } from './moveEntries';

describe('moveEntriesCopy', () => {
  it('words the question and the count as the MoveEntriesPrompt board does', () => {
    expect(moveEntriesCopy('Banff 2026', 3)).toEqual({
      question: 'Move your Banff 2026 entries into the new group?',
      body: "3 entries you added on this phone aren't in it yet. Everyone in the new group will see them.",
    });
  });

  it('says one entry in the singular', () => {
    expect(moveEntriesCopy('Banff 2026', 1).body).toBe(
      "1 entry you added on this phone isn't in it yet. Everyone in the new group will see them.",
    );
  });

  it('leaves out a name it does not have, without a double space', () => {
    expect(moveEntriesCopy(' ', 2).question).toBe('Move your entries into the new group?');
  });
});

describe('which offer a screen shows', () => {
  const offer = (to: string, from: string, asked: boolean): MoveOffer => ({
    to,
    from,
    fromName: 'Banff 2026',
    count: 2,
    asked,
  });

  it('asks over the new group until Not now', () => {
    expect(promptFor([offer('g2', 'g1', false)], 'g2')).toEqual(offer('g2', 'g1', false));
    expect(promptFor([offer('g2', 'g1', true)], 'g2')).toBeNull();
    expect(promptFor([offer('g2', 'g1', false)], 'g1')).toBeNull();
  });

  it("keeps the move in the old group's settings, answered or not", () => {
    expect(moveFrom([offer('g2', 'g1', true)], 'g1')).toEqual(offer('g2', 'g1', true));
    expect(moveFrom([offer('g2', 'g1', false)], 'g1')).toEqual(offer('g2', 'g1', false));
    expect(moveFrom([offer('g2', 'g1', true)], 'g2')).toBeNull();
  });
});
