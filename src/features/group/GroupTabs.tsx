import { CATEGORY_EMOJI, displayMinor, type ExpenseState } from '@even/core';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  CardSlice,
  CategoryBars,
  CategoryTile,
  Footnote,
  Icon,
  ListRow,
  MoneyText,
  SectionHeader,
  Strong,
} from '@/components';
import { layout, useTheme } from '@/theme';

import { clockTime } from './format';
import { MemberAvatar } from './GroupHeader';
import type { ActivityRow, BalanceRow, CategoryRow } from './model';

// ---------- Expenses ----------

/**
 * Expenses (Group): 64 pt rows in one card, the category tile, "Maya paid", the amount over the day. Each row is its
 * own slice of the card (`CardSlice`), so the list mounts only the rows near the screen; memoised, so a re-render of
 * Group leaves rows whose expense, payer and day did not change alone.
 */
export const ExpenseRow = memo(function ExpenseRow({
  expense,
  payer,
  currency,
  dateLabel,
  first,
  last,
  onOpen,
}: {
  expense: ExpenseState;
  /** "You", the payer's name, or "Someone". */
  payer: string;
  /** The group's currency, for an expense that carries none. */
  currency: string;
  dateLabel: string;
  first: boolean;
  last: boolean;
  onOpen: (expenseId: string) => void;
}) {
  return (
    <CardSlice
      first={first}
      last={last}
      separatorInset={68}
      style={first ? styles.first : styles.gutter}
    >
      <ListRow
        variant="expense"
        leading={<CategoryTile emoji={CATEGORY_EMOJI[expense.category]} />}
        title={expense.title}
        subtitle={`${payer} paid`}
        detail={
          <MoneyText
            amount={expense.amount}
            currency={expense.currency || currency}
            weight="medium"
          />
        }
        detailCaption={dateLabel}
        onPress={() => onOpen(expense.id)}
      />
    </CardSlice>
  );
});

/** Expenses, empty (Group, just created): "No expenses yet." in a card padded 40 · 24. */
export function NoExpenses() {
  return (
    <Card style={[styles.first, styles.empty]}>
      <AppText variant="calloutLoose" color="textSecondary" align="center">
        No expenses yet.
      </AppText>
    </Card>
  );
}

// ---------- Balances ----------

function balanceWords(row: BalanceRow): { verb: string; showAmount: boolean } {
  if (row.net === 0) return { verb: row.isMe ? ' are settled' : ' is settled', showAmount: false };
  if (row.net < 0) return { verb: row.isMe ? ' owe' : ' owes', showAmount: true };
  return { verb: row.isMe ? ' are owed' : ' is owed', showAmount: true };
}

/**
 * Balances: "Everyone" (you first, then by size: "Maya is owed $172.00"; a settled member last, "Nathan is settled"
 * with no amount and the verb in `textSecondary`, as the Group screen copy board draws it), "Settle up" 12 below,
 * then "Spend by category · $1,780.00" with a bar per category, largest first.
 */
export function BalancesTab({
  rows,
  categories,
  currency,
  unavailable,
  onSettle,
}: {
  rows: readonly BalanceRow[];
  categories: { rows: readonly CategoryRow[]; total: number };
  currency: string;
  unavailable: boolean;
  onSettle: (() => void) | null;
}) {
  return (
    <>
      <SectionHeader>Everyone</SectionHeader>
      {unavailable ? (
        <Footnote spacingTop={0}>Balances unavailable for this group.</Footnote>
      ) : (
        <Card separatorInset={60} style={styles.gutter} accessibilityLabel="Balances">
          {rows.map((row) => {
            const { verb, showAmount } = balanceWords(row);
            return (
              <ListRow
                key={row.member.id}
                variant="balance"
                leading={<MemberAvatar member={row.member} size={32} />}
                title={
                  <AppText variant="callout" color={showAmount ? 'text' : 'textSecondary'}>
                    <Strong color="text">{row.isMe ? 'You' : row.member.name}</Strong>
                    {verb}
                  </AppText>
                }
                detail={
                  showAmount ? (
                    <MoneyText amount={Math.abs(row.net)} currency={currency} />
                  ) : undefined
                }
              />
            );
          })}
        </Card>
      )}
      {onSettle !== null && (
        <View style={styles.settle}>
          <Button label="Settle up" variant="secondary" size="regular" onPress={onSettle} />
        </View>
      )}
      {categories.total > 0 && (
        <>
          <SectionHeader spacingTop={24} tabular>
            {`Spend by category · ${displayMinor(categories.total, currency)}`}
          </SectionHeader>
          <Card style={styles.gutter} accessibilityLabel="Spend by category">
            <CategoryBars rows={categories.rows} total={categories.total} currency={currency} />
          </Card>
        </>
      )}
    </>
  );
}

// ---------- Activity ----------

/** Activity: a day's heading over its card (Today, Yesterday, Sep 20), newest day first. */
export const ActivityDay = memo(function ActivityDay({ label }: { label: string }) {
  return <SectionHeader>{label}</SectionHeader>;
});

/**
 * One Activity row, a slice of its day's card: the subject's avatar, the subject bold, and under it the time, then
 * "· ▯ 7QX2" when it came from another of that member's devices. Memoised like the expense rows.
 */
export const ActivityItem = memo(function ActivityItem({
  row,
  first,
  last,
}: {
  row: ActivityRow;
  first: boolean;
  last: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <CardSlice first={first} last={last} separatorInset={60} style={styles.gutter}>
      <ListRow
        variant="activity"
        leading={<MemberAvatar member={row.member} size={32} />}
        title={
          <AppText variant="subheadLoose" tabular>
            {row.subject !== null && <Strong>{row.subject}</Strong>}
            {row.rest}
          </AppText>
        }
        subtitle={
          row.device === null ? (
            clockTime(row.at)
          ) : (
            <View style={styles.meta}>
              <AppText variant="caption" color="textMuted">
                {clockTime(row.at)}
              </AppText>
              <AppText variant="caption" color="textMuted" accessibilityElementsHidden>
                ·
              </AppText>
              <View style={styles.device} accessibilityLabel={`Device ${row.device}`}>
                <Icon name="device" size={12} color={tokens.textMuted} />
                <AppText variant="caption" color="textMuted">
                  {row.device}
                </AppText>
              </View>
            </View>
          )
        }
      />
    </CardSlice>
  );
});

const styles = StyleSheet.create({
  first: { marginTop: 12, marginHorizontal: layout.gutter },
  empty: { paddingVertical: 40, paddingHorizontal: 24 },
  gutter: { marginHorizontal: layout.gutter },
  settle: { paddingTop: 12, paddingHorizontal: layout.gutter },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
