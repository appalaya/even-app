import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, utf8Decode, utf8Encode } from './encoding.js';
import {
  decodeInvite, encodeInvite, InviteError, inviteChecksum, inviteLink, makeInvite, secretFromInvite,
} from './invite.js';
import type { InviteErrorCode } from './invite.js';
import { LIMITS } from './constants.js';
import { newSecret } from './keys.js';
import type { Invite } from './types.js';

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
const SERVER = 'https://sync.even.appalaya.com';

/** Encode an arbitrary payload the way encodeInvite would, without its type or ordering. */
const encodeRaw = (payload: unknown) => b64urlEncode(utf8Encode(JSON.stringify(payload)));
const payloadOf = (code: string): unknown => JSON.parse(utf8Decode(b64urlDecode(code)));

function expectCode(fn: () => unknown, code: InviteErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(InviteError);
  expect((caught as InviteError).code).toBe(code);
}

describe('inviteChecksum', () => {
  it('is the first 4 bytes of SHA-256(secret bytes), base64url, 6 chars', () => {
    // Independent vector: Node createHash('sha256') over 0x00..0x1f, first 4 bytes, base64url.
    expect(inviteChecksum(SECRET)).toBe('Yw3NKQ');
    const secret = newSecret();
    expect(inviteChecksum(secret)).toBe(b64urlEncode(sha256(secret).subarray(0, 4)));
    expect(inviteChecksum(secret)).toMatch(/^[A-Za-z0-9_-]{6}$/);
  });
});

describe('makeInvite', () => {
  it('builds a complete invite with the server canonicalised', () => {
    expect(makeInvite(SECRET, 'HTTPS://Sync.Even.Appalaya.com:443/', { g: 'Banff 2026', cur: 'CAD' })).toEqual({
      v: 1,
      s: SERVER,
      k: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      h: 'Yw3NKQ',
      g: 'Banff 2026',
      cur: 'CAD',
    });
  });

  it('omits absent optionals', () => {
    const invite = makeInvite(SECRET, SERVER);
    expect(Object.keys(invite)).toEqual(['v', 's', 'k', 'h']);
    expect(Object.keys(makeInvite(SECRET, SERVER, { cur: 'EUR' }))).toEqual(['v', 's', 'k', 'h', 'cur']);
  });

  it('rejects a secret that is not 32 bytes', () => {
    expectCode(() => makeInvite(new Uint8Array(16), SERVER), 'secret');
  });

  it('rejects an invalid server', () => {
    expectCode(() => makeInvite(SECRET, 'http://sync.even.appalaya.com'), 'server');
  });

  it('rejects extras that decodeInvite would reject', () => {
    expectCode(() => makeInvite(SECRET, SERVER, { g: 'x'.repeat(LIMITS.groupNameMax + 1) }), 'malformed');
    expectCode(() => makeInvite(SECRET, SERVER, { cur: 'cad' }), 'malformed');
  });

  it('requires g to be a valid group name (the group.created / group.renamed rule)', () => {
    expect(makeInvite(SECRET, SERVER, { g: 'x'.repeat(LIMITS.groupNameMax) }).g).toHaveLength(LIMITS.groupNameMax);
    for (const g of ['', '   ', ' Banff', 'Banff\n']) expectCode(() => makeInvite(SECRET, SERVER, { g }), 'malformed');
    // No bidirectional-control character (review L4).
    for (const g of ['Banff\u202E6202', '\u2066Banff\u2069']) expectCode(() => makeInvite(SECRET, SERVER, { g }), 'malformed');
  });
});

describe('encodeInvite', () => {
  it('is base64url(UTF-8(JSON)) with keys in the order v, s, k, h, g, cur', () => {
    const code = encodeInvite({ cur: 'CAD', g: 'Banff 2026', h: 'Yw3NKQ', k: b64urlEncode(SECRET), s: SERVER, v: 1 });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(utf8Decode(b64urlDecode(code))).toBe(
      `{"v":1,"s":"${SERVER}","k":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8","h":"Yw3NKQ","g":"Banff 2026","cur":"CAD"}`,
    );
  });

  it('omits absent optionals and ignores unknown properties', () => {
    const invite = { ...makeInvite(SECRET, SERVER), extra: 1 } as Invite;
    expect(Object.keys(payloadOf(encodeInvite(invite)) as object)).toEqual(['v', 's', 'k', 'h']);
  });
});

describe('decodeInvite', () => {
  const invite = makeInvite(SECRET, SERVER, { g: 'Banff 2026 🏔️', cur: 'CAD' });
  const code = encodeInvite(invite);

  it('round-trips make -> encode -> decode', () => {
    expect(decodeInvite(code)).toEqual(invite);
    const plain = makeInvite(newSecret(), 'https://home.example.net:8443/even');
    expect(decodeInvite(encodeInvite(plain))).toEqual(plain);
  });

  it('decodes a full link', () => {
    const link = inviteLink(code);
    expect(link).toBe(`https://even.appalaya.com/i#${code}`);
    expect(decodeInvite(link)).toEqual(invite);
  });

  it('takes the text after the last # and trims whitespace', () => {
    expect(decodeInvite(`  ${code}\n`)).toEqual(invite);
    expect(decodeInvite(`Join us: https://even.appalaya.com/i#${code}  `)).toEqual(invite);
    expect(decodeInvite(`https://even.appalaya.com/i#junk#${code}`)).toEqual(invite);
    expect(decodeInvite(`#${code}`)).toEqual(invite);
  });

  it('canonicalises a valid but non-canonical server', () => {
    const raw = encodeRaw({ ...invite, s: 'HTTPS://Sync.Even.Appalaya.com:443/' });
    expect(decodeInvite(raw).s).toBe(SERVER);
  });

  it('ignores unknown fields', () => {
    const decoded = decodeInvite(encodeRaw({ ...invite, future: { x: 1 } }));
    expect(decoded).toEqual(invite);
    expect(Object.keys(decoded)).toEqual(['v', 's', 'k', 'h', 'g', 'cur']);
  });

  it('accepts fields in any order', () => {
    const { v, s, k, h } = invite;
    expect(decodeInvite(encodeRaw({ h, k, s, v }))).toEqual({ v, s, k, h });
  });

  describe('malformed', () => {
    it.each([
      ['empty', ''],
      ['whitespace', '   '],
      ['link without a code', 'https://even.appalaya.com/i#'],
      ['not base64url', 'not a code!'],
      ['base64 padding', `${code}==`],
      ['impossible length', 'A'.repeat(4 * 20 + 1)],
      ['truncated', code.slice(0, code.length - 7)],
      ['invalid UTF-8', b64urlEncode(Uint8Array.of(0xff, 0xfe, 0xfd))],
      ['not JSON', b64urlEncode(utf8Encode('hello world'))],
      ['JSON null', encodeRaw(null)],
      ['JSON array', encodeRaw([1, 'x'])],
      ['JSON string', encodeRaw('invite')],
      ['JSON number', encodeRaw(1)],
      ['missing v', encodeRaw({ s: SERVER, k: invite.k, h: invite.h })],
      ['v as string', encodeRaw({ ...invite, v: '1' })],
      ['missing s', encodeRaw({ v: 1, k: invite.k, h: invite.h })],
      ['missing k', encodeRaw({ v: 1, s: SERVER, h: invite.h })],
      ['missing h', encodeRaw({ v: 1, s: SERVER, k: invite.k })],
      ['s not a string', encodeRaw({ ...invite, s: 42 })],
      ['k not a string', encodeRaw({ ...invite, k: 42 })],
      ['h not a string', encodeRaw({ ...invite, h: null })],
      ['g not a string', encodeRaw({ ...invite, g: 7 })],
      ['g null', encodeRaw({ ...invite, g: null })],
      ['g 81 chars', encodeRaw({ ...invite, g: 'x'.repeat(81) })],
      ['cur lowercase', encodeRaw({ ...invite, cur: 'cad' })],
      ['cur 2 letters', encodeRaw({ ...invite, cur: 'CA' })],
      ['cur 4 letters', encodeRaw({ ...invite, cur: 'CADX' })],
      ['cur digits', encodeRaw({ ...invite, cur: '123' })],
      ['cur non-ASCII', encodeRaw({ ...invite, cur: 'ÇAD' })],
      ['cur null', encodeRaw({ ...invite, cur: null })],
    ])('%s', (_label, text) => {
      expectCode(() => decodeInvite(text), 'malformed');
    });

    it('non-string input', () => {
      expectCode(() => decodeInvite(undefined as unknown as string), 'malformed');
    });
  });

  it('drops a g holding a bidirectional-control character and keeps the invite (review L4)', () => {
    const crafted = 'Banff\u202E6202\u202C';
    const decoded = decodeInvite(encodeRaw({ ...invite, g: crafted }));
    expect(decoded).toEqual({ v: 1, s: SERVER, k: invite.k, h: invite.h, cur: 'CAD' });
    expect('g' in decoded).toBe(false);
    expect(decodeInvite(encodeRaw({ ...invite, g: 'Banff\u2067' })).g).toBeUndefined();
  });

  it('accepts g up to 80 characters (code points) and the empty string', () => {
    expect(decodeInvite(encodeRaw({ ...invite, g: 'x'.repeat(80) })).g).toBe('x'.repeat(80));
    expect(decodeInvite(encodeRaw({ ...invite, g: '😀'.repeat(80) })).g).toBe('😀'.repeat(80));
    expect(decodeInvite(encodeRaw({ ...invite, g: '' })).g).toBe('');
  });

  it.each([2, 0, 1.5, -1])('version error for v = %s', (v) => {
    expectCode(() => decodeInvite(encodeRaw({ ...invite, v })), 'version');
  });

  it('checks the version before the rest of the shape', () => {
    expectCode(() => decodeInvite(encodeRaw({ v: 2, totally: 'different' })), 'version');
  });

  it('checksum error on a mutated k', () => {
    const k = invite.k;
    for (const i of [0, 10, 20, 41]) {
      const mutated = k.slice(0, i) + (k[i] === 'A' ? 'B' : 'A') + k.slice(i + 1);
      expectCode(() => decodeInvite(encodeRaw({ ...invite, k: mutated })), 'checksum');
    }
  });

  it('checksum error on a mutated or missing-length h', () => {
    expectCode(() => decodeInvite(encodeRaw({ ...invite, h: 'AAAAAA' })), 'checksum');
    expectCode(() => decodeInvite(encodeRaw({ ...invite, h: invite.h.slice(0, 5) })), 'checksum');
    expectCode(() => decodeInvite(encodeRaw({ ...invite, h: '' })), 'checksum');
  });

  it.each([
    ['42 chars', 'A'.repeat(42)],
    ['44 chars', 'A'.repeat(44)],
    ['empty', ''],
    ['standard alphabet', `${invite.k.slice(0, 42)}+`],
    ['padded', `${invite.k}=`],
    ['16-byte secret', b64urlEncode(new Uint8Array(16))],
  ])('secret error for k %s', (_label, k) => {
    expectCode(() => decodeInvite(encodeRaw({ ...invite, k, h: 'Yw3NKQ' })), 'secret');
  });

  it('accepts a k with non-zero trailing bits and returns it canonical', () => {
    // The 43rd character carries 4 data bits and 2 unused bits; flipping the lowest bit keeps the same 32 bytes.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const loose = `${invite.k.slice(0, 42)}${alphabet[alphabet.indexOf(invite.k[42] ?? '') ^ 1]}`;
    expect(loose).not.toBe(invite.k);
    expect(Array.from(b64urlDecode(loose))).toEqual(Array.from(SECRET));
    expect(decodeInvite(encodeRaw({ ...invite, k: loose })).k).toBe(invite.k);
  });

  it.each([
    ['http', 'http://sync.even.appalaya.com'],
    ['userinfo', 'https://me@sync.even.appalaya.com'],
    ['query', 'https://sync.even.appalaya.com/?x'],
    ['non-ASCII host', 'https://bücher.example'],
    ['not a URL', 'sync'],
    ['empty', ''],
  ])('server error for s %s', (_label, s) => {
    expectCode(() => decodeInvite(encodeRaw({ ...invite, s })), 'server');
  });

  it('checks the checksum before the server', () => {
    expectCode(() => decodeInvite(encodeRaw({ ...invite, h: 'AAAAAA', s: 'http://x' })), 'checksum');
  });
});

describe('inviteLink', () => {
  it('defaults to the landing host', () => {
    expect(inviteLink('abc')).toBe('https://even.appalaya.com/i#abc');
  });

  it('accepts another host', () => {
    expect(inviteLink('abc', 'https://staging.example')).toBe('https://staging.example/i#abc');
  });
});

describe('secretFromInvite', () => {
  it('returns the original secret bytes', () => {
    const secret = newSecret();
    const decoded = decodeInvite(inviteLink(encodeInvite(makeInvite(secret, SERVER))));
    expect(secretFromInvite(decoded)).toEqual(secret);
  });

  it('rejects an invite whose k is not a 32-byte secret', () => {
    const invite = makeInvite(SECRET, SERVER);
    expectCode(() => secretFromInvite({ ...invite, k: 'short' }), 'secret');
    expectCode(() => secretFromInvite({ ...invite, k: b64urlEncode(new Uint8Array(33)) }), 'secret');
  });
});
