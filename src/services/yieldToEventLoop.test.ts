import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pacer,
  releaseWaitingYields,
  setForegroundCheck,
  yieldToEventLoop,
} from './yieldToEventLoop';

/** A real turn of Node's event loop: the fake timers below fake setTimeout only. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Whether the promise has settled after a few turns. */
async function settles(promise: Promise<void>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 3; i += 1) await turn();
  return done;
}

describe('yieldToEventLoop', () => {
  afterEach(() => {
    setForegroundCheck(() => true);
    vi.useRealTimers();
  });

  it('lets a timer that was already due run first, which a resolved promise does not', async () => {
    const order: string[] = [];
    setTimeout(() => order.push('timer'), 0);
    await Promise.resolve();
    order.push('microtask');
    await yieldToEventLoop();
    order.push('after yield');
    expect(order).toEqual(['microtask', 'timer', 'after yield']);
  });

  // Android fires no JavaScript timer out of the foreground, a background task included: here, a fake setTimeout
  // that only fires when the test advances it.
  it('in the foreground waits on a zero-delay timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const yielded = yieldToEventLoop();
    expect(await settles(yielded)).toBe(false);
    vi.advanceTimersByTime(0);
    expect(await settles(yielded)).toBe(true);
  });

  it('out of the foreground goes on without a timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setForegroundCheck(() => false);
    expect(await settles(yieldToEventLoop())).toBe(true);
  });

  it('lets a yield already waiting on a timer go on when the app leaves the foreground', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let active = true;
    setForegroundCheck(() => active);
    const waiting = yieldToEventLoop();
    expect(await settles(waiting)).toBe(false);
    active = false;
    releaseWaitingYields();
    expect(await settles(waiting)).toBe(true);
    // Its timer, when it fires on the way back, is a no-op; the next yield waits on its own.
    active = true;
    vi.runAllTimers();
    const next = yieldToEventLoop();
    expect(await settles(next)).toBe(false);
    vi.advanceTimersByTime(0);
    expect(await settles(next)).toBe(true);
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
