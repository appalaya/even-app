/**
 * Settle's starting point from its route parameters (`?from=<memberId>&to=<memberId>&amount=<minor units>`, as the
 * Group screen's settle list passes a transfer). Pure.
 */
import { LIMITS } from '@even/core';

export interface SettleStart {
  from: string | null;
  to: string | null;
  /** Minor units; 0 when absent or unreadable. */
  amount: number;
}

/**
 * Unknown or archived members are dropped; without a `from`, you pay; without a `to` (or with `to` equal to `from`),
 * nobody is chosen yet ("Choose", as Settle, extra states draws the sheet opened from Balances' "Settle up").
 * `listed` is the pickable members, you first.
 */
export function settleStart(
  params: { from?: string; to?: string; amount?: string },
  listed: readonly string[],
  meId: string | null,
): SettleStart {
  const known = (id: string | undefined): string | null =>
    id !== undefined && listed.includes(id) ? id : null;
  const from = known(params.from) ?? (meId !== null && listed.includes(meId) ? meId : null);
  const asked = known(params.to);
  const to = asked !== null && asked !== from ? asked : null;
  const raw = params.amount === undefined ? NaN : Number(params.amount);
  const amount =
    Number.isSafeInteger(raw) && raw >= LIMITS.amountMin && raw <= LIMITS.amountMax ? raw : 0;
  return { from, to, amount };
}
