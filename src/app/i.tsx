/**
 * The invite link's route (`https://even.appalaya.com/i#<payload>`, design.md "Invites" → Open). The router may not
 * surface the fragment, so this reads the full URL through `Linking.useURL()`, takes the payload after `#`, and
 * hands it to Join. A link without a payload goes to Groups.
 */
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { hrefs } from '@/features/groups/routes';
import { payloadFromUrl } from '@/features/join/invite';

/** How long to wait for `useURL` before treating the visit as payload-less. */
const URL_WAIT_MS = 1000;

export default function InviteRoute() {
  const url = Linking.useURL();

  useEffect(() => {
    const code = payloadFromUrl(url);
    if (code !== null) {
      router.replace(hrefs.joinWithCode(code));
      return;
    }
    if (url !== null) {
      router.replace(hrefs.groups);
      return;
    }
    const timer = setTimeout(() => router.replace(hrefs.groups), URL_WAIT_MS);
    return () => clearTimeout(timer);
  }, [url]);

  return null;
}
