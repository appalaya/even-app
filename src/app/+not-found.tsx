/**
 * NotFound (boards NotFound, NotFoundDark): any `even://` link or route the app does not know, in place of Expo
 * Router's default Unmatched page. The path is never shown, and there is no sitemap (app.json turns Expo Router's
 * `_sitemap` route off, so `even://_sitemap` lands here too). Go to Groups replaces the stack with Groups.
 */
import { router } from 'expo-router';

import { ErrorScreen } from '@/features/errors/ErrorScreen';

export default function NotFound() {
  return (
    <ErrorScreen
      glyph="question"
      title="Even can't open this link."
      text="It may be incomplete, or need a newer Even."
      primary={{ label: 'Go to Groups', onPress: () => router.dismissTo('/') }}
    />
  );
}
