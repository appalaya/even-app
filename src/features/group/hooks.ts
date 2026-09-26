import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { notSyncedLabel, type StatusLineProps } from '@/components';
import { useApp, useSyncStatus, type GroupSnapshot, type InviteInfo } from '@/state';

import { staleSince, syncedLabel } from './format';
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

/** The clock, re-read every `ms` so relative labels ("Synced 2 min ago", "Today") stay true. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Errors the status line words on their own (design.md "Error handling"); the rest read "Not synced since …". */
const ERROR_WORDS: Readonly<Record<string, string>> = {
  group_blocked: 'This server refuses this group.',
  not_an_even_server: "That URL isn't an Even server. Check the address.",
  unsupported_version: 'This server needs updating',
  unauthorized: "Can't reach this group's server",
};

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
  if (sync.syncing || replaying) return { state: 'syncing', label: 'Syncing…' };
  const error = sync.lifecycle === 'blocked' ? 'group_blocked' : sync.lastSyncError;
  if (error !== null) {
    const words = ERROR_WORDS[error];
    if (words !== undefined) return { state: 'stale', label: words, onSyncNow };
  }
  if (error !== null || sync.lastSyncedAt === null) {
    const label =
      sync.lastSyncedAt === null
        ? 'Not synced yet'
        : notSyncedLabel(staleSince(sync.lastSyncedAt, now));
    return { state: 'stale', label, onSyncNow };
  }
  return { state: 'synced', label: syncedLabel(sync.lastSyncedAt, now), onSyncNow };
}

/**
 * Sync triggers the Group screen owns: pull to refresh, and the app returning to the foreground while it is open
 * (the engine shares a running cycle, so the provider's app-wide foreground sync costs nothing extra).
 */
export function useGroupSync(localId: string): { refreshing: boolean; onRefresh: () => void } {
  const { groups, engine } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void engine.syncGroup(localId, { trigger: 'foreground' });
    });
    return () => subscription.remove();
  }, [engine, localId]);

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
