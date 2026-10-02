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
 */

/** Envelopes opened between yields: about 40 ms of work without a JIT, a few ms with one. */
export const OPENS_PER_YIELD = 200;

/** Envelopes re-encrypted (opened and sealed again) between yields: about the same time as `OPENS_PER_YIELD` opens. */
export const RESEALS_PER_YIELD = 100;

/** Resolves after one turn of the event loop. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
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
