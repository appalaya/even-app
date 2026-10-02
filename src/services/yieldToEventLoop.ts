/**
 * Long loops on the JavaScript thread hand it back every so often (pre-launch review H3): decrypting every envelope
 * of a group when it is derived, opening every pulled envelope, and re-encrypting a whole log for a server move or a
 * rotation. Each envelope costs about 0.2 ms to open without a JIT (Hermes in a release build), so a 10,000-event
 * group held the thread for seconds: no frame, no touch, not even the screen's own loading state. Yielding every
 * few hundred envelopes lets React commit and the UI answer in between, for a few percent of the total time.
 *
 * A zero-delay timer, not a microtask: microtasks all run before the thread is released, so `await
 * Promise.resolve()` would let nothing through. React Native runs a zero-delay one-off timer at once rather than on
 * the next frame (RCTTiming `immediatelyCallTimer`), so a yield costs little more than a turn of the event loop.
 *
 * Only in the foreground, though. Android fires no JavaScript timer while the app is not in the foreground, a
 * background task included, so there a yield waited until the app was next opened and a background run stood
 * still at its first one. Out of the foreground a yield is `setImmediate`, which runs there: React Native makes it a
 * microtask, so it hands nothing back, and nothing on screen needs it to. Whether the app is in the foreground is
 * set by `appForeground.ts`, from React Native's AppState, through `setForegroundCheck`; this module stays free of
 * React Native so it runs under Vitest, where the foreground is assumed.
 */

let inForeground: () => boolean = () => true;

/** Yields waiting on a zero-delay timer: `releaseWaitingYields` lets them go on if the app leaves the foreground. */
const waiting = new Set<() => void>();

/** Envelopes opened between yields: about 40 ms of work without a JIT, a few ms with one. */
export const OPENS_PER_YIELD = 200;

/** Envelopes re-encrypted (opened and sealed again) between yields: about the same time as `OPENS_PER_YIELD` opens. */
export const RESEALS_PER_YIELD = 100;

/** How a yield learns whether the app is in the foreground. Set once, from the entry (`appForeground.ts`). */
export function setForegroundCheck(check: () => boolean): void {
  inForeground = check;
}

/**
 * The app left the foreground: a yield already waiting on a timer, which will not fire now, goes on at once. Without
 * this, a derive or a pull running when the app was put away would stand still until it was opened again, and so
 * would a background run that waits on it (the same group's state).
 */
export function releaseWaitingYields(): void {
  const pending = [...waiting];
  waiting.clear();
  for (const go of pending) go();
}

/** Resolves after one turn of the event loop. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!inForeground()) {
      setImmediate(resolve);
      return;
    }
    const go = () => {
      waiting.delete(go);
      resolve();
    };
    waiting.add(go);
    setTimeout(go, 0);
  });
}

/**
 * Counts units of work and says when to yield: `if (pace()) await yieldToEventLoop();` yields after every `every`
 * units, so a loop that does little (every envelope already decrypted) never waits.
 */
export function pacer(every: number): () => boolean {
  let count = 0;
  return () => {
    count += 1;
    if (count < every) return false;
    count = 0;
    return true;
  };
}
