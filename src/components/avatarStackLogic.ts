/**
 * The done-adding row's ordering rule (Group, Group · twelve members): members still adding come first, drawn
 * outlined; then members who are done, drawn filled. Within each half the caller's order is kept. At most
 * `max` avatars are drawn (five on the boards), then a "+N" chip counts the rest.
 *
 * Pure so Vitest can run it without React Native.
 */

/** Avatars drawn before the "+N" chip (design.md; the twelve-member board draws five, then "+7"). */
export const AVATAR_STACK_MAX = 5;

export interface StackLayout<T> {
  /** The avatars to draw, left to right: not-done first, then done. */
  shown: T[];
  /** How many members the "+N" chip counts; 0 draws no chip. */
  overflow: number;
}

/** Sorts not-done before done (stable), keeps the first `max`, and counts the rest. */
export function stackLayout<T extends { done: boolean }>(
  members: readonly T[],
  max: number = AVATAR_STACK_MAX,
): StackLayout<T> {
  const limit = Math.max(0, Math.floor(max));
  const sorted = [...members.filter((m) => !m.done), ...members.filter((m) => m.done)];
  const shown = sorted.slice(0, limit);
  return { shown, overflow: sorted.length - shown.length };
}
