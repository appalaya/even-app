import { describe, expect, it } from 'vitest';

import { archivedLabel, isWaiting, netLabel, peopleLabel } from './cardLabels';

describe('group card', () => {
  it('counts people as the board words it', () => {
    expect(peopleLabel(4, false)).toBe('4 people');
    expect(peopleLabel(6, true)).toBe('6 people · waiting to sync');
    expect(peopleLabel(1, false)).toBe('1 person');
    expect(peopleLabel(null, true)).toBe('waiting to sync');
    expect(peopleLabel(null, false)).toBeNull();
  });

  it('words an archived card as drawn', () => {
    expect(archivedLabel(4, 0, 'CAD', 'en-CA')).toBe('4 people · settled');
    expect(archivedLabel(3, -1200, 'CAD', 'en-CA')).toBe('3 people · you owe $12.00');
    expect(archivedLabel(3, null, 'CAD', 'en-CA')).toBe('3 people');
  });

  it('words the net', () => {
    expect(netLabel(-5200, 'CAD')).toEqual({ kind: 'owe', caption: 'you owe', amount: 5200 });
    expect(netLabel(4400, 'CAD')).toEqual({ kind: 'owed', caption: "you're owed", amount: 4400 });
    expect(netLabel(0, 'CAD')).toEqual({ kind: 'settled', caption: 'settled' });
    // A just-created group: zero net, but nothing to settle yet, so no label at all.
    expect(netLabel(0, 'CAD', false)).toBeNull();
    expect(netLabel(0, 'CAD', true)).toEqual({ kind: 'settled', caption: 'settled' });
    expect(netLabel(null, 'CAD')).toBeNull();
    expect(netLabel(100, null)).toBeNull();
  });

  it('waits while anything is unsent or nothing ever synced', () => {
    expect(isWaiting(0, 1)).toBe(false);
    expect(isWaiting(3, 1)).toBe(true);
    expect(isWaiting(0, null)).toBe(true);
  });
});
