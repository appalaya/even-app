/**
 * POST /api/contact and GET /api/contact/config (README.md, "Contact form").
 *
 * A submission goes through these steps in order and stops at the first that fails; nothing is stored at any step:
 *
 *   method POST                               405
 *   SITE_ORIGIN and every secret present      503 unavailable
 *   same origin (isSameOrigin)                403 forbidden
 *   Content-Type application/json             415
 *   body at most 16 KB of UTF-8 JSON          413 too_large, 400 invalid (field "body")
 *   fields (validate.ts)                      400 invalid, with the field
 *   Turnstile siteverify, fail closed         403 turnstile_failed, 503 unavailable
 *   one message a minute per IP               429 rate_limited, Retry-After
 *   send the email through Resend             502 send_failed
 *                                             202 { ok: true }
 *
 * The rate limit is counted after Turnstile, so a visitor whose challenge failed or expired can retry at once, and
 * only submissions that could send mail use the allowance.
 */
import { contactConfig, type Env } from './env';
import { clientKey, exceptionName, failure, json, logEvent, logLine } from './http';
import { composeEmail } from './message';
import { sendViaResend } from './resend';
import { MAX_MESSAGE_LENGTH, validateContact, type Purpose } from './validate';

export const CONTACT_ROUTE = '/api/contact';
export const CONFIG_ROUTE = '/api/contact/config';

export const MAX_BODY_BYTES = 16 * 1024;
/** The Turnstile action the page renders its widget with; siteverify must report the same. */
export const TURNSTILE_ACTION = 'contact';
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 10_000;
/** The rate limiter's period (wrangler.jsonc). The binding does not say when a window ends; this is the bound. */
export const RATE_PERIOD_SECONDS = 60;

/** GET /api/contact/config: what the page needs to render the form, from the Worker's configuration. */
export function handleConfig(request: Request, env: Env): Response {
  const done = (response: Response, outcome: string) => {
    logLine({ route: CONFIG_ROUTE, status: response.status, outcome });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return done(
      failure(405, 'method_not_allowed', { headers: { Allow: 'GET, HEAD' } }),
      'method_not_allowed',
    );
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? '';
  if (siteKey === '') {
    logEvent('error', 'contact_not_configured', { missing: ['TURNSTILE_SITE_KEY'] });
    return done(failure(503, 'unavailable'), 'not_configured');
  }
  return done(
    json(
      {
        turnstileSiteKey: siteKey,
        turnstileAction: TURNSTILE_ACTION,
        maxMessageLength: MAX_MESSAGE_LENGTH,
      },
      200,
    ),
    'ok',
  );
}

/** POST /api/contact. */
export async function handleContact(request: Request, env: Env): Promise<Response> {
  let purpose: Purpose | undefined;
  const done = (response: Response, outcome: string, detail?: string) => {
    logLine({
      route: CONTACT_ROUTE,
      status: response.status,
      outcome,
      ...(purpose === undefined ? {} : { purpose }),
      ...(detail === undefined ? {} : { detail }),
    });
    return response;
  };

  if (request.method !== 'POST')
    return done(
      failure(405, 'method_not_allowed', { headers: { Allow: 'POST' } }),
      'method_not_allowed',
    );

  // Before anything else reads the request: without SITE_ORIGIN no origin can be compared, and without the
  // secrets a visitor would solve a challenge for a message that cannot be sent.
  const config = contactConfig(env);
  if (!config.ok) {
    logEvent('error', 'contact_not_configured', { missing: config.missing });
    return done(failure(503, 'unavailable'), 'not_configured');
  }
  if (!isSameOrigin(request, config.siteOrigin))
    return done(failure(403, 'forbidden'), 'forbidden');

  if (mediaType(request.headers.get('Content-Type')) !== 'application/json')
    return done(failure(415, 'unsupported_media_type'), 'unsupported_media_type');

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (body === 'too_large') return done(failure(413, 'too_large'), 'too_large');
  if (body === 'malformed')
    return done(failure(400, 'invalid', { field: 'body' }), 'invalid', 'body');

  const validation = validateContact(body.value);
  if (!validation.ok)
    return done(failure(400, 'invalid', { field: validation.field }), 'invalid', validation.field);
  const contact = validation.value;
  purpose = contact.purpose;

  const verdict = await verifyTurnstile(
    contact.turnstileToken,
    config.turnstileSecret,
    request.headers.get('CF-Connecting-IP'),
    config.siteOrigin,
  );
  if (!verdict.ok) {
    return verdict.status === 403
      ? done(failure(403, 'turnstile_failed'), 'turnstile_failed', verdict.detail)
      : done(failure(503, 'unavailable'), 'turnstile_unavailable', verdict.detail);
  }

  if (!(await allowed(env, request)))
    return done(
      failure(429, 'rate_limited', { headers: { 'Retry-After': String(RATE_PERIOD_SECONDS) } }),
      'rate_limited',
    );

  const email = composeEmail(
    contact,
    { to: config.to[contact.purpose], from: config.from },
    config.siteOrigin,
  );
  const sent = await sendViaResend(config.resendApiKey, email);
  if (!sent.ok) return done(failure(502, 'send_failed'), 'send_failed', sent.detail);
  return done(json({ ok: true }, 202), 'sent');
}

/**
 * Same-origin requests only. Browsers send Origin on every POST, cross-origin or not, and Sec-Fetch-Site where
 * they support it (a header no page can set). Where Sec-Fetch-Site is sent it must be `same-origin`, and Origin
 * must be the site's or `null`: a browser may send `null` on a same-origin POST because of the site's
 * `Referrer-Policy: no-referrer` (_headers). Without Sec-Fetch-Site, Origin must be the site's. Anything that is
 * not a browser can forge both, which is what Turnstile is for; this check keeps other sites' pages from posting.
 */
export function isSameOrigin(request: Request, siteOrigin: string): boolean {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === null) return origin === siteOrigin;
  return site === 'same-origin' && (origin === siteOrigin || origin === 'null');
}

/** `application/json; charset=utf-8` → `application/json`. */
export function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

/**
 * The body parsed as JSON, reading at most `limit` bytes whatever Content-Length claims. Invalid UTF-8 and
 * invalid JSON are both `malformed`.
 */
export async function readJsonBody(
  request: Request,
  limit: number,
): Promise<{ value: unknown } | 'too_large' | 'malformed'> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) > limit) return 'too_large';
  const bytes = new Uint8Array(limit);
  let length = 0;
  if (request.body !== null) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > limit) {
        await reader.cancel();
        return 'too_large';
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    return { value: JSON.parse(text) as unknown };
  } catch {
    return 'malformed';
  }
}

export type Verdict = { ok: true } | { ok: false; status: 403 | 503; detail: string };

/** Siteverify errors that mean this Worker is misconfigured or Cloudflare failed, not that the visitor did. */
const OUR_FAULT = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);

/** Asks Cloudflare whether the token is genuine, unused and unexpired. Any failure to get an answer is a no. */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp: string | null,
  siteOrigin: string,
): Promise<Verdict> {
  let result: unknown;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: token,
        ...(remoteIp === null || remoteIp === '' ? {} : { remoteip: remoteIp }),
      }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, status: 503, detail: `siteverify_${response.status}` };
    result = await response.json();
  } catch (error) {
    return { ok: false, status: 503, detail: `siteverify_${exceptionName(error)}` };
  }
  return evaluateSiteverify(result, siteOrigin);
}

/**
 * The siteverify answer, checked the way Cloudflare's docs ask: success, then the action and hostname this site
 * renders the widget with. A result from one of Cloudflare's published test secrets says so
 * (`metadata.result_with_testing_key`) and carries neither; it is accepted only when SITE_ORIGIN is a loopback
 * address, so a test secret deployed by mistake lets nothing through.
 */
export function evaluateSiteverify(result: unknown, siteOrigin: string): Verdict {
  if (typeof result !== 'object' || result === null)
    return { ok: false, status: 503, detail: 'siteverify_malformed' };
  const answer = result as {
    success?: unknown;
    'error-codes'?: unknown;
    hostname?: unknown;
    action?: unknown;
    metadata?: { result_with_testing_key?: unknown } | null;
  };
  if (answer.success !== true) {
    const codes = Array.isArray(answer['error-codes'])
      ? answer['error-codes'].filter((code): code is string => typeof code === 'string')
      : [];
    const ours = codes.some((code) => OUR_FAULT.has(code));
    return { ok: false, status: ours ? 503 : 403, detail: codes.join(',') || 'rejected' };
  }
  if (answer.metadata?.result_with_testing_key === true) {
    return isLoopbackOrigin(siteOrigin)
      ? { ok: true }
      : { ok: false, status: 503, detail: 'testing_key' };
  }
  if (answer.hostname !== new URL(siteOrigin).hostname)
    return { ok: false, status: 403, detail: 'hostname' };
  if (answer.action !== TURNSTILE_ACTION) return { ok: false, status: 403, detail: 'action' };
  return { ok: true };
}

/** `wrangler dev` on this machine: http://localhost, 127.0.0.1 or [::1], any port. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** One hit against the per-IP limiter. A limiter that throws lets the request through: Turnstile still gates it. */
async function allowed(env: Env, request: Request): Promise<boolean> {
  try {
    return (await env.CONTACT_RATE_LIMIT.limit({ key: clientKey(request) })).success;
  } catch (error) {
    logEvent('warn', 'ratelimit_failed', { exception: exceptionName(error) });
    return true;
  }
}
