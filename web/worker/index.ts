/**
 * even-web's Worker script: the contact form's API next to the static site (../wrangler.jsonc).
 *
 *   /api/contact          POST: validate, verify Turnstile, rate-limit, send one email (contact.ts)
 *   /api/contact/config   GET: the Turnstile site key and the form's limits, for the page
 *   /api/*                anything else: 404 JSON
 *   any other path        straight to the asset server (see run_worker_first in wrangler.jsonc for when a
 *                         request outside /api/* reaches this script at all)
 */
import { CONFIG_ROUTE, CONTACT_ROUTE, handleConfig, handleContact } from './contact';
import type { Env } from './env';
import { exceptionName, failure, logEvent, logLine } from './http';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (pathname === CONTACT_ROUTE) return await handleContact(request, env);
      if (pathname === CONFIG_ROUTE) return handleConfig(request, env);
    } catch (error) {
      logEvent('error', 'unhandled_exception', { exception: exceptionName(error) });
      return failure(500, 'internal');
    }
    logLine({ route: 'other', status: 404, outcome: 'not_found' });
    return failure(404, 'not_found');
  },
};
