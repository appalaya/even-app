import type { GroupState, LogEntry } from './types.js';
export interface ReduceOptions {
  /** Formats minor units for activity summaries; defaults to String(n). The app passes formatMinor bound to the group currency. */
  format?: (minor: number) => string;
  /** This group's own localId; a group.closed whose `to` equals it is ignored. */
  selfLocalId?: string;
}
export function emptyState(): GroupState { throw new Error('not implemented'); }
/** Stable sort by (ts, id) ascending. Does not mutate. */
export function sortLog(log: readonly LogEntry[]): LogEntry[] { throw new Error('not implemented'); }
/** Deterministic avatar colour index 0..AVATAR_COLOR_COUNT-1 from a member id. */
export function memberColor(memberId: string): number { throw new Error('not implemented'); }
/** 1–2 uppercase initials from a name ("maya andersen" → "MA", "Nathan" → "N"). */
export function initialsOf(name: string): string { throw new Error('not implemented'); }
/** Replays the log per design.md "Reducer". Pure. Every event in `log` has already passed parseEvent. */
export function reduce(log: readonly LogEntry[], options?: ReduceOptions): GroupState { throw new Error('not implemented'); }
