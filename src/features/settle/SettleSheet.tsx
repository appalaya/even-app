/**
 * Record a payment (boards Settle, SettleStates, light and dark): From → To, the amount on the keypad, the date and
 * an optional note, "Record payment", and under it "Records that the money moved. Send it however you like."
 * Prefilled from the tapped settle-list row (`?from&to&amount`, amount in minor units); opened from Balances'
 * "Settle up" it starts empty (you pay, "Choose" whom, "$0"). From and To open the member sheet (everyone except
 * whoever is on the other side). Recorded, the button becomes "✓ Recorded" for 0.8 s with a light haptic, then the
 * sheet closes.
 */
import { exponentOf, LIMITS, type GroupState } from '@even/core';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import {
  AmountDisplay,
  AppText,
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
import { DateSheet } from '@/features/addExpense/DateSheet';
import { todayIso } from '@/features/addExpense/draft';
import {
  dateLabel,
  listedMembers,
  memberLabel,
  saveErrorMessage,
} from '@/features/addExpense/labels';
import { MemberPickerSheet } from '@/features/addExpense/MemberPickerSheet';
import { RouteSheet, useRouteSheet } from '@/features/addExpense/RouteSheet';
import { useApp, useGroup, useMe } from '@/state';
import { radii, useTheme } from '@/theme';

import { MemberSelect } from './MemberSelect';
import { settleStart } from './settleDraft';

export interface SettleSheetProps {
  groupId: string;
  params: { from?: string; to?: string; amount?: string };
  /** Leaves the route once the sheet is down. */
  onClosed: () => void;
  /** Development builds only (the dev seed's screenshots): open a picker, or show "✓ Recorded" and stay. */
  dev?: { sheet?: 'to' | 'from' | 'date'; recorded?: boolean };
}

export function SettleSheet({ groupId, params, onClosed, dev }: SettleSheetProps) {
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
          dev={dev}
        />
      ) : null}
    </RouteSheet>
  );
}

/** How long "✓ Recorded" shows before the sheet closes (Settle, extra states). */
const RECORDED_MS = 800;

function SettleForm({
  groupId,
  state,
  currency,
  meId,
  params,
  onSaved,
  dev,
}: {
  groupId: string;
  state: GroupState;
  currency: string;
  meId: string | null;
  params: SettleSheetProps['params'];
  onSaved: () => void;
  dev?: SettleSheetProps['dev'];
}) {
  const { tokens } = useTheme();
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
  const [amountText, setAmountText] = useState(() =>
    start.amount > 0 ? minorToEntry(start.amount, exponent) : '',
  );
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState('');
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState(__DEV__ && dev?.recorded === true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'From' | 'To' | 'date' | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Development: open a picker once the sheet is up (the dev seed's screenshots).
  useEffect(() => {
    if (!__DEV__ || dev?.sheet === undefined) return;
    const which = dev.sheet === 'to' ? 'To' : dev.sheet === 'from' ? 'From' : 'date';
    const timer = setTimeout(() => setSheet(which), 500);
    return () => clearTimeout(timer);
  }, [dev?.sheet]);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const today = todayIso();
  const amount = entryToMinor(amountText, exponent);
  const canSave = amount > 0 && from !== null && to !== null && from !== to && !saving;

  const openSheet = (which: 'From' | 'To' | 'date') => {
    Keyboard.dismiss();
    setSheet(which);
  };
  const onKey = (key: KeypadKey) => {
    if (recorded) return;
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
      setRecorded(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      closeTimer.current = setTimeout(onSaved, RECORDED_MS);
    } catch (e) {
      setSaving(false);
      setError(saveErrorMessage(e));
    }
  };

  const fromMember = from === null ? undefined : state.members.get(from);
  const toMember = to === null ? undefined : state.members.get(to);
  const role = sheet === 'From' || sheet === 'To' ? sheet : null;
  const other = role === 'From' ? to : role === 'To' ? from : null;
  return (
    <View style={styles.body}>
      <View style={styles.people}>
        <View style={styles.person}>
          <FieldLabel>From</FieldLabel>
          <MemberSelect
            role="From"
            member={fromMember}
            label={memberLabel(fromMember, meId)}
            onPress={() => openSheet('From')}
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
            onPress={() => openSheet('To')}
          />
        </View>
      </View>
      <Pressable onPress={Keyboard.dismiss} accessible={false} style={styles.amount}>
        <AmountDisplay amount={amount} currency={currency} empty={amountText === ''} />
      </Pressable>
      <View style={styles.details}>
        <SelectPill
          value={dateLabel(date, today)}
          onPress={() => openSheet('date')}
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
          containerStyle={styles.note}
        />
      </View>
      {error !== null && (
        <View style={styles.error} accessibilityRole="alert">
          <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
          <AppText variant="footnote" weight="semibold" style={styles.errorText}>
            {error}
          </AppText>
        </View>
      )}
      {recorded ? (
        <View
          style={[styles.recorded, { backgroundColor: tokens.accentSoft }]}
          accessibilityRole="alert"
          accessibilityLabel="Recorded"
        >
          <Icon name="check" size={20} color={tokens.accent} />
          <AppText weight="semibold" color="accent">
            Recorded
          </AppText>
        </View>
      ) : (
        <Button
          label="Record payment"
          disabled={!canSave}
          onPress={() => void onRecord()}
          style={[styles.record, error !== null && styles.recordAfterError]}
        />
      )}
      <Footnote align="center" spacingTop={8}>
        Records that the money moved. Send it however you like.
      </Footnote>
      {!typing && (
        <View style={styles.keys}>
          <Keypad onKey={onKey} keyHeight={52} decimal={exponent > 0} />
        </View>
      )}
      <MemberPickerSheet
        visible={role !== null}
        title={role ?? 'To'}
        members={listed.filter((m) => m.id !== other)}
        meId={meId}
        value={role === 'From' ? from : to}
        onPick={(id) => {
          setError(null);
          if (role === 'From') setFrom(id);
          else setTo(id);
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
      />
      <DateSheet
        visible={sheet === 'date'}
        value={date}
        today={today}
        onDone={(picked) => {
          setDate(picked);
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
      />
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
  recordAfterError: { marginTop: 10 },
  /** "✓ Recorded": the button's place, 52 tall, soft accent, a 20 pt check 8 before the label. */
  recorded: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: radii.round,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginHorizontal: 20,
  },
  errorText: { flexShrink: 1 },
  keys: { marginTop: 12, marginHorizontal: 16 },
});
