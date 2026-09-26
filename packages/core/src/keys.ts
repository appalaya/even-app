/** Key derivation and server-origin canonicalisation (PROTOCOL.md §2, §8.1). */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { LIMITS, PROTOCOL } from './constants.js';
import { b64urlEncode, utf8Encode } from './encoding.js';
import { randomBytes } from './ids.js';

export class InvalidServerUrlError extends Error {}

export function newSecret(): Uint8Array {
  return randomBytes(LIMITS.secretLength);
}

function checkSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length !== LIMITS.secretLength) {
    throw new RangeError(`secret must be ${LIMITS.secretLength} bytes`);
  }
}

function derive(secret: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, secret, utf8Encode(PROTOCOL.hkdfSalt), utf8Encode(info), 32);
}

/** Server-independent: encryptionKey = HKDF(secret, "even/v1", "enc"); localId = b64url(HKDF(secret, "even/v1", "local")). */
export function deriveLocal(secret: Uint8Array): { encryptionKey: Uint8Array; localId: string } {
  checkSecret(secret);
  return {
    encryptionKey: derive(secret, PROTOCOL.hkdfInfoEnc),
    localId: b64urlEncode(derive(secret, PROTOCOL.hkdfInfoLocal)),
  };
}

/** Per server: authToken = HKDF(secret, "even/v1", "auth|" + origin); groupId = b64url(SHA-256(authToken)). `origin` must already be canonical. */
export function deriveServer(secret: Uint8Array, origin: string): { authToken: Uint8Array; groupId: string } {
  checkSecret(secret);
  if (canonicalOrigin(origin) !== origin) {
    throw new InvalidServerUrlError(`origin is not canonical: expected ${JSON.stringify(canonicalOrigin(origin))}`);
  }
  const authToken = derive(secret, PROTOCOL.hkdfInfoAuthPrefix + origin);
  return { authToken, groupId: b64urlEncode(sha256(authToken)) };
}

// ---------- canonicalOrigin ----------

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DECIMAL_OCTET = /^(?:0|[1-9][0-9]{0,2})$/;
/** RFC 3986 pchar minus pct-encoded: unreserved / sub-delims / ":" / "@". */
const PATH_SEGMENT = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]+$/;

function fail(url: string, why: string): never {
  throw new InvalidServerUrlError(`Invalid server URL ${JSON.stringify(url)}: ${why}`);
}

function canonicalHost(url: string, host: string): string {
  if (host === '') fail(url, 'the host is empty');
  host = host.toLowerCase();
  if (host.length > 253) fail(url, 'the host name is longer than 253 characters');
  const labels = host.split('.');
  const last = labels[labels.length - 1] ?? '';
  // A final label that is numeric (or hex) can only be an IPv4 address; accept the dotted-quad form only, so
  // "127.1", "0x7f.0.0.1" and "010.0.0.1" cannot become second spellings of the same server.
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/.test(last)) {
    const ok = labels.length === 4 && labels.every((o) => DECIMAL_OCTET.test(o) && Number(o) <= 255);
    if (!ok) fail(url, 'a numeric host must be a dotted-decimal IPv4 address such as 192.0.2.1');
    return host;
  }
  for (const label of labels) {
    if (label === '') fail(url, 'the host has an empty label (leading, trailing, or doubled dot)');
    if (!LABEL.test(label)) {
      fail(url, `invalid host label ${JSON.stringify(label)}: use letters, digits and inner hyphens, at most 63 characters`);
    }
  }
  return host;
}

function canonicalPort(url: string, port: string): string {
  if (!/^[0-9]{1,5}$/.test(port)) fail(url, 'the port must be 1 to 5 digits');
  const value = Number(port);
  if (value < 1 || value > 65535) fail(url, 'the port must be between 1 and 65535');
  return value === 443 ? '' : `:${value}`;
}

function canonicalPath(url: string, path: string): string {
  if (path === '' || path === '/') return '';
  const body = path.endsWith('/') ? path.slice(1, -1) : path.slice(1);
  const out: string[] = [];
  for (const segment of body.split('/')) {
    if (segment === '') fail(url, 'the path contains an empty segment ("//")');
    if (segment === '.' || segment === '..') fail(url, 'the path contains a "." or ".." segment');
    if (segment.includes('%')) fail(url, 'percent-encoded characters are not supported in the path');
    if (!PATH_SEGMENT.test(segment)) fail(url, `the path segment ${JSON.stringify(segment)} has characters that are not allowed`);
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

/**
 * Canonical server URL: https only, lowercase scheme/host, ASCII host only, no userinfo, no :443, other ports kept,
 * optional path without trailing slash, no query/fragment. Throws InvalidServerUrlError. Pure TS parser; does not use URL.
 *
 * Also: surrounding whitespace is trimmed; one trailing "/" is dropped; IPv6 literals, percent-encoding, backslashes,
 * "//", "." and ".." segments, empty ports, and trailing-dot host names are rejected rather than normalised.
 */
export function canonicalOrigin(url: string): string {
  if (typeof url !== 'string') throw new InvalidServerUrlError('Invalid server URL: not a string');
  const text = url.trim();
  if (text === '') fail(url, 'it is empty');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) fail(url, 'it contains non-ASCII characters; write an internationalised host name in its punycode (xn--) form');
    if (code <= 0x20 || code === 0x7f) fail(url, 'it contains whitespace or control characters');
  }

  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  const rest = scheme === undefined ? '' : text.slice(scheme.length + 1);
  if (scheme === undefined || !rest.startsWith('//')) fail(url, 'it must start with https://');
  if (scheme !== 'https') fail(url, `the scheme must be https, not ${scheme}`);
  if (rest.includes('?')) fail(url, 'a query string ("?") is not allowed');
  if (rest.includes('#')) fail(url, 'a fragment ("#") is not allowed');
  if (rest.includes('\\')) fail(url, 'backslashes are not allowed');

  const afterSlashes = rest.slice(2);
  const pathStart = afterSlashes.indexOf('/');
  const authority = pathStart === -1 ? afterSlashes : afterSlashes.slice(0, pathStart);
  const path = pathStart === -1 ? '' : afterSlashes.slice(pathStart);
  if (authority.includes('@')) fail(url, 'a user name or password ("user@") is not allowed');

  if (authority.startsWith('[')) fail(url, 'IPv6 address literals are not supported; use a host name');
  const colon = authority.indexOf(':');
  if (colon !== -1 && authority.indexOf(':', colon + 1) !== -1) fail(url, 'the host has more than one ":"');
  const host = canonicalHost(url, colon === -1 ? authority : authority.slice(0, colon));
  const port = colon === -1 ? '' : canonicalPort(url, authority.slice(colon + 1));

  return `https://${host}${port}${canonicalPath(url, path)}`;
}
