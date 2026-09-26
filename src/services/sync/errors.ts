/**
 * The concrete `SyncError` the transport rejects with and the engine records. The interface lives in
 * `./types`; this is its one implementation, so `code` is always a `SyncErrorCode`.
 */
import type { SyncError as SyncErrorShape, SyncErrorCode } from './types';

export interface SyncErrorDetails {
  status?: number;
  index?: number;
  reason?: 'bytes' | 'events';
  retryAfterMs?: number;
  cause?: unknown;
}

export class SyncError extends Error implements SyncErrorShape {
  readonly code: SyncErrorCode;
  readonly status?: number;
  readonly index?: number;
  readonly reason?: 'bytes' | 'events';
  readonly retryAfterMs?: number;

  constructor(code: SyncErrorCode, message?: string, details: SyncErrorDetails = {}) {
    super(message ?? code, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'SyncError';
    this.code = code;
    if (details.status !== undefined) this.status = details.status;
    if (details.index !== undefined) this.index = details.index;
    if (details.reason !== undefined) this.reason = details.reason;
    if (details.retryAfterMs !== undefined) this.retryAfterMs = details.retryAfterMs;
  }
}

export function isSyncError(value: unknown): value is SyncError {
  return value instanceof SyncError;
}

/** Anything thrown during a cycle, as a `SyncError`: transport errors pass through, the rest is `local_error`. */
export function toSyncError(value: unknown): SyncError {
  if (value instanceof SyncError) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new SyncError('local_error', message, { cause: value });
}
