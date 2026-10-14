import { Platform, Share } from 'react-native';

import { inviteSharePayload } from './share';

/** Hands an invite link to the OS share sheet (`inviteSharePayload`); a dismissed or failed sheet is not reported. */
export function shareInviteLink(link: string, title?: string): void {
  const { content, options } = inviteSharePayload(link, Platform.OS, title);
  void Share.share(content, options).catch(() => undefined);
}
