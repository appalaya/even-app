/**
 * The hooks screens use. Thin: each one subscribes to a snapshot store (`GroupStateStore`, `PrefsService`) through
 * `useSyncExternalStore`, so a screen re-renders exactly when its snapshot is replaced. Actions are methods on
 * `useApp().groups` (GroupService) and `usePrefs()`.
 */
import type { MemberState } from '@even/core';
import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';

import { peekModelOutcomes, subscribeModelOutcomes, type ModelOutcomeEntry } from './categories';
import { AppContext } from './context';
import type { GroupListSnapshot, GroupSnapshot, SyncStatus } from './groupState';
import type { MoveOffer } from './moveOffers';
import type { Appearance, NotificationStatus, Prefs } from './prefs';
import type { AppServices } from './services';

/** The app's services. Throws outside `<AppProvider>`, which is a wiring bug. */
export function useApp(): AppServices {
  const services = useContext(AppContext);
  if (services === null) throw new Error('useApp() must be used inside <AppProvider>');
  return services;
}

/**
 * The Groups screen: one row per group that is not hidden (name, currency, your net, member count, unsent count,
 * lifecycle, sync status), active groups by latest activity first, then archived ones. Everything a group card
 * shows is on its row, so the list renders from this one subscription.
 */
export function useGroups(): GroupListSnapshot {
  const { groupState } = useApp();
  const subscribe = useCallback(
    (onChange: () => void) => groupState.subscribeList(onChange),
    [groupState],
  );
  const getSnapshot = useCallback(() => groupState.peekList(), [groupState]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** One group's derived state (reducer output, balances, skipped counts, invite readiness) and sync status. */
export function useGroup(localId: string): GroupSnapshot {
  const { groupState } = useApp();
  const subscribe = useCallback(
    (onChange: () => void) => groupState.subscribe(localId, onChange),
    [groupState, localId],
  );
  const getSnapshot = useCallback(() => groupState.peek(localId), [groupState, localId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * MoveEntriesPrompt's offers (state/moveOffers.ts): rotations recognised on this phone whose old group holds entries
 * this phone wrote that the new group lacks. Replaced on every change.
 */
export function useMoveOffers(): readonly MoveOffer[] {
  const { groups } = useApp();
  const subscribe = useCallback(
    (onChange: () => void) => groups.moveOffers.subscribe(onChange),
    [groups],
  );
  const getSnapshot = useCallback(() => groups.moveOffers.peek(), [groups]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The status line: syncing, last success, last error, lifecycle. Null while loading. */
export function useSyncStatus(localId: string): SyncStatus | null {
  return useGroup(localId).sync;
}

export interface Me {
  /** The member this device claimed, or null before "Which one are you?". */
  memberId: string | null;
  member: MemberState | null;
  /** Your net in minor units; null when unknown or balances are unavailable. */
  net: number | null;
  needsClaim: boolean;
}

/** This device's seat in a group. */
export function useMe(localId: string): Me {
  const { derived } = useGroup(localId);
  return useMemo(
    () => ({
      memberId: derived?.myMemberId ?? null,
      member: derived?.me ?? null,
      net: derived?.myNet ?? null,
      needsClaim: derived?.needsClaim ?? false,
    }),
    [derived],
  );
}

export interface PrefsHandle {
  /** Null until loaded. */
  prefs: Prefs | null;
  setName(name: string | null): Promise<void>;
  setEmoji(emoji: string | null): Promise<void>;
  setAppearance(appearance: Appearance): Promise<void>;
  /** Asks for notification permission (contextually, never at launch). */
  requestNotifications(): Promise<NotificationStatus>;
}

/** App settings: default name and emoji, Appearance, and the Notifications permission. */
export function usePrefs(): PrefsHandle {
  const { prefs } = useApp();
  const subscribe = useCallback((onChange: () => void) => prefs.subscribe(onChange), [prefs]);
  const getSnapshot = useCallback(() => prefs.peek(), [prefs]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(
    () => ({
      prefs: snapshot,
      setName: (name) => prefs.setName(name),
      setEmoji: (emoji) => prefs.setEmoji(emoji),
      setAppearance: (appearance) => prefs.setAppearance(appearance),
      requestNotifications: () => prefs.requestNotifications(),
    }),
    [prefs, snapshot],
  );
}

/**
 * Diagnostics: the category model's last 20 outcomes since launch, newest first (outcome, category, milliseconds,
 * model, time; never a title). Re-renders as each reply to the chip arrives. Needs no provider: the ring lives in
 * memory in `categories.ts`.
 */
export function useCategoryModelLog(): readonly ModelOutcomeEntry[] {
  return useSyncExternalStore(subscribeModelOutcomes, peekModelOutcomes);
}
