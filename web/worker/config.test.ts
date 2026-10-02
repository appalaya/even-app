/**
 * The Wrangler configuration, the deploy workflow and the script agree, and none of them holds an address or a
 * key. What a deploy cannot show until it runs in production is checked here instead.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import workflowText from '../../.github/workflows/web.yml?raw';
import assetsIgnoreText from '../.assetsignore?raw';
import readmeText from '../README.md?raw';
import wranglerText from '../wrangler.jsonc?raw';
import { CONFIG_ROUTE, CONTACT_ROUTE, RATE_PERIOD_SECONDS } from './contact';
import { SECRET_NAMES } from './env';

/** Every TypeScript file in this folder as text, except this one (Vite leaves out the importer). */
const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });

function jsonc(name: string, text: string): Record<string, unknown> {
  const { config, error } = ts.parseConfigFileTextToJson(name, text);
  if (error !== undefined) throw new Error(`${name} does not parse`);
  return config as Record<string, unknown>;
}

const wrangler = jsonc('wrangler.jsonc', wranglerText) as {
  name: string;
  main: string;
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown;
  assets: {
    directory: string;
    binding: string;
    run_worker_first: string[];
    not_found_handling: string;
  };
  send_email?: unknown;
  ratelimits: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  vars: Record<string, string>;
  secrets: { required: string[] };
  observability: { logs: { invocation_logs: boolean }; traces: { enabled: boolean } };
  logpush: boolean;
};

describe('wrangler.jsonc', () => {
  it('runs this script, and only for /api/*', () => {
    expect(wrangler.name).toBe('even-web');
    expect(wrangler.main).toBe('worker/index.ts');
    expect(wrangler.assets.binding).toBe('ASSETS');
    expect(wrangler.assets.run_worker_first).toEqual(['/api/*']);
    expect(wrangler.assets.not_found_handling).toBe('404-page');
    expect(CONTACT_ROUTE.startsWith('/api/')).toBe(true);
    expect(CONFIG_ROUTE.startsWith('/api/')).toBe(true);
  });

  it('keeps the custom domain the only public address', () => {
    expect(wrangler.workers_dev).toBe(false);
    expect(wrangler.preview_urls).toBe(false);
    expect(wrangler.routes).toBeUndefined();
  });

  it('binds what env.ts expects: assets and the rate limiter, no email binding (mail goes through Resend)', () => {
    expect(wrangler.send_email).toBeUndefined();
    expect(wrangler.ratelimits.map((r) => r.name)).toEqual(['CONTACT_RATE_LIMIT']);
    expect(wrangler.ratelimits[0]?.simple.period).toBe(RATE_PERIOD_SECONDS);
    expect(Object.keys(wrangler.vars)).toEqual(['SITE_ORIGIN']);
    expect(wrangler.vars.SITE_ORIGIN).toBe('https://even.appalaya.com');
  });

  it('requires exactly the secrets the script reads', () => {
    expect(wrangler.secrets.required).toEqual([...SECRET_NAMES]);
  });

  it('records no URL, header or IP in Cloudflare’s logs', () => {
    expect(wrangler.observability.logs.invocation_logs).toBe(false);
    expect(wrangler.observability.traces.enabled).toBe(false);
    expect(wrangler.logpush).toBe(false);
  });
});

describe('.assetsignore', () => {
  it('keeps the script’s source out of the published site', () => {
    const lines = assetsIgnoreText.split('\n');
    expect(lines).toContain('/worker/');
  });
});

describe('the deploy workflow', () => {
  const workflow = workflowText;

  it('passes every secret and the site key from GitHub Actions secrets of the same names', () => {
    for (const name of SECRET_NAMES) expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(workflow).toContain(
      'TURNSTILE_SITE_KEY: ${{ secrets.TURNSTILE_SITE_KEY || vars.TURNSTILE_SITE_KEY }}',
    );
    expect(workflow).toContain('--secrets-file');
    expect(workflow).toContain('--var "TURNSTILE_SITE_KEY:');
  });

  it('runs an exact Wrangler, and actions pinned by commit, in the job that holds the secrets', () => {
    const wranglers = [...workflow.matchAll(/wrangler@(\S+)/g)].map((m) => m[1]);
    expect(wranglers.length).toBeGreaterThan(0);
    for (const version of wranglers) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}$/);
  });
});

describe('no address or key in the repository', () => {
  const files: Record<string, string> = {
    'web/wrangler.jsonc': wranglerText,
    'web/README.md': readmeText,
    '.github/workflows/web.yml': workflowText,
    ...Object.fromEntries(
      Object.entries(sources).map(([path, text]) => [`web/worker/${path.slice(2)}`, text]),
    ),
  };

  it('covers the script and its tests', () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['web/worker/contact.ts', 'web/worker/contact.test.ts']),
    );
  });

  // Addresses on the reserved example domains (RFC 2606) are fixtures, not anyone's mailbox.
  const ADDRESS =
    /[A-Za-z0-9._%+'-]+@(?!(?:[A-Za-z0-9-]+\.)*example\.(?:com|net|org)\b)(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
  // Turnstile site keys and secrets start 0x4AAAAAAA; the published test keys are 1x, 2x and 3x followed by zeros.
  const TURNSTILE_KEY = /\b0x4A{6,}[A-Za-z0-9_-]*/g;
  // Resend API keys are re_<id>_<secret>.
  const RESEND_KEY = /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{12,}/g;

  for (const [file, text] of Object.entries(files)) {
    it(file, () => {
      expect(text.match(ADDRESS) ?? []).toEqual([]);
      expect(text.match(TURNSTILE_KEY) ?? []).toEqual([]);
      expect(text.match(RESEND_KEY) ?? []).toEqual([]);
    });
  }
});
