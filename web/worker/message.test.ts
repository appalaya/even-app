import { describe, expect, it } from 'vitest';

import { composeEmail, SENDER_NAME } from './message';
import type { ContactRequest } from './validate';

const GROUP_ID = 'q3Zb5y0f4n1xk2Qp9sVtWm8rLc7dE6gHjA-BuC_DeFg';
const ADDRESSES = { to: 'mailbox@example.com', from: 'form@example.net' };
const SITE = 'https://even.appalaya.com';

const base: ContactRequest = { purpose: 'help', message: 'Hello', turnstileToken: 't' };

describe('composeEmail', () => {
  it('addresses the mailbox from the sender, as plain text only', () => {
    const email = composeEmail(base, ADDRESSES, SITE);
    expect(email.to).toBe('mailbox@example.com');
    expect(email.from).toEqual({ email: 'form@example.net', name: SENDER_NAME });
    expect(Object.keys(email).sort()).toEqual(['from', 'subject', 'text', 'to']);
  });

  it('uses the subject for each purpose', () => {
    expect(composeEmail(base, ADDRESSES, SITE).subject).toBe('Even support');
    expect(composeEmail({ ...base, purpose: 'feedback' }, ADDRESSES, SITE).subject).toBe(
      'Even feedback',
    );
    expect(
      composeEmail(
        { ...base, purpose: 'report', groupId: GROUP_ID, server: 'https://sync.even.appalaya.com' },
        ADDRESSES,
        SITE,
      ).subject,
    ).toBe(`Even report: ${GROUP_ID}`);
  });

  it('sets Reply-To and names the address in the text when the visitor gave one', () => {
    const email = composeEmail({ ...base, email: 'visitor@example.com' }, ADDRESSES, SITE);
    expect(email.replyTo).toBe('visitor@example.com');
    expect(email.text).toContain('\nReply to: visitor@example.com\n');
  });

  it('says so when there is no one to reply to', () => {
    const email = composeEmail(base, ADDRESSES, SITE);
    expect(email.replyTo).toBeUndefined();
    expect(email.text).toContain('Reply to: none given');
  });

  it('puts a report’s group id and server on lines of their own', () => {
    const email = composeEmail(
      {
        ...base,
        purpose: 'report',
        message: 'Spam group',
        groupId: GROUP_ID,
        server: 'https://sync.even.appalaya.com',
      },
      ADDRESSES,
      SITE,
    );
    const lines = email.text.split('\n');
    expect(lines).toContain(GROUP_ID);
    expect(lines).toContain('https://sync.even.appalaya.com');
    expect(lines[lines.indexOf(GROUP_ID) - 1]).toBe('Group id:');
    expect(lines[lines.indexOf('https://sync.even.appalaya.com') - 1]).toBe('Server:');
    expect(email.text).toBe(
      [
        'Purpose: report (abuse)',
        '',
        'Group id:',
        GROUP_ID,
        '',
        'Server:',
        'https://sync.even.appalaya.com',
        '',
        'Reply to: none given; this sender cannot be answered.',
        '',
        'Message:',
        'Spam group',
        '',
        '-- ',
        'Sent by the contact form at https://even.appalaya.com. The site keeps no copy.',
      ].join('\n'),
    );
  });

  it('has no group id or server lines for help and feedback', () => {
    const text = composeEmail(base, ADDRESSES, SITE).text;
    expect(text).not.toContain('Group id');
    expect(text).not.toContain('Server:');
  });

  it('keeps the message as written, with line endings normalised', () => {
    const text = composeEmail(
      { ...base, message: 'One\r\nTwo\rThree\n\tFour' },
      ADDRESSES,
      SITE,
    ).text;
    expect(text).toContain('Message:\nOne\nTwo\nThree\n\tFour\n');
  });
});
