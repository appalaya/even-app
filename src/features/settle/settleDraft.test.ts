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

  it('opened from Balances: you pay, nobody chosen to receive yet, no amount', () => {
    expect(settleStart({}, LISTED, 'me')).toEqual({ from: 'me', to: null, amount: 0 });
  });

  it('drops unknown members and unreadable amounts', () => {
    expect(settleStart({ from: 'ghost', to: 'me', amount: '12.5' }, LISTED, 'me')).toEqual({
      from: 'me',
      to: null,
      amount: 0,
    });
    expect(settleStart({ from: 'maya', to: 'me' }, LISTED, 'me')).toMatchObject({
      from: 'maya',
      to: 'me',
    });
    expect(settleStart({ amount: '-3' }, LISTED, 'me').amount).toBe(0);
  });
});
