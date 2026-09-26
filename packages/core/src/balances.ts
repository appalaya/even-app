/**
 * Balances and settle-up simplification. See design.md "Balances and simplification".
 * Honours `state.flagged`: flagged expenses and payments are excluded from every net.
 *
 * `nets` sums in BigInt, so the order of accumulation never matters, and throws RangeError only if a FINAL net is
 * not a safe integer. That is reachable only through a hostile log (e.g. 10,000 events of 10^12 minor units, all
 * owed by one member). The app wraps `nets` (and so `simplify`/`myNet`) and shows "balances unavailable" for the
 * group instead of crashing.
 */
import type { GroupState, Transfer } from './types.js';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function add(map: Map<string, bigint>, memberId: string, delta: number): void {
  map.set(memberId, (map.get(memberId) ?? 0n) + BigInt(delta));
}

/**
 * net[m] = Σpaid − Σshare + Σsent − Σreceived over non-flagged live expenses and payments. Includes every member
 * (0 if none). Σ over all = 0. Throws RangeError if a final net is outside the safe-integer range (see the header).
 */
export function nets(state: GroupState): Map<string, number> {
  const flaggedExpenses = new Set<string>();
  const flaggedPayments = new Set<string>();
  for (const f of state.flagged) {
    (f.kind === 'expense' ? flaggedExpenses : flaggedPayments).add(f.id);
  }

  const sums = new Map<string, bigint>();
  for (const memberId of state.members.keys()) sums.set(memberId, 0n);

  for (const e of state.expenses.values()) {
    if (flaggedExpenses.has(e.id)) continue;
    add(sums, e.paidBy, e.amount);
    for (const [memberId, share] of Object.entries(e.split)) add(sums, memberId, -share);
  }
  for (const p of state.payments.values()) {
    if (flaggedPayments.has(p.id)) continue;
    add(sums, p.from, p.amount);
    add(sums, p.to, -p.amount);
  }

  const out = new Map<string, number>();
  for (const [memberId, net] of sums) {
    if (net > MAX_SAFE || net < -MAX_SAFE) throw new RangeError(`net for member ${memberId} is not a safe integer`);
    out.set(memberId, Number(net));
  }
  return out;
}

function byAmountDescThenId(a: [string, number], b: [string, number]): number {
  if (a[1] !== b[1]) return b[1] - a[1];
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/** Greedy: largest debtor pays largest creditor; ties by member id; at most members−1 transfers; deterministic. */
export function simplify(nets: ReadonlyMap<string, number>): Transfer[] {
  const creditors: [string, number][] = [];
  const debtors: [string, number][] = [];
  for (const [memberId, net] of nets) {
    if (net > 0) creditors.push([memberId, net]);
    else if (net < 0) debtors.push([memberId, -net]);
  }
  creditors.sort(byAmountDescThenId);
  debtors.sort(byAmountDescThenId);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    if (debtor === undefined || creditor === undefined) break;
    const amount = Math.min(debtor[1], creditor[1]);
    transfers.push({ from: debtor[0], to: creditor[0], amount });
    debtor[1] -= amount;
    creditor[1] -= amount;
    if (debtor[1] === 0) i++;
    if (creditor[1] === 0) j++;
  }
  return transfers;
}

export function myNet(state: GroupState, memberId: string): number {
  return nets(state).get(memberId) ?? 0;
}
