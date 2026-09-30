/**
 * The invite link's path, reached without a code (`https://even.appalaya.com/i`): Groups. An invite link with a code
 * never lands here; `+native-intent.ts` sends it straight to Join (design.md "Invites" → Open). An `even://` link to
 * `/i` lands here too, fragment or not, since `even://` never carries a payload.
 */
import { Redirect } from 'expo-router';

import { hrefs } from '@/features/groups/routes';

export default function InviteRoute() {
  return <Redirect href={hrefs.groups} />;
}
