/**
 * Every URL the system opens the app with passes through here before the router reads it (expo-router's native
 * intent; design.md "Invites" → Open): at launch (`initial`), and while the app runs, when a link arrives as an event.
 * An invite link, the universal link or App Link `https://even.appalaya.com/i#<code>`, leaves as `/join?code=<code>`,
 * so the code travels in the route. Anything else goes on unchanged.
 *
 * Before this, `/i` waited for the link itself (`Linking.useURL()`). A link that reached a running app arrived as one
 * `url` event, the router opened `/i` on that event, and `/i` subscribed after it had passed, so it went to Groups.
 */
import * as Linking from 'expo-linking';

import { routeForSystemUrl } from '@/features/join/invite';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // The URL is being routed, so forget it as the launch URL. The router reads that (`getLinkingURL`) whenever its root
  // mounts, and iOS can mount it again while the process lives (a new scene connection, which shows the splash). iOS
  // records a universal link there only while nothing is recorded, so without this a later invite would read as this
  // one, and a remount with no link would open this one again.
  Linking.clearInitialURL();
  return routeForSystemUrl(path);
}
