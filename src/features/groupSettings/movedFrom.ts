/**
 * The server a group was moved away from in this session, for "Delete the copy on <old host>" (design.md "Rotation,
 * moving, closing"). The derived state keeps only the latest `group.moved` target, not the server before it, so the
 * offer lasts until the copy is deleted or the app restarts.
 */
const movedFrom = new Map<string, string>();

export function rememberMove(localId: string, fromServer: string): void {
  movedFrom.set(localId, fromServer);
}

export function forgetMove(localId: string): void {
  movedFrom.delete(localId);
}

export function movedFromOf(localId: string): string | null {
  return movedFrom.get(localId) ?? null;
}
