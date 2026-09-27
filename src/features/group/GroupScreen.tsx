import type { Transfer } from '@even/core';
import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  HeaderButton,
  Screen,
  SegmentedControl,
  type Segment,
  type StackMember,
} from '@/components';
import { useApp, useGroup } from '@/state';
import { layout, useTheme } from '@/theme';

import { DoneRow, DoneSheet } from './DoneAdding';
import { GroupBanners, lastBannerFlush } from './GroupBanners';
import { ArchiveOffer, BalanceSection, ClosedNote, SettledLine, SettleList } from './GroupHeader';
import { ActivityTab, BalancesTab, ExpensesTab } from './GroupTabs';
import {
  useGroupNotifications,
  useGroupSync,
  useInvite,
  useLeaveWhenGone,
  useNow,
  useStatusLine,
} from './hooks';
import { InviteCard, PeopleRow, shareInvite } from './InviteCard';
import {
  activitySections,
  balanceRows,
  categoryRows,
  doneSummary,
  inviteLayout,
  myTransfers,
  peopleOf,
  sortedExpenses,
} from './model';
import { groupHrefs } from './routes';

export type GroupTab = 'expenses' | 'balances' | 'activity';

const SEGMENTS: readonly Segment<GroupTab>[] = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'activity', label: 'Activity' },
];

/** The segmented control sticks this far under the nav bar (Group, Balances tab: 8). */
const STUCK_GAP = 8;

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
 */
export function GroupScreen({
  localId,
  initialTab = 'expenses',
  initialSheet,
  initialStuck = false,
}: GroupScreenProps) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const { groups } = useApp();
  const snapshot = useGroup(localId);
  const derived = snapshot.derived;
  const state = derived?.state ?? null;
  const myId = derived?.myMemberId ?? null;
  const now = useNow();
  const status = useStatusLine(localId);
  const { refreshing, onRefresh } = useGroupSync(localId);

  const [tab, setTab] = useState<GroupTab>(initialTab);
  const [doneOpen, setDoneOpen] = useState(initialSheet === 'done');
  // The sheet is a modal over the window: close it when another screen covers this one.
  useFocusEffect(useCallback(() => () => setDoneOpen(false), []));

  const card = state !== null && derived?.readOnly === null ? inviteLayout(state, myId) : 'none';
  const invite = useInvite(
    localId,
    derived?.inviteReady ?? false,
    derived !== null && state !== null,
  );

  useLeaveWhenGone(snapshot.status);
  useGroupNotifications(localId, state === null ? null : peopleOf(state).length);

  // ----- scrolling: the sticky segment -----
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
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
    scrollRef.current?.scrollTo({ y, animated: want.animated });
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
  const onSegmentLayout = (e: LayoutChangeEvent) => {
    segmentY.current = e.nativeEvent.layout.y;
    applyScroll();
  };

  // ----- derived view data -----
  const view = useMemo(() => {
    if (derived === null || state === null) return null;
    return {
      done: doneSummary(state, myId, { everyone: card === 'pinned' }),
      mine: myTransfers(derived.transfers, myId),
      balances: derived.nets === null ? [] : balanceRows(state, derived.nets, myId),
      categories: categoryRows(state),
      expenses: sortedExpenses(state),
    };
  }, [derived, state, myId, card]);
  const sections = useMemo(
    () => (state === null ? [] : activitySections(state, myId)),
    [state, myId],
  );

  const name = derived?.name ?? '';
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
  const settledAll = derived.transfers.length === 0 && !derived.balancesUnavailable;
  const canWrite = !readOnly && !derived.needsClaim;
  const bannerShown = lastBannerFlush(derived);

  const toggleDone = () => {
    void (view.done.meDone ? groups.setUndone(localId) : groups.setDone(localId));
  };
  const settle = canWrite ? (t: Transfer) => router.push(groupHrefs.settle(localId, t)) : null;

  // Share is hidden while the invite card shows and in a read-only group; until the server has the group it waits.
  const headerRight = (
    <>
      {card === 'none' && !readOnly && (
        <HeaderButton
          icon="share"
          accessibilityLabel="Share invite"
          disabled={invite?.ready !== true}
          onPress={() => {
            if (invite?.ready === true) shareInvite(invite, name);
          }}
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
  if (card === 'alone') {
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
        {!readOnly && view.done.total > 0 && (
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

  const footer = canWrite ? (
    <Button
      label="Add expense"
      icon="plus"
      onPress={() => router.push(groupHrefs.addExpense(localId))}
    />
  ) : undefined;

  return (
    <Screen back={back} title={name} headerRight={headerRight} footer={footer} scroll={false}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={{
          paddingBottom: footer === undefined ? Math.max(insets.bottom, layout.homeIndicator) : 16,
        }}
        stickyHeaderIndices={[1]}
        onLayout={onScrollLayout}
        onContentSizeChange={onContentSize}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.textMuted}
          />
        }
      >
        <View>
          <GroupBanners derived={derived} />
          {header}
        </View>
        <View
          onLayout={onSegmentLayout}
          style={[
            styles.segment,
            { marginTop: segmentGap - STUCK_GAP, backgroundColor: tokens.background },
          ]}
        >
          <SegmentedControl segments={SEGMENTS} value={tab} onChange={changeTab} />
        </View>
        <View>
          {tab === 'expenses' && (
            <ExpensesTab
              expenses={view.expenses}
              state={state}
              myId={myId}
              currency={currency}
              now={now}
              onOpen={(expenseId) => router.push(groupHrefs.expense(localId, expenseId))}
            />
          )}
          {tab === 'balances' && (
            <BalancesTab
              rows={view.balances}
              categories={view.categories}
              currency={currency}
              unavailable={derived.balancesUnavailable}
              onSettle={onSettleUp}
            />
          )}
          {tab === 'activity' && <ActivityTab sections={sections} now={now} />}
        </View>
      </ScrollView>
      <DoneSheet
        visible={doneOpen}
        summary={view.done}
        onDismiss={() => setDoneOpen(false)}
        onToggle={toggleDone}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  segment: { paddingTop: STUCK_GAP, paddingHorizontal: layout.gutter },
  doneAfterHeader: { marginTop: 8 },
});
