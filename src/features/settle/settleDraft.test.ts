import { describe, expect, it } from 'vitest';

import { settleStart } from './settleDraft';

const LISTED = ['me', 'maya', 'jordan'];

describe('settleStart', () => {
  it('takes a settle-list transfer as given', () => {
    expect(settleStart({ from: 'jordan', to: 'maya', amount: '4400' }, LISTED, 'me')).toEqual({
      from: 'jordan',
      to: 'maya',
      amount: 4400,
    });
  });

  it('defaults to you paying the first other member, with no amount', () => {
    expect(settleStart({}, LISTED, 'me')).toEqual({ from: 'me', to: 'maya', amount: 0 });
  });

  it('drops unknown members and unreadable amounts', () => {
    expect(settleStart({ from: 'ghost', to: 'me', amount: '12.5' }, LISTED, 'me')).toEqual({
      from: 'me',
      to: 'maya',
      amount: 0,
    });
    expect(settleStart({ amount: '-3' }, LISTED, 'me').amount).toBe(0);
  });
});
