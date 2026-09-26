/**
 * Record a payment (boards Settle, SettleDark): From → To, the amount on the keypad, the date and an optional note,
 * "Record payment", and under it "Records that the money moved. Send it however you like." Prefilled from the
 * tapped settle-list row (`?from&to&amount`, amount in minor units).
 */
import { exponentOf, LIMITS, type GroupState } from '@even/core';
import { useCallback, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import {
  AmountDisplay,
  Button,
  FieldLabel,
  Footnote,
  Icon,
  Keypad,
  SelectPill,
  TextField,
  type KeypadKey,
} from '@/components';
import { applyKey, entryToMinor, minorToEntry } from '@/features/addExpense/amountEntry';
import { todayIso } from '@/features/addExpense/draft';
import {
  dateLabel,
  listedMembers,
  memberLabel,
  recentDays,
  saveErrorMessage,
} from '@/features/addExpense/labels';
import { pick } from '@/features/addExpense/pickers';
import { RouteSheet, useRouteSheet } from '@/features/addExpense/RouteSheet';
import { useApp, useGroup, useMe } from '@/state';
import { useTheme } from '@/theme';

import { MemberSelect } from './MemberSelect';
import { settleStart } from './settleDraft';

export interface SettleSheetProps {
  groupId: string;
  params: { from?: string; to?: string; amount?: string };
  /** Leaves the route once the sheet is down. */
  onClosed: () => void;
}

export function SettleSheet({ groupId, params, onClosed }: SettleSheetProps) {
  const sheet = useRouteSheet('present');
  const { derived } = useGroup(groupId);
  const { memberId: meId } = useMe(groupId);
  const state = derived?.state ?? null;
  const currency = derived?.currency ?? null;
  const close = useCallback(() => {
    Keyboard.dismiss();
    sheet.close(onClosed);
  }, [onClosed, sheet]);
  return (
    <RouteSheet
      sheet={sheet}
      onDismiss={close}
      accessibilityLabel="Record a payment"
      leftAction={{ label: 'Cancel', onPress: close }}
      navTitle="Record a payment"
      navTitleInset={100}
      bottom="keypad"
    >
      {state !== null && currency !== null ? (
        <SettleForm
          groupId={groupId}
          state={state}
          currency={currency}
          meId={meId}
          params={params}
          onSaved={close}
        />
      ) : null}
    </RouteSheet>
  );
}

function SettleForm({
  groupId,
  state,
  currency,
  meId,
  params,
  onSaved,
}: {
  groupId: string;
  state: GroupState;
  currency: string;
  meId: string | null;
  params: SettleSheetProps['params'];
  onSaved: () => void;
}) {
  const { tokens, scheme } = useTheme();
  const { groups } = useApp();
  const exponent = exponentOf(currency);
  const listed = listedMembers(state, meId);
  const [start] = useState(() =>
    settleStart(
      params,
      listed.map((m) => m.id),
      meId,
    ),
  );
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [amountText, setAmountText] = useState(() => minorToEntry(start.amount, exponent));
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState('');
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const amount = entryToMinor(amountText, exponent);
  const canSave = amount > 0 && from !== null && to !== null && from !== to && !saving;

  const choose = (role: 'From' | 'To') =>
    pick({
      title: role,
      options: listed.map((m) => ({ label: memberLabel(m, meId), value: m.id })),
      scheme,
      tint: tokens.accent,
      onPick: (id) => {
        setError(null);
        if (role === 'From') {
          if (id === to) setTo(from);
          setFrom(id);
        } else {
          if (id === from) setFrom(to);
          setTo(id);
        }
      },
    });
  const pickDate = () =>
    pick({
      title: 'Date',
      options: recentDays(today).map((d) => ({ label: dateLabel(d, today), value: d })),
      scheme,
      tint: tokens.accent,
      onPick: setDate,
    });
  const onKey = (key: KeypadKey) => {
    setError(null);
    setAmountText((text) => applyKey(text, key, exponent));
  };
  const onRecord = async () => {
    if (!canSave || from === null || to === null) return;
    setSaving(true);
    try {
      const trimmed = note.trim();
      await groups.addPayment(groupId, {
        from,
        to,
        amount,
        date,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      onSaved();
    } catch (e) {
      setSaving(false);
      setError(saveErrorMessage(e));
    }
  };

  const fromMember = from === null ? undefined : state.members.get(from);
  const toMember = to === null ? undefined : state.members.get(to);
  return (
    <View style={styles.body}>
      <View style={styles.people}>
        <View style={styles.person}>
          <FieldLabel>From</FieldLabel>
          <MemberSelect
            role="From"
            member={fromMember}
            label={memberLabel(fromMember, meId)}
            onPress={() => choose('From')}
          />
        </View>
        <View style={styles.arrow}>
          <Icon name="arrowRight" size={20} color={tokens.textMuted} />
        </View>
        <View style={styles.person}>
          <FieldLabel>To</FieldLabel>
          <MemberSelect
            role="To"
            member={toMember}
            label={memberLabel(toMember, meId)}
            onPress={() => choose('To')}
          />
        </View>
      </View>
      <Pressable onPress={Keyboard.dismiss} accessible={false} style={styles.amount}>
        <AmountDisplay amount={amount} currency={currency} />
      </Pressable>
      <View style={styles.details}>
        <SelectPill
          value={dateLabel(date, today)}
          onPress={pickDate}
          accessibilityLabel={`Date: ${dateLabel(date, today)}`}
        />
        <TextField
          variant="pill"
          accessibilityLabel="Note"
          placeholder="Note (optional)"
          value={note}
          onChangeText={(text) => {
            setNote(text);
            setError(null);
          }}
          maxLength={LIMITS.noteMax}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          error={error ?? undefined}
          containerStyle={styles.note}
        />
      </View>
      <Button
        label="Record payment"
        haptic="success"
        disabled={!canSave}
        onPress={() => void onRecord()}
        style={styles.record}
      />
      <Footnote align="center" spacingTop={8}>
        Records that the money moved. Send it however you like.
      </Footnote>
      {!typing && (
        <View style={styles.keys}>
          <Keypad onKey={onKey} keyHeight={52} decimal={exponent > 0} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  people: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 12,
    marginHorizontal: 16,
  },
  person: { flex: 1, flexBasis: 0, gap: 6 },
  arrow: { height: 48, justifyContent: 'center' },
  amount: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  details: { flexDirection: 'row', gap: 8, marginHorizontal: 16 },
  note: { flex: 1 },
  record: { marginTop: 16, marginHorizontal: 16 },
  keys: { marginTop: 12, marginHorizontal: 16 },
});
