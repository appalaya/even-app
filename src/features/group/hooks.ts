import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { StatusLineProps } from '@/components';
import { askForNotificationsOnce, clearActivityNotification } from '@/services/notifications/local';
import { useApp, useSyncStatus, type GroupSnapshot, type InviteInfo } from '@/state';

import { statusLineWords } from './format';
import { groupHrefs } from './routes';

/**
 * A group left or replaced while its screen is open goes back to Groups, once that screen is the one showing. Only a
 * group this screen has seen counts as gone: right after a leave and a re-join of the same group (same local id) the
 * store can still hold the old "missing" snapshot for a moment.
 */
export function useLeaveWhenGone(status: GroupSnapshot['status']): void {
  const [seenReady, setSeenReady] = useState(status === 'ready');
  if (status === 'ready' && !seenReady) setSeenReady(true);
  const gone = seenReady && status === 'missing';
  useFocusEffect(
    useCallback(() => {
      if (gone) router.replace(groupHrefs.groups);
    }, [gone]),
  );
}

/** The native stack's end-of-transition event, which expo-router's `useNavigation` does not type. */
interface TransitionEvents {
  addListener(
    type: 'transitionEnd',
    listener: (event: { data?: { closing?: boolean } }) => void,
  ): () => void;
}

/**
 * A sheet offered each time this screen comes into view: `open` from the end of the transition that shows the screen
 * (its push, or the pop of the screen above it) until the screen loses focus or `close()` is called. The focus event
 * alone is too early: it fires as the transition starts, and iOS does not present a modal asked for mid-transition
 * (it never appears). `reopen()` shows it again on demand ("Pick your name", GroupNoSeat). `round` changes with each
 * showing, so the sheet can start fresh.
 */
export function useSheetOnEachView(): {
  round: number;
  open: boolean;
  close: () => void;
  reopen: () => void;
} {
  const navigation = useNavigation() as unknown as TransitionEvents;
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        setOpen(false);
      };
    }, []),
  );
  useEffect(
    () =>
      navigation.addListener('transitionEnd', (event) => {
        if (event.data?.closing === true || !focused.current) return;
        setRound((n) => n + 1);
        setOpen(true);
      }),
    [navigation],
  );
  const close = useCallback(() => setOpen(false), []);
  const reopen = useCallback(() => {
    setRound((n) => n + 1);
    setOpen(true);
  }, []);
  return { round, open, close, reopen };
}

/** The clock, re-read every `ms` so relative labels ("Synced 2 min ago", "Today") stay true. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** One turn of the sync glyph (StatusLine: 1.1 s per turn). */
const REPLAY_MS = 1100;

/**
 * The status line under Group's big number: "Synced 2 min ago", "Syncing…", "Not synced since 2:10 pm". A tap on the
 * glyph is a `manual` sync; within 10 s of the last success the engine answers `debounced` and the spinner replays
 * one turn without a request (design.md "Triggers").
 */
export function useStatusLine(localId: string): StatusLineProps | null {
  const { groups } = useApp();
  const sync = useSyncStatus(localId);
  const now = useNow();
  const [replaying, setReplaying] = useState(false);
  const replayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (replayTimer.current !== null) clearTimeout(replayTimer.current);
    },
    [],
  );

  const onSyncNow = useCallback(() => {
    void groups.sync(localId, 'manual').then((result) => {
      if (result.outcome !== 'skipped' || result.reason !== 'debounced') return;
      setReplaying(true);
      if (replayTimer.current !== null) clearTimeout(replayTimer.current);
      replayTimer.current = setTimeout(() => setReplaying(false), REPLAY_MS);
    });
  }, [groups, localId]);

  if (sync === null) return null;
  const words = statusLineWords(sync, now, { replaying });
  return words.state === 'syncing' ? words : { ...words, onSyncNow };
}

/**
 * Sync triggers the Group screen owns: pull to refresh, and the app returning to the foreground while it is open
 * (`GroupService.sync(…, 'foreground')`; the engine shares a running cycle, so the provider's app-wide foreground sync
 * costs nothing extra).
 */
export function useGroupSync(localId: string): { refreshing: boolean; onRefresh: () => void } {
  const { groups } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void groups.sync(localId, 'foreground');
    });
    return () => subscription.remove();
  }, [groups, localId]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void groups.sync(localId, 'pull_to_refresh').finally(() => setRefreshing(false));
  }, [groups, localId]);

  return { refreshing, onRefresh };
}

/** The group's invite (code, link, readiness), re-read when readiness changes. Null until read or when `enabled` is false. */
export function useInvite(localId: string, ready: boolean, enabled: boolean): InviteInfo | null {
  const { groups } = useApp();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    groups.inviteFor(localId).then(
      (info) => {
        if (!cancelled) setInvite(info);
      },
      () => {
        if (!cancelled) setInvite(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [groups, localId, ready, enabled]);
  return enabled ? invite : null;
}

/**
 * Notifications, from the group screen (design.md "Background refresh"): while the group is on screen its activity
 * notification is cleared (it has been seen); and the first time a group with more than one member is opened, the
 * permission is asked for, once per install (`askForNotificationsOnce` remembers it in `prefs`).
 */
export function useGroupNotifications(localId: string, memberCount: number | null): void {
  const services = useApp();
  const asked = useRef(false);
  useFocusEffect(
    useCallback(() => {
      void clearActivityNotification(localId, services).catch(() => undefined);
    }, [localId, services]),
  );
  useEffect(() => {
    if (asked.current || memberCount === null || memberCount < 2) return;
    asked.current = true;
    void askForNotificationsOnce(services).catch(() => undefined);
  }, [memberCount, services]);
}
