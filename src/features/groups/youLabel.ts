/**
 * What the top right of Groups says to VoiceOver (Main, GroupsEmpty): the App settings button that shows you.
 * `name` is the prefs name (already trimmed, or null until set).
 */
export function youLabel(name: string | null): string {
  return name === null ? 'App settings. No name set yet.' : `App settings. You: ${name}.`;
}
