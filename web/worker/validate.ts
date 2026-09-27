/**
 * The contact form's request body (README.md, "Contact form"): exactly these keys, nothing else.
 *
 *   { purpose: "report" | "help" | "feedback", message, email?, groupId?, server?, turnstileToken }
 *
 * `groupId` and `server` are required for a report and must be absent otherwise. An optional key that is present
 * must be valid: the page omits `email` when the field is empty rather than sending "" or null. Pure, so it is
 * tested in Node.
 */

export const PURPOSES = ['report', 'help', 'feedback'] as const;
export type Purpose = (typeof PURPOSES)[number];

/** In UTF-16 code units, the unit of JavaScript's `length` and of the HTML `maxlength` attribute. */
export const MAX_MESSAGE_LENGTH = 4000;
/** RFC 5321's limit on a forward path, in practice the longest address that can be delivered to. */
export const MAX_EMAIL_LENGTH = 254;
/** Turnstile tokens are at most 2048 characters (developers.cloudflare.com/turnstile, "Validate the token"). */
export const MAX_TOKEN_LENGTH = 2048;
/** Longer than any real origin (a 253-character host and a port); only a bound on what is parsed. */
const MAX_SERVER_LENGTH = 300;

export interface ContactRequest {
  purpose: Purpose;
  message: string;
  email?: string;
  /** Report only: the group's id on that server, base64url(SHA-256(authToken)) (even-server PROTOCOL.md §2). */
  groupId?: string;
  /** Report only: the server's origin, as in the invite (PROTOCOL.md §8.1), host only. */
  server?: string;
  turnstileToken: string;
}

/** `body` when the JSON is not an object or has a key this contract does not define. */
export type Field = 'body' | keyof ContactRequest;

export type Validation = { ok: true; value: ContactRequest } | { ok: false; field: Field };

const KEYS: ReadonlySet<string> = new Set<keyof ContactRequest>([
  'purpose',
  'message',
  'email',
  'groupId',
  'server',
  'turnstileToken',
]);

/** 32 bytes, unpadded base64url. */
export const GROUP_ID = /^[A-Za-z0-9_-]{43}$/;

/** C0 controls other than tab, line feed and carriage return, and DEL. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** RFC 5322 dot-atom local part: no quoted strings, comments or leading, trailing or doubled dots. */
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Printable ASCII: Turnstile tokens are base64-like text with dots and dashes. */
const TOKEN = /^[\x21-\x7E]+$/;

export function validateContact(body: unknown): Validation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid('body');
  if (Object.keys(body).some((key) => !KEYS.has(key))) return invalid('body');
  const input = body as Record<string, unknown>;
  const has = (key: keyof ContactRequest) => Object.hasOwn(input, key);

  const { purpose, message, email, groupId, server, turnstileToken } = input;
  if (typeof purpose !== 'string' || !(PURPOSES as readonly string[]).includes(purpose))
    return invalid('purpose');
  if (!isMessage(message)) return invalid('message');
  if (has('email') && !isPlausibleEmail(email)) return invalid('email');
  if (purpose === 'report') {
    if (typeof groupId !== 'string' || !GROUP_ID.test(groupId)) return invalid('groupId');
    if (!isHttpsOrigin(server)) return invalid('server');
  } else {
    if (has('groupId')) return invalid('groupId');
    if (has('server')) return invalid('server');
  }
  if (
    typeof turnstileToken !== 'string' ||
    turnstileToken.length > MAX_TOKEN_LENGTH ||
    !TOKEN.test(turnstileToken)
  )
    return invalid('turnstileToken');

  return {
    ok: true,
    value: {
      purpose: purpose as Purpose,
      message,
      ...(typeof email === 'string' ? { email } : {}),
      ...(purpose === 'report' ? { groupId: groupId as string, server: server as string } : {}),
      turnstileToken,
    },
  };
}

function invalid(field: Field): Validation {
  return { ok: false, field };
}

/** 1 to 4000 code units, not only whitespace, well-formed UTF-16, no control characters but tab and newlines. */
export function isMessage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_MESSAGE_LENGTH &&
    value.trim() !== '' &&
    value.isWellFormed() &&
    !CONTROL.test(value)
  );
}

/**
 * Syntactically plausible, not proven deliverable: an ASCII dot-atom local part of at most 64 characters, `@`, and
 * a domain of at least two DNS labels whose last is not all digits; 254 characters at most. No whitespace, so it
 * can never break out of the Reply-To header it is written to.
 */
export function isPlausibleEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_EMAIL_LENGTH) return false;
  const at = value.lastIndexOf('@');
  if (at < 1) return false;
  const local = value.slice(0, at);
  const labels = value.slice(at + 1).split('.');
  return (
    local.length <= 64 &&
    LOCAL_PART.test(local) &&
    labels.length >= 2 &&
    labels.every((label) => DNS_LABEL.test(label)) &&
    !/^[0-9]+$/.test(labels.at(-1) ?? '')
  );
}

/**
 * An https origin in canonical form and nothing more: lowercase ASCII host, no default port, no userinfo, path,
 * trailing slash, query or fragment. `new URL(value).origin` normalises exactly those things, so a value that
 * differs from its own origin is not canonical and is rejected rather than rewritten.
 */
export function isHttpsOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_SERVER_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.origin === value;
}
