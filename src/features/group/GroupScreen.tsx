import { isCurrency, type ExpenseState, type Transfer } from '@even/core';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  HeaderButton,
  Screen,
  SegmentedControl,
  type Segment,
  type StackMember,
} from '@/components';
import { InviteQrSheet } from '@/features/invite/InviteQrSheet';
import { PickNameStep } from '@/features/join/PickNameStep';
import {
  describeForLog,
  deviceSeat,
  useApp,
  useGroup,
  useMoveOffers,
  type MoveOffer,
} from '@/state';
import { layout, useTheme } from '@/theme';

import { DoneRow, DoneSheet } from './DoneAdding';
import { GroupBanners, lastBannerFlush } from './GroupBanners';
import {
  ArchiveOffer,
  BalanceSection,
  ClosedNote,
  NoSeatNote,
  SettledLine,
  SettleList,
  SpentSection,
} from './GroupHeader';
import { dayLabel, isoDateLabel } from './format';
import { ActivityDay, ActivityItem, BalancesTab, ExpenseRow, NoExpenses } from './GroupTabs';
import {
  useGroupNotifications,
  useGroupSync,
  useInvite,
  useLeaveWhenGone,
  useNow,
  useSheetOnEachView,
  useStatusLine,
} from './hooks';
import { InviteCard, PeopleRow, shareInvite } from './InviteCard';
import { promptFor } from './moveEntries';
import { MoveEntriesSheet } from './MoveEntriesSheet';
import {
  groupItemKey,
  groupItems,
  SEGMENT_INDEX,
  type GroupItem,
  type GroupTab,
} from './listItems';
import {
  activitySections,
  balanceRows,
  categoryRows,
  doneSummary,
  everyoneSettled,
  inviteLayout,
  myTransfers,
  offersNamePick,
  peopleOf,
  showsDoneRow,
  showsShareButton,
  sortedExpenses,
  spentSoFar,
} from './model';
import { groupHrefs } from './routes';
import { ShareButton, ShareMenu } from './ShareMenu';

export type { GroupTab } from './listItems';

const SEGMENTS: readonly Segment<GroupTab>[] = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'activity', label: 'Activity' },
];

/** The segmented control sticks this far under the nav bar (Group, Balances tab: 8). */
const STUCK_GAP = 8;

/**
 * Items mounted on open: the header, the segment and enough rows to fill the boards' screen and more (the Activity
 * board, stuck, shows about ten). The list mounts the rest as they near the screen.
 */
const INITIAL_ITEMS = 24;

export interface GroupScreenProps {
  localId: string;
  /** Opens on this tab (a deep link or the dev seed). */
  initialTab?: GroupTab;
  /** Opens with the Done adding sheet up. */
  initialSheet?: 'done';
  /** Opens on `initialTab` with the segment already stuck under the nav bar, as a tap on that tab leaves it. */
  initialStuck?: boolean;
}

/**
 * Group: the big number, the settle list, the done-adding row, then Expenses · Balances · Activity; Add expense in a
 * sticky footer. Until another member joins, the invite card replaces the big number (Group, just created) or, once
 * there are expenses, is pinned above it (Group, new with expenses). The segmented control sticks under the nav bar; choosing Balances or Activity scrolls it there (the
 * Balances and Activity boards) as far as the content allows, and Expenses scrolls back to the top (Group).
 *
 * A phone holding the group without a seat cannot add anything, so while it has none, each time Group comes into view
 * it presents "Which name is yours?" (SeatPick: the Join boards' sheet as offered again, `PickNameStep`). Closing it
 * only closes it: the group stays as it is and reads GroupNoSeat ("Spent so far", the note, no settle list or
 * done-adding row, no share arrow, "Pick your name" in place of Add expense, which opens the sheet again), and the
 * sheet comes back on the next focus. A seat the log already gives this device (a keychain recovery after a
 * reinstall) is restored without asking (`GroupService.restoreSeat`).
 *
 * The share arrow opens "Share link" · "Show QR code" (GroupShareMenu, `ShareMenu`).
 *
 * A regenerated invite whose old group holds entries this phone wrote that this group lacks asks, while this group
 * is on screen, "Move your Banff 2026 entries into the new group?" (MoveEntriesPrompt), once per rotation: Move is
 * the rescue, Not now (or closing it) leaves the move in the old group's settings.
 */
export function GroupScreen({
  localId,
  initialTab = 'expenses',
  initialSheet,
  initialStuck = false,
}: GroupScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { groups, deviceId } = useApp();
  const snapshot = useGroup(localId);
  const derived = snapshot.derived;
  const state = derived?.state ?? null;
  const myId = derived?.myMemberId ?? null;
  const now = useNow();
  const status = useStatusLine(localId);
  const { refreshing, onRefresh } = useGroupSync(localId);

  const [tab, setTab] = useState<GroupTab>(initialTab);
  const [doneOpen, setDoneOpen] = useState(initialSheet === 'done');
  const [menuOpen, setMenuOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  // The sheets are modals over the window: close them (and the share menu) when another screen covers this one.
  useFocusEffect(
    useCallback(
      () => () => {
        setDoneOpen(false);
        setMenuOpen(false);
        setQrOpen(false);
      },
      [],
    ),
  );
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // "Which name is yours?": up each time Group comes into view (a fresh sheet each time), down on blur and on close.
  // Whether it shows at all is `offersNamePick` below.
  const pick = useSheetOnEachView();

  // MoveEntriesPrompt: asked while this screen is in view; the offer stays set while the sheet slides away.
  const offer = promptFor(useMoveOffers(), localId);
  const [asked, setAsked] = useState<MoveOffer | null>(offer);
  if (offer !== null && offer !== asked) setAsked(offer);
  const [inView, setInView] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setInView(true);
      return () => setInView(false);
    }, []),
  );
  const [moving, setMoving] = useState(false);
  const moveEntries = (o: MoveOffer) => {
    setMoving(true);
    groups
      .moveEntries(o.to, o.from)
      .catch((error: unknown) => console.warn('moving entries failed', describeForLog(error)))
      .finally(() => setMoving(false));
  };
  const notNow = (o: MoveOffer) => {
    groups
      .notNowMove(o.from)
      .catch((error: unknown) => console.warn('not now failed', describeForLog(error)));
  };

  // This device's own seat is in the log but not on the row: give it back rather than ask. The lifecycle check does
  // this after every sync and at app start; this covers a group opened before that has run.
  const ownSeat =
    state !== null && derived?.needsClaim === true ? deviceSeat(state, deviceId) : null;
  useEffect(() => {
    if (ownSeat === null) return;
    groups.restoreSeat(localId).catch((error: unknown) => {
      console.warn('restoring the seat failed', describeForLog(error));
    });
  }, [ownSeat, groups, localId]);

  const card = state !== null && derived?.readOnly === null ? inviteLayout(state, myId) : 'none';
  const invite = useInvite(
    localId,
    derived?.inviteReady ?? false,
    derived !== null && state !== null,
  );

  useLeaveWhenGone(snapshot.status);
  useGroupNotifications(localId, state === null ? null : peopleOf(state).length);

  // ----- scrolling: the sticky segment -----
  const scrollRef = useRef<FlatList<GroupItem>>(null);
  const segmentY = useRef(0);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const pending = useRef<{ to: 'stick' | 'top'; animated: boolean } | null>(
    initialTab !== 'expenses' && initialStuck ? { to: 'stick', animated: false } : null,
  );

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Scrolls to the pending target once the scroll view and its content are measured. The target stays pending a
   * moment after the first scroll, so the new tab's content size (which can land a frame later) scrolls it again.
   */
  const applyScroll = useCallback(() => {
    const want = pending.current;
    if (want === null || viewportHeight.current === 0 || contentHeight.current === 0) return;
    const max = Math.max(0, contentHeight.current - viewportHeight.current);
    const y = want.to === 'top' ? 0 : Math.min(segmentY.current, max);
    scrollRef.current?.scrollToOffset({ offset: y, animated: want.animated });
    if (settleTimer.current === null) {
      settleTimer.current = setTimeout(() => {
        pending.current = null;
        settleTimer.current = null;
      }, 300);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(applyScroll, 0);
    return () => clearTimeout(timer);
  }, [tab, applyScroll]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  const changeTab = (next: GroupTab) => {
    if (next === tab) return;
    pending.current = { to: next === 'expenses' ? 'top' : 'stick', animated: true };
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    setTab(next);
  };

  const onScrollLayout = (e: LayoutChangeEvent) => {
    viewportHeight.current = e.nativeEvent.layout.height;
    applyScroll();
  };
  const onContentSize = (_w: number, h: number) => {
    contentHeight.current = h;
    applyScroll();
  };
  // The segment's cell starts where the header's ends, so the header's height is where the segment sticks.
  const onHeaderLayout = (e: LayoutChangeEvent) => {
    segmentY.current = e.nativeEvent.layout.height;
    applyScroll();
  };

  // ----- derived view data -----
  const view = useMemo(() => {
    if (derived === null || state === null) return null;
    return {
      done: doneSummary(state, myId),
      mine: myTransfers(derived.transfers, myId),
      balances: derived.nets === null ? [] : balanceRows(state, derived.nets, myId),
      categories: categoryRows(state),
      expenses: sortedExpenses(state),
    };
  }, [derived, state, myId]);
  const onActivity = tab === 'activity';
  const sections = useMemo(
    () => (state === null || !onActivity ? [] : activitySections(state, myId)),
    [state, myId, onActivity],
  );
  const items = useMemo(
    () => groupItems(tab, view?.expenses ?? [], sections),
    [tab, view, sections],
  );
  const openExpense = useCallback(
    (expenseId: string) => router.push(groupHrefs.expense(localId, expenseId)),
    [localId],
  );

  // Until the first derive lands (a large group, decrypted in slices), the cached name heads the empty screen.
  const name = derived?.name ?? snapshot.name ?? '';
  const back = {
    label: 'Groups',
    onPress: () => (router.canGoBack() ? router.back() : router.replace(groupHrefs.groups)),
  };

  const currency = derived?.currency ?? state?.currency ?? '';
  // Joined, waiting for the first sync: no currency yet to word amounts in.
  if (derived === null || state === null || view === null || currency === '') {
    return (
      <Screen back={back} title={name} scroll={false}>
        {null}
      </Screen>
    );
  }

  const readOnly = derived.readOnly !== null;
  const net = derived.myNet ?? 0;
  // Nothing to settle is not settled: "Everyone's settled" and the archive offer need an expense or a payment.
  const settledAll = everyoneSettled(state, derived.transfers, derived.balancesUnavailable);
  // A currency this build cannot read (a newer table's, or a hostile `group.created`'s) has no exponent to enter an
  // amount in: no Add expense or Settle, and the "Update Even" banner says why (derived.updateRequired).
  const canWrite = !readOnly && !derived.needsClaim && isCurrency(currency);
  // Also Group's no-seat layout (GroupNoSeat): exactly while the pick is offered.
  const offerPick = offersNamePick(state, {
    needsClaim: derived.needsClaim,
    writable: !readOnly,
    deviceId,
  });
  const shareShown = showsShareButton(card, { readOnly, needsClaim: derived.needsClaim });
  const bannerShown = lastBannerFlush(derived);

  const toggleDone = () => {
    void (view.done.meDone ? groups.setUndone(localId) : groups.setDone(localId));
  };
  const settle = canWrite ? (t: Transfer) => router.push(groupHrefs.settle(localId, t)) : null;

  // Share is hidden while the invite card shows, in a read-only group and with no seat; until the server has the group
  // it waits. It opens the share menu (GroupShareMenu).
  const headerRight = (
    <>
      {shareShown && (
        <ShareButton
          expanded={menuOpen}
          disabled={invite?.ready !== true}
          onPress={() => setMenuOpen(true)}
        />
      )}
      <HeaderButton
        icon="gear"
        accessibilityLabel="Group settings"
        onPress={() => router.push(groupHrefs.settings(localId))}
      />
    </>
  );

  // ----- the block above the segment -----
  let header: ReactNode;
  let segmentGap: number;
  if (offerPick) {
    // GroupNoSeat: 20 from the note to the segmented control.
    header = (
      <>
        <SpentSection
          amount={spentSoFar(state)}
          currency={currency}
          status={status}
          hasBanner={bannerShown}
        />
        <NoSeatNote />
      </>
    );
    segmentGap = 20;
  } else if (card === 'alone') {
    const people: StackMember[] = peopleOf(state).map((m) => ({
      id: m.id,
      name: m.name,
      initials: m.initials,
      color: m.color,
      done: true,
      ...(m.emoji === undefined ? {} : { emoji: m.emoji }),
    }));
    header = (
      <>
        <InviteCard invite={invite} groupName={name} />
        <PeopleRow members={people} />
      </>
    );
    segmentGap = 20;
  } else {
    const showSettledLine = net === 0 && settledAll && !readOnly;
    header = (
      <>
        {card === 'pinned' && <InviteCard invite={invite} groupName={name} />}
        <BalanceSection
          net={net}
          currency={currency}
          status={readOnly ? null : status}
          hasBanner={bannerShown}
          readOnly={readOnly}
          settled={settledAll}
        />
        {showSettledLine && <SettledLine />}
        {showSettledLine && canWrite && (
          <ArchiveOffer onPress={() => void groups.archiveGroup(localId)} />
        )}
        <SettleList
          transfers={view.mine}
          myId={myId}
          members={state.members}
          currency={currency}
          allDone={view.done.allDone}
          onSettle={settle}
          readOnly={readOnly}
        />
        {derived.readOnly === 'closed' && view.mine.length > 0 && <ClosedNote />}
        {!readOnly && showsDoneRow(view.done) && (
          <View style={view.mine.length === 0 && !showSettledLine ? styles.doneAfterHeader : null}>
            <DoneRow summary={view.done} onOpen={() => setDoneOpen(true)} onToggle={toggleDone} />
          </View>
        )}
      </>
    );
    // Group, archived: 20 under the header; Group screen copy, closed: 16 under the read-only note.
    segmentGap = readOnly && view.mine.length === 0 ? 20 : 16;
  }

  // Balances' "Settle up" opens Record a payment empty: you pay, "Choose" whom (Settle, extra states).
  const onSettleUp =
    canWrite && derived.transfers.length > 0 ? () => router.push(groupHrefs.settle(localId)) : null;

  let footer: ReactNode = undefined;
  if (canWrite) {
    footer = (
      <Button
        label="Add expense"
        icon="plus"
        onPress={() => router.push(groupHrefs.addExpense(localId))}
      />
    );
  } else if (offerPick) {
    footer = <Button label="Pick your name" icon="person" onPress={pick.reopen} />;
  }

  // One scrolling surface: the header block, the segment (it sticks under the nav bar), then the tab's rows, mounted
  // only near the screen. Expenses and Activity rows are memoised slices of their cards.
  const payerOf = (expense: ExpenseState) =>
    expense.paidBy === myId ? 'You' : (state.members.get(expense.paidBy)?.name ?? 'Someone');
  const renderItem = ({ item }: ListRenderItemInfo<GroupItem>) => {
    switch (item.kind) {
      case 'header':
        return (
          <View onLayout={onHeaderLayout}>
            <GroupBanners derived={derived} />
            {header}
            <View style={{ height: segmentGap - STUCK_GAP }} />
          </View>
        );
      case 'segment':
        return (
          <View style={[styles.segment, { backgroundColor: tokens.background }]}>
            <SegmentedControl segments={SEGMENTS} value={tab} onChange={changeTab} />
          </View>
        );
      case 'noExpenses':
        return <NoExpenses />;
      case 'expense':
        return (
          <ExpenseRow
            expense={item.expense}
            payer={payerOf(item.expense)}
            currency={currency}
            dateLabel={isoDateLabel(item.expense.date, now)}
            first={item.first}
            last={item.last}
            onOpen={openExpense}
          />
        );
      case 'balances':
        return (
          <BalancesTab
            rows={view.balances}
            categories={view.categories}
            currency={currency}
            unavailable={derived.balancesUnavailable}
            onSettle={onSettleUp}
          />
        );
      case 'day':
        return <ActivityDay label={dayLabel(item.section.at, now)} />;
      case 'activity':
        return <ActivityItem row={item.row} first={item.first} last={item.last} />;
    }
  };

  return (
    <View style={styles.flex}>
      <Screen back={back} title={name} headerRight={headerRight} footer={footer} scroll={false}>
        <FlatList
          ref={scrollRef}
          data={items}
          keyExtractor={groupItemKey}
          renderItem={renderItem}
          style={styles.flex}
          contentContainerStyle={{
            paddingBottom:
              footer === undefined ? Math.max(insets.bottom, layout.homeIndicator) : 16,
          }}
          stickyHeaderIndices={[SEGMENT_INDEX]}
          initialNumToRender={INITIAL_ITEMS}
          onLayout={onScrollLayout}
          onContentSizeChange={onContentSize}
          refreshControl={
            // `tintColor` is iOS; Android draws its spinner on a disc, so the disc takes `surface` and the arc the
            // same `textMuted` (a white disc with a black arc otherwise, in dark mode too).
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tokens.textMuted}
              colors={[tokens.textMuted]}
              progressBackgroundColor={tokens.surface}
            />
          }
        />
        <DoneSheet
          visible={doneOpen}
          summary={view.done}
          onDismiss={() => setDoneOpen(false)}
          onToggle={toggleDone}
        />
        {/* Closing only closes it (unlike the Join route's close, which leaves for Groups); nothing changes the group. */}
        <PickNameStep
          key={pick.round}
          localId={localId}
          visible={pick.open && offerPick}
          again
          fallbackName={null}
          onClose={pick.close}
          onClaimed={pick.close}
        />
        <InviteQrSheet
          visible={qrOpen}
          onClose={() => setQrOpen(false)}
          invite={invite}
          groupName={name}
        />
        {/* After the name pick, when that is up too. */}
        <MoveEntriesSheet
          offer={asked}
          visible={offer !== null && inView && !(pick.open && offerPick)}
          busy={moving}
          onMove={() => offer !== null && moveEntries(offer)}
          onNotNow={() => offer !== null && notNow(offer)}
        />
      </Screen>
      <ShareMenu
        visible={menuOpen && shareShown}
        groupName={name}
        onDismiss={closeMenu}
        onShareLink={() => {
          setMenuOpen(false);
          if (invite?.ready === true) shareInvite(invite, name);
        }}
        onShowQr={() => {
          setMenuOpen(false);
          setQrOpen(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segment: { paddingTop: STUCK_GAP, paddingHorizontal: layout.gutter },
  doneAfterHeader: { marginTop: 8 },
});
