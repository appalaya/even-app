/**
 * Argument checks run before any SQL. Every value reaching SQLite is bound, never interpolated; these checks
 * make malformed input fail loudly at the call site instead of landing in a row.
 */
import { canonicalOrigin, isB64url, isId } from '@even/core';

import { StoreError } from './errors';

/** A local group id: 43 base64url characters (32 bytes), design.md "Identity model". */
export const LOCAL_ID_LENGTH = 43;

function fail(message: string): never {
  throw new StoreError('invalid_argument', message);
}

function describe(value: unknown): string {
  if (typeof value === 'string')
    return value.length > 60 ? `${JSON.stringify(value.slice(0, 60))}…` : JSON.stringify(value);
  return typeof value;
}

export function checkLocalId(value: unknown, what = 'localId'): string {
  if (typeof value !== 'string' || !isB64url(value, LOCAL_ID_LENGTH)) {
    fail(`${what} must be ${LOCAL_ID_LENGTH} base64url characters, got ${describe(value)}`);
  }
  return value;
}

export function checkId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !isId(value)) {
    fail(`${what} must be 22 base64url characters, got ${describe(value)}`);
  }
  return value;
}

export function checkIds(values: unknown, what = 'ids'): readonly string[] {
  if (!Array.isArray(values)) fail(`${what} must be an array`);
  for (const value of values) checkId(value, `${what}[]`);
  return values as string[];
}

export function checkNullableId(value: unknown, what: string): string | null {
  return value === null ? null : checkId(value, what);
}

/** A per-server auth token as stored in `pending_deletes`: 43 base64url characters (32 bytes). */
export function checkAuthToken(value: unknown, what = 'authToken'): string {
  // Never echo the value: it is a credential.
  if (typeof value !== 'string' || !isB64url(value, 43))
    fail(`${what} must be 43 base64url characters`);
  return value;
}

/** A safe integer ≥ `min`. */
export function checkInt(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    fail(`${what} must be an integer ≥ ${min}, got ${describe(value)}`);
  }
  return value;
}

export function checkNullableInt(value: unknown, what: string, min = 0): number | null {
  return value === null ? null : checkInt(value, what, min);
}

export function checkString(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} must be a string, got ${describe(value)}`);
  return value;
}

export function checkNullableString(value: unknown, what: string): string | null {
  return value === null ? null : checkString(value, what);
}

export function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  what: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${what} must be one of ${allowed.join(', ')}, got ${describe(value)}`);
  }
  return value as T;
}

export function checkBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} must be a boolean, got ${describe(value)}`);
  return value;
}

/** ISO 4217 code: three uppercase letters. */
export function checkNullableCurrency(value: unknown, what: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    fail(`${what} must be a three-letter ISO 4217 code, got ${describe(value)}`);
  }
  return value;
}

/** A server URL already in canonical form (PROTOCOL.md §8.1): what `canonicalOrigin` returns. */
export function checkServerUrl(value: unknown, what = 'serverUrl'): string {
  if (typeof value !== 'string') fail(`${what} must be a string, got ${describe(value)}`);
  let canonical: string;
  try {
    canonical = canonicalOrigin(value);
  } catch (error) {
    fail(`${what} is not a valid server URL: ${(error as Error).message}`);
  }
  if (canonical !== value) fail(`${what} must be canonical: expected ${JSON.stringify(canonical)}`);
  return value;
}
