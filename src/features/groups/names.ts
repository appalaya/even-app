/** Name rules the Create and Join forms check before the GroupService does (design.md "Identity model"). Pure. */

/** Names compare case-insensitively, ignoring surrounding whitespace. */
export function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Whether `name` collides with any of `taken`. */
export function isNameTaken(name: string, taken: readonly string[]): boolean {
  const key = nameKey(name);
  return key !== '' && taken.some((other) => nameKey(other) === key);
}

/** The States board's duplicate-name line: "Someone here is already called Maya." */
export function nameTakenMessage(name: string): string {
  return `Someone here is already called ${name.trim()}.`;
}
