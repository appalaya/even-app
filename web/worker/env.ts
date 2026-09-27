/**
 * The Worker's bindings, vars and secrets (../wrangler.jsonc). The binding types are the subset of the Workers
 * runtime types this script uses, written out so the script typechecks and runs under Vitest in Node without the
 * Workers type package; config.test.ts fails if these names and the Wrangler configuration drift apart.
 */

/** A Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The static assets binding. */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetFetcher;
  CONTACT_RATE_LIMIT: RateLimiter;
  /** The site's origin, `https://even.appalaya.com` in production (a var in wrangler.jsonc). */
  SITE_ORIGIN: string;
  /** Public by nature, but passed at deploy time rather than kept in the repository (--var). */
  TURNSTILE_SITE_KEY?: string;
  /** Secrets. Optional in the type because a Worker without them must answer 503, not throw. */
  TURNSTILE_SECRET_KEY?: string;
  CONTACT_TO_REPORT?: string;
  CONTACT_TO_HELP?: string;
  CONTACT_TO_FEEDBACK?: string;
  /** The sender: a bare address on a domain verified in Resend (the company site's send subdomain). */
  CONTACT_FROM?: string;
  /** A Resend API key allowed to send. */
  RESEND_API_KEY?: string;
}

/** The Worker secrets, as listed under `secrets.required` in wrangler.jsonc and set by the deploy workflow. */
export const SECRET_NAMES = [
  'CONTACT_TO_REPORT',
  'CONTACT_TO_HELP',
  'CONTACT_TO_FEEDBACK',
  'CONTACT_FROM',
  'RESEND_API_KEY',
  'TURNSTILE_SECRET_KEY',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/** Everything the contact form needs to send, or the names (never the values) of what is missing. */
export type ContactConfig =
  | {
      ok: true;
      siteOrigin: string;
      turnstileSecret: string;
      resendApiKey: string;
      from: string;
      to: { report: string; help: string; feedback: string };
    }
  | { ok: false; missing: string[] };

export function contactConfig(env: Env): ContactConfig {
  const missing: string[] = [];
  const read = (name: SecretName | 'SITE_ORIGIN'): string => {
    const value = env[name];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(name);
      return '';
    }
    return value.trim();
  };
  const siteOrigin = read('SITE_ORIGIN');
  const turnstileSecret = read('TURNSTILE_SECRET_KEY');
  const resendApiKey = read('RESEND_API_KEY');
  const from = read('CONTACT_FROM');
  const to = {
    report: read('CONTACT_TO_REPORT'),
    help: read('CONTACT_TO_HELP'),
    feedback: read('CONTACT_TO_FEEDBACK'),
  };
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, siteOrigin, turnstileSecret, resendApiKey, from, to };
}
