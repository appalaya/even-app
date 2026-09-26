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
}: {
  member: MemberState | null;
  size: 28 | 30 | 32;
  on?: 'surface' | 'inset' | 'fill';
}) {
  if (member === null) return <Avatar size={size} initials="?" on={on} />;
  return (
    <Avatar
      size={size}
      name={member.name}
      initials={member.initials}
      color={member.color}
      on={on}
      {...(member.emoji === undefined ? {} : { emoji: member.emoji })}
    />
  );
}

/**
 * The big number (Group): "You owe" / "You're owed" at 17/22 in `textSecondary`, the amount at 56/64 with the code,
 * then the status line 4 below. At a zero net (Group, even): "You're even" at 44/52 and the status line 6 below; read
 * only (Group, archived) it is `textSecondary` and carries "Everyone's settled" 8 below instead of a status line.
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
          <MoneyText amount={Math.abs(net)} currency={currency} size="big" />
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
 * The settle list: your simplified transfers as 60 pt rows ("You pay Maya · $44.00 ›"), 20 below the header. Once
 * everyone is done (Group, everyone done) it takes the "Settle up" title and the soft-accent card with accent
 * chevrons. Read only, the rows are not pressable.
 */
export function SettleList({
  transfers,
  myId,
  members,
  currency,
  allDone,
  onSettle,
}: {
  transfers: readonly Transfer[];
  myId: string | null;
  members: ReadonlyMap<string, MemberState>;
  currency: string;
  allDone: boolean;
  onSettle: ((transfer: Transfer) => void) | null;
}) {
  if (transfers.length === 0) return null;
  const rows = transfers.map((t) => {
    const mine = t.from === myId;
    const other = members.get(mine ? t.to : t.from) ?? null;
    const name = other?.name ?? 'Someone';
    const title = mine ? `You pay ${name}` : `${name} pays you`;
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
  settleTint: { marginHorizontal: layout.gutter },
});
