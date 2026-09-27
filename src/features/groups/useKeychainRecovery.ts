/**
 * First-launch recovery (design.md "Keys"): the iOS keychain outlives an uninstall, so when this phone's store has
 * no groups but the keychain index still lists some, offer to bring them back. Asked at most once per launch.
 *
 * The count comes from the keychain index (`secrets.listGroups()`, entries that carry a server URL, which is what
 * `recoverGroupsFromSecrets` can rebuild); the GroupService has no read-only count yet.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useApp, useGroups } from '@/state';

let askedThisLaunch = false;
/** Bumped by the dev seed's reset so a Groups screen that is already mounted checks again. */
let generation = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getGeneration = () => generation;

/** One server's line in the offer: "sync.even.appalaya.com · 2 groups". */
export interface RecoverableServer {
  serverUrl: string;
  count: number;
}

export function useKeychainRecovery() {
  const services = useApp();
  const list = useGroups();
  const [count, setCount] = useState(0);
  const [servers, setServers] = useState<RecoverableServer[]>([]);
  const [busy, setBusy] = useState(false);
  const round = useSyncExternalStore(subscribe, getGeneration);

  useEffect(() => {
    if (askedThisLaunch || list.status !== 'ready' || list.rows.length > 0) return;
    let cancelled = false;
    services.secrets
      .listGroups()
      .then((entries) => {
        // Counted as asked only by a screen still showing, so a Groups screen replaced mid-lookup asks again.
        if (cancelled || askedThisLaunch) return;
        askedThisLaunch = true;
        const byServer = new Map<string, number>();
        for (const entry of entries) {
          if (entry.serverUrl === null) continue;
          byServer.set(entry.serverUrl, (byServer.get(entry.serverUrl) ?? 0) + 1);
        }
        setServers([...byServer].map(([serverUrl, n]) => ({ serverUrl, count: n })));
        setCount([...byServer.values()].reduce((sum, n) => sum + n, 0));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [list.status, list.rows.length, services, round]);

  const dismiss = useCallback(() => setCount(0), []);

  const recover = useCallback(async () => {
    setBusy(true);
    try {
      const recovered = await services.groups.recoverGroupsFromSecrets();
      if (recovered > 0) void services.foreground();
    } catch (error) {
      console.warn('keychain recovery failed', error instanceof Error ? error.message : error);
    } finally {
      setBusy(false);
      setCount(0);
    }
  }, [services]);

  return { offer: count, servers, busy, recover, dismiss };
}

/** Dev seed only: holds the offer back while the seed rewrites the store… */
export function suppressRecoveryOffer(): void {
  askedThisLaunch = true;
}

/** …and lets Groups ask again (the recovery seed). */
export function resetRecoveryOffer(): void {
  askedThisLaunch = false;
  generation += 1;
  for (const listener of [...listeners]) listener();
}
