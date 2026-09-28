/**
 * Add expense / Edit expense (boards AddExpense, AddExpenseStates, CategoryPicker, CategoryChosen, light and dark):
 * keypad first, the title with its category chip, Paid by, the date, the Split row, and Save. Two required fields
 * (amount and title); Save is one tap with a success haptic. Advanced split is a push (`split.tsx`), not a modal in
 * a modal.
 *
 * States as drawn: first open ("$0" muted, the dashed "Category" chip, Save off); Edit expense ("Save changes");
 * typing the title (the keypad hides, the amount shrinks to one line, Save sits above the keyboard); a failed save
 * (the error line just above Save, everything typed kept); the Paid by and date pickers as sheets.
 */
import { exponentOf, LIMITS, type Category, type GroupState } from '@even/core';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import {
  AmountDisplay,
  AppText,
  Button,
  CategoryGrid,
  Icon,
  Keypad,
  SelectPill,
  TextField,
  type KeypadKey,
} from '@/components';
import { draftFromResolved, draftToSpec, equalDraft, summarize } from '@/features/split/draft';
import { prepareCategoryModel, refineCategory, useApp, useGroup, useMe } from '@/state';
import { useTheme } from '@/theme';

import { applyKey, entryToMinor, minorToEntry } from './amountEntry';
import { ChipController, initialChipState } from './chipMachine';
import { ChipSlot } from './ChipSlot';
import {
  createDraft,
  deleteDraft,
  getDraft,
  todayIso,
  updateDraft,
  useDraft,
  type SheetDraft,
} from './draft';
import { DateSheet } from './DateSheet';
import { dateLabel, listedMembers, memberLabel, saveErrorMessage } from './labels';
import { MemberPickerSheet } from './MemberPickerSheet';
import { RouteSheet, useRouteSheet } from './RouteSheet';
import { leaveSheet, splitHref } from './routing';
import { SplitRow } from './SplitRow';

export interface AddExpenseSheetProps {
  groupId: string;
  /** `?edit=<expenseId>`. */
  editId: string | null;
  /** `?draft=<id>`: reopen a draft (the dev seed prepares one). */
  draftId: string | null;
  /** Development builds only (the dev seed's screenshots): type the title, or open a picker. */
  dev?: AddExpenseDev;
}

export interface AddExpenseDev {
  focusTitle?: boolean;
  sheet?: 'payer' | 'date';
}

function newDraft(groupId: string): SheetDraft {
  return createDraft({
    groupId,
    editId: null,
    title: '',
    amountText: '',
    paidBy: null,
    date: todayIso(),
    split: null,
    chip: null,
    pickerOpen: false,
    splitFocus: null,
    error: null,
  });
}

/** An edited expense's draft: its fields, its split re-opened in the editor, its category as your choice. */
function editDraft(
  groupId: string,
  expenseId: string,
  state: GroupState,
  meId: string | null,
): SheetDraft | null {
  const expense = state.expenses.get(expenseId);
  if (expense === undefined) return null;
  const members = listedMembers(state, meId).map((m) => m.id);
  return createDraft({
    groupId,
    editId: expenseId,
    title: expense.title,
    amountText: minorToEntry(expense.amount, exponentOf(expense.currency)),
    paidBy: expense.paidBy,
    date: expense.date,
    split: draftFromResolved(expense.amount, expense.split, members, expenseId),
    chip: initialChipState(expense.title, expense.category),
    pickerOpen: false,
    splitFocus: null,
    error: null,
  });
}

export function AddExpenseSheet({
  groupId,
  editId,
  draftId: requested,
  dev,
}: AddExpenseSheetProps) {
  const sheet = useRouteSheet('present');
  const { derived } = useGroup(groupId);
  const { memberId: meId } = useMe(groupId);
  const state = derived?.state ?? null;
  const currency = derived?.currency ?? null;
  const draftRef = useRef<string | null>(null);
  const onDraft = useCallback((id: string | null) => {
    draftRef.current = id;
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    sheet.close(() => {
      if (draftRef.current !== null) deleteDraft(draftRef.current);
      leaveSheet(groupId);
    });
  }, [groupId, sheet]);

  const editing = (getDraft(requested)?.editId ?? editId) !== null;
  const title = editing ? 'Edit expense' : 'New expense';
  return (
    <RouteSheet
      sheet={sheet}
      onDismiss={close}
      accessibilityLabel={title}
      leftAction={{ label: 'Cancel', onPress: close }}
      navTitle={title}
      bottom="keypad"
    >
      {state !== null && currency !== null ? (
        <DraftedForm
          requested={requested}
          editId={editId}
          groupId={groupId}
          state={state}
          currency={currency}
          meId={meId}
          onDraft={onDraft}
          onSaved={close}
          dev={dev}
        />
      ) : null}
    </RouteSheet>
  );
}

/** Opens the requested draft, or makes one (from the edited expense, or empty), once the group is loaded. */
function DraftedForm({
  requested,
  editId,
  groupId,
  state,
  currency,
  meId,
  onDraft,
  onSaved,
  dev,
}: {
  requested: string | null;
  editId: string | null;
  groupId: string;
  state: GroupState;
  currency: string;
  meId: string | null;
  onDraft: (id: string | null) => void;
  onSaved: () => void;
  dev?: AddExpenseDev;
}) {
  const [draftId] = useState<string | null>(
    () =>
      getDraft(requested)?.id ??
      (editId === null
        ? newDraft(groupId).id
        : (editDraft(groupId, editId, state, meId)?.id ?? null)),
  );
  useEffect(() => onDraft(draftId), [draftId, onDraft]);
  const draft = useDraft(draftId);
  if (draft === undefined) return null;
  return (
    <ExpenseForm
      draft={draft}
      state={state}
      currency={currency}
      meId={meId}
      groupId={groupId}
      onSaved={onSaved}
      dev={dev}
    />
  );
}

/** Every split problem reads the same on the sheet: the fix is in Split. */
const SPLIT_PROBLEM = "The split doesn't add up to the amount. Open Split to fix it.";

function ExpenseForm({
  draft,
  state,
  currency,
  meId,
  groupId,
  onSaved,
  dev,
}: {
  draft: SheetDraft;
  state: GroupState;
  currency: string;
  meId: string | null;
  groupId: string;
  onSaved: () => void;
  dev?: AddExpenseDev;
}) {
  const { tokens } = useTheme();
  const { groups } = useApp();
  const exponent = exponentOf(currency);
  const [controller] = useState(
    () =>
      new ChipController(draft.title, draft.chip ?? initialChipState(draft.title), {
        refine: refineCategory,
        schedule: (fn, ms) => {
          const timer = setTimeout(fn, ms);
          return () => clearTimeout(timer);
        },
      }),
  );
  useEffect(() => () => controller.dispose(), [controller]);
  // The amount comes first (keypad-first), so the on-device model has loaded by the time the title pauses.
  useEffect(() => {
    if (controller.getState().source !== 'user') prepareCategoryModel();
  }, [controller]);
  const chip = useSyncExternalStore(controller.subscribe, controller.getState);
  const [pickerOpen, setPickerOpen] = useState(draft.pickerOpen);
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'payer' | 'date' | null>(null);
  // Development: open a picker once the sheet is up (the dev seed's screenshots).
  useEffect(() => {
    if (!__DEV__ || dev?.sheet === undefined) return;
    const which = dev.sheet;
    const timer = setTimeout(() => setSheet(which), 500);
    return () => clearTimeout(timer);
  }, [dev?.sheet]);

  const today = todayIso();
  const amount = entryToMinor(draft.amountText, exponent);
  const listed = listedMembers(state, meId);
  const activeIds = listed.map((m) => m.id);
  const split = draft.split ?? equalDraft(activeIds);
  const nameOf = (id: string) => memberLabel(state.members.get(id), meId);
  const summary = summarize(split, amount, currency, activeIds, { nameOf });
  const paidBy = draft.paidBy ?? meId;
  const payer = paidBy === null ? undefined : state.members.get(paidBy);
  const canSave = amount > 0 && draft.title.trim() !== '' && paidBy !== null && !saving;
  const editing = draft.editId !== null;

  const patch = (p: Partial<Omit<SheetDraft, 'id'>>) => updateDraft(draft.id, p);

  const onTitle = (title: string) => {
    patch({ title, error: null });
    controller.setTitle(title);
  };
  const onKey = (key: KeypadKey) => {
    const next = applyKey(draft.amountText, key, exponent);
    if (next !== draft.amountText) patch({ amountText: next, error: null });
  };
  const onChip = () => {
    Keyboard.dismiss();
    setPickerOpen((open) => !open);
  };
  const onPickCategory = (category: Category) => {
    controller.tap(category);
    setPickerOpen(false);
  };
  const openSplit = () => {
    Keyboard.dismiss();
    setPickerOpen(false);
    router.push(splitHref(draft.id));
  };
  const openSheet = (which: 'payer' | 'date') => {
    Keyboard.dismiss();
    setSheet(which);
  };

  const onSave = async () => {
    if (!canSave || paidBy === null) return;
    const result = draftToSpec(split, amount);
    if (!result.ok) {
      patch({ error: SPLIT_PROBLEM });
      return;
    }
    const category = controller.freeze();
    setSaving(true);
    try {
      const title = draft.title.trim();
      if (draft.editId === null) {
        await groups.addExpense(groupId, {
          title,
          amount,
          paidBy,
          date: draft.date,
          category,
          split: result.spec,
        });
      } else {
        await groups.updateExpense(groupId, draft.editId, {
          title,
          amount,
          split: result.spec,
          paidBy,
          date: draft.date,
          category,
        });
      }
      onSaved();
    } catch (error) {
      setSaving(false);
      patch({ error: saveErrorMessage(error) });
    }
  };

  return (
    <View style={styles.body}>
      {typing ? (
        <View style={styles.amountCompact}>
          <AmountDisplay
            amount={amount}
            currency={currency}
            empty={draft.amountText === ''}
            compact
            onPress={Keyboard.dismiss}
          />
        </View>
      ) : (
        <Pressable
          onPress={Keyboard.dismiss}
          accessible={false}
          style={[styles.amount, pickerOpen && styles.amountPicking]}
        >
          <AmountDisplay amount={amount} currency={currency} empty={draft.amountText === ''} />
        </Pressable>
      )}
      <TextField
        variant="title"
        accessibilityLabel="Title"
        placeholder="Title"
        value={draft.title}
        onChangeText={onTitle}
        maxLength={LIMITS.titleMax}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
        onFocus={() => {
          setTyping(true);
          setPickerOpen(false);
        }}
        onBlur={() => setTyping(false)}
        autoFocus={__DEV__ && dev?.focusTitle === true}
        containerStyle={styles.gutter}
        trailing={
          <ChipSlot chip={chip} title={draft.title} choosing={pickerOpen} onPress={onChip} />
        }
      />
      <View style={styles.pills}>
        <SelectPill
          label="Paid by"
          value={memberLabel(payer, meId)}
          onPress={() => openSheet('payer')}
        />
        <SelectPill
          value={dateLabel(draft.date, today)}
          onPress={() => openSheet('date')}
          accessibilityLabel={`Date: ${dateLabel(draft.date, today)}`}
        />
      </View>
      <SplitRow label={summary.label} detail={summary.detail} onPress={openSplit} />
      {typing && <View style={styles.flex} />}
      {draft.error !== null && (
        <View style={styles.error} accessibilityRole="alert">
          <Icon name="warning" size={16} color={tokens.text} strokeWidth={2.2} />
          <AppText variant="footnote" weight="semibold" style={styles.flexShrink}>
            {draft.error}
          </AppText>
        </View>
      )}
      <Button
        label={editing ? 'Save changes' : 'Save'}
        haptic="success"
        disabled={!canSave}
        onPress={() => void onSave()}
        style={[
          styles.save,
          typing && styles.saveTyping,
          draft.error !== null && styles.saveAfterError,
        ]}
      />
      {typing ? null : pickerOpen ? (
        <View style={styles.keys}>
          <CategoryGrid value={chip.category} onChange={onPickCategory} />
        </View>
      ) : (
        <View style={styles.keys}>
          <Keypad onKey={onKey} decimal={exponent > 0} />
        </View>
      )}
      <MemberPickerSheet
        visible={sheet === 'payer'}
        title="Paid by"
        members={listedMembers(state, meId, paidBy === null ? [] : [paidBy])}
        meId={meId}
        value={paidBy}
        onPick={(id) => {
          patch({ paidBy: id, error: null });
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
      />
      <DateSheet
        visible={sheet === 'date'}
        value={draft.date}
        today={today}
        onDone={(date) => {
          patch({ date, error: null });
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
  flexShrink: { flexShrink: 1 },
  /** Typing the title: the amount on one line, 8 below the header and 12 above the title. */
  amountCompact: { alignItems: 'center', marginTop: 8, marginBottom: 12, marginHorizontal: 16 },
  amount: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  amountPicking: { paddingVertical: 4 },
  gutter: { marginHorizontal: 16 },
  pills: { flexDirection: 'row', gap: 8, marginTop: 12, marginHorizontal: 16 },
  save: { marginTop: 16, marginHorizontal: 16 },
  /** Keyboard up: Save sits on the spacer, 12 above the keyboard. */
  saveTyping: { marginTop: 0 },
  /** Save failed: the line sits 14 under the Split row and Save 10 under it. */
  saveAfterError: { marginTop: 10 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginHorizontal: 20,
  },
  keys: { marginTop: 12, marginHorizontal: 16 },
});
