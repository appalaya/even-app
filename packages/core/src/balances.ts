import type { GroupState, Transfer } from './types.js';
/** net[m] = Σpaid − Σshare + Σsent − Σreceived over non-flagged live expenses and payments. Includes every member (0 if none). Σ over all = 0. */
export function nets(state: GroupState): Map<string, number> { throw new Error('not implemented'); }
/** Greedy: largest debtor pays largest creditor; ties by member id; at most members−1 transfers; deterministic. */
export function simplify(nets: ReadonlyMap<string, number>): Transfer[] { throw new Error('not implemented'); }
export function myNet(state: GroupState, memberId: string): number { throw new Error('not implemented'); }
