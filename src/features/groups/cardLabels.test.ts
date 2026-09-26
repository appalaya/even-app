import type { MemberState } from '@even/core';
import { describe, expect, it } from 'vitest';

import { isWaiting, netLabel, peopleLabel } from './cardLabels';

const member = (over: Partial<MemberState> = {}): MemberState => ({
  id: 'm',
  name: 'Maya',
  archived: false,
  devices: [],
  unknown: false,
  color: 0,
  initials: 'M',
  ...over,
});

describe('group card', () => {
  it('counts people as the board words it', () => {
    expect(peopleLabel([member(), member(), member(), member()], false)).toBe('4 people');
    expect(
      peopleLabel(
        Array.from({ length: 6 }, () => member()),
        true,
      ),
    ).toBe('6 people · waiting to sync');
    expect(
      peopleLabel([member(), member({ archived: true }), member({ unknown: true })], false),
    ).toBe('1 person');
  });

  it('words the net', () => {
    expect(netLabel(-5200, 'CAD')).toEqual({ kind: 'owe', caption: 'you owe', amount: 5200 });
    expect(netLabel(4400, 'CAD')).toEqual({ kind: 'owed', caption: "you're owed", amount: 4400 });
    expect(netLabel(0, 'CAD')).toEqual({ kind: 'settled', caption: 'settled' });
    expect(netLabel(null, 'CAD')).toBeNull();
    expect(netLabel(100, null)).toBeNull();
  });

  it('waits while anything is unsent or nothing ever synced', () => {
    expect(isWaiting(0, 1)).toBe(false);
    expect(isWaiting(3, 1)).toBe(true);
    expect(isWaiting(0, null)).toBe(true);
  });
});
