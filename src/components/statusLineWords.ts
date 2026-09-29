/** The status line's own words, pure (no React Native), so the Group and Diagnostics word helpers can test them. */

/**
 * The stale line as the States board words it: "Not synced since 2:10 pm". `time` is the caller's formatted time of
 * the last successful sync.
 */
export function notSyncedLabel(time: string): string {
  return `Not synced since ${time}`;
}
