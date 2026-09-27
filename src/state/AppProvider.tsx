/**
 * Opens the app's services (store and migrations, secure store, info cache, sync engine; see services.ts) and
 * provides them to the tree. Thin on purpose: every rule lives in the plain classes `createAppServices` builds.
 *
 * Sync triggers owned here: one `foreground` sync when the services open and one each time the app returns to the
 * foreground (design.md "Triggers"). The services live for the process; they are not disposed on unmount, because
 * the background task shares them.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { AppContext } from './context';
import { openAppServices } from './openAppServices';
import type { AppServices } from './services';

export interface AppProviderProps {
  children: ReactNode;
  /** Rendered while the services open (a few milliseconds). */
  fallback?: ReactNode;
  /**
   * Rendered when they cannot open, e.g. a database written by a newer version of the app. `retry` opens them again
   * (a failed open is not cached).
   */
  renderError?: (error: Error, retry: () => void) => ReactNode;
  /** Defaults to the device wiring; previews can inject their own. */
  open?: () => Promise<AppServices>;
}

export function AppProvider({
  children,
  fallback = null,
  renderError,
  open = openAppServices,
}: AppProviderProps) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Bumped by `retry` to open again after a failure.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    open().then(
      (opened) => {
        if (cancelled) return;
        setServices(opened);
        void opened.foreground();
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  useEffect(() => {
    if (services === null) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void services.foreground();
    });
    return () => subscription.remove();
  }, [services]);

  if (error !== null) return <>{renderError?.(error, retry) ?? null}</>;
  if (services === null) return <>{fallback}</>;
  return <AppContext.Provider value={services}>{children}</AppContext.Provider>;
}
