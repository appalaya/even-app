/**
 * What the Expense detail screen shows (Expense detail, Expense detail · flagged): the split's one-line summary, the
 * History rows, and the flag. Pure (no React Native), so Vitest runs it.
 */
import {
  CATEGORY_LABEL,
  splitSum,
  type Expense,
  type ExpenseState,
  type FlaggedItem,
  type GroupState,
} from '@even/core';

/**
 * The caption beside "Split": "Everyone, equally" when every active member has an equal share, "Equally, 3 of 4
 * people" when only some do, "Exact amounts" otherwise (the flagged board's 32 · 32 · 30).
 */
export function splitCaption(
  split: Readonly<Record<string, number>>,
  activeIds: readonly string[],
): string {
  const shares = Object.entries(split).filter(([, amount]) => amount > 0);
  if (shares.length === 0) return 'Exact amounts';
  const amounts = shares.map(([, amount]) => amount);
  const equal = Math.max(...amounts) - Math.min(...amounts) <= 1;
  if (!equal) return 'Exact amounts';
  const included = new Set(shares.map(([id]) => id));
  const everyone = activeIds.length > 0 && activeIds.every((id) => included.has(id));
  if (everyone && included.size === activeIds.length) return 'Everyone, equally';
  const people = Math.max(activeIds.length, included.size);
  return `Equally, ${included.size} of ${people} ${people === 1 ? 'person' : 'people'}`;
}

/** Members who can be in a split: not archived and not placeholders. */
export function activeMemberIds(state: GroupState): string[] {
  return [...state.members.values()].filter((m) => !m.archived && !m.unknown).map((m) => m.id);
}

/** The split's rows: you first, then everyone else in member order; members whose share is zero are left out. */
export function splitRows(
  split: Readonly<Record<string, number>>,
  state: GroupState,
  myId: string | null,
): { id: string; amount: number }[] {
  const order = [...state.members.keys()];
  const rank = (id: string): number => (id === myId ? -1 : order.indexOf(id));
  return Object.entries(split)
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

export interface HistoryRow {
  /** Index into `expense.history` (what `restoreExpenseVersion` takes). */
  index: number;
  text: string;
  at: number;
  /** The newest version: "Current", no Restore. */
  current: boolean;
  /** Restore is offered on every other version except a deletion. */
  restorable: boolean;
}

export interface HistoryWords {
  /** A member's name, or "You". */
  nameOf: (memberId: string) => string;
  money: (minor: number) => string;
  /** An expense date (`YYYY-MM-DD`) as shown ("Sep 21"). */
  date: (iso: string) => string;
}

function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

function sameSplit(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

/**
 * One version's line, against the version before it: "Maya added this", "Jordan added the note "Split the wine"",
 * "Maya changed the amount from $90.00 to $96.00", "Jordan changed the split" (as the boards word them); the other
 * fields follow the same pattern.
 */
function versionText(
  snapshot: Expense,
  before: Expense | null,
  kind: string,
  actor: string,
  words: HistoryWords,
): string {
  if (kind === 'added' || before === null) return `${actor} added this`;
  if (kind === 'deleted') return `${actor} deleted this`;
  const parts: string[] = [];
  if (snapshot.amount !== before.amount) {
    parts.push(
      `changed the amount from ${words.money(before.amount)} to ${words.money(snapshot.amount)}`,
    );
  } else if (!sameSplit(snapshot.split, before.split)) {
    parts.push('changed the split');
  }
  if (snapshot.title !== before.title) parts.push(`changed the title to "${snapshot.title}"`);
  if (snapshot.paidBy !== before.paidBy)
    parts.push(`changed who paid to ${words.nameOf(snapshot.paidBy)}`);
  if (snapshot.date !== before.date) parts.push(`changed the date to ${words.date(snapshot.date)}`);
  if (snapshot.category !== before.category) {
    parts.push(`changed the category to ${CATEGORY_LABEL[snapshot.category]}`);
  }
  const note = snapshot.note ?? '';
  const previous = before.note ?? '';
  if (note !== previous) {
    if (previous === '') parts.push(`added the note "${note}"`);
    else if (note === '') parts.push('removed the note');
    else parts.push(`changed the note to "${note}"`);
  }
  if (parts.length === 0) return `${actor} changed this`;
  return `${actor} ${joinParts(parts)}`;
}

/** History, newest first; the newest is "Current". */
export function historyRows(expense: ExpenseState, words: HistoryWords): HistoryRow[] {
  const rows: HistoryRow[] = expense.history.map((entry, index) => {
    const before = index > 0 ? (expense.history[index - 1]?.snapshot ?? null) : null;
    return {
      index,
      text: versionText(entry.snapshot, before, entry.kind, words.nameOf(entry.by), words),
      at: entry.at,
      current: index === expense.history.length - 1,
      restorable: index !== expense.history.length - 1 && entry.kind !== 'deleted',
    };
  });
  return rows.reverse();
}

/** The flag on this expense, if the reducer left it out of balances. */
export function flagOf(state: GroupState, expenseId: string): FlaggedItem | null {
  return state.flagged.find((f) => f.kind === 'expense' && f.id === expenseId) ?? null;
}

/**
 * The banner's copy: the flagged board's "This expense's split doesn't add up, so it's left out of balances.", and
 * for a currency that is not the group's the Group screen copy board's "This expense is in USD, not CAD, so it's left
 * out of balances."
 */
export function flagMessage(
  flag: FlaggedItem,
  expenseCurrency?: string,
  groupCurrency?: string | null,
): string {
  if (flag.reason === 'currency_mismatch') {
    return expenseCurrency !== undefined && groupCurrency != null
      ? `This expense is in ${expenseCurrency}, not ${groupCurrency}, so it's left out of balances.`
      : "This expense's currency isn't the group's, so it's left out of balances.";
  }
  return "This expense's split doesn't add up, so it's left out of balances.";
}

/** "Shares add up to $94.00, not $96.00" (flagged board), for a split that does not sum to the amount. */
export function splitTotalLine(expense: Expense, money: (minor: number) => string): string | null {
  let sum: number;
  try {
    sum = splitSum(expense.split);
  } catch {
    return null; // a hostile split whose total is not a safe integer: the banner still says why it is left out
  }
  if (sum === expense.amount) return null;
  return `Shares add up to ${money(sum)}, not ${money(expense.amount)}`;
}
