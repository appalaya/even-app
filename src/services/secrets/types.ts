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
 * - `even.groups`: the index, a JSON array of local ids that have a secret. Secure store cannot enumerate
 *   its keys, so this index is how a restored or reinstalled iPhone finds its groups again.
 * - `even.device`: this install's device id, 22-char base64url.
 */
export type SecretStoreKey = `even.secret.${string}` | 'even.groups' | 'even.device';

export interface Secrets {
  /** The group secret, or null if this phone has none for `localId`. */
  getSecret(localId: string): Promise<Uint8Array | null>;
  /**
   * Stores the 32-byte secret under `even.secret.<localId>` and adds `localId` to the `even.groups` index
   * (secret first, index second, so the index never names a missing secret). Overwriting is allowed and
   * idempotent. Callers derive `localId` with `deriveLocal(secret)`; the implementation may assert it.
   */
  setSecret(localId: string, secret: Uint8Array): Promise<void>;
  /** Removes the secret and its index entry (index first). Missing is a no-op. */
  deleteSecret(localId: string): Promise<void>;
  /**
   * Local ids listed in the `even.groups` index. Used on launch to reconcile with SQLite: an id here with
   * no `groups` row is a restore or reinstall (re-create the row and re-pull).
   */
  listLocalIds(): Promise<string[]>;
  /** This install's device id from `even.device`, created with `newId()` from @even/core on first call. */
  deviceId(): Promise<string>;
}
