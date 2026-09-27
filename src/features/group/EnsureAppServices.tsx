import { useContext, type ReactNode } from 'react';

import { AppProvider } from '@/state';
import { AppContext } from '@/state/context';

/**
 * The group routes (and the dev seed) read the app's services. When the root layout already provides them
 * this renders its children as they are; otherwise it opens them here (`openAppServices` is one instance per
 * process, so a second provider shares it).
 */
export function EnsureAppServices({ children }: { children: ReactNode }) {
  const services = useContext(AppContext);
  if (services !== null) return <>{children}</>;
  return <AppProvider>{children}</AppProvider>;
}
