/**
 * Add expense / Edit expense (boards AddExpense, AddExpenseStates, CategoryPicker, CategoryChosen, light and dark):
 * keypad first, the title with its category chip, Paid by, the date, the Split row, and Save. Two required fields
 * (amount and title); Save is one tap with a success haptic. Advanced split is a push (`split.tsx`), not a modal in
 * a modal.
 *
 * States as drawn: first open ("$0" muted, the dashed "Category" chip, Save off); Edit expense ("Save changes");
 * typing the title (the keypad hides, the amount shrinks to one line, Save sits above the keyboard); a failed save
 * (the error line just above Save, everything typed kept); the Paid by and date pickers as sheets.
 *
 * On a screen shorter than the boards, Save and the keypad (or the category grid) keep their size and place, and the
 * rest gives way as `fitShortScreen` says; the rows above Save scroll only once nothing else can.
 */
import { exponentOf, LIMITS, type Category, type GroupState } from '@even/core';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import {
  AMOUNT_PAD,
  AMOUNT_PAD_PICKING,
  fitShortScreen,
  KEYPAD_GAP,
  type ShortFit,
} from './shortScreen';
import { SPLIT_ROW_GAP, SplitRow } from './SplitRow';
import { useOverflowScroll } from './useOverflowScroll';

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

/**
 * The heights that never give way on a short screen, each measured on its own element (a wrapper around several would
 * move them by a pixel at densities like 2.625, where Yoga rounds positions relative to the parent): the form, the
 * title, Paid by and the date, Split, the error line, Save, and the keypad or category grid.
 */
interface Measured {
  body: number;
  title: number;
  pills: number;
  split: number;
  error: number;
  save: number;
  keys: number;
}

/**
 * How the sheet fits the screen (`fitShortScreen`): as drawn until everything is measured, and while typing the title
 * (the keypad is down then, and only scrolling gives way). The gaps between the rows are the drawn ones.
 */
function useShortFit(typing: boolean, picking: boolean, error: boolean) {
  const { fontScale } = useWindowDimensions();
  const [box, setBox] = useState<Measured>({
    body: 0,
    title: 0,
    pills: 0,
    split: 0,
    error: 0,
    save: 0,
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
    box.title > 0 &&
    box.pills > 0 &&
    box.split > 0 &&
    box.save > 0 &&
    box.keys > 0 &&
    (!error || box.error > 0);
  if (typing || !ready) return { fit: null, measure };
  const rows = box.title + styles.pills.marginTop + box.pills + SPLIT_ROW_GAP + box.split;
  const save = error
    ? styles.error.marginTop + box.error + styles.saveAfterError.marginTop + box.save
    : styles.save.marginTop + box.save;
  const fit: ShortFit = fitShortScreen(box.body - rows - save - box.keys, fontScale, picking);
  return { fit, measure };
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
  // The amount comes first (keypad-first), so the on-device model has loaded by the time the title pauses. History is
  // looked up in this group first.
  useEffect(() => {
    if (controller.getState().source !== 'user') prepareCategoryModel(groupId);
  }, [controller, groupId]);
  const chip = useSyncExternalStore(controller.subscribe, controller.getState);
  const [pickerOpen, setPickerOpen] = useState(draft.pickerOpen);
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'payer' | 'date' | null>(null);
  const { fit, measure } = useShortFit(typing, pickerOpen, draft.error !== null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scroll = useOverflowScroll(scrollRef);
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

  const pad = pickerOpen ? AMOUNT_PAD_PICKING : AMOUNT_PAD;
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
            style={[
              styles.amount,
              pickerOpen && styles.amountPicking,
              fit !== null && fit.amountPadTop !== pad && { paddingTop: fit.amountPadTop },
            ]}
          >
            <AmountDisplay
              amount={amount}
              currency={currency}
              empty={draft.amountText === ''}
              scale={fit?.amountScale}
              inline={fit?.amountInline}
            />
          </Pressable>
        )}
        <View onLayout={measure('title')}>
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
        </View>
        <View style={styles.pills} onLayout={measure('pills')}>
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
        <SplitRow
          label={summary.label}
          detail={summary.detail}
          onPress={openSplit}
          onLayout={measure('split')}
        />
      </ScrollView>
      {draft.error !== null && (
        <View style={styles.error} accessibilityRole="alert" onLayout={measure('error')}>
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
        onLayout={measure('save')}
        style={[
          styles.save,
          typing && styles.saveTyping,
          draft.error !== null && styles.saveAfterError,
        ]}
      />
      {typing ? null : (
        <View
          onLayout={measure('keys')}
          style={[
            styles.keys,
            fit !== null && fit.keypadGap !== KEYPAD_GAP && { marginTop: fit.keypadGap },
          ]}
        >
          {pickerOpen ? (
            <CategoryGrid value={chip.category} onChange={onPickCategory} />
          ) : (
            <Keypad onKey={onKey} decimal={exponent > 0} />
          )}
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
  grow: { flexGrow: 1 },
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
  /** Keyboard up: Save sits under the rows' scroll view, which takes the room left, 12 above the keyboard. */
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
