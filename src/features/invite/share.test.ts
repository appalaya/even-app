import { encodeInvite, inviteLink, makeInvite } from '@even/core';
import { describe, expect, it } from 'vitest';

import { inviteSharePayload, inviteShareTitle } from './share';

/** An invite link as `inviteFor` builds it: a 32-byte secret, the default server, a name and a currency. */
function sampleLink(): string {
  const secret = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
  const invite = makeInvite(secret, 'https://sync.even.appalaya.com', {
    g: 'Banff 2026',
    cur: 'CAD',
  });
  return inviteLink(encodeInvite(invite));
}

describe('invite share payload', () => {
  const link = sampleLink();
  const title = inviteShareTitle('Banff 2026');

  it('is the full invite link, fragment and all', () => {
    expect(link).toMatch(/^https:\/\/even\.appalaya\.com\/i#[A-Za-z0-9_-]{40,}$/);
    expect(title).toBe('Even · Join Banff 2026');
  });

  it('keeps iOS as it was: the link as url, the title as the subject', () => {
    expect(inviteSharePayload(link, 'ios', title)).toEqual({
      content: { url: link, title },
      options: { subject: title },
    });
    expect(inviteSharePayload(link, 'ios')).toEqual({ content: { url: link }, options: {} });
  });

  it('puts the link alone in the message on Android, which drops url', () => {
    const titled = inviteSharePayload(link, 'android', title);
    expect(titled.content.message).toBe(link);
    expect(titled.content.title).toBe(title);
    expect(titled.content.url).toBeUndefined();
    expect(titled.options).toEqual({});

    const bare = inviteSharePayload(link, 'android');
    expect(bare).toEqual({ content: { message: link }, options: {} });
  });

  it("gives every platform the link in a field that platform's share sheet reads", () => {
    // React Native's Share.share: Android reads title and message, iOS reads message, url and options.subject.
    const read = (os: string, withTitle: boolean) => {
      const { content } = inviteSharePayload(link, os, withTitle ? title : undefined);
      return os === 'android' ? [content.message] : [content.message, content.url];
    };
    for (const os of ['ios', 'android']) {
      for (const withTitle of [true, false]) expect(read(os, withTitle)).toContain(link);
    }
  });
});
