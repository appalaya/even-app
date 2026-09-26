/**
 * Secrets contract: group secrets and the device id in expo-secure-store. Types only.
 * Source of truth: design.md "Keys" and "Identity model".
 *
 * Every item is written with accessibility `AFTER_FIRST_UNLOCK` (`SecureStore.AFTER_FIRST_UNLOCK`), so the
 * background refresh task can read keys while the phone is locked after its first unlock since boot.
 * Never `WHEN_UNLOCKED*`, never `*_THIS_DEVICE_ONLY`: the iOS keychain backup is the restore path.
 */

/**
 * Secure-store keys (secure store keys allow only `[A-Za-z0-9._-]`; local ids are base64url, so they fit):
 * - `even.secret.<localId>`: the 32-byte group secret, as 43-char base64url.
 * - `even.groups`: the index, a JSON array of `{ localId, serverUrl }` (`IndexedGroup`), one per group that has a
 *   secret. Secure store cannot enumerate its keys, so this index is how a restored or reinstalled iPhone finds its
 *   groups again; the server URL (not secret) is what lets it rebuild each `groups` row and pull the log. The first
 *   format was a bare array of local ids; it is read as pairs with `serverUrl: null` and rewritten on the next write.
 * - `even.device`: this install's device id, 22-char base64url.
 */
export type SecretStoreKey = `even.secret.${string}` | 'even.groups' | 'even.device';

/** One `even.groups` index entry. */
export interface IndexedGroup {
  localId: string;
  /**
   * The canonical server URL the group syncs with (`groups.server_url`), kept current on create, join, import,
   * rotation and move. Null for an entry written in the first index format, before the URL was recorded.
   */
  serverUrl: string | null;
}

export interface Secrets {
  /** The group secret, or null if this phone has none for `localId`. */
  getSecret(localId: string): Promise<Uint8Array | null>;
  /**
   * Stores the 32-byte secret under `even.secret.<localId>` and records `{ localId, serverUrl }` in the
   * `even.groups` index (secret first, index second, so the index never names a missing secret). Overwriting is
   * allowed and idempotent; an existing entry takes the new `serverUrl`. Callers derive `localId` with
   * `deriveLocal(secret)`; the implementation may assert it. `serverUrl` is the canonical URL of the group's
   * `groups` row (`canonicalOrigin`); anything else is refused.
   */
  setSecret(localId: string, secret: Uint8Array, serverUrl: string): Promise<void>;
  /**
   * Records the group's new server in its index entry after a move (`groups.server_url` changed). A local id that
   * is not in the index is a no-op; the URL must be canonical, as for `setSecret`.
   */
  setServerUrl(localId: string, serverUrl: string): Promise<void>;
  /** Removes the secret and its index entry (index first). Missing is a no-op. */
  deleteSecret(localId: string): Promise<void>;
  /** The local ids in the `even.groups` index, in index order. */
  listLocalIds(): Promise<string[]>;
  /**
   * The `even.groups` index as `{ localId, serverUrl }` pairs, in index order. Used on launch to reconcile with
   * SQLite: an entry with no `groups` row is a restore or reinstall, and its URL is where the row is rebuilt to
   * re-pull the log (`GroupService.recoverGroupsFromSecrets`). An entry from the first index format has no URL.
   */
  listGroups(): Promise<IndexedGroup[]>;
  /** This install's device id from `even.device`, created with `newId()` from @even/core on first call. */
  deviceId(): Promise<string>;
}
