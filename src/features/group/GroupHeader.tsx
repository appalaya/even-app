import type { MemberState, Transfer } from '@even/core';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Avatar,
  Card,
  Icon,
  ListRow,
  MoneyText,
  SectionHeader,
  StatusLine,
  type StatusLineProps,
} from '@/components';
import { layout, radii, strokes, useTheme } from '@/theme';

/** A member's avatar at `size`, from the reducer's member record (initials or emoji, palette slot). */
export function MemberAvatar({
  member,
  size,
  on,
  dimmed = false,
}: {
  member: MemberState | null;
  size: 28 | 30 | 32;
  on?: 'surface' | 'inset' | 'fill';
  /** Read only (a closed group's settle list): 40 %. */
  dimmed?: boolean;
}) {
  if (member === null) return <Avatar size={size} initials="?" on={on} dimmed={dimmed} />;
  return (
    <Avatar
      size={size}
      name={member.name}
      initials={member.initials}
      color={member.color}
      on={on}
      dimmed={dimmed}
      {...(member.emoji === undefined ? {} : { emoji: member.emoji })}
    />
  );
}

/** "Read-only. Record payments in the new group once you have its invite." (Group screen copy, closed.) */
export function ClosedNote() {
  return (
    <AppText variant="caption" color="textMuted" style={styles.closedNote}>
      Read-only. Record payments in the new group once you have its invite.
    </AppText>
  );
}

/**
 * The big number (Group): "You owe" / "You're owed" at 17/22 in `textSecondary`, the amount at 56/64 with the code,
 * then the status line 4 below. At a zero net (Group, even): "You're even" at 44/52 and the status line 6 below. Read
 * only (Group, archived; Group screen copy, closed) the figure is `textSecondary` and there is no status line; an
 * even archived group carries "Everyone's settled" 8 below instead. `settled` is `everyoneSettled` (model.ts): no
 * transfers, and at least one expense or payment, since a group with nothing in it has nothing settled.
 */
export function BalanceSection({
  net,
  currency,
  status,
  hasBanner,
  readOnly,
  settled,
}: {
  net: number;
  currency: string;
  status: StatusLineProps | null;
  hasBanner: boolean;
  readOnly: boolean;
  settled: boolean;
}) {
  const even = net === 0;
  const top = (even && !readOnly ? 22 : 18) - (hasBanner && !readOnly ? 4 : 0);
  return (
    <View style={[styles.section, { paddingTop: top }]} accessibilityLabel="Your balance">
      {even ? (
        <AppText
          variant="displayText"
          color={readOnly ? 'textSecondary' : 'text'}
          accessibilityRole="header"
        >
          You&apos;re even
        </AppText>
      ) : (
        <>
          <AppText color="textSecondary">{net < 0 ? 'You owe' : "You're owed"}</AppText>
          <MoneyText
            amount={Math.abs(net)}
            currency={currency}
            size="big"
            color={readOnly ? 'textSecondary' : 'text'}
          />
        </>
      )}
      {readOnly
        ? even && settled && <SettledLine style={styles.settledInSection} />
        : status !== null && (
            <View style={even ? styles.statusEven : styles.status}>
              <StatusLine {...status} />
            </View>
          )}
    </View>
  );
}

/**
 * Group with no name picked (GroupNoSeat): "Spent so far" 17/22 `textSecondary`, the trip's total (`spentSoFar`) at
 * 56/64 with the code, then the status line 4 below, drawn without its sync button (pull to refresh still syncs).
 * Padded as the big number: 18 above (4 less under a flush banner), inset 20.
 */
export function SpentSection({
  amount,
  currency,
  status,
  hasBanner,
}: {
  amount: number;
  currency: string;
  status: StatusLineProps | null;
  hasBanner: boolean;
}) {
  return (
    <View
      style={[styles.section, { paddingTop: 18 - (hasBanner ? 4 : 0) }]}
      accessibilityLabel="Group total"
    >
      <AppText color="textSecondary">Spent so far</AppText>
      <MoneyText amount={amount} currency={currency} size="big" />
      {status !== null && (
        <View style={styles.status}>
          <StatusLine {...status} button={false} />
        </View>
      )}
    </View>
  );
}

/**
 * "Pick your name to add or settle expenses." (GroupNoSeat): 16 below the header, inset 16; `surface` with a 1 pt
 * `border`, radius 14, padded 12 · 14; the 20 pt person glyph in `textSecondary`, 1 down, 10 before the 15/21
 * sentence.
 */
export function NoSeatNote() {
  const { tokens } = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <View style={styles.noteGlyph}>
        <Icon name="person" size={20} color={tokens.textSecondary} />
      </View>
      <AppText variant="subheadLoose" style={styles.flex}>
        Pick your name to add or settle expenses.
      </AppText>
    </View>
  );
}

/** "✓ Everyone's settled" (Group, even: 18 below the status line, inset 20; archived: inside the header, 8 below). */
export function SettledLine({ style }: { style?: object }) {
  const { tokens } = useTheme();
  return (
    <View style={[styles.settled, style]}>
      <Icon name="check" size={16} color={tokens.textSecondary} strokeWidth={2.6} />
      <AppText variant="subhead" color="textSecondary">
        Everyone&apos;s settled
      </AppText>
    </View>
  );
}

/** "Trip over? Archive this group" (Group, even): an outlined 52 pt row, 14 below "Everyone's settled". */
export function ArchiveOffer({ onPress }: { onPress: () => void }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Trip over? Archive this group"
      style={({ pressed }) => [
        styles.offer,
        { borderColor: tokens.border },
        pressed && { backgroundColor: tokens.rowPressed },
      ]}
    >
      <Icon name="archive" size={20} color={tokens.textSecondary} />
      <AppText variant="subhead" style={styles.flex}>
        <AppText variant="subhead" color="textSecondary">
          Trip over?{' '}
        </AppText>
        <AppText variant="subhead" weight="semibold" color="accent">
          Archive this group
        </AppText>
      </AppText>
      <Icon name="chevronRight" size={16} color={tokens.iconMuted} />
    </Pressable>
  );
}

/**
 * The settle list: your simplified transfers as 60 pt rows, 20 below the header, in both directions ("You pay Maya ·
 * $44.00 ›", "Nathan pays you · $128.00 ›"; Group screen copy). Once everyone is done (Group, everyone done) it takes
 * the "Settle up" title and the soft-accent card with accent chevrons. Read only (Group screen copy, closed) the rows
 * are greyed: avatars at 40 %, words and amounts (medium) in `textMuted`, no chevron, not pressable, padded 16.
 */
export function SettleList({
  transfers,
  myId,
  members,
  currency,
  allDone,
  onSettle,
  readOnly = false,
}: {
  transfers: readonly Transfer[];
  myId: string | null;
  members: ReadonlyMap<string, MemberState>;
  currency: string;
  allDone: boolean;
  onSettle: ((transfer: Transfer) => void) | null;
  readOnly?: boolean;
}) {
  if (transfers.length === 0) return null;
  const rows = transfers.map((t) => {
    const mine = t.from === myId;
    const other = members.get(mine ? t.to : t.from) ?? null;
    const name = other?.name ?? 'Someone';
    const title = mine ? `You pay ${name}` : `${name} pays you`;
    if (readOnly) {
      return (
        <ListRow
          key={`${t.from}>${t.to}`}
          variant="settle"
          leading={<MemberAvatar member={other} size={32} dimmed />}
          title={title}
          titleColor="textMuted"
          detail={
            <MoneyText amount={t.amount} currency={currency} weight="medium" color="textMuted" />
          }
          paddingRight={16}
          accessibilityLabel={title}
        />
      );
    }
    return (
      <ListRow
        key={`${t.from}>${t.to}`}
        variant="settle"
        leading={<MemberAvatar member={other} size={32} />}
        title={title}
        detail={<MoneyText amount={t.amount} currency={currency} />}
        chevron={onSettle === null ? undefined : allDone ? 'accent' : true}
        onPress={onSettle === null ? undefined : () => onSettle(t)}
        accessibilityLabel={`${title}, settle up`}
      />
    );
  });
  if (!allDone) {
    return (
      <Card separatorInset={60} style={styles.settleCard} accessibilityLabel="Settle up">
        {rows}
      </Card>
    );
  }
  return (
    <>
      <SectionHeader variant="title">Settle up</SectionHeader>
      <Card
        tone="tint"
        separatorInset={60}
        style={styles.settleTint}
        accessibilityLabel="Settle up"
      >
        {rows}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { paddingHorizontal: layout.textInset },
  status: { marginTop: 4 },
  statusEven: { marginTop: 6 },
  settled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginHorizontal: layout.textInset,
  },
  settledInSection: { marginTop: 8, marginHorizontal: 0 },
  note: {
    marginTop: 16,
    marginHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radii.tile,
    borderWidth: strokes.hairline,
  },
  noteGlyph: { paddingTop: 1 },
  offer: {
    marginTop: 14,
    marginHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: radii.group,
    borderWidth: strokes.hairline,
  },
  settleCard: { marginTop: 20, marginHorizontal: layout.gutter },
  closedNote: { marginTop: 8, marginHorizontal: layout.textInset },
  settleTint: { marginHorizontal: layout.gutter },
});
