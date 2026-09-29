/**
 * `Transport` over `fetch` (design.md "Transport"; PROTOCOL.md §5–§7). One instance per canonical server URL.
 * Refuses non-HTTPS URLs at construction; there are no certificate options. Every failure rejects with a
 * `SyncError` carrying the protocol `error` code, `index`, `reason`, and `Retry-After` in ms.
 *
 * No retries here: the engine owns retry, backoff, and `Retry-After`. Every request times out after 30 s (the body
 * read included) as a `network` error. Error messages are fixed words: the route pattern
 * (`POST /v1/groups/{groupId}/events`), the HTTP status and the code, never the path itself, which carries the
 * group id, and never text from the response (a `message`, an `error` that is not a protocol code). A message can
 * reach a log line, React Native writes every console line to the device log in release builds too, and the
 * server is whoever the invite names (../even-server/THREAT-MODEL.md "What we log").
 */
import { b64urlEncode, canonicalOrigin, InvalidServerUrlError, type Envelope } from '@even/core';

import { SyncError, type SyncErrorDetails } from './errors';
import type {
  ProtocolErrorCode,
  PullResponse,
  PushResponse,
  ServerInfo,
  SyncErrorCode,
  Transport,
} from './types';

export interface HttpTransportOptions {
  /**
   * Tests only: also accept `http://127.0.0.1[:port][/path]` and `http://localhost[:port][/path]`, so the
   * engine can be run against a local reference server. Never set in the app (PROTOCOL.md §5, §10).
   */
  allowInsecureLocalhost?: boolean;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout; a timeout is a `network` error. Default 30 s. */
  timeoutMs?: number;
  /** Clock for HTTP-date `Retry-After` values. Default `Date.now`. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const PROTOCOL_ERRORS: ReadonlySet<string> = new Set<ProtocolErrorCode>([
  'invalid_request',
  'invalid_envelope',
  'unauthorized',
  'not_found',
  'method_not_allowed',
  'group_full',
  'unsupported_version',
  'group_blocked',
  'rate_limited',
  'over_budget',
  'server_error',
  'not_implemented',
]);

/** The code a status implies when the body does not name a known protocol error. */
function codeForStatus(status: number): SyncErrorCode {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 410:
      return 'group_blocked';
    case 413:
      return 'group_full';
    case 415:
      return 'unsupported_version';
    case 429:
      return 'rate_limited';
    case 501:
      return 'not_implemented';
    default:
      // 5xx and anything a conforming server never sends (a proxy's 403, 502, …): transient.
      return 'server_error';
  }
}

/** `Retry-After` as ms: delta-seconds or an HTTP-date (RFC 9110 §10.2.3). Undefined when absent or unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;
  const text = value.trim();
  if (/^[0-9]+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Resolves the constructor's URL to `{ origin, base }`: `origin` is the canonical `https` form (what keys are
 * derived from), `base` is what requests go to. They differ only for the test-only insecure loopback case.
 */
function resolveServer(url: string, allowInsecure: boolean): { origin: string; base: string } {
  const text = url.trim();
  if (allowInsecure && /^http:\/\//i.test(text)) {
    const origin = canonicalOrigin(`https://${text.slice('http://'.length)}`);
    const host = origin.slice('https://'.length).split(/[:/]/)[0] ?? '';
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new InvalidServerUrlError(`http:// is allowed only for 127.0.0.1 or localhost: ${url}`);
    }
    return { origin, base: `http://${origin.slice('https://'.length)}` };
  }
  const origin = canonicalOrigin(text); // throws InvalidServerUrlError for http:// and anything non-canonicalisable
  return { origin, base: origin };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositive(value: unknown): value is number {
  return isCount(value) && value > 0;
}

function parseInfo(body: unknown): ServerInfo | null {
  if (!isRecord(body) || !isRecord(body.limits) || !isRecord(body.limits.rate)) return null;
  const { protocol, limits, retention_days, push, operator, terms } = body;
  const rate = limits.rate as Record<string, unknown>;
  if (!Array.isArray(protocol) || !protocol.every(isPositive)) return null;
  const sizes = [
    limits.max_event_bytes,
    limits.max_group_bytes,
    limits.max_group_events,
    limits.max_batch,
    limits.max_page,
  ];
  if (!sizes.every(isPositive) || !isCount(limits.daily_write_budget)) return null;
  const rates = [rate.requests_per_minute, rate.writes_per_minute, rate.group_creates_per_minute];
  if (!rates.every(isCount) || !isCount(retention_days) || typeof push !== 'boolean') return null;
  if (operator !== undefined && typeof operator !== 'string') return null;
  if (terms !== undefined && typeof terms !== 'string') return null;
  const info: ServerInfo = {
    protocol: protocol as number[],
    limits: {
      max_event_bytes: limits.max_event_bytes as number,
      max_group_bytes: limits.max_group_bytes as number,
      max_group_events: limits.max_group_events as number,
      max_batch: limits.max_batch as number,
      max_page: limits.max_page as number,
      daily_write_budget: limits.daily_write_budget as number,
      rate: {
        requests_per_minute: rate.requests_per_minute as number,
        writes_per_minute: rate.writes_per_minute as number,
        group_creates_per_minute: rate.group_creates_per_minute as number,
      },
    },
    retention_days,
    push,
  };
  if (operator !== undefined) info.operator = operator;
  if (terms !== undefined) info.terms = terms;
  return info;
}

function parsePush(body: unknown): PushResponse | null {
  if (!isRecord(body)) return null;
  const { accepted, duplicates, seq, epoch } = body;
  if (!isCount(accepted) || !isCount(duplicates) || !isCount(seq)) return null;
  if (typeof epoch !== 'string' || epoch === '') return null;
  return { accepted, duplicates, seq, epoch };
}

/** Envelopes are passed through unvalidated: the engine classifies each one (design.md "Cycle", step 2). */
function parsePull(body: unknown): PullResponse | null {
  if (!isRecord(body)) return null;
  const { events, next, more, epoch } = body;
  if (!Array.isArray(events) || !isCount(next) || typeof more !== 'boolean') return null;
  if (epoch !== null && (typeof epoch !== 'string' || epoch === '')) return null;
  return { events: events as PullResponse['events'], next, more, epoch };
}

export class HttpTransport implements Transport {
  /** Canonical `https` server URL (PROTOCOL.md §8.1). */
  readonly origin: string;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(serverUrl: string, options: HttpTransportOptions = {}) {
    const { origin, base } = resolveServer(serverUrl, options.allowInsecureLocalhost === true);
    this.origin = origin;
    this.base = base;
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') throw new Error('HttpTransport: fetch is unavailable');
    this.fetchFn = fetchFn;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async info(): Promise<ServerInfo> {
    const body = await this.request('GET', '/v1/info', '/v1/info');
    const info = parseInfo(body);
    if (info === null)
      throw new SyncError('not_an_even_server', 'GET /v1/info: not the documented shape');
    return info;
  }

  async push(groupId: string, token: Uint8Array, envelopes: Envelope[]): Promise<PushResponse> {
    const body = await this.request('POST', `${groupPath(groupId)}/events`, EVENTS_ROUTE, token, {
      events: envelopes,
    });
    const response = parsePush(body);
    if (response === null)
      throw new SyncError('not_an_even_server', 'POST events: not the documented shape');
    return response;
  }

  async pull(
    groupId: string,
    token: Uint8Array,
    since: number,
    limit: number,
  ): Promise<PullResponse> {
    const query = `?since=${encodeURIComponent(String(since))}&limit=${encodeURIComponent(String(limit))}`;
    const body = await this.request(
      'GET',
      `${groupPath(groupId)}/events${query}`,
      EVENTS_ROUTE,
      token,
    );
    const response = parsePull(body);
    if (response === null)
      throw new SyncError('not_an_even_server', 'GET events: not the documented shape');
    return response;
  }

  async delete(groupId: string, token: Uint8Array): Promise<void> {
    await this.request('DELETE', groupPath(groupId), GROUP_ROUTE, token);
  }

  /**
   * One request. Resolves with the parsed JSON body (undefined for an empty body); rejects with `SyncError`.
   * `route` is the path's pattern, the only form of it that appears in messages.
   */
  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    route: string,
    token?: Uint8Array,
    json?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== undefined) headers.Authorization = `Bearer ${b64urlEncode(token)}`;
    if (json !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = setTimeout(() => controller?.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      // An Even server never redirects; refusing one keeps the bearer token on this origin.
      const init: RequestInit = { method, headers, redirect: 'error' };
      if (json !== undefined) init.body = JSON.stringify(json);
      if (controller !== undefined) init.signal = controller.signal;
      response = await this.fetchFn(`${this.base}${path}`, init);
      text = await response.text();
    } catch (cause) {
      throw new SyncError('network', `${method} ${route}: no response`, { cause });
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    let parsed = true;
    if (text === '') body = undefined;
    else {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        parsed = false;
      }
    }

    if (response.ok) {
      if (!parsed) {
        throw new SyncError('not_an_even_server', `${method} ${route}: response is not JSON`);
      }
      return body;
    }
    throw this.errorFor(response, parsed ? body : undefined, `${method} ${route}`);
  }

  private errorFor(response: Response, body: unknown, request: string): SyncError {
    const status = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), this.now());
    const record = isRecord(body) ? body : {};
    // Read only to pick a code from the fixed list. The body's `message` is never read: the server's own words
    // stay out of the error, and so out of every log line.
    const named = typeof record.error === 'string' ? record.error : undefined;

    let code: SyncErrorCode;
    if (status === 404 || status === 405) {
      // Every route this transport calls is documented (PROTOCOL.md §10).
      code = 'not_an_even_server';
    } else if (named !== undefined && PROTOCOL_ERRORS.has(named)) {
      code = named as ProtocolErrorCode;
    } else {
      code = codeForStatus(status);
    }

    const details: SyncErrorDetails = { status };
    if (isCount(record.index)) details.index = record.index;
    if (record.reason === 'bytes' || record.reason === 'events') details.reason = record.reason;
    if (retryAfterMs !== undefined) details.retryAfterMs = retryAfterMs;
    return new SyncError(code, `${request}: HTTP ${status} ${code}`, details);
  }
}

const EVENTS_ROUTE = '/v1/groups/{groupId}/events';
const GROUP_ROUTE = '/v1/groups/{groupId}';

function groupPath(groupId: string): string {
  return `/v1/groups/${encodeURIComponent(groupId)}`;
}
