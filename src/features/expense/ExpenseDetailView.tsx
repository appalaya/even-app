import {
  CATEGORY_EMOJI,
  CATEGORY_LABEL,
  formatMinor,
  type ExpenseState,
  type FlaggedItem,
  type GroupState,
  type MemberState,
} from '@even/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Avatar,
  Button,
  Card,
  Icon,
  ListRow,
  MoneyText,
  Screen,
  SectionHeader,
} from '@/components';
import { layout, radii, strokes, useTheme } from '@/theme';

import { dateTimeLower, isoDateLabel } from '../group/format';
import {
  activeMemberIds,
  flagMessage,
  historyRows,
  splitCaption,
  splitRows,
  splitTotalLine,
} from './model';

export interface ExpenseDetailViewProps {
  groupName: string;
  state: GroupState;
  expense: ExpenseState;
  myId: string | null;
  /** Edit, Delete and Restore are offered (not in a read-only group, not on a deleted expense). */
  writable: boolean;
  flag: FlaggedItem | null;
  now: number;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: (historyIndex: number) => void;
}

/**
 * Expense detail (full scroll; flagged): the category chip, the title, the amount; the facts (paid by, date, note);
 * the split with its one-line summary; who added it and when; History, newest first, with Restore on every version
 * but the current one; Delete and Edit in the sticky footer. Flagged: a banner under the nav bar and, under the
 * split, what the shares add up to.
 */
export function ExpenseDetailView({
  groupName,
  state,
  expense,
  myId,
  writable,
  flag,
  now,
  onBack,
  onEdit,
  onDelete,
  onRestore,
}: ExpenseDetailViewProps) {
  const { tokens } = useTheme();
  const currency = expense.currency;
  const money = (minor: number) => formatMinor(minor, currency);
  const member = (id: string): MemberState | null => state.members.get(id) ?? null;
  const nameOf = (id: string) => (id === myId ? 'You' : (member(id)?.name ?? 'Someone'));
  const history = historyRows(expense, {
    nameOf,
    money,
    date: (iso) => isoDateLabel(iso, now),
  });
  const payer = member(expense.paidBy);
  const totalLine = flag?.reason === 'split_mismatch' ? splitTotalLine(expense, money) : null;
  const addedBy = expense.addedBy === myId ? 'you' : (member(expense.addedBy)?.name ?? 'Someone');

  const footer = writable ? (
    <View style={styles.footer}>
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete"
        style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
      >
        <AppText weight="semibold" style={{ color: tokens.attention }}>
          Delete
        </AppText>
      </Pressable>
      <Button label="Edit" variant="secondary" onPress={onEdit} style={styles.edit} />
    </View>
  ) : undefined;

  return (
    <Screen back={{ label: groupName, onPress: onBack }} footer={footer}>
      {flag !== null && <FlagBanner message={flagMessage(flag)} />}
      <View style={styles.head} accessibilityLabel="Expense">
        <CategoryPill
          emoji={CATEGORY_EMOJI[expense.category]}
          label={CATEGORY_LABEL[expense.category]}
        />
        <AppText variant="title1" style={styles.title} accessibilityRole="header">
          {expense.title}
        </AppText>
        <MoneyText amount={expense.amount} currency={currency} size="big" />
      </View>

      <Card separatorInset={16} style={styles.facts} accessibilityLabel="Details">
        <Fact label="Paid by">
          <View style={styles.payer}>
            <MemberAvatar member={payer} size={28} />
            <AppText variant="callout">{nameOf(expense.paidBy)}</AppText>
          </View>
        </Fact>
        <Fact label="Date">
          <AppText variant="callout" align="right">
            {isoDateLabel(expense.date, now)}
          </AppText>
        </Fact>
        {expense.note !== undefined && expense.note !== '' && (
          <Fact label="Note">
            <AppText variant="callout" align="right">
              {expense.note}
            </AppText>
          </Fact>
        )}
      </Card>

      <View style={styles.splitHead}>
        <AppText
          variant="subhead"
          weight="semibold"
          color="textSecondary"
          accessibilityRole="header"
        >
          Split
        </AppText>
        <AppText variant="caption" color="textMuted">
          {splitCaption(expense.split, activeMemberIds(state))}
        </AppText>
      </View>
      <Card separatorInset={60} style={styles.gutter} accessibilityLabel="Split">
        {splitRows(expense.split, state, myId).map((row) => (
          <ListRow
            key={row.id}
            paddingRight={16}
            leading={<MemberAvatar member={member(row.id)} size={32} />}
            title={nameOf(row.id)}
            detail={<MoneyText amount={row.amount} currency={currency} weight="medium" />}
          />
        ))}
      </Card>
      {totalLine !== null && (
        <View style={styles.totalLine}>
          <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
          <AppText variant="footnote" weight="semibold" tabular style={styles.flex}>
            {totalLine}
          </AppText>
        </View>
      )}
      <AppText variant="caption" color="textMuted" style={styles.addedBy}>
        {`Added by ${addedBy} · ${dateTimeLower(expense.addedAt, now)}`}
      </AppText>

      <SectionHeader spacingTop={24}>History</SectionHeader>
      <Card separatorInset={16} style={styles.gutter} accessibilityLabel="History">
        {history.map((row) => (
          <View
            key={row.index}
            style={[styles.version, row.restorable && writable && styles.versionAction]}
          >
            <View style={styles.versionText}>
              <AppText variant="subheadLoose" tabular>
                {row.text}
              </AppText>
              <AppText variant="caption" color="textMuted">
                {dateTimeLower(row.at, now)}
              </AppText>
            </View>
            {row.current ? (
              <AppText variant="caption" color="textMuted" style={styles.current}>
                Current
              </AppText>
            ) : (
              row.restorable &&
              writable && (
                <Button
                  label="Restore"
                  variant="quiet"
                  size="pill"
                  accessibilityLabel={`Restore: ${row.text}`}
                  onPress={() => onRestore(row.index)}
                />
              )
            )}
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function MemberAvatar({ member, size }: { member: MemberState | null; size: 28 | 32 }) {
  if (member === null) return <Avatar size={size} initials="?" />;
  return (
    <Avatar
      size={size}
      name={member.name}
      initials={member.initials}
      color={member.color}
      {...(member.emoji === undefined ? {} : { emoji: member.emoji })}
    />
  );
}

/** A fact row: the label in a 72 pt column at 15/20 `textSecondary`, the value right-aligned at 16/21; 52 tall. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <AppText variant="subhead" color="textSecondary" style={styles.factLabel}>
        {label}
      </AppText>
      <View style={styles.factValue}>{children}</View>
    </View>
  );
}

/** The category above the title: 30 tall, soft accent, the emoji at 16/20 and the label at 14/18 semibold. */
function CategoryPill({ emoji, label }: { emoji: string; label: string }) {
  const { tokens } = useTheme();
  return (
    <View
      style={[styles.pill, { backgroundColor: tokens.accentSoft }]}
      accessibilityLabel={`Category: ${label}`}
    >
      <AppText style={styles.pillEmoji} maxFontSizeMultiplier={1.2}>
        {emoji}
      </AppText>
      <AppText variant="segment" weight="semibold" color="accent">
        {label}
      </AppText>
    </View>
  );
}

/**
 * Expense detail · flagged: the warning glyph and the reason on `surface` with a 1 pt `border`, radius 14, padded
 * 8 · 14, at least 56 tall. Unlike the kit's banners it has no action.
 */
function FlagBanner({ message }: { message: string }) {
  const { tokens } = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.flag, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
    >
      <Icon name="warning" size={20} color={tokens.textSecondary} />
      <AppText variant="subhead" style={styles.flex}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gutter: { marginHorizontal: layout.gutter },
  head: {
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 12,
    paddingHorizontal: layout.textInset,
  },
  /** 28/34 bold −0.3: the canvas's expense title (the type scale has no 28 pt step). */
  title: { fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingLeft: 8,
    paddingRight: 12,
    borderRadius: 15,
  },
  pillEmoji: { fontSize: 16, lineHeight: 20 },
  facts: { marginTop: 16, marginHorizontal: layout.gutter },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
  },
  factLabel: { width: 72, flexShrink: 0 },
  factValue: { flex: 1, alignItems: 'flex-end' },
  payer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splitHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: layout.textInset,
  },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginHorizontal: layout.textInset,
  },
  addedBy: { marginTop: 12, marginHorizontal: layout.textInset },
  version: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 12,
  },
  versionAction: { paddingRight: 6 },
  versionText: { flex: 1, minWidth: 0, gap: 2 },
  current: { paddingHorizontal: 4 },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    marginTop: 8,
    marginHorizontal: layout.gutter,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: strokes.hairline,
    borderRadius: radii.tile,
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: layout.stackGap },
  delete: { minHeight: 52, paddingHorizontal: 20, justifyContent: 'center' },
  edit: { flex: 1 },
  pressed: { opacity: 0.5 },
});
