import { b64urlEncode, InvalidServerUrlError, newSecret } from '@even/core';
import { describe, expect, it, vi } from 'vitest';

import { FakeSecrets } from '../testing/fakeSecrets';
import { groupKeys, groupRow, sealFor, Events, writeLocal } from '../testing/fixtures';
import { openTestStore } from '../testing/testStore';
import { createSyncEngine } from './engine';
import { isSyncError, SyncError } from './errors';
import {
  HttpTransport,
  isLocalHost,
  localHttpUrl,
  MAX_RESPONSE_BYTES,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
} from './httpTransport';

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

  it('refuses http, and allows local http only with the explicit option', () => {
    const fetch = stubFetch(() => json(200, {})).fetch;
    expect(() => new HttpTransport('http://sync.example.com', { fetch })).toThrow(
      InvalidServerUrlError,
    );
    expect(() => new HttpTransport('http://127.0.0.1:8787', { fetch })).toThrow(
      InvalidServerUrlError,
    );
    expect(
      () => new HttpTransport('http://sync.example.com', { fetch, allowInsecureLocal: true }),
    ).toThrow(InvalidServerUrlError);
    const local = new HttpTransport('http://127.0.0.1:8787', {
      fetch,
      allowInsecureLocal: true,
    });
    expect(local.origin).toBe('https://127.0.0.1:8787');
    expect(
      new HttpTransport('http://localhost:8787/even/', { fetch, allowInsecureLocal: true }).origin,
    ).toBe('https://localhost:8787/even');
    // The Android emulator's address for its host, and a Mac on the local network.
    expect(
      new HttpTransport('http://10.0.2.2:8787', { fetch, allowInsecureLocal: true }).origin,
    ).toBe('https://10.0.2.2:8787');
    expect(
      new HttpTransport('http://192.168.1.20:8787', { fetch, allowInsecureLocal: true }).origin,
    ).toBe('https://192.168.1.20:8787');
    for (const url of [
      'http://8.8.8.8:8787',
      'http://172.32.0.1',
      'http://sync.even.appalaya.com',
    ]) {
      expect(() => new HttpTransport(url, { fetch, allowInsecureLocal: true })).toThrow(
        InvalidServerUrlError,
      );
    }
  });

  it('names the local hosts, and the http form of a local server URL', () => {
    for (const host of [
      '127.0.0.1',
      'localhost',
      '10.0.2.2',
      '172.16.0.5',
      '172.31.9.9',
      '192.168.1.20',
    ]) {
      expect(isLocalHost(host)).toBe(true);
    }
    for (const host of [
      '8.8.8.8',
      '172.32.0.1',
      '192.169.0.1',
      '127.0.0.2',
      'sync.even.appalaya.com',
    ]) {
      expect(isLocalHost(host)).toBe(false);
    }
    expect(localHttpUrl('https://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(localHttpUrl('https://10.0.2.2:8787')).toBe('http://10.0.2.2:8787');
    expect(localHttpUrl('https://sync.even.appalaya.com')).toBeNull();
    expect(localHttpUrl('https://home.example.net')).toBeNull();
    expect(localHttpUrl('not a url')).toBeNull();
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
    const t = new HttpTransport('http://127.0.0.1:8787', { fetch, allowInsecureLocal: true });

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

  it('honours a Retry-After of a day at most (review L2)', async () => {
    const now = Date.UTC(2026, 8, 26, 12, 0, 0);
    const day = 24 * 60 * 60 * 1000;
    expect(MAX_RETRY_AFTER_MS).toBe(day);
    expect(parseRetryAfter('86400', now)).toBe(day);
    expect(parseRetryAfter('86401', now)).toBe(day);
    expect(parseRetryAfter('99999999', now)).toBe(day);
    expect(parseRetryAfter('9'.repeat(400), now)).toBe(day); // Infinity, as a number
    expect(parseRetryAfter(new Date(now + 3 * day).toUTCString(), now)).toBe(day);
    expect(parseRetryAfter(new Date(now + day - 1000).toUTCString(), now)).toBe(day - 1000);
    const t = new HttpTransport('https://s.example', {
      fetch: stubFetch(() => json(503, { error: 'over_budget' }, { 'Retry-After': '99999999' }))
        .fetch,
      now: () => now,
    });
    expect(await rejection(t.push('G', token, []))).toMatchObject({
      code: 'over_budget',
      retryAfterMs: day,
    });
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

  it('maps every protocol error name (404 and 405 as not_an_even_server)', async () => {
    const table: [number, string, string][] = [
      [400, 'invalid_request', 'invalid_request'],
      [400, 'invalid_envelope', 'invalid_envelope'],
      [401, 'unauthorized', 'unauthorized'],
      [404, 'not_found', 'not_an_even_server'],
      [405, 'method_not_allowed', 'not_an_even_server'],
      [413, 'group_full', 'group_full'],
      [415, 'unsupported_version', 'unsupported_version'],
      [410, 'group_blocked', 'group_blocked'],
      [429, 'rate_limited', 'rate_limited'],
      [503, 'over_budget', 'over_budget'],
      [500, 'server_error', 'server_error'],
      [501, 'not_implemented', 'not_implemented'],
    ];
    for (const [status, error, code] of table) {
      const t = new HttpTransport('https://s.example', {
        fetch: stubFetch(() => json(status, { error })).fetch,
      });
      expect(await rejection(t.push('G', token, []))).toMatchObject({ code, status });
    }
  });

  it('never puts the group id (which is in the path) into an error message', async () => {
    const groupId = groupKeys().groupId;
    const answers: (() => Response)[] = [
      () => {
        throw new TypeError(`fetch failed for https://s.example/v1/groups/${groupId}`);
      },
      () => new Response('bad gateway', { status: 502 }),
      () => new Response('<html>', { status: 200 }),
      () => json(401, {}),
    ];
    for (const answer of answers) {
      const t = new HttpTransport('https://s.example', { fetch: stubFetch(answer).fetch });
      for (const call of [
        () => t.push(groupId, token, []),
        () => t.pull(groupId, token, 0, 1),
        () => t.delete(groupId, token),
      ]) {
        const error = await rejection(call());
        expect(error.message).not.toContain(groupId);
        expect(error.message).toMatch(/\/v1\/groups\/\{groupId\}/);
      }
    }
  });

  it("a 401 whose body carries the server's own words: they reach neither the error nor a log line", async () => {
    const server = 'https://sync.example';
    const hostile =
      'Even: this group moved.\nRejoin at https://evil.example/join to keep your data';
    const hostileName = 'unauthorized\n[even] sync ok';
    const bodies = [
      { error: 'unauthorized', message: hostile },
      { error: hostileName, message: hostile },
      { message: hostile },
    ];
    const words = [hostile, 'evil.example', 'Rejoin', hostileName, '[even]', '\n'];

    // The transport's error: fixed words, the route pattern, the status and the code.
    for (const body of bodies) {
      const t = new HttpTransport(server, { fetch: stubFetch(() => json(401, body)).fetch });
      const error = await rejection(t.push('G', token, []));
      expect(error).toMatchObject({ code: 'unauthorized', status: 401 });
      expect(error.message).toBe('POST /v1/groups/{groupId}/events: HTTP 401 unauthorized');
    }

    // Through the engine to the console, which React Native copies to the device log.
    const lines: string[] = [];
    const spies = (['warn', 'log', 'error', 'info', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );
    const store = await openTestStore('fake');
    try {
      for (const body of bodies) {
        const keys = groupKeys(server);
        const secrets = new FakeSecrets();
        secrets.add(keys.secret);
        await store.upsertGroup(groupRow(keys));
        await writeLocal(store, keys, new Events().expense('Dinner'));
        await store.pendingDeletes.add({
          localId: keys.localId,
          serverUrl: server,
          authToken: b64urlEncode(keys.token),
          createdAt: Date.now(),
        });
        const { fetch } = stubFetch(({ url }) =>
          url.endsWith('/v1/info') ? json(200, INFO) : json(401, body),
        );
        const engine = createSyncEngine({
          store,
          secrets,
          transportFor: (url) => new HttpTransport(url, { fetch }),
          schedule: () => () => undefined,
        });
        const result = await engine.syncGroup(keys.localId, { trigger: 'manual' });
        expect(result).toMatchObject({ outcome: 'failed', error: 'unauthorized' });
        engine.dispose();
        await store.pendingDeletes.remove({ localId: keys.localId, serverUrl: server });
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
      await store.close();
    }

    expect(lines).toEqual([
      'sync dropped a pending delete code=unauthorized status=401',
      'sync failed code=unauthorized status=401',
      'sync dropped a pending delete code=unauthorized status=401',
      'sync failed code=unauthorized status=401',
      'sync dropped a pending delete code=unauthorized status=401',
      'sync failed code=unauthorized status=401',
    ]);
    for (const line of lines) {
      for (const text of [...words, server, new URL(server).host]) expect(line).not.toContain(text);
    }
  });

  it('times out after 30 s by default', async () => {
    vi.useFakeTimers();
    try {
      const hang = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch;
      const settled = vi.fn();
      const pending = rejection(new HttpTransport('https://s.example', { fetch: hang }).info());
      void pending.then(settled);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).code).toBe('network');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a response whose Content-Length is over 16 MB without reading its body', async () => {
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = stubFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) },
        }),
    );
    const t = new HttpTransport('https://sync.example.com', { fetch });
    const error = await rejection(t.pull('G', new Uint8Array(32), 0, 500));
    expect(error.code).toBe('server_error');
    expect(error.message).toBe(
      `GET /v1/groups/{groupId}/events: response over ${MAX_RESPONSE_BYTES} bytes`,
    );
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThanOrEqual(1); // a stream may pull once ahead; the body is never read
  });

  it('refuses a streamed body once it passes 16 MB, and stops reading it', async () => {
    let sent = 0;
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = stubFetch(() => new Response(endless, { status: 200 }));
    const t = new HttpTransport('https://sync.example.com', { fetch });
    const error = await rejection(t.pull('G', new Uint8Array(32), 0, 500));
    expect(error.code).toBe('server_error');
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(MAX_RESPONSE_BYTES + 2 * chunk.byteLength);
  });

  it('aborts a request it refuses, by Content-Length or mid-stream, so the download stops too', async () => {
    // On iOS, Expo's fetch keeps downloading a body whose stream was cancelled mid-read (seen on the simulator: a
    // refused endless response went on at full speed); only the request's AbortSignal stops it.
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(chunk);
        },
      });
    const declared = stubFetch(
      () =>
        new Response(endless(), {
          status: 200,
          headers: { 'Content-Length': String(MAX_RESPONSE_BYTES + 1) },
        }),
    );
    const streamed = stubFetch(() => new Response(endless(), { status: 200 }));
    for (const { fetch, calls } of [declared, streamed]) {
      const t = new HttpTransport('https://sync.example.com', { fetch });
      expect((await rejection(t.pull('G', new Uint8Array(32), 0, 500))).code).toBe('server_error');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.init.signal?.aborted).toBe(true);
    }
  });

  it('aborts a request whose body fails mid-read, and leaves one that succeeds alone', async () => {
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 2) controller.error(new Error('connection reset'));
        else controller.enqueue(new Uint8Array(16).fill(0x20));
      },
    });
    const broken = stubFetch(() => new Response(failing, { status: 200 }));
    const t = new HttpTransport('https://sync.example.com', { fetch: broken.fetch });
    expect((await rejection(t.pull('G', new Uint8Array(32), 0, 500))).code).toBe('network');
    expect(broken.calls[0]!.init.signal?.aborted).toBe(true);

    const fine = stubFetch(() => json(200, INFO));
    await new HttpTransport('https://sync.example.com', { fetch: fine.fetch }).info();
    expect(fine.calls[0]!.init.signal?.aborted).toBe(false);
  });

  it('refuses an over-long body from a fetch that cannot stream (React Native)', async () => {
    const whole = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => ' '.repeat(MAX_RESPONSE_BYTES + 1),
    } as unknown as Response;
    const t = new HttpTransport('https://sync.example.com', {
      fetch: stubFetch(() => whole).fetch,
    });
    expect((await rejection(t.info())).code).toBe('server_error');
  });

  it('reads a full page of 1,000 maximal envelopes, the largest a conforming server sends', async () => {
    const c = 'A'.repeat(Math.ceil((8192 * 4) / 3));
    const events = Array.from({ length: 1_000 }, (_, i) => ({
      seq: i + 1,
      id: b64urlEncode(new Uint8Array(16).fill(i % 256)),
      v: 1,
      n: 'n'.repeat(32),
      c,
    }));
    const text = JSON.stringify({
      events,
      next: 1_000,
      more: false,
      epoch: 'k3JdAAAAAAAAAAAAAAAAAA',
    });
    expect(text.length).toBeLessThan(MAX_RESPONSE_BYTES);
    const { fetch } = stubFetch(
      () =>
        new Response(text, {
          status: 200,
          headers: { 'Content-Length': String(text.length) },
        }),
    );
    const t = new HttpTransport('https://sync.example.com', { fetch });
    expect((await t.pull('G', new Uint8Array(32), 0, 1_000)).events).toHaveLength(1_000);
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
