/**
 * Responses and logs for the /api/* routes.
 *
 * _headers applies only to what the asset server answers, so every API response carries its own copy of the
 * site-wide security headers, plus `Cache-Control: no-store`. No response has an Access-Control-* header: the API
 * is for the site's own pages, and a browser on any other origin cannot read it.
 *
 * Logging (even-server THREAT-MODEL.md, "What we log"): one JSON line per API request with the route, the form's
 * purpose once it is known, the outcome and the status, plus a fixed error code where one explains a failure.
 * Never a body, message, email address, group id, server, token, header or IP. This file is the only place the
 * script calls console.*.
 */
import type { Purpose } from './validate';

export const JSON_TYPE = 'application/json; charset=utf-8';

const API_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_TYPE, ...API_HEADERS, ...headers },
  });
}

/** `{ ok: false, error }`, with `field` for a 400 that names the offending field. */
export function failure(
  status: number,
  error: string,
  extra: { field?: string; headers?: Record<string, string> } = {},
): Response {
  return json(
    { ok: false, error, ...(extra.field === undefined ? {} : { field: extra.field }) },
    status,
    extra.headers,
  );
}

export interface LogLine {
  route: string;
  status: number;
  outcome: string;
  purpose?: Purpose;
  /** A fixed code (a Turnstile or Resend error name, an HTTP status) or a field name; never request data. */
  detail?: string;
}

/** Only codes shaped like the ones Cloudflare documents, so nothing from a request can ride along. */
const SAFE_DETAIL = /^[A-Za-z0-9_,.-]{1,120}$/;

export function logLine(line: LogLine): void {
  const { detail, ...rest } = line;
  const safe = detail !== undefined && SAFE_DETAIL.test(detail) ? { detail } : {};
  console.log(JSON.stringify({ ...rest, ...safe }));
}

/** Operational events. Callers pass only names and fixed codes. */
export function logEvent(level: 'warn' | 'error', event: string, fields: object = {}): void {
  const text = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(text);
  else console.warn(text);
}

/** An exception's type only: messages and stacks can carry request data. */
export function exceptionName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * The rate-limit key: CF-Connecting-IP, which Cloudflare sets and a client cannot forge through it; IPv4 as is,
 * IPv6 by its /64, IPv4-mapped IPv6 as the IPv4 address (as even-server keys its limits). The key goes to the
 * platform's limiter and nowhere else.
 */
export function clientKey(request: Request): string {
  const address = request.headers.get('CF-Connecting-IP')?.trim() ?? '';
  return address === '' ? 'unknown' : ipKey(address);
}

export function ipKey(address: string): string {
  if (!address.includes(':')) return address;
  const groups = parseIpv6(address);
  if (groups === undefined) return address;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi = 0, lo = 0] = groups.slice(6);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** Eight 16-bit groups, or undefined. Handles `::` compression, a zone suffix and a trailing dotted IPv4. */
function parseIpv6(text: string): number[] | undefined {
  const halves = text.replace(/%.*$/, '').toLowerCase().split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === '') return [];
    const out: number[] = [];
    const pieces = part.split(':');
    for (const [i, piece] of pieces.entries()) {
      if (i === pieces.length - 1 && piece.includes('.')) {
        const octets = piece.split('.');
        if (octets.length !== 4 || !octets.every((o) => /^[0-9]{1,3}$/.test(o) && Number(o) <= 255))
          return undefined;
        const [a = 0, b = 0, c = 0, d = 0] = octets.map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        out.push(parseInt(piece, 16));
      } else {
        return undefined;
      }
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === undefined || tail === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}
