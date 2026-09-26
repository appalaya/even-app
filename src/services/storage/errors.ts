/**
 * The one error type the store throws on purpose. Anything else escaping a store method is a SQLite or
 * driver failure (disk full, I/O error) and should be treated as transient.
 */
export type StoreErrorCode =
  /** A caller passed a malformed id, a non-integer, an unknown enum value, or a non-canonical URL. */
  | 'invalid_argument'
  /** The group row does not exist (for example, Leave ran while a sync was in flight). */
  | 'group_not_found'
  /** `setServer` was given a re-encryption that does not cover exactly the group's readable rows. */
  | 'incomplete_reencryption'
  /** The database was written by a newer app version (`user_version` above the known migrations). */
  | 'schema_too_new'
  /** Waited too long for the database lock: usually a `transaction` callback calling the outer store. */
  | 'lock_timeout'
  /**
   * A transaction's store (or driver) was used after the transaction committed or rolled back, or two nested
   * `transaction` calls ran concurrently on the same transaction store.
   */
  | 'transaction_misuse'
  /** The store was used after `close()`. */
  | 'closed'
  /** A readable row's envelope text is not a v1 envelope; only possible if the file was edited outside the app. */
  | 'corrupt_row';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'StoreError';
    this.code = code;
  }
}

export function isStoreError(error: unknown, code?: StoreErrorCode): error is StoreError {
  return error instanceof StoreError && (code === undefined || error.code === code);
}
