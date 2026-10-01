/**
 * App settings → Notifications (AppSettings board; design.md "Background refresh"): the only switch in the app,
 * tied to the OS permission. On asks for it (the OS prompt, also after a prompt closed with no answer; the Settings
 * app once it was refused for good, or after the prompt closed unanswered twice: state/prefs.ts); off sends the user
 * to the Settings app, since an app cannot revoke its own permission. The status is read again whenever the app
 * returns to the foreground.
 */
import { useEffect } from 'react';
import { AppState, Linking } from 'react-native';

import { ToggleRow } from '@/components';
import { useApp, usePrefs } from '@/state';

export function NotificationsRow() {
  const { prefs: service } = useApp();
  const { prefs, requestNotifications } = usePrefs();
  const status = prefs?.notifications ?? 'unavailable';

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void service.load().catch(() => undefined);
    });
    return () => sub.remove();
  }, [service]);

  const change = (on: boolean) => {
    if (on && status === 'undetermined') {
      void requestNotifications();
      return;
    }
    void Linking.openSettings();
  };

  return (
    <ToggleRow
      label="Notifications"
      value={status === 'granted'}
      onValueChange={change}
      disabled={status === 'unavailable'}
    />
  );
}
