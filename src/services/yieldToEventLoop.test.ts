import { describe, expect, it } from 'vitest';

import { pacer, yieldToEventLoop } from './yieldToEventLoop';

describe('yieldToEventLoop', () => {
  it('lets a timer that was already due run first, which a resolved promise does not', async () => {
    const order: string[] = [];
    setTimeout(() => order.push('timer'), 0);
    await Promise.resolve();
    order.push('microtask');
    await yieldToEventLoop();
    order.push('after yield');
    expect(order).toEqual(['microtask', 'timer', 'after yield']);
  });
});

describe('pacer', () => {
  it('says to yield after every `every` units, and not before', () => {
    const pace = pacer(3);
    expect(Array.from({ length: 7 }, () => pace())).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});
