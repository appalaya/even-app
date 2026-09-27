import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  isHttpsOrigin,
  isMessage,
  isPlausibleEmail,
  MAX_MESSAGE_LENGTH,
  validateContact,
  type Field,
} from './validate';

const GROUP_ID = 'q3Zb5y0f4n1xk2Qp9sVtWm8rLc7dE6gHjA-BuC_DeFg';
const TOKEN = '0.dummy-turnstile-token_abc.DEF';

const help = { purpose: 'help', message: 'The app will not sync.', turnstileToken: TOKEN };
const report = {
  purpose: 'report',
  message: 'This group is spam.',
  groupId: GROUP_ID,
  server: 'https://sync.even.appalaya.com',
  turnstileToken: TOKEN,
};

function fieldOf(body: unknown): Field | 'ok' {
  const result = validateContact(body);
  return result.ok ? 'ok' : result.field;
}

describe('validateContact', () => {
  it('accepts each purpose with and without a reply address', () => {
    expect(fieldOf(help)).toBe('ok');
    expect(fieldOf({ ...help, purpose: 'feedback' })).toBe('ok');
    expect(fieldOf({ ...help, email: 'visitor@example.com' })).toBe('ok');
    expect(fieldOf(report)).toBe('ok');
    expect(fieldOf({ ...report, email: 'visitor@example.com' })).toBe('ok');
  });

  it('returns exactly the known fields, with groupId and server only for a report', () => {
    expect(validateContact({ ...help, email: 'a@example.com' })).toEqual({
      ok: true,
      value: {
        purpose: 'help',
        message: help.message,
        email: 'a@example.com',
        turnstileToken: TOKEN,
      },
    });
    expect(validateContact(report)).toEqual({ ok: true, value: report });
  });

  it('rejects a body that is not a JSON object', () => {
    for (const body of [null, [], 'help', 3, true, undefined]) expect(fieldOf(body)).toBe('body');
  });

  it('rejects any key outside the contract', () => {
    expect(fieldOf({ ...help, name: 'Sam' })).toBe('body');
    expect(fieldOf({ ...help, __proto__x: 1 })).toBe('body');
    expect(fieldOf({ ...report, cc: 'x@example.com' })).toBe('body');
  });

  it('requires a known purpose', () => {
    for (const purpose of [undefined, '', 'Report', 'abuse', 'support', 1, null])
      expect(fieldOf({ ...help, purpose })).toBe('purpose');
  });

  it('requires a message of 1 to 4000 characters that is not only whitespace', () => {
    expect(fieldOf({ ...help, message: 'x' })).toBe('ok');
    expect(fieldOf({ ...help, message: 'x'.repeat(MAX_MESSAGE_LENGTH) })).toBe('ok');
    expect(fieldOf({ ...help, message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).toBe('message');
    for (const message of [undefined, '', '   ', '\n\t', 42, ['hi'], null])
      expect(fieldOf({ ...help, message })).toBe('message');
  });

  it('allows tabs, newlines and any language in a message, but no other control characters', () => {
    expect(isMessage('Line one\r\nLine two\n\tindented')).toBe(true);
    expect(isMessage('Ça ne marche pas 🙃 日本語')).toBe(true);
    expect(isMessage('nul\u0000byte')).toBe(false);
    expect(isMessage('bell\u0007')).toBe(false);
    expect(isMessage('del\u007f')).toBe(false);
    expect(isMessage('lone \ud800 surrogate')).toBe(false);
  });

  it('checks a reply address only when one is sent, and rejects "" and null', () => {
    expect(fieldOf({ ...help, email: '' })).toBe('email');
    expect(fieldOf({ ...help, email: null })).toBe('email');
    expect(fieldOf({ ...help, email: 'not an address' })).toBe('email');
  });

  it('requires groupId and server for a report', () => {
    const { groupId: _g, ...noGroup } = report;
    const { server: _s, ...noServer } = report;
    expect(fieldOf(noGroup)).toBe('groupId');
    expect(fieldOf(noServer)).toBe('server');
  });

  it('rejects groupId and server on help and feedback, even when valid', () => {
    for (const purpose of ['help', 'feedback']) {
      expect(fieldOf({ ...help, purpose, groupId: GROUP_ID })).toBe('groupId');
      expect(fieldOf({ ...help, purpose, server: 'https://sync.even.appalaya.com' })).toBe(
        'server',
      );
      expect(fieldOf({ ...help, purpose, groupId: null })).toBe('groupId');
    }
  });

  it('accepts exactly 43 base64url characters as a group id', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{43}$/), (groupId) => {
        expect(fieldOf({ ...report, groupId })).toBe('ok');
      }),
    );
    for (const groupId of [
      GROUP_ID.slice(1),
      `${GROUP_ID}A`,
      `${GROUP_ID.slice(1)}=`,
      `${GROUP_ID.slice(1)}+`,
      `${GROUP_ID.slice(1)}/`,
      ` ${GROUP_ID.slice(1)}`,
      '',
      43,
    ])
      expect(fieldOf({ ...report, groupId })).toBe('groupId');
  });

  it('requires a Turnstile token of printable ASCII, at most 2048 characters', () => {
    expect(fieldOf({ ...help, turnstileToken: 'x'.repeat(2048) })).toBe('ok');
    for (const turnstileToken of [undefined, '', 'x'.repeat(2049), 'has space', 'tab\t', 'é', 7])
      expect(fieldOf({ ...help, turnstileToken })).toBe('turnstileToken');
  });
});

describe('isPlausibleEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const address of [
      'a@example.com',
      'first.last+tag@mail.example.com',
      "o'brien@example.org",
      'x_y-z@sub-domain.example.org',
      `${'l'.repeat(64)}@example.com`,
      `${'a'.repeat(60)}@${'b.'.repeat(95)}com`, // 254 characters
    ])
      expect(isPlausibleEmail(address), address).toBe(true);
  });

  it('rejects anything that could not be a single plain address', () => {
    for (const address of [
      'plain',
      '@example.com',
      'a@',
      'a@localhost',
      'a@example',
      'a@@example.com',
      'a@b@example.com',
      '.a@example.com',
      'a.@example.com',
      'a..b@example.com',
      'a b@example.com',
      ' a@example.com',
      'a@example.com ',
      'a@example.com\r\nBcc: x@example.com',
      'a@-bad.example.com',
      'a@bad-.example.com',
      'a@example..com',
      'a@1.2.3.4',
      '"quoted"@example.com',
      'Name <a@example.com>',
      'ü@example.com',
      'a@exämple.com',
      `${'l'.repeat(65)}@example.com`,
      `a@${'b'.repeat(64)}.com`,
      `${'a'.repeat(60)}@${'b.'.repeat(96)}com`,
    ])
      expect(isPlausibleEmail(address), address).toBe(false);
    expect(isPlausibleEmail(undefined)).toBe(false);
    expect(isPlausibleEmail(1)).toBe(false);
  });
});

describe('isHttpsOrigin', () => {
  it('accepts canonical https origins', () => {
    for (const origin of [
      'https://sync.even.appalaya.com',
      'https://home.example.net:8443',
      'https://192.0.2.10',
      'https://[2001:db8::1]',
      'https://xn--bcher-kva.example',
    ])
      expect(isHttpsOrigin(origin), origin).toBe(true);
  });

  it('rejects paths, other schemes and anything the canonical form would rewrite', () => {
    for (const origin of [
      'https://sync.even.appalaya.com/',
      'https://home.example.net:8443/even',
      'https://sync.even.appalaya.com?x=1',
      'https://sync.even.appalaya.com#x',
      'https://Sync.Even.Appalaya.com',
      'HTTPS://sync.even.appalaya.com',
      'https://sync.even.appalaya.com:443',
      'https://user@sync.example.com',
      'https://user:pw@sync.example.com',
      'https://bücher.example',
      'http://sync.even.appalaya.com',
      'wss://sync.even.appalaya.com',
      'sync.even.appalaya.com',
      '//sync.even.appalaya.com',
      ' https://sync.even.appalaya.com',
      'https://',
      '',
      `https://${'a'.repeat(300)}.com`,
    ])
      expect(isHttpsOrigin(origin), origin).toBe(false);
    expect(isHttpsOrigin(null)).toBe(false);
  });
});
