/**
 * What "Share link" hands the system share sheet (design.md "Invites" → Share): the group's share menu and invite
 * card, Group settings' invite section, and the new link after "Regenerate invite link".
 *
 * React Native's `Share.share` reads `url` on iOS only. On Android it sends `message` as the intent's text and `title`
 * as its subject and drops `url`, so a link passed only as `url` reached Android's sheet with no link in it. So:
 * - iOS keeps the link as `url` (the sheet's link preview, Messages, AirDrop, Copy) and the title, where there is
 *   one, as Mail's `subject`.
 * - Android sends the link alone as `message`, so a messaging app sends a bare link and draws its own preview; design.md
 *   writes no sentence to go with it. The title, where there is one, stays the subject (an email's subject line).
 *
 * The link carries the group secret in its fragment: it goes to the share sheet and nowhere else, never to a log.
 */
import type { ShareContent, ShareOptions } from 'react-native';

export interface InviteSharePayload {
  content: ShareContent;
  options: ShareOptions;
}

/** The share sheet's title for a group's invite (Share sheet board: "Even · Join Banff 2026"). */
export function inviteShareTitle(groupName: string): string {
  return `Even · Join ${groupName}`;
}

/** `Share.share`'s arguments for an invite link on `os` (`Platform.OS`), with an optional title. */
export function inviteSharePayload(link: string, os: string, title?: string): InviteSharePayload {
  if (os === 'android') {
    return {
      content: title === undefined ? { message: link } : { message: link, title },
      options: {},
    };
  }
  return title === undefined
    ? { content: { url: link }, options: {} }
    : { content: { url: link, title }, options: { subject: title } };
}
