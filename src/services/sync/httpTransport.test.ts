import { b64urlEncode, InvalidServerUrlError, newSecret } from '@even/core';
import { describe, expect, it } from 'vitest';

import { groupKeys, sealFor, Events } from '../testing/fixtures';
import { isSyncError, SyncError } from './errors';
import { HttpTransport, parseRetryAfter } from './httpTransport';

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: (call: Call) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetch: fetchFn, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const INFO = {
  protocol: [1],
  limits: {
    max_event_bytes: 8192,
    max_group_bytes: 2097152,
    max_group_events: 10000,
    max_batch: 25,
    max_page: 500,
    daily_write_budget: 0,
    rate: { requests_per_minute: 120, writes_per_minute: 60, group_creates_per_minute: 3 },
  },
  retention_days: 365,
  push: false,
  operator: 'Even',
};

async function rejection(promise: Promise<unknown>): Promise<SyncError> {
  try {
    await promise;
  } catch (error) {
    if (isSyncError(error)) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('HttpTransport construction', () => {
  it('canonicalises https URLs', () => {
    const t = new HttpTransport(' HTTPS://Sync.Example.com:443/ ', {
      fetch: stubFetch(() => json(200, {})).fetch,
    });
    expect(t.origin).toBe('https://sync.example.com');
  });

  it('refuses http, and allows loopback http only with the explicit test option', () => {
    const fetch = stubFetch(() => json(200, {})).fetch;
    expect(() => new HttpTransport('http://sync.example.com', { fetch })).toThrow(
      InvalidServerUrlError,
    );
    expect(() => new HttpTransport('http://127.0.0.1:8787', { fetch })).toThrow(
      InvalidServerUrlError,
    );
    expect(
      () => new HttpTransport('http://sync.example.com', { fetch, allowInsecureLocalhost: true }),
    ).toThrow(InvalidServerUrlError);
    const local = new HttpTransport('http://127.0.0.1:8787', {
      fetch,
      allowInsecureLocalhost: true,
    });
    expect(local.origin).toBe('https://127.0.0.1:8787');
    expect(
      new HttpTransport('http://localhost:8787/even/', { fetch, allowInsecureLocalhost: true })
        .origin,
    ).toBe('https://localhost:8787/even');
  });
});

describe('HttpTransport requests', () => {
  it('GET /v1/info without auth, validated', async () => {
    const { fetch, calls } = stubFetch(() => json(200, INFO));
    const t = new HttpTransport('https://sync.example.com/even', { fetch });
    expect(await t.info()).toEqual(INFO);
    expect(calls[0]?.url).toBe('https://sync.example.com/even/v1/info');
    expect(calls[0]?.init.method).toBe('GET');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('pushes JSON with the bearer token as base64url', async () => {
    const keys = groupKeys();
    const envelope = sealFor(keys, new Events().expense('Dinner'));
    const { fetch, calls } = stubFetch(() =>
      json(200, { accepted: 1, duplicates: 0, seq: 7, epoch: 'k3JdAAAAAAAAAAAAAAAAAA' }),
    );
    const t = new HttpTransport('http://127.0.0.1:8787', { fetch, allowInsecureLocalhost: true });

    const response = await t.push(keys.groupId, keys.token, [envelope]);

    expect(response).toEqual({
      accepted: 1,
      duplicates: 0,
      seq: 7,
      epoch: 'k3JdAAAAAAAAAAAAAAAAAA',
    });
    const call = calls[0];
    expect(call?.url).toBe(`http://127.0.0.1:8787/v1/groups/${keys.groupId}/events`);
    expect(call?.init.method).toBe('POST');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${b64urlEncode(keys.token)}`);
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(String(call?.init.body))).toEqual({ events: [envelope] });
  });

  it('pulls with since and limit, passing envelopes through', async () => {
    const page = { events: [{ seq: 3, id: 'x' }], next: 3, more: false, epoch: null };
    const { fetch, calls } = stubFetch(() => json(200, page));
    const t = new HttpTransport('https://sync.example.com', { fetch });
    expect(await t.pull('G', new Uint8Array(32), 2, 50)).toEqual(page);
    expect(calls[0]?.url).toBe('https://sync.example.com/v1/groups/G/events?since=2&limit=50');
  });

  it('deletes with 204', async () => {
    const { fetch, calls } = stubFetch(() => new Response(null, { status: 204 }));
    const t = new HttpTransport('https://sync.example.com', { fetch });
    await expect(t.delete('G', new Uint8Array(32))).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe('DELETE');
  });
});

describe('HttpTransport errors', () => {
  const token = newSecret();

  it('carries the protocol code, index, and reason', async () => {
    const t = (response: Response) =>
      new HttpTransport('https://s.example', { fetch: stubFetch(() => response).fetch });
    const invalid = await rejection(
      t(json(400, { error: 'invalid_envelope', index: 2 })).push('G', token, []),
    );
    expect(invalid).toMatchObject({ code: 'invalid_envelope', status: 400, index: 2 });
    const full = await rejection(
      t(json(413, { error: 'group_full', reason: 'events' })).push('G', token, []),
    );
    expect(full).toMatchObject({ code: 'group_full', reason: 'events' });
    const blocked = await rejection(
      t(json(410, { error: 'group_blocked' })).pull('G', token, 0, 1),
    );
    expect(blocked.code).toBe('group_blocked');
    const unsupported = await rejection(
      t(json(415, { error: 'unsupported_version', index: 0 })).push('G', token, []),
    );
    expect(unsupported).toMatchObject({ code: 'unsupported_version', index: 0 });
  });

  it('reads Retry-After as seconds or an HTTP-date', async () => {
    const now = Date.UTC(2026, 8, 26, 12, 0, 0);
    const t = (headers: Record<string, string>, status = 429, error = 'rate_limited') =>
      new HttpTransport('https://s.example', {
        fetch: stubFetch(() => json(status, { error }, headers)).fetch,
        now: () => now,
      });
    expect(await rejection(t({ 'Retry-After': '7' }).pull('G', token, 0, 1))).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 7000,
    });
    const date = new Date(now + 90_000).toUTCString();
    expect(
      await rejection(t({ 'Retry-After': date }, 503, 'over_budget').push('G', token, [])),
    ).toMatchObject({ code: 'over_budget', status: 503, retryAfterMs: 90_000 });
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it('maps 404 and 405 on documented routes, and non-protocol success bodies, to not_an_even_server', async () => {
    const t = (response: () => Response) =>
      new HttpTransport('https://s.example', { fetch: stubFetch(response).fetch });
    expect((await rejection(t(() => json(404, { error: 'not_found' })).info())).code).toBe(
      'not_an_even_server',
    );
    expect(
      (await rejection(t(() => new Response('nope', { status: 405 })).pull('G', token, 0, 1))).code,
    ).toBe('not_an_even_server');
    const html = () =>
      new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect((await rejection(t(html).info())).code).toBe('not_an_even_server');
    expect((await rejection(t(() => json(200, { hello: 1 })).push('G', token, []))).code).toBe(
      'not_an_even_server',
    );
  });

  it('classifies unknown failures by status', async () => {
    const t = (response: () => Response) =>
      new HttpTransport('https://s.example', { fetch: stubFetch(response).fetch });
    expect(
      (await rejection(t(() => new Response('bad gateway', { status: 502 })).info())).code,
    ).toBe('server_error');
    expect((await rejection(t(() => json(401, {})).pull('G', token, 0, 1))).code).toBe(
      'unauthorized',
    );
    expect(
      (await rejection(t(() => json(400, { error: 'weird' })).pull('G', token, 0, 1))).code,
    ).toBe('invalid_request');
  });

  it('reports a failed fetch as network', async () => {
    const t = new HttpTransport('https://s.example', {
      fetch: stubFetch(() => {
        throw new TypeError('fetch failed');
      }).fetch,
    });
    expect((await rejection(t.info())).code).toBe('network');
  });

  it('times out as network', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const t = new HttpTransport('https://s.example', { fetch: hang, timeoutMs: 5 });
    expect((await rejection(t.info())).code).toBe('network');
  });
});
