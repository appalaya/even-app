import { sha256 } from '@noble/hashes/sha2.js';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode } from './encoding.js';
import { canonicalOrigin, deriveLocal, deriveServer, groupIdForToken, InvalidServerUrlError, newSecret } from './keys.js';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** secret = 0x00 0x01 … 0x1f */
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
const DEFAULT = 'https://sync.even.appalaya.com';
const HOME = 'https://home.example.net:8443/even';

/**
 * Known-answer vectors computed independently with Node's `crypto.hkdfSync` / `createHash('sha256')` and
 * `Buffer#toString('base64url')`, not with @noble or this module. They pin PROTOCOL.md §2 for other implementations.
 */
const VECTORS = {
  encryptionKeyHex: '05dfaaec81e08821fddda8094319bb1eb24825e65de14fcee95729af87053a6d',
  localId: 'f7tQ_gdG-T-e6rtbgy_FtNT75Yu9ieQs0_mnuysbtI8',
  [DEFAULT]: { authToken: 'Bth1dhK4nn2tJ_RNu2DTi0ZWWiCKyPXtYFJsoUA4TA8', groupId: '5440R1lj0RAH5z7UZJ48_Fbl2cbrEBrp4DFswxKPwTI' },
  [HOME]: { authToken: 'GAL3XisRWEhk3X6FLeypv78mKgTSHgM0OO92ONP8XqM', groupId: 'ohV9w_-dFphsCPCXCv7OQnwDcxnuhBeGmQNKiJkI8z4' },
} as const;

describe('newSecret', () => {
  it('is 32 random bytes', () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(32);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('deriveLocal', () => {
  it('matches the independent known-answer vector', () => {
    const { encryptionKey, localId } = deriveLocal(SECRET);
    expect(hex(encryptionKey)).toBe(VECTORS.encryptionKeyHex);
    expect(localId).toBe(VECTORS.localId);
  });

  it('is deterministic and produces a 32-byte key and a 43-char localId', () => {
    const secret = newSecret();
    const a = deriveLocal(secret);
    const b = deriveLocal(secret);
    expect(a.encryptionKey).toHaveLength(32);
    expect(a.localId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).toEqual(b);
  });

  it('separates the encryption key from the local id', () => {
    const { encryptionKey, localId } = deriveLocal(SECRET);
    expect(hex(b64urlDecode(localId))).not.toBe(hex(encryptionKey));
  });

  it('differs between secrets', () => {
    expect(deriveLocal(newSecret()).localId).not.toBe(deriveLocal(newSecret()).localId);
  });

  it('rejects secrets that are not 32 bytes', () => {
    expect(() => deriveLocal(new Uint8Array(31))).toThrow(RangeError);
    expect(() => deriveLocal(new Uint8Array(33))).toThrow(RangeError);
    expect(() => deriveLocal('x'.repeat(32) as unknown as Uint8Array)).toThrow(RangeError);
  });
});

describe('deriveServer', () => {
  it.each([DEFAULT, HOME] as const)('matches the independent known-answer vector for %s', (origin) => {
    const { authToken, groupId } = deriveServer(SECRET, origin);
    expect(b64urlEncode(authToken)).toBe(VECTORS[origin].authToken);
    expect(groupId).toBe(VECTORS[origin].groupId);
  });

  it('groupId is b64url(SHA-256(authToken)), 43 chars', () => {
    const { authToken, groupId } = deriveServer(newSecret(), DEFAULT);
    expect(authToken).toHaveLength(32);
    expect(groupId).toBe(b64urlEncode(sha256(authToken)));
    expect(groupId).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is deterministic', () => {
    const secret = newSecret();
    expect(deriveServer(secret, HOME)).toEqual(deriveServer(secret, HOME));
  });

  it('gives different tokens and group ids on different origins, while the local derivation is unchanged', () => {
    const secret = newSecret();
    const origins = [DEFAULT, HOME, 'https://home.example.net/even', 'https://home.example.net:8443', 'https://home.example.net:8443/even/x'];
    const derived = origins.map((o) => deriveServer(secret, o));
    expect(new Set(derived.map((d) => b64urlEncode(d.authToken))).size).toBe(origins.length);
    expect(new Set(derived.map((d) => d.groupId)).size).toBe(origins.length);
    // encryptionKey and localId have no origin input at all: the same secret gives the same values for every server.
    expect(deriveLocal(secret)).toEqual(deriveLocal(Uint8Array.from(secret)));
  });

  it('keeps the auth token independent of the encryption key and local id', () => {
    const { encryptionKey, localId } = deriveLocal(SECRET);
    const { authToken } = deriveServer(SECRET, DEFAULT);
    expect(hex(authToken)).not.toBe(hex(encryptionKey));
    expect(b64urlEncode(authToken)).not.toBe(localId);
  });

  it.each([
    'https://sync.even.appalaya.com/',
    'https://Sync.Even.Appalaya.com',
    'HTTPS://sync.even.appalaya.com',
    'https://sync.even.appalaya.com:443',
    ' https://sync.even.appalaya.com',
    'https://home.example.net:8443/even/',
  ])('throws InvalidServerUrlError for the non-canonical origin %j', (origin) => {
    expect(() => deriveServer(SECRET, origin)).toThrow(InvalidServerUrlError);
  });

  it('throws InvalidServerUrlError for an invalid origin', () => {
    expect(() => deriveServer(SECRET, 'http://sync.even.appalaya.com')).toThrow(InvalidServerUrlError);
  });

  it('rejects secrets that are not 32 bytes', () => {
    expect(() => deriveServer(new Uint8Array(16), DEFAULT)).toThrow(RangeError);
  });
});

describe('groupIdForToken', () => {
  it.each([DEFAULT, HOME] as const)('matches the independent known-answer vector for %s', (origin) => {
    expect(groupIdForToken(b64urlDecode(VECTORS[origin].authToken))).toBe(VECTORS[origin].groupId);
  });

  it('equals deriveServer(...).groupId for random secrets and origins (property)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.constantFrom(DEFAULT, HOME, 'https://home.example.net', 'https://192.0.2.1:8080/a/b', 'https://x.test'),
        (secret, origin) => {
          const { authToken, groupId } = deriveServer(secret, origin);
          const fromToken = groupIdForToken(authToken);
          expect(fromToken).toBe(groupId);
          expect(fromToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('throws RangeError unless the token is 32 bytes', () => {
    for (const length of [0, 16, 31, 33, 64]) {
      expect(() => groupIdForToken(new Uint8Array(length))).toThrow(RangeError);
    }
    expect(() => groupIdForToken('x'.repeat(32) as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => groupIdForToken(Array.from({ length: 32 }, () => 0) as unknown as Uint8Array)).toThrow(RangeError);
    expect(() => groupIdForToken(new Uint8Array(32))).not.toThrow();
  });
});

describe('canonicalOrigin', () => {
  it.each([
    ['https://Sync.Even.Appalaya.com:443/', 'https://sync.even.appalaya.com'],
    ['https://home.example.net:8443/even/', 'https://home.example.net:8443/even'],
    ['https://sync.even.appalaya.com', 'https://sync.even.appalaya.com'],
    ['HTTPS://EXAMPLE.COM', 'https://example.com'],
    ['hTtPs://example.com/', 'https://example.com'],
    ['https://example.com:443', 'https://example.com'],
    ['https://example.com:0443', 'https://example.com'],
    ['https://example.com:08443', 'https://example.com:8443'],
    ['https://example.com:1', 'https://example.com:1'],
    ['https://example.com:65535', 'https://example.com:65535'],
    ['https://example.com:80', 'https://example.com:80'],
    ['https://example.com/Even/Sync', 'https://example.com/Even/Sync'],
    ['https://example.com/a/b/c/', 'https://example.com/a/b/c'],
    ['https://example.com/v1.2/~me/a-b_c', 'https://example.com/v1.2/~me/a-b_c'],
    ['  https://example.com/even \n', 'https://example.com/even'],
    ['https://xn--bcher-kva.example', 'https://xn--bcher-kva.example'],
    ['https://localhost:8443', 'https://localhost:8443'],
    ['https://192.0.2.10:8443/even', 'https://192.0.2.10:8443/even'],
    ['https://a-b.c-d.example', 'https://a-b.c-d.example'],
    [`https://${'a'.repeat(63)}.example`, `https://${'a'.repeat(63)}.example`],
  ])('%j -> %j', (input, expected) => {
    const out = canonicalOrigin(input);
    expect(out).toBe(expected);
    expect(canonicalOrigin(out)).toBe(out); // idempotent
  });

  it.each([
    ['http', 'http://sync.even.appalaya.com'],
    ['http uppercase', 'HTTP://sync.even.appalaya.com'],
    ['other scheme', 'ftp://example.com'],
    ['custom scheme', 'even://join'],
    ['no scheme', 'sync.even.appalaya.com'],
    ['no scheme with port', 'example.com:8443'],
    ['missing slashes', 'https:example.com'],
    ['one slash', 'https:/example.com'],
    ['userinfo', 'https://user@example.com'],
    ['userinfo with password', 'https://user:pass@example.com'],
    ['empty userinfo', 'https://@example.com'],
    ['query', 'https://example.com/?x=1'],
    ['empty query', 'https://example.com?'],
    ['fragment', 'https://example.com/#top'],
    ['empty fragment', 'https://example.com#'],
    ['non-ASCII host', 'https://bücher.example'],
    ['non-ASCII path', 'https://example.com/café'],
    ['full-width dot', 'https://example．com'],
    ['empty host', 'https://'],
    ['empty host with path', 'https:///even'],
    ['empty host with port', 'https://:8443'],
    ['.. segment', 'https://example.com/even/..'],
    ['.. in the middle', 'https://example.com/a/../b'],
    ['. segment', 'https://example.com/./even'],
    ['double slash', 'https://example.com//even'],
    ['double trailing slash', 'https://example.com/even//'],
    ['percent-encoding', 'https://example.com/%65ven'],
    ['encoded dot segment', 'https://example.com/%2e%2e'],
    ['backslash', 'https://example.com\\even'],
    ['port 0', 'https://example.com:0'],
    ['port 65536', 'https://example.com:65536'],
    ['port too many digits', 'https://example.com:000443'],
    ['port with letters', 'https://example.com:84a3'],
    ['negative port', 'https://example.com:-1'],
    ['plus port', 'https://example.com:+443'],
    ['empty port', 'https://example.com:'],
    ['two colons', 'https://example.com:8443:1'],
    ['IPv6 literal', 'https://[::1]'],
    ['IPv6 literal with port', 'https://[2001:db8::1]:8443'],
    ['malformed bracket', 'https://[::1'],
    ['space in host', 'https://exa mple.com'],
    ['tab in path', 'https://example.com/a\tb'],
    ['control char', 'https://example.com\u0000'],
    ['DEL', 'https://example.com\u007f'],
    ['underscore in host', 'https://my_server.example.com'],
    ['leading hyphen label', 'https://-bad.example.com'],
    ['trailing hyphen label', 'https://bad-.example.com'],
    ['empty label', 'https://a..example.com'],
    ['leading dot', 'https://.example.com'],
    ['trailing dot', 'https://example.com.'],
    ['label too long', `https://${'a'.repeat(64)}.example`],
    ['host too long', `https://${Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.')}.example`],
    ['shorthand IPv4', 'https://127.1'],
    ['numeric host', 'https://2130706433'],
    ['hex IPv4', 'https://0x7f.0.0.1'],
    ['octal-looking IPv4', 'https://010.0.0.1'],
    ['IPv4 octet > 255', 'https://192.0.2.256'],
    ['five-part IPv4', 'https://1.2.3.4.5'],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('rejects %s (%j)', (_label, input) => {
    expect(() => canonicalOrigin(input)).toThrow(InvalidServerUrlError);
  });

  it('gives helpful messages', () => {
    expect(() => canonicalOrigin('http://example.com')).toThrow(/scheme must be https, not http/);
    expect(() => canonicalOrigin('https://bücher.example')).toThrow(/punycode/);
    expect(() => canonicalOrigin('https://[::1]')).toThrow(/IPv6/);
    expect(() => canonicalOrigin('https://u@example.com')).toThrow(/user name or password/);
    expect(() => canonicalOrigin('example.com')).toThrow(/must start with https:\/\//);
  });

  it('rejects non-strings with InvalidServerUrlError', () => {
    expect(() => canonicalOrigin(undefined as unknown as string)).toThrow(InvalidServerUrlError);
    expect(() => canonicalOrigin(42 as unknown as string)).toThrow(InvalidServerUrlError);
  });

  it('treats spellings of one server as one canonical string', () => {
    const spellings = [
      'https://sync.even.appalaya.com',
      'https://sync.even.appalaya.com/',
      'https://SYNC.even.appalaya.com:443',
      'HTTPS://sync.even.appalaya.com:443/',
    ];
    expect(new Set(spellings.map(canonicalOrigin))).toEqual(new Set([DEFAULT]));
  });
});
