/**
 * Record a payment (boards Settle, SettleStates, light and dark): From → To, the amount on the keypad, the date and
 * an optional note, "Record payment", and under it "Records that the money moved. Send it however you like."
 * Prefilled from the tapped settle-list row (`?from&to&amount`, amount in minor units); opened from Balances'
 * "Settle up" it starts empty (you pay, "Choose" whom, "$0"). From and To open the member sheet (everyone except
 * whoever is on the other side). Recorded, the button becomes "✓ Recorded" for 0.8 s with a light haptic, then the
 * sheet closes.
 *
 * On a screen shorter than the boards, Record payment, its footnote and the keypad keep their size and place, and the
 * rest gives way as on Add expense (`fitShortScreen`); From and To, the amount, the date and the note scroll only once
 * nothing else can.
 */
import { exponentOf, LIMITS, type GroupState } from '@even/core';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';

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
import { AMOUNT_PAD, fitShortScreen, KEYPAD_GAP } from '@/features/addExpense/shortScreen';
import { useOverflowScroll } from '@/features/addExpense/useOverflowScroll';
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

/** The footnote's gap under Record payment, as drawn. */
const FOOTNOTE_GAP = 8;

/**
 * The heights that never give way on a short screen, each measured on its own element (as on Add expense, so
 * positions round as before): the form, From and To, the date and note, the error line, Record payment (or
 * "✓ Recorded"), the footnote, and the keypad.
 */
interface Measured {
  body: number;
  people: number;
  details: number;
  error: number;
  record: number;
  footnote: number;
  keys: number;
}

/**
 * How the sheet fits the screen (`fitShortScreen`): as drawn until everything is measured, and while the note is typed
 * (the keypad is down then, and only scrolling gives way). The gaps between the rows are the drawn ones.
 */
function useShortFit(typing: boolean, error: boolean, recorded: boolean) {
  const { fontScale } = useWindowDimensions();
  const [box, setBox] = useState<Measured>({
    body: 0,
    people: 0,
    details: 0,
    error: 0,
    record: 0,
    footnote: 0,
    keys: 0,
  });
  const measure = useCallback(
    (key: keyof Measured) => (e: LayoutChangeEvent) => {
      const height = e.nativeEvent.layout.height;
      setBox((b) => (Math.abs(b[key] - height) < 0.5 ? b : { ...b, [key]: height }));
    },
    [],
  );
  const ready =
    box.body > 0 &&
    box.people > 0 &&
    box.details > 0 &&
    box.record > 0 &&
    box.footnote > 0 &&
    box.keys > 0 &&
    (!error || box.error > 0);
  if (typing || !ready) return { fit: null, measure };
  const rows = styles.people.marginTop + box.people + box.details;
  const gap = recorded
    ? styles.recorded.marginTop
    : error
      ? styles.recordAfterError.marginTop
      : styles.record.marginTop;
  const record = (error ? styles.error.marginTop + box.error : 0) + gap + box.record;
  const below = FOOTNOTE_GAP + box.footnote + box.keys;
  return { fit: fitShortScreen(box.body - rows - record - below, fontScale, false), measure };
}

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
  const { fit, measure } = useShortFit(typing, error !== null, recorded);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scroll = useOverflowScroll(scrollRef);
  // Typing the note on a short screen: the rows stay scrolled to their end as the keyboard comes up, so the note sits
  // just above Record payment.
  useEffect(() => {
    if (typing && scroll.scrollable) scrollRef.current?.scrollToEnd({ animated: false });
  }, [typing, scroll.scrollable, scroll.view]);
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
    <View style={styles.body} onLayout={measure('body')}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.grow}
        scrollEnabled={scroll.scrollable}
        keyboardShouldPersistTaps="handled"
        onLayout={scroll.onLayout}
        onContentSizeChange={scroll.onContentSizeChange}
      >
        <View style={styles.people} onLayout={measure('people')}>
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
        <Pressable
          onPress={Keyboard.dismiss}
          accessible={false}
          style={[
            styles.amount,
            fit !== null && fit.amountPadTop !== AMOUNT_PAD && { paddingTop: fit.amountPadTop },
          ]}
        >
          <AmountDisplay
            amount={amount}
            currency={currency}
            empty={amountText === ''}
            scale={fit?.amountScale}
            inline={fit?.amountInline}
          />
        </Pressable>
        <View style={styles.details} onLayout={measure('details')}>
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
      </ScrollView>
      {error !== null && (
        <View style={styles.error} accessibilityRole="alert" onLayout={measure('error')}>
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
          onLayout={measure('record')}
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
          onLayout={measure('record')}
          style={[styles.record, error !== null && styles.recordAfterError]}
        />
      )}
      <Footnote align="center" spacingTop={FOOTNOTE_GAP} onLayout={measure('footnote')}>
        Records that the money moved. Send it however you like.
      </Footnote>
      {!typing && (
        <View
          onLayout={measure('keys')}
          style={[
            styles.keys,
            fit !== null && fit.keypadGap !== KEYPAD_GAP && { marginTop: fit.keypadGap },
          ]}
        >
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
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
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
