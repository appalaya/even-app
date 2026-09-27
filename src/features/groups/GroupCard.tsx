/**
 * One group on Groups (Main board): a 76 pt `surface` card, radius 18, padding 14 18; the name 17/22 semibold with
 * the 7 pt sync dot 8 after it, "4 people" 14/19 `textSecondary` 3 below; at the trailing edge "you owe" 13/18
 * `textSecondary` over the amount 17/22 semibold tabular (1 apart), or "settled" 15/20 `textMuted`. A group with no
 * expense or payment yet shows no net: there is nothing to settle (design.md, "Groups").
 *
 * Everything it shows comes from the list row (`useGroups()`), so the list renders from one subscription.
 */
import { formatMinor } from '@even/core';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, MoneyText, SyncDot } from '@/components';
import type { GroupListRow } from '@/state';
import { radii, useTheme } from '@/theme';

import { isWaiting, netLabel, peopleLabel } from './cardLabels';

/** A group recovered from the keychain has no name until its first pull (design.md "Invites": "a group"). */
export function cardName(row: GroupListRow): string {
  return row.name.trim() === '' ? 'a group' : row.name;
}

export function GroupCard({ row, onPress }: { row: GroupListRow; onPress: () => void }) {
  const { tokens } = useTheme();
  const waiting = isWaiting(row.outbox, row.sync.lastSyncedAt);
  const people = peopleLabel(row.memberCount, waiting);
  const currency = row.currency;
  const net =
    currency === null
      ? null
      : netLabel(row.balancesUnavailable ? null : row.myNet, currency, row.hasActivity);
  const name = cardName(row);

  const spoken = [
    name,
    waiting ? 'waiting to sync' : 'synced',
    people,
    net === null || currency === null
      ? null
      : net.kind === 'settled'
        ? 'settled'
        : `${net.caption} ${formatMinor(net.amount, currency)}`,
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken.filter((part) => part !== null).join(', ')}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? tokens.rowPressed : tokens.surface },
      ]}
    >
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <AppText weight="semibold" numberOfLines={1} style={styles.name}>
            {name}
          </AppText>
          <SyncDot waiting={waiting} />
        </View>
        {people !== null && (
          <AppText variant="footnote" color="textSecondary" numberOfLines={1}>
            {people}
          </AppText>
        )}
      </View>
      {net !== null &&
        currency !== null &&
        (net.kind === 'settled' ? (
          <AppText variant="subhead" color="textMuted">
            settled
          </AppText>
        ) : (
          <View style={styles.net}>
            <AppText variant="caption" color="textSecondary">
              {net.caption}
            </AppText>
            <MoneyText amount={net.amount} currency={currency} variant="body" />
          </View>
        ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 76,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: radii.card,
  },
  main: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1 },
  net: { alignItems: 'flex-end', gap: 1 },
});
