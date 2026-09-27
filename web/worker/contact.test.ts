/**
 * The Worker end to end in Node, with every binding stubbed: the assets binding, the rate limiter, the email
 * binding, and siteverify (global fetch). Requests go through the default export, as Cloudflare calls it.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { evaluateSiteverify, isLoopbackOrigin, readJsonBody, SITEVERIFY_URL } from './contact';
import type { EmailBuilder, Env } from './env';
import { ipKey } from './http';
import worker from './index';

const SITE = 'https://even.appalaya.com';
const GROUP_ID = 'q3Zb5y0f4n1xk2Qp9sVtWm8rLc7dE6gHjA-BuC_DeFg';
const IP = '203.0.113.7';
const TOKEN = '0.real-looking-token';
const SECRETS = {
  TURNSTILE_SECRET_KEY: 'secret-turnstile-value',
  CONTACT_TO_REPORT: 'report-box@example.com',
  CONTACT_TO_HELP: 'help-box@example.com',
  CONTACT_TO_FEEDBACK: 'feedback-box@example.com',
  CONTACT_FROM: 'form@example.net',
};

interface Stubs {
  env: Env;
  sent: EmailBuilder[];
  assets: Mock<(request: Request) => Promise<Response>>;
  limit: Mock<(options: { key: string }) => Promise<{ success: boolean }>>;
  send: Mock<(message: EmailBuilder) => Promise<{ messageId: string }>>;
}

function stubs(overrides: Partial<Env> = {}): Stubs {
  const sent: EmailBuilder[] = [];
  const assets = vi.fn(async (_request: Request) => new Response('<h1>404</h1>', { status: 404 }));
  const limit = vi.fn(async (_options: { key: string }) => ({ success: true }));
  const send = vi.fn(async (message: EmailBuilder) => {
    sent.push(message);
    return { messageId: 'm-1' };
  });
  const env: Env = {
    ASSETS: { fetch: assets },
    EMAIL: { send },
    CONTACT_RATE_LIMIT: { limit },
    SITE_ORIGIN: SITE,
    TURNSTILE_SITE_KEY: 'public-site-key',
    ...SECRETS,
    ...overrides,
  };
  return { env, sent, assets, limit, send };
}

let siteverify: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
let siteverifyAnswer: unknown;
let logs: string[];

beforeEach(() => {
  siteverifyAnswer = {
    success: true,
    hostname: 'even.appalaya.com',
    action: 'contact',
    'error-codes': [],
  };
  siteverify = vi.fn(async () => Response.json(siteverifyAnswer));
  vi.stubGlobal('fetch', siteverify);
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const helpBody = { purpose: 'help', message: 'Sync is stuck.', turnstileToken: TOKEN };
const reportBody = {
  purpose: 'report',
  message: 'Scam links in this group.',
  email: 'visitor@example.com',
  groupId: GROUP_ID,
  server: 'https://sync.even.appalaya.com',
  turnstileToken: TOKEN,
};

function post(
  body: unknown,
  headers: Record<string, string | null> = {},
  path = '/api/contact',
): Request {
  const all: Record<string, string | null> = {
    'Content-Type': 'application/json',
    Origin: SITE,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': IP,
    ...headers,
  };
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: Object.fromEntries(
      Object.entries(all).filter((e): e is [string, string] => e[1] !== null),
    ),
    body:
      typeof body === 'string'
        ? body
        : body instanceof Uint8Array
          ? new Uint8Array(body)
          : JSON.stringify(body),
  });
}

async function call(
  request: Request,
  env: Env,
): Promise<{ status: number; body: unknown; response: Response }> {
  const response = await worker.fetch(request, env);
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text), response };
}

describe('POST /api/contact', () => {
  it('sends a help request to the help mailbox and answers 202', async () => {
    const s = stubs();
    const { status, body } = await call(post({ ...helpBody, email: 'visitor@example.com' }), s.env);
    expect(status).toBe(202);
    expect(body).toEqual({ ok: true });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({
      to: SECRETS.CONTACT_TO_HELP,
      from: { email: SECRETS.CONTACT_FROM },
      subject: 'Even support',
      replyTo: 'visitor@example.com',
    });
    expect(s.sent[0]?.text).toContain('Sync is stuck.');
  });

  it('sends feedback to the feedback mailbox without a Reply-To when no address was given', async () => {
    const s = stubs();
    const { status } = await call(post({ ...helpBody, purpose: 'feedback' }), s.env);
    expect(status).toBe(202);
    expect(s.sent[0]).toMatchObject({ to: SECRETS.CONTACT_TO_FEEDBACK, subject: 'Even feedback' });
    expect(s.sent[0]).not.toHaveProperty('replyTo');
  });

  it('sends a report to the report mailbox with the group id and server on their own lines', async () => {
    const s = stubs();
    const { status } = await call(post(reportBody), s.env);
    expect(status).toBe(202);
    expect(s.sent[0]).toMatchObject({
      to: SECRETS.CONTACT_TO_REPORT,
      subject: `Even report: ${GROUP_ID}`,
    });
    const lines = s.sent[0]?.text.split('\n') ?? [];
    expect(lines).toContain(GROUP_ID);
    expect(lines).toContain('https://sync.even.appalaya.com');
  });

  it('verifies the token with the secret, the token and the visitor’s IP', async () => {
    const s = stubs();
    await call(post(helpBody), s.env);
    expect(siteverify).toHaveBeenCalledTimes(1);
    const [url, init] = siteverify.mock.calls[0] ?? [];
    expect(String(url)).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      secret: SECRETS.TURNSTILE_SECRET_KEY,
      response: TOKEN,
      remoteip: IP,
    });
  });

  it('accepts a same-origin request whatever the browser sends as Origin under no-referrer', async () => {
    for (const headers of [
      { Origin: SITE, 'Sec-Fetch-Site': null },
      { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
    ]) {
      const { status } = await call(post(helpBody, headers), stubs().env);
      expect(status).toBe(202);
    }
  });

  it('accepts a charset parameter on the content type', async () => {
    const s = stubs();
    const { status } = await call(
      post(helpBody, { 'Content-Type': 'Application/JSON; charset=utf-8' }),
      s.env,
    );
    expect(status).toBe(202);
  });

  describe('rejects before verifying or sending anything', () => {
    const cases: [string, () => Request, number, unknown][] = [
      [
        'GET',
        () => new Request(`${SITE}/api/contact`, { headers: { Origin: SITE } }),
        405,
        { ok: false, error: 'method_not_allowed' },
      ],
      ['no Origin', () => post(helpBody, { Origin: null }), 403, { ok: false, error: 'forbidden' }],
      [
        'another Origin',
        () => post(helpBody, { Origin: 'https://evil.example' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'an http Origin',
        () => post(helpBody, { Origin: 'http://even.appalaya.com' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'a subdomain Origin',
        () => post(helpBody, { Origin: 'https://x.even.appalaya.com' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'Sec-Fetch-Site cross-site',
        () => post(helpBody, { 'Sec-Fetch-Site': 'cross-site' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'Sec-Fetch-Site same-site',
        () => post(helpBody, { 'Sec-Fetch-Site': 'same-site' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'Origin null without Sec-Fetch-Site',
        () => post(helpBody, { Origin: 'null', 'Sec-Fetch-Site': null }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'Origin null from another site',
        () => post(helpBody, { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'another Origin claiming same-origin',
        () => post(helpBody, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' }),
        403,
        { ok: false, error: 'forbidden' },
      ],
      [
        'a form post',
        () => post('purpose=help', { 'Content-Type': 'application/x-www-form-urlencoded' }),
        415,
        { ok: false, error: 'unsupported_media_type' },
      ],
      [
        'text/plain',
        () => post(helpBody, { 'Content-Type': 'text/plain' }),
        415,
        { ok: false, error: 'unsupported_media_type' },
      ],
      [
        'no content type',
        () => post(helpBody, { 'Content-Type': null }),
        415,
        { ok: false, error: 'unsupported_media_type' },
      ],
      [
        'a body over 16 KB',
        () => post({ ...helpBody, message: 'x'.repeat(16 * 1024) }),
        413,
        { ok: false, error: 'too_large' },
      ],
      [
        'invalid JSON',
        () => post('{"purpose":'),
        400,
        { ok: false, error: 'invalid', field: 'body' },
      ],
      [
        'invalid UTF-8',
        () => post(new Uint8Array([0x7b, 0xff, 0x7d])),
        400,
        { ok: false, error: 'invalid', field: 'body' },
      ],
      ['an empty body', () => post(''), 400, { ok: false, error: 'invalid', field: 'body' }],
      [
        'an unknown key',
        () => post({ ...helpBody, name: 'Sam' }),
        400,
        { ok: false, error: 'invalid', field: 'body' },
      ],
      [
        'a bad purpose',
        () => post({ ...helpBody, purpose: 'sales' }),
        400,
        { ok: false, error: 'invalid', field: 'purpose' },
      ],
      [
        'an empty message',
        () => post({ ...helpBody, message: '' }),
        400,
        { ok: false, error: 'invalid', field: 'message' },
      ],
      [
        'a bad email',
        () => post({ ...helpBody, email: 'nope' }),
        400,
        { ok: false, error: 'invalid', field: 'email' },
      ],
      [
        'a report without a group id',
        () => post({ ...reportBody, groupId: undefined }),
        400,
        { ok: false, error: 'invalid', field: 'groupId' },
      ],
      [
        'a report with a server path',
        () => post({ ...reportBody, server: 'https://sync.even.appalaya.com/v1' }),
        400,
        { ok: false, error: 'invalid', field: 'server' },
      ],
      [
        'help with a group id',
        () => post({ ...helpBody, groupId: GROUP_ID }),
        400,
        { ok: false, error: 'invalid', field: 'groupId' },
      ],
      [
        'no token',
        () => post({ ...helpBody, turnstileToken: undefined }),
        400,
        { ok: false, error: 'invalid', field: 'turnstileToken' },
      ],
    ];
    for (const [name, request, status, body] of cases) {
      it(name, async () => {
        const s = stubs();
        const result = await call(request(), s.env);
        expect(result.status).toBe(status);
        expect(result.body).toEqual(body);
        expect(siteverify).not.toHaveBeenCalled();
        expect(s.limit).not.toHaveBeenCalled();
        expect(s.send).not.toHaveBeenCalled();
      });
    }

    it('names the allowed method on a 405', async () => {
      const { response } = await call(new Request(`${SITE}/api/contact`), stubs().env);
      expect(response.headers.get('Allow')).toBe('POST');
    });

    it('stops reading a streamed body at 16 KB whatever its length claims', async () => {
      const chunk = new TextEncoder().encode('x'.repeat(4096));
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(chunk);
        },
      });
      const request = new Request(`${SITE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: SITE },
        body: stream,
        duplex: 'half',
      } as RequestInit);
      expect(await readJsonBody(request, 16 * 1024)).toBe('too_large');
      expect(pulled).toBeLessThanOrEqual(6);
    });
  });

  describe('Turnstile, fail closed', () => {
    const cases: [string, () => void, number, string][] = [
      [
        'an invalid token',
        () => (siteverifyAnswer = { success: false, 'error-codes': ['invalid-input-response'] }),
        403,
        'turnstile_failed',
      ],
      [
        'a reused or expired token',
        () => (siteverifyAnswer = { success: false, 'error-codes': ['timeout-or-duplicate'] }),
        403,
        'turnstile_failed',
      ],
      [
        'another hostname',
        () => (siteverifyAnswer = { success: true, hostname: 'evil.example', action: 'contact' }),
        403,
        'turnstile_failed',
      ],
      [
        'another action',
        () =>
          (siteverifyAnswer = { success: true, hostname: 'even.appalaya.com', action: 'login' }),
        403,
        'turnstile_failed',
      ],
      [
        'no action',
        () => (siteverifyAnswer = { success: true, hostname: 'even.appalaya.com' }),
        403,
        'turnstile_failed',
      ],
      [
        'a wrong secret',
        () => (siteverifyAnswer = { success: false, 'error-codes': ['invalid-input-secret'] }),
        503,
        'unavailable',
      ],
      [
        'a test secret in production',
        () =>
          (siteverifyAnswer = {
            success: true,
            hostname: 'example.com',
            metadata: { result_with_testing_key: true },
          }),
        503,
        'unavailable',
      ],
      [
        'a success that is not literally true',
        () =>
          (siteverifyAnswer = {
            success: 'true',
            hostname: 'even.appalaya.com',
            action: 'contact',
          }),
        403,
        'turnstile_failed',
      ],
      [
        'a non-JSON answer',
        () => siteverify.mockResolvedValueOnce(new Response('<html>', { status: 200 })),
        503,
        'unavailable',
      ],
      [
        'an HTTP error',
        () => siteverify.mockResolvedValueOnce(new Response('', { status: 500 })),
        503,
        'unavailable',
      ],
      [
        'a network failure',
        () => siteverify.mockRejectedValueOnce(new TypeError('fetch failed')),
        503,
        'unavailable',
      ],
      [
        'a timeout',
        () => siteverify.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError')),
        503,
        'unavailable',
      ],
    ];
    for (const [name, arrange, status, error] of cases) {
      it(`${status} for ${name}, and sends nothing`, async () => {
        arrange();
        const s = stubs();
        const result = await call(post(helpBody), s.env);
        expect(result.status).toBe(status);
        expect(result.body).toEqual({ ok: false, error });
        expect(s.send).not.toHaveBeenCalled();
        expect(s.limit).not.toHaveBeenCalled();
      });
    }

    it('accepts a test key’s answer only when the site is running on this machine', () => {
      const testing = {
        success: true,
        hostname: 'example.com',
        metadata: { result_with_testing_key: true },
      };
      expect(evaluateSiteverify(testing, 'http://localhost:4173')).toEqual({ ok: true });
      expect(evaluateSiteverify(testing, 'http://127.0.0.1:8787')).toEqual({ ok: true });
      expect(evaluateSiteverify(testing, SITE).ok).toBe(false);
      expect(isLoopbackOrigin('https://localhost')).toBe(false);
      expect(isLoopbackOrigin('http://localhost.example.com')).toBe(false);
      expect(isLoopbackOrigin('not a url')).toBe(false);
    });
  });

  describe('rate limit', () => {
    it('answers 429 with Retry-After once the IP has used its allowance, and sends nothing', async () => {
      const s = stubs();
      s.limit.mockResolvedValueOnce({ success: false });
      const { status, body, response } = await call(post(helpBody), s.env);
      expect(status).toBe(429);
      expect(body).toEqual({ ok: false, error: 'rate_limited' });
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(s.send).not.toHaveBeenCalled();
    });

    it('counts only submissions that passed Turnstile, keyed by IP', async () => {
      const s = stubs();
      siteverifyAnswer = { success: false, 'error-codes': ['invalid-input-response'] };
      await call(post(helpBody), s.env);
      expect(s.limit).not.toHaveBeenCalled();
      siteverifyAnswer = { success: true, hostname: 'even.appalaya.com', action: 'contact' };
      await call(post(helpBody, { 'CF-Connecting-IP': '2001:db8:1:2:3:4:5:6' }), s.env);
      expect(s.limit).toHaveBeenCalledWith({ key: '2001:db8:1:2::/64' });
    });

    it('lets a submission through when the limiter itself fails', async () => {
      const s = stubs();
      s.limit.mockRejectedValueOnce(new Error('limiter down'));
      const { status } = await call(post(helpBody), s.env);
      expect(status).toBe(202);
      expect(s.send).toHaveBeenCalledTimes(1);
    });
  });

  it('answers 502 when the email cannot be sent, logging only the error code', async () => {
    const s = stubs();
    s.send.mockRejectedValueOnce(
      Object.assign(new Error(`sender ${SECRETS.CONTACT_FROM} not verified`), {
        code: 'E_SENDER_NOT_VERIFIED',
      }),
    );
    const { status, body } = await call(post(helpBody), s.env);
    expect(status).toBe(502);
    expect(body).toEqual({ ok: false, error: 'send_failed' });
    expect(logs.join('\n')).toContain('E_SENDER_NOT_VERIFIED');
    expect(logs.join('\n')).not.toContain(SECRETS.CONTACT_FROM);
  });

  it('answers 503 without verifying when a secret is missing, and logs its name only', async () => {
    for (const name of Object.keys(SECRETS)) {
      const s = stubs({ [name]: undefined });
      siteverify.mockClear();
      logs.length = 0;
      const { status, body } = await call(post(helpBody), s.env);
      expect(status).toBe(503);
      expect(body).toEqual({ ok: false, error: 'unavailable' });
      expect(siteverify).not.toHaveBeenCalled();
      expect(logs.join('\n')).toContain(name);
    }
    const { status } = await call(post(helpBody), stubs({ CONTACT_FROM: '  ' }).env);
    expect(status).toBe(503);
  });

  it('answers 500 without detail when something unexpected throws', async () => {
    const s = stubs({ SITE_ORIGIN: 'not a url' });
    const { status, body } = await call(post(helpBody, { Origin: 'not a url' }), s.env);
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'internal' });
    expect(logs.join('\n')).toContain('"exception":"TypeError"');
  });
});

describe('every API response', () => {
  it('is JSON, uncached, and readable by no other origin', async () => {
    const s = stubs();
    const requests = [
      post(helpBody),
      post(helpBody, { Origin: 'https://evil.example' }),
      post({ nope: 1 }),
      new Request(`${SITE}/api/contact`),
      new Request(`${SITE}/api/contact/config`),
      new Request(`${SITE}/api/other`),
    ];
    for (const request of requests) {
      const response = await worker.fetch(request, s.env);
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect([...response.headers.keys()].filter((h) => h.startsWith('access-control-'))).toEqual(
        [],
      );
    }
  });
});

describe('logs', () => {
  it('carry the route, purpose and outcome, never what the visitor sent or who they are', async () => {
    const s = stubs();
    await call(post(reportBody), s.env);
    await call(post({ ...reportBody, email: 'bad' }), s.env);
    siteverifyAnswer = { success: false, 'error-codes': ['invalid-input-response'] };
    await call(post(reportBody), s.env);
    const all = logs.join('\n');
    const lines = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toEqual({
      route: '/api/contact',
      status: 202,
      outcome: 'sent',
      purpose: 'report',
    });
    expect(lines[1]).toEqual({
      route: '/api/contact',
      status: 400,
      outcome: 'invalid',
      detail: 'email',
    });
    expect(lines[2]).toEqual({
      route: '/api/contact',
      status: 403,
      outcome: 'turnstile_failed',
      purpose: 'report',
      detail: 'invalid-input-response',
    });
    for (const secret of [
      reportBody.message,
      'visitor@example.com',
      GROUP_ID,
      'sync.even.appalaya.com',
      TOKEN,
      IP,
      ...Object.values(SECRETS),
    ])
      expect(all).not.toContain(secret);
  });
});

describe('routing', () => {
  it('hands any path outside /api/ to the asset server untouched', async () => {
    const s = stubs();
    for (const path of ['/', '/i', '/nope.php', '/api', '/apifoo']) {
      const request = new Request(`${SITE}${path}`);
      const response = await worker.fetch(request, s.env);
      expect(response.status).toBe(404);
      expect(s.assets).toHaveBeenLastCalledWith(request);
    }
    expect(logs).toEqual([]);
  });

  it('answers 404 JSON for an unknown /api/ path', async () => {
    const s = stubs();
    for (const path of ['/api/', '/api/contact/', '/api/contacts', '/api/contact/config/x']) {
      const { status, body } = await call(new Request(`${SITE}${path}`, { method: 'POST' }), s.env);
      expect(status).toBe(404);
      expect(body).toEqual({ ok: false, error: 'not_found' });
    }
    expect(s.assets).not.toHaveBeenCalled();
  });
});

describe('GET /api/contact/config', () => {
  it('returns the site key, the action and the message limit', async () => {
    const { status, body } = await call(new Request(`${SITE}/api/contact/config`), stubs().env);
    expect(status).toBe(200);
    expect(body).toEqual({
      turnstileSiteKey: 'public-site-key',
      turnstileAction: 'contact',
      maxMessageLength: 4000,
    });
  });

  it('answers HEAD with the headers only', async () => {
    const response = await worker.fetch(
      new Request(`${SITE}/api/contact/config`, { method: 'HEAD' }),
      stubs().env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('answers 503 when the deploy supplied no site key', async () => {
    for (const TURNSTILE_SITE_KEY of [undefined, '', ' ']) {
      const { status, body } = await call(
        new Request(`${SITE}/api/contact/config`),
        stubs({ TURNSTILE_SITE_KEY }).env,
      );
      expect(status).toBe(503);
      expect(body).toEqual({ ok: false, error: 'unavailable' });
    }
  });

  it('allows only GET and HEAD', async () => {
    const { status, response } = await call(
      new Request(`${SITE}/api/contact/config`, { method: 'POST' }),
      stubs().env,
    );
    expect(status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
  });
});

describe('ipKey', () => {
  it('keys IPv4 as is, IPv6 by /64 and IPv4-mapped IPv6 as IPv4', () => {
    expect(ipKey('198.51.100.4')).toBe('198.51.100.4');
    expect(ipKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(ipKey('garbage:::')).toBe('garbage:::');
  });
});
