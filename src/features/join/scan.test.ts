import {
  b64urlDecode,
  b64urlEncode,
  encodeInvite,
  inviteLink,
  makeInvite,
  utf8Decode,
  utf8Encode,
} from '@even/core';
import { describe, expect, it } from 'vitest';

import { readScan } from './scan';

const secret = new Uint8Array(32).map((_, i) => (i * 29 + 3) & 0xff);
const code = encodeInvite(
  makeInvite(secret, 'https://sync.even.appalaya.com', { g: 'Banff 2026', cur: 'CAD' }),
);
const link = inviteLink(code);

/** A payload with its fields replaced, re-encoded (bypassing makeInvite's checks). */
function recode(fields: Record<string, unknown>): string {
  return b64urlEncode(utf8Encode(JSON.stringify(fields)));
}

describe('readScan', () => {
  it('accepts the invite link and hands over its code', () => {
    expect(readScan(link)).toEqual({ kind: 'invite', code });
    expect(readScan(`  ${link}\n`)).toEqual({ kind: 'invite', code });
  });

  it('accepts the /i/# form and an upper-case host', () => {
    const slash = `https://even.appalaya.com/i/#${code}`;
    expect(readScan(slash)).toEqual({ kind: 'invite', code });
    const upper = `HTTPS://EVEN.APPALAYA.COM/i#${code}`;
    expect(readScan(upper)).toEqual({ kind: 'invite', code });
  });

  it('accepts the bare code', () => {
    expect(readScan(code)).toEqual({ kind: 'invite', code });
  });

  it('refuses a link on another host or path, and the even:// scheme', () => {
    expect(readScan(`https://example.com/i#${code}`)).toEqual({ kind: 'notInvite' });
    expect(readScan(`https://even.appalaya.com/join#${code}`)).toEqual({ kind: 'notInvite' });
    expect(readScan(`even://join#${code}`)).toEqual({ kind: 'notInvite' });
    expect(readScan('even://join')).toEqual({ kind: 'notInvite' });
  });

  it("refuses QR codes that aren't invites", () => {
    expect(readScan('https://www.example.com/menu')).toEqual({ kind: 'notInvite' });
    expect(readScan('WIFI:S:Cabin;T:WPA;P:hunter22;;')).toEqual({ kind: 'notInvite' });
    expect(readScan('hello')).toEqual({ kind: 'notInvite' });
    expect(readScan('')).toEqual({ kind: 'notInvite' });
    expect(readScan('https://even.appalaya.com/i#')).toEqual({ kind: 'notInvite' });
    expect(readScan(recode({ hello: 'world' }))).toEqual({ kind: 'notInvite' });
  });

  it('hands over an invite that is shaped right but cannot be used, so Join with code names the problem', () => {
    const newer = recode({ v: 2, s: 'https://sync.even.appalaya.com', k: 'x', h: 'y' });
    expect(readScan(newer)).toEqual({ kind: 'invite', code: newer });
    const payload = JSON.parse(utf8Decode(b64urlDecode(code))) as Record<string, unknown>;
    const damaged = recode({ ...payload, h: 'AAAAAA' });
    expect(readScan(damaged)).toEqual({ kind: 'invite', code: damaged });
  });
});
