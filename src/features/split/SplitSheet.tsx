/**
 * Split, pushed from Add expense (boards Split = Exact, SplitEqual, SplitPercent, light and dark): segmented
 * Equal · Exact · Percent over one member list. Equal has a ×n stepper and a "+ extra" field per member (extras come
 * off the top, the rest splits by share); Exact and Percent type into the member's cell with the keypad, and Done
 * turns on when Remaining reaches zero (no caption says so: the Remaining line and the dimmed Done do). Excluded members stay listed as "Not included"; archived members
 * already on the expense stay visible. Done hands the split back to the sheet's draft; back discards the edit.
 */
import { exponentOf, formatMinor, LIMITS, type GroupState, type MemberState } from '@even/core';
import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';

import {
  AmountCell,
  AppText,
  Avatar,
  Card,
  Checkbox,
  Icon,
  Keypad,
  SegmentedControl,
  type KeypadKey,
} from '@/components';
import { applyKey, entryToMinor, minorToEntry } from '@/features/addExpense/amountEntry';
import { updateDraft, useDraft, type SheetDraft } from '@/features/addExpense/draft';
import { listedMembers, memberLabel } from '@/features/addExpense/labels';
import { RouteSheet, useRouteSheet } from '@/features/addExpense/RouteSheet';
import { useGroup, useMe } from '@/state';
import { useTheme } from '@/theme';

import { ExtraField, SharesStepper } from './controls';
import {
  amountOf,
  BPS_TOTAL,
  bpsOf,
  draftToSpec,
  equalDraft,
  extraOf,
  formatBps,
  includedIds,
  isIncluded,
  previewAmounts,
  remaining,
  setAmount,
  setBps,
  setExtra,
  setWeight,
  sharesLine,
  switchMode,
  toggleMember,
  weightOf,
  type SplitDraft,
  type SplitMode,
} from './draft';

const MODES = [
  { key: 'equal', label: 'Equal' },
  { key: 'exact', label: 'Exact' },
  { key: 'percent', label: 'Percent' },
] as const;

/** The editor's starting point: the draft's split, or everyone equally; anyone who joined since is listed, not in. */
function initialSplit(draft: SheetDraft, state: GroupState, meId: string | null): SplitDraft {
  const active = listedMembers(state, meId).map((m) => m.id);
  const base = draft.split ?? equalDraft(active);
  const missing = active.filter((id) => !base.members.includes(id));
  if (missing.length === 0) return base;
  return {
    ...base,
    members: [...base.members, ...missing],
    included: { ...base.included, ...Object.fromEntries(missing.map((id) => [id, false])) },
  };
}

export function SplitSheet({ groupId, draftId }: { groupId: string; draftId: string | null }) {
  const sheet = useRouteSheet('push');
  const draft = useDraft(draftId);
  const { derived } = useGroup(groupId);
  const { memberId: meId } = useMe(groupId);
  const state = derived?.state ?? null;
  const currency = derived?.currency ?? null;
  const ready = draft !== undefined && state !== null && currency !== null;
  /** Null until the first edit: until then the editor shows the draft's split (or everyone, equally). */
  const [edited, setEdited] = useState<SplitDraft | null>(null);
  const split = edited ?? (ready ? initialSplit(draft, state, meId) : null);

  const back = useCallback(() => {
    Keyboard.dismiss();
    sheet.close(() => router.back());
  }, [sheet]);
  const amount =
    draft !== undefined && currency !== null
      ? entryToMinor(draft.amountText, exponentOf(currency))
      : 0;
  const valid = split !== null && draftToSpec(split, amount).ok;
  const done = () => {
    if (!valid || draft === undefined) return;
    updateDraft(draft.id, { split, error: null });
    back();
  };

  return (
    <RouteSheet
      sheet={sheet}
      onDismiss={back}
      accessibilityLabel="Split"
      leftAction={{
        label: draft?.editId != null ? 'Edit expense' : 'New expense',
        back: true,
        onPress: back,
      }}
      navTitle="Split"
      rightAction={{ label: 'Done', disabled: !valid, onPress: done }}
      bottom="keypad"
    >
      {ready && split !== null ? (
        <SplitEditor
          draft={draft}
          state={state}
          currency={currency}
          meId={meId}
          split={split}
          onChange={setEdited}
        />
      ) : null}
    </RouteSheet>
  );
}

function SplitEditor({
  draft,
  state,
  currency,
  meId,
  split,
  onChange: update,
}: {
  draft: SheetDraft;
  state: GroupState;
  currency: string;
  meId: string | null;
  split: SplitDraft;
  onChange: (split: SplitDraft) => void;
}) {
  const { tokens } = useTheme();
  const exponent = exponentOf(currency);
  const amount = entryToMinor(draft.amountText, exponent);
  const seed = draft.editId ?? draft.id;
  const [focus, setFocus] = useState<string | null>(
    () => draft.splitFocus ?? includedIds(split)[0] ?? null,
  );
  /** The cell's keypad text; `fresh` until the first key, which then replaces the value. */
  const [entry, setEntry] = useState<{ text: string; fresh: boolean }>({ text: '', fresh: true });

  const members = useMemo(
    () =>
      split.members
        .map((id) => state.members.get(id))
        .filter((m): m is MemberState => m !== undefined),
    [split.members, state],
  );
  const preview = previewAmounts(split, amount, seed);
  const left = remaining(split, amount);
  const keyed = split.mode !== 'equal';

  const focusOn = (id: string) => {
    setFocus(id);
    setEntry({ text: '', fresh: true });
  };
  const onMode = (mode: SplitMode) => {
    const next = switchMode(split, mode, amount, seed);
    update(next);
    if (mode !== 'equal' && (focus === null || !isIncluded(next, focus))) {
      const first = includedIds(next)[0];
      if (first !== undefined) focusOn(first);
    } else {
      setEntry({ text: '', fresh: true });
    }
  };
  const onToggle = (id: string) => {
    const next = toggleMember(split, id);
    update(next);
    if (focus === id && !isIncluded(next, id)) {
      setFocus(includedIds(next)[0] ?? null);
      setEntry({ text: '', fresh: true });
    }
  };
  const onKey = (key: KeypadKey) => {
    if (focus === null || !isIncluded(split, focus)) return;
    const percent = split.mode === 'percent';
    const exp = percent ? 2 : exponent;
    const max = percent ? BPS_TOTAL : LIMITS.amountMax;
    const value = percent ? bpsOf(split, focus) : amountOf(split, focus);
    const start = entry.fresh ? (key === 'delete' ? minorToEntry(value, exp) : '') : entry.text;
    const text = applyKey(start, key, exp, max);
    setEntry({ text, fresh: false });
    const minor = entryToMinor(text, exp);
    update(percent ? setBps(split, focus, minor) : setAmount(split, focus, minor));
  };

  const rows: ReactNode[] = members.map((member) => {
    const id = member.id;
    const name = memberLabel(member, meId);
    const whose = id === meId ? 'Your' : `${member.name}'s`;
    const included = isIncluded(split, id);
    const include = (
      <Checkbox
        checked={included}
        onToggle={() => onToggle(id)}
        label={`Include ${id === meId ? 'you' : member.name}`}
        style={split.mode === 'equal' && included ? styles.checkTop : undefined}
      />
    );
    const avatar = (
      <Avatar
        size={32}
        name={member.name}
        initials={member.initials}
        emoji={member.emoji}
        color={member.color}
        on="inset"
        dimmed={!included}
      />
    );
    if (!included) {
      return (
        <View
          key={id}
          style={[styles.row, styles.rowOut, split.mode === 'equal' && styles.rowOutEqual]}
        >
          {include}
          {avatar}
          <AppText variant="callout" color="textMuted" numberOfLines={1} style={styles.flex}>
            {name}
          </AppText>
          <AppText variant="caption" color="textMuted">
            Not included
          </AppText>
        </View>
      );
    }
    if (split.mode === 'equal') {
      return (
        <View key={id} style={styles.equalRow}>
          {include}
          {avatar}
          <View style={styles.equalName}>
            <AppText variant="callout" numberOfLines={1}>
              {name}
            </AppText>
          </View>
          <View style={styles.equalRight}>
            <AppText variant="callout" weight="semibold" tabular style={styles.equalAmount}>
              {formatMinor(preview[id] ?? 0, currency)}
            </AppText>
            <View style={styles.controls}>
              <SharesStepper
                weight={weightOf(split, id)}
                onChange={(w) => update(setWeight(split, id, w))}
                label={`${whose} shares`}
              />
              <ExtraField
                extra={extraOf(split, id)}
                currency={currency}
                onChange={(minor) => update(setExtra(split, id, minor))}
                label={`Extra for ${id === meId ? 'you' : member.name}`}
              />
            </View>
          </View>
        </View>
      );
    }
    const percent = split.mode === 'percent';
    return (
      <View key={id} style={styles.row}>
        {include}
        {avatar}
        <AppText variant="callout" numberOfLines={1} style={styles.flex}>
          {name}
        </AppText>
        {percent && (
          <AppText variant="subhead" color="textMuted" tabular>
            {formatMinor(preview[id] ?? 0, currency)}
          </AppText>
        )}
        <AmountCell
          width={percent ? 76 : 100}
          active={focus === id}
          onPress={() => focusOn(id)}
          accessibilityLabel={`${percent ? 'Percent' : 'Amount'} for ${name}`}
          value={percent ? formatBps(bpsOf(split, id)) : formatMinor(amountOf(split, id), currency)}
        />
      </View>
    );
  });

  const subtitle =
    draft.title.trim() === ''
      ? formatMinor(amount, currency)
      : `${draft.title.trim()} · ${formatMinor(amount, currency)}`;

  return (
    <View style={styles.body}>
      <AppText
        variant="subhead"
        color="textSecondary"
        align="center"
        tabular
        style={styles.subtitle}
      >
        {subtitle}
      </AppText>
      <View style={styles.segments}>
        <SegmentedControl segments={MODES} value={split.mode} onChange={onMode} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card tone="fill" separatorInset={split.mode === 'equal' ? 46 : 48} style={styles.list}>
          {rows}
        </Card>
        {split.mode !== 'equal' && left < 0 ? (
          // Over-assigned (Split, extra states): the attention style, never red; Done stays off.
          <View style={[styles.totalRow, styles.overRow]} accessibilityRole="alert">
            <View style={styles.over}>
              <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
              <AppText variant="subhead" weight="bold">
                Over by
              </AppText>
            </View>
            <AppText weight="bold" tabular>
              {split.mode === 'exact' ? formatMinor(-left, currency) : formatBps(-left)}
            </AppText>
          </View>
        ) : (
          <View style={styles.totalRow}>
            <AppText variant="subhead" color="textSecondary">
              {split.mode === 'equal' ? 'Total' : 'Remaining'}
            </AppText>
            <AppText weight="semibold" tabular>
              {split.mode === 'equal'
                ? formatMinor(amount, currency)
                : split.mode === 'exact'
                  ? formatMinor(left, currency)
                  : formatBps(left)}
            </AppText>
          </View>
        )}
        {split.mode === 'equal' && (
          <AppText variant="caption" color="textMuted" tabular style={styles.note}>
            {sharesLine(split, amount, currency)}
          </AppText>
        )}
      </ScrollView>
      {keyed && (
        <View style={styles.keys}>
          <Keypad onKey={onKey} keyHeight={52} decimal={split.mode === 'percent' || exponent > 0} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  flex: { flex: 1 },
  subtitle: { marginTop: 2, marginHorizontal: 20 },
  segments: { marginTop: 14, marginHorizontal: 16 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: 2 },
  list: { marginTop: 12, marginHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingLeft: 14,
    paddingRight: 10,
  },
  rowOut: { paddingRight: 16 },
  /** Equal (Split, extra states: one person left out): 10 between the columns, as the equal rows. */
  rowOutEqual: { gap: 10 },
  over: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overRow: { alignItems: 'center' },
  equalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 14,
    paddingRight: 12,
  },
  checkTop: { marginTop: 5 },
  equalName: { flex: 1, minWidth: 0, gap: 1, paddingTop: 5 },
  /** Takes what it needs (the name gives way first); shrinks only when even an empty name leaves too little. */
  equalRight: { flexShrink: 1, alignItems: 'flex-end', gap: 6 },
  equalAmount: { paddingTop: 5 },
  /**
   * The stepper, then the extra field on the row's right edge. The field grows to fit its amount; the stepper moves
   * left, and if the two no longer fit side by side it gives way to the line below (wrap-reverse), the field keeping
   * its place under the amount.
   */
  controls: { flexDirection: 'row', flexWrap: 'wrap-reverse', justifyContent: 'flex-end', gap: 6 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 14,
    marginHorizontal: 20,
  },
  note: { marginTop: 2, marginHorizontal: 20 },
  keys: { marginTop: 'auto', marginHorizontal: 16 },
});
