/**
 * What the sheet routes share: the app's services (opened here if the root layout does not provide them yet;
 * `openAppServices` is one instance per process, so a second provider shares it), and leaving a sheet route.
 */
import { router, type Href } from 'expo-router';
import { useContext, type ReactNode } from 'react';

import { AppProvider } from '@/state';
import { AppContext } from '@/state/context';

export function WithServices({ children }: { children: ReactNode }) {
  const services = useContext(AppContext);
  if (services !== null) return <>{children}</>;
  return <AppProvider>{children}</AppProvider>;
}

/** Back to where the sheet was opened from; to the group when it was opened directly (a link). */
export function leaveSheet(groupId: string): void {
  if (router.canGoBack()) router.back();
  else router.replace(`/group/${encodeURIComponent(groupId)}` as Href);
}

/**
 * The Split route for a draft, relative to the sheet's own route (`/group/<id>/expense` → `/group/<id>/split`), so it
 * is pushed onto whichever group stack presents the sheet.
 */
export function splitHref(draftId: string): Href {
  return `./split?draft=${encodeURIComponent(draftId)}` as Href;
}
