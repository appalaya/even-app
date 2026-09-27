/**
 * The one email a valid submission produces: plain text, to the mailbox for its purpose, from CONTACT_FROM, with
 * the visitor's address (if given) as Reply-To. A report puts the group id and the server on lines of their own,
 * so the operator can copy each into the takedown command (even-server worker/README.md, "Takedown (blocklist)").
 * The shape is the body of Resend's send-email request (resend.ts). Pure, so it is tested in Node.
 */
import type { ContactRequest, Purpose } from './validate';

export const SENDER_NAME = 'Even';

/** The body of `POST https://api.resend.com/emails`, as far as this form uses it. */
export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  reply_to?: string;
}

const PURPOSE_LINE: Record<Purpose, string> = {
  report: 'report (abuse)',
  help: 'help',
  feedback: 'feedback',
};

export function subjectFor(request: ContactRequest): string {
  switch (request.purpose) {
    case 'report':
      return `Even report: ${request.groupId ?? ''}`;
    case 'help':
      return 'Even support';
    case 'feedback':
      return 'Even feedback';
  }
}

export function composeEmail(
  request: ContactRequest,
  addresses: { to: string; from: string },
  siteOrigin: string,
): OutgoingEmail {
  const lines = [`Purpose: ${PURPOSE_LINE[request.purpose]}`];
  if (request.purpose === 'report') {
    lines.push('', 'Group id:', request.groupId ?? '', '', 'Server:', request.server ?? '');
  }
  lines.push(
    '',
    request.email === undefined
      ? 'Reply to: none given; this sender cannot be answered.'
      : `Reply to: ${request.email}`,
    '',
    'Message:',
    request.message.replace(/\r\n?/g, '\n'),
    '',
    '-- ',
    `Sent by the contact form at ${siteOrigin}. The site keeps no copy.`,
  );
  return {
    from: `${SENDER_NAME} <${addresses.from}>`,
    to: [addresses.to],
    subject: subjectFor(request),
    text: lines.join('\n'),
    ...(request.email === undefined ? {} : { reply_to: request.email }),
  };
}
