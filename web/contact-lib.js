/**
 * The contact page's rules, with no DOM (contact.js is the page; contact-lib.test.ts checks this file against
 * @even/core's known answers and the Worker's own request rules; scripts/check.mjs runs the known answers too).
 *
 * A report names a group by its id on its server, worked out here from the invite so that the invite, which is the
 * group's key, is never sent; the page empties the field it was pasted into at once (takeInvite). From even-server
 * PROTOCOL.md §2 and §8:
 *
 *   authToken = HKDF-SHA256(ikm = secret, salt = "even/v1", info = "auth|" + server, 32 bytes)
 *   groupId   = base64url(SHA-256(authToken)), without padding: 43 characters
 *
 * The invite is read exactly as @even/core's decodeInvite reads it, and the server canonicalised exactly as its
 * canonicalOrigin does, so the id is the one the app uses. WebCrypto only: `crypto.subtle` exists in a secure
 * context (https, or localhost) and is global in Node. No dependencies.
 */

/** PROTOCOL.defaultServer: the server Appalaya runs, the only one whose groups it can block. */
export const DEFAULT_SERVER = 'https://sync.even.appalaya.com';

const HKDF_SALT = 'even/v1';
const HKDF_INFO_AUTH_PREFIX = 'auth|';
const SECRET_BYTES = 32;
/** 32 bytes as unpadded base64url. */
const SECRET_CHARS = 43;
const CHECKSUM_BYTES = 4;
/** LIMITS.groupNameMax: the longest `g` an invite may carry, in code points. */
const GROUP_NAME_MAX = 80;

/** A group id on a server: 32 bytes, unpadded base64url (web/worker/validate.ts, GROUP_ID). */
export const GROUP_ID = /^[A-Za-z0-9_-]{43}$/;

export const PURPOSES = ['report', 'help', 'feedback'];

/** The reasons a report can give, in the order the page lists them. */
export const REASONS = [
  'Illegal content',
  'Harassment or threats',
  'Spam or scam',
  'Something else',
];

/** web/worker/validate.ts, MAX_MESSAGE_LENGTH; the config route sends the live value. */
export const MAX_MESSAGE_LENGTH = 4000;
/** web/worker/validate.ts, MAX_EMAIL_LENGTH. */
export const MAX_EMAIL_LENGTH = 254;

/** Why an invite could not be read. `code` as @even/core's InviteError: malformed, version, secret, checksum, server. */
export class InviteError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'InviteError';
    this.code = code;
  }
}

export class InvalidServerUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidServerUrlError';
  }
}

// ---------- base64url and UTF-8 (packages/core/src/encoding.ts) ----------

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function sextet(text, index) {
  const code = text.charCodeAt(index);
  return code < 128 ? ALPHABET.indexOf(String.fromCharCode(code)) : -1;
}

export function b64urlEncode(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >>> 18) & 63] +
      ALPHABET[(n >>> 12) & 63] +
      ALPHABET[(n >>> 6) & 63] +
      ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63];
  }
  return out;
}

/** True if `text` is unpadded base64url and, when given, exactly `length` characters. */
export function isB64url(text, length) {
  if (typeof text !== 'string') return false;
  if (length !== undefined && text.length !== length) return false;
  if (text.length % 4 === 1) return false;
  for (let i = 0; i < text.length; i++) if (sextet(text, i) < 0) return false;
  return true;
}

/** Strict: throws on any character outside the alphabet or an impossible length. */
export function b64urlDecode(text) {
  if (!isB64url(text)) throw new RangeError('not base64url');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < text.length; i += 4) {
    const n =
      (sextet(text, i) << 18) |
      (sextet(text, i + 1) << 12) |
      (sextet(text, i + 2) << 6) |
      sextet(text, i + 3);
    out[o++] = (n >>> 16) & 255;
    out[o++] = (n >>> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = text.length - i;
  if (rest >= 2) {
    const c = rest === 3 ? sextet(text, i + 2) : 0;
    const n = (sextet(text, i) << 18) | (sextet(text, i + 1) << 12) | (c << 6);
    out[o++] = (n >>> 16) & 255;
    if (rest === 3) out[o++] = (n >>> 8) & 255;
  }
  return out;
}

const utf8 = (text) => new TextEncoder().encode(text);
const utf8Strict = (bytes) =>
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

// ---------- canonicalOrigin (packages/core/src/keys.ts), PROTOCOL.md §8.1 ----------

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DECIMAL_OCTET = /^(?:0|[1-9][0-9]{0,2})$/;
const PATH_SEGMENT = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]+$/;

function badUrl(url, why) {
  throw new InvalidServerUrlError(`Invalid server URL ${JSON.stringify(url)}: ${why}`);
}

function canonicalHost(url, raw) {
  if (raw === '') badUrl(url, 'the host is empty');
  const host = raw.toLowerCase();
  if (host.length > 253) badUrl(url, 'the host name is longer than 253 characters');
  const labels = host.split('.');
  const last = labels[labels.length - 1] ?? '';
  if (/^(?:[0-9]+|0x[0-9a-f]*)$/.test(last)) {
    const ok =
      labels.length === 4 && labels.every((o) => DECIMAL_OCTET.test(o) && Number(o) <= 255);
    if (!ok) badUrl(url, 'a numeric host must be a dotted-decimal IPv4 address');
    return host;
  }
  for (const label of labels) {
    if (label === '') badUrl(url, 'the host has an empty label');
    if (!LABEL.test(label)) badUrl(url, `invalid host label ${JSON.stringify(label)}`);
  }
  return host;
}

function canonicalPort(url, port) {
  if (!/^[0-9]{1,5}$/.test(port)) badUrl(url, 'the port must be 1 to 5 digits');
  const value = Number(port);
  if (value < 1 || value > 65535) badUrl(url, 'the port must be between 1 and 65535');
  return value === 443 ? '' : `:${value}`;
}

function canonicalPath(url, path) {
  if (path === '' || path === '/') return '';
  const body = path.endsWith('/') ? path.slice(1, -1) : path.slice(1);
  const out = [];
  for (const segment of body.split('/')) {
    if (segment === '') badUrl(url, 'the path contains an empty segment');
    if (segment === '.' || segment === '..') badUrl(url, 'the path contains a "." or ".." segment');
    if (segment.includes('%'))
      badUrl(url, 'percent-encoded characters are not supported in the path');
    if (!PATH_SEGMENT.test(segment))
      badUrl(url, `the path segment ${JSON.stringify(segment)} is not allowed`);
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

/**
 * The canonical server URL, or InvalidServerUrlError: https only, lowercase scheme and host, ASCII host, no userinfo,
 * no :443, other ports kept, an optional path without a trailing slash, no query or fragment.
 */
export function canonicalOrigin(url) {
  if (typeof url !== 'string') throw new InvalidServerUrlError('Invalid server URL: not a string');
  const text = url.trim();
  if (text === '') badUrl(url, 'it is empty');
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) badUrl(url, 'it contains non-ASCII characters');
    if (code <= 0x20 || code === 0x7f) badUrl(url, 'it contains whitespace or control characters');
  }
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  const rest = scheme === undefined ? '' : text.slice(scheme.length + 1);
  if (scheme === undefined || !rest.startsWith('//')) badUrl(url, 'it must start with https://');
  if (scheme !== 'https') badUrl(url, `the scheme must be https, not ${scheme}`);
  if (rest.includes('?')) badUrl(url, 'a query string is not allowed');
  if (rest.includes('#')) badUrl(url, 'a fragment is not allowed');
  if (rest.includes('\\')) badUrl(url, 'backslashes are not allowed');
  const afterSlashes = rest.slice(2);
  const pathStart = afterSlashes.indexOf('/');
  const authority = pathStart === -1 ? afterSlashes : afterSlashes.slice(0, pathStart);
  const path = pathStart === -1 ? '' : afterSlashes.slice(pathStart);
  if (authority.includes('@')) badUrl(url, 'a user name or password is not allowed');
  if (authority.startsWith('[')) badUrl(url, 'IPv6 address literals are not supported');
  const colon = authority.indexOf(':');
  if (colon !== -1 && authority.indexOf(':', colon + 1) !== -1)
    badUrl(url, 'the host has more than one ":"');
  const host = canonicalHost(url, colon === -1 ? authority : authority.slice(0, colon));
  const port = colon === -1 ? '' : canonicalPort(url, authority.slice(colon + 1));
  return `https://${host}${port}${canonicalPath(url, path)}`;
}

/**
 * The contact API's rule for `server` (web/worker/validate.ts, isHttpsOrigin): an https origin in canonical form,
 * with no path. A server whose canonical URL has a path cannot be reported through the form.
 */
export function isHttpsOrigin(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.origin === value;
}

// ---------- the invite (packages/core/src/invite.ts, decodeInvite) ----------

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** First 4 bytes of SHA-256(secret), base64url: 6 characters. */
export async function inviteChecksum(secret) {
  return b64urlEncode((await sha256(secret)).subarray(0, CHECKSUM_BYTES));
}

const hasOwn = (o, key) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * Reads a pasted invite link or bare code the way the app does and returns its secret and canonical server; throws
 * InviteError otherwise. Checks in decodeInvite's order: shape, version, secret, checksum, server.
 */
export async function readInvite(text) {
  if (typeof text !== 'string') throw new InviteError('malformed', 'invite is not text');
  const hash = text.lastIndexOf('#');
  const code = (hash === -1 ? text : text.slice(hash + 1)).trim();
  if (code === '' || !isB64url(code)) throw new InviteError('malformed', 'not base64url');
  let payload;
  try {
    payload = JSON.parse(utf8Strict(b64urlDecode(code)));
  } catch {
    throw new InviteError('malformed', 'no JSON payload');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new InviteError('malformed', 'payload is not an object');
  }
  const v = payload['v'];
  if (typeof v !== 'number') throw new InviteError('malformed', 'no version');
  if (v !== 1) throw new InviteError('version', `invite version ${v}`);
  const { s, k, h } = payload;
  if (typeof s !== 'string' || typeof k !== 'string' || typeof h !== 'string') {
    throw new InviteError('malformed', 'missing server, secret or checksum');
  }
  const g = payload['g'];
  const cur = payload['cur'];
  if (hasOwn(payload, 'g') && (typeof g !== 'string' || [...g].length > GROUP_NAME_MAX)) {
    throw new InviteError('malformed', 'bad group name');
  }
  if (hasOwn(payload, 'cur') && (typeof cur !== 'string' || !/^[A-Z]{3}$/.test(cur))) {
    throw new InviteError('malformed', 'bad currency');
  }
  if (!isB64url(k, SECRET_CHARS))
    throw new InviteError('secret', 'secret is not 43 base64url characters');
  const secret = b64urlDecode(k);
  if (secret.length !== SECRET_BYTES) throw new InviteError('secret', 'secret is not 32 bytes');
  if (h !== (await inviteChecksum(secret)))
    throw new InviteError('checksum', 'checksum does not match');
  let server;
  try {
    server = canonicalOrigin(s);
  } catch {
    throw new InviteError('server', 'invalid server URL');
  }
  return { secret, server };
}

// ---------- key derivation (packages/core/src/keys.ts), PROTOCOL.md §2 ----------

/** HKDF-SHA256(secret, "even/v1", "auth|" + server), 32 bytes. `server` must already be canonical. */
export async function authToken(secret, server) {
  if (!(secret instanceof Uint8Array) || secret.length !== SECRET_BYTES) {
    throw new RangeError('secret must be 32 bytes');
  }
  if (canonicalOrigin(server) !== server)
    throw new InvalidServerUrlError('server is not canonical');
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: utf8(HKDF_SALT),
      info: utf8(HKDF_INFO_AUTH_PREFIX + server),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** base64url(SHA-256(authToken)): the group's id on that server, 43 characters. */
export async function groupIdForToken(token) {
  if (!(token instanceof Uint8Array) || token.length !== 32)
    throw new RangeError('auth token must be 32 bytes');
  return b64urlEncode(await sha256(token));
}

export async function groupIdFor(secret, server) {
  return groupIdForToken(await authToken(secret, server));
}

// ---------- what the page shows and sends ----------

/**
 * A report's target: the group id, its server, whether the form can take it (the API accepts an origin only, not a
 * server URL with a path), and whether it is Appalaya's server.
 */
export function reportTarget(groupId, server) {
  return {
    groupId,
    server,
    reportable: isHttpsOrigin(server),
    appalaya: server === DEFAULT_SERVER,
  };
}

/** The target named by a pasted invite link or code; throws InviteError. The secret stays in this function. */
export async function targetFromInvite(text) {
  const { secret, server } = await readInvite(text);
  return reportTarget(await groupIdFor(secret, server), server);
}

/**
 * Reads the invite pasted into a text field (`{ value }`: the page's #link) and empties the field at once, before
 * anything is awaited, so the invite, which is the group's key, does not stay on the page. Resolves to the target
 * (only the id and server, as targetFromInvite), to null for blank text, or rejects with InviteError.
 */
export function takeInvite(field) {
  const text = String(field.value ?? '');
  field.value = '';
  return text.trim() === '' ? Promise.resolve(null) : targetFromInvite(text);
}

/** "sync.even.appalaya.com", "home.example.net:8443/even": a canonical server URL without its scheme. */
export function serverLabel(server) {
  return server.startsWith('https://') ? server.slice('https://'.length) : server;
}

/** "ab12…u7Qx": the first and last four characters, as the app's report sheet shows an id. */
export function shortGroupId(groupId) {
  return groupId.length <= 9 ? groupId : `${groupId.slice(0, 4)}…${groupId.slice(-4)}`;
}

/**
 * The fragment the app opens the page with: `#purpose=help`, `#purpose=feedback`, or
 * `#purpose=report&id=<groupId>&server=<https origin>`. `purpose` is null when absent or unknown; `target` is null
 * unless a report names a well-formed id and a server with a canonical form.
 */
export function readFragment(hash) {
  const params = new URLSearchParams(typeof hash === 'string' ? hash.replace(/^#/, '') : '');
  const named = params.get('purpose');
  const purpose = PURPOSES.includes(named) ? named : null;
  if (purpose !== 'report') return { purpose, target: null };
  const id = params.get('id') ?? '';
  const raw = params.get('server') ?? '';
  if (!GROUP_ID.test(id)) return { purpose, target: null };
  let server;
  try {
    server = canonicalOrigin(raw);
  } catch {
    return { purpose, target: null };
  }
  return { purpose, target: reportTarget(id, server) };
}

/** C0 controls other than tab, line feed and carriage return, and DEL: the API rejects them. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Text as the API accepts it: no control characters, no lone surrogates, no surrounding whitespace. */
export function cleanText(text) {
  const clean = String(text).replace(CONTROL, '');
  return (typeof clean.toWellFormed === 'function' ? clean.toWellFormed() : clean).trim();
}

/** A report's message: its reason, then what the person saw, if anything. */
export function reportMessage(reason, details) {
  const seen = cleanText(details);
  return seen === '' ? `Reason: ${reason}` : `Reason: ${reason}\n\n${seen}`;
}

/** The longest `Reason: …` line and blank line a report message starts with. */
export const REPORT_PREFIX_MAX = Math.max(...REASONS.map((r) => reportMessage(r, '').length)) + 2;

/**
 * The POST body (web/README.md, "API for the page"): exactly the keys the API takes. `email` is left out when
 * empty (the API rejects "" and null); `groupId` and `server` go with a report and nowhere else.
 */
export function contactBody({ purpose, message, email, target, turnstileToken }) {
  if (!PURPOSES.includes(purpose)) throw new RangeError(`unknown purpose ${purpose}`);
  const body = { purpose, message };
  const address = typeof email === 'string' ? email.trim() : '';
  if (address !== '') body.email = address;
  if (purpose === 'report') {
    if (target === null || target === undefined || !target.reportable)
      throw new RangeError('no reportable group');
    body.groupId = target.groupId;
    body.server = target.server;
  }
  body.turnstileToken = turnstileToken;
  return body;
}

/**
 * What the page says after a POST, from the status and the JSON body: `sent`, `turnstile` (reset the widget and
 * check again), `rate_limited` (one message a minute), or `unavailable` (the form or its mail cannot work now).
 */
export function outcome(status, body) {
  if (status === 202 && body !== null && typeof body === 'object' && body.ok === true)
    return 'sent';
  const error = body !== null && typeof body === 'object' ? body.error : undefined;
  if (status === 403 && error === 'turnstile_failed') return 'turnstile';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}
