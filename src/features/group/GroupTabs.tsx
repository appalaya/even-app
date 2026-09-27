import { CATEGORY_EMOJI, formatMinor, type ExpenseState, type GroupState } from '@even/core';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
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

import { clockTime, dayLabel, isoDateLabel } from './format';
import { MemberAvatar } from './GroupHeader';
import type { ActivitySection, BalanceRow, CategoryRow } from './model';

// ---------- Expenses ----------

/**
 * Expenses (Group): 64 pt rows in one card, the category tile, "Maya paid", the amount over the day. Empty (Group,
 * just created): "No expenses yet. Add the first one below." in a card padded 40 · 24.
 */
export function ExpensesTab({
  expenses,
  state,
  myId,
  currency,
  now,
  onOpen,
}: {
  expenses: readonly ExpenseState[];
  state: GroupState;
  myId: string | null;
  currency: string;
  now: number;
  onOpen: (expenseId: string) => void;
}) {
  if (expenses.length === 0) {
    return (
      <Card style={[styles.first, styles.empty]}>
        <AppText variant="calloutLoose" color="textSecondary" align="center">
          No expenses yet. Add the first one below.
        </AppText>
      </Card>
    );
  }
  return (
    <Card separatorInset={68} style={styles.first} accessibilityLabel="Expenses">
      {expenses.map((e) => {
        const payer = e.paidBy === myId ? 'You' : (state.members.get(e.paidBy)?.name ?? 'Someone');
        return (
          <ListRow
            key={e.id}
            variant="expense"
            leading={<CategoryTile emoji={CATEGORY_EMOJI[e.category]} />}
            title={e.title}
            subtitle={`${payer} paid`}
            detail={
              <MoneyText amount={e.amount} currency={e.currency || currency} weight="medium" />
            }
            detailCaption={isoDateLabel(e.date, now)}
            onPress={() => onOpen(e.id)}
          />
        );
      })}
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
            {`Spend by category · ${formatMinor(categories.total, currency)}`}
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

/**
 * Activity: one card per day (Today, Yesterday, Sep 20), newest first. Each row leads with the subject's avatar,
 * bolds the subject, and under it gives the time, then "· ▯ 7QX2" when it came from another of that member's devices.
 */
export function ActivityTab({
  sections,
  now,
}: {
  sections: readonly ActivitySection[];
  now: number;
}) {
  const { tokens } = useTheme();
  return (
    <>
      {sections.map((section) => (
        <View key={section.key}>
          <SectionHeader>{dayLabel(section.at, now)}</SectionHeader>
          <Card
            separatorInset={60}
            style={styles.gutter}
            accessibilityLabel={dayLabel(section.at, now)}
          >
            {section.rows.map((row) => (
              <ListRow
                key={row.key}
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
            ))}
          </Card>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  first: { marginTop: 12, marginHorizontal: layout.gutter },
  empty: { paddingVertical: 40, paddingHorizontal: 24 },
  gutter: { marginHorizontal: layout.gutter },
  settle: { paddingTop: 12, paddingHorizontal: layout.gutter },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  device: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
