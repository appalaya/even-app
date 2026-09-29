/**
 * The dev server the dev seed syncs with, and the guard that keeps every seed off the production server.
 *
 * `npm run dev:server` runs the Python reference server (../even-server/python) on this Mac at 127.0.0.1:8787 with
 * a throwaway database. The iOS simulator shares the Mac's loopback, so it reaches it at `http://127.0.0.1:8787`;
 * the Android emulator reaches the Mac at `10.0.2.2`. A phone on the local network takes `?server=` on the seed
 * link (`http://<the Mac's address>:8787`, with the server started on that interface, or an https tunnel).
 *
 * A group's server URL is always the canonical https form (keys derive from it, PROTOCOL.md §8.1); a development
 * build reaches a local one over plain http (`localHttpUrl`, `openAppServices`). Pure, so Node tests use it.
 */
import { canonicalOrigin, PROTOCOL } from '@even/core';

import { isLocalHost } from '../services/sync/httpTransport';
import type { AppServices } from '../state';

export const DEV_SERVER_PORT = 8787;

/** The domain Appalaya's servers live under: no seed may name a host in it. */
const PRODUCTION_DOMAIN = 'appalaya.com';

/** Where the dev server is, as this platform reaches the Mac it runs on (`Platform.OS`). */
export function devServerUrl(os: string): string {
  return `http://${os === 'android' ? '10.0.2.2' : '127.0.0.1'}:${DEV_SERVER_PORT}`;
}

/** A server URL's host, lower case, from any scheme; null when there is none. Lenient, for the guard. */
function hostOf(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url.trim());
  return match?.[1]?.toLowerCase().replace(/\.+$/, '') ?? null;
}

/**
 * Whether `url` is the production server (`PROTOCOL.defaultServer`) or any host under appalaya.com, in any
 * spelling or scheme. A URL with no readable host counts too: the guard refuses what it cannot read.
 */
export function isProductionServer(url: string): boolean {
  try {
    if (canonicalOrigin(url) === canonicalOrigin(PROTOCOL.defaultServer)) return true;
  } catch {
    // Not canonicalisable (http://, say): judged by its host below.
  }
  const host = hostOf(url);
  return host === null || host === PRODUCTION_DOMAIN || host.endsWith(`.${PRODUCTION_DOMAIN}`);
}

/** Throws unless `url` is safe to seed against: never the production server, never appalaya.com. */
export function assertNotProduction(url: string): void {
  if (isProductionServer(url)) {
    throw new Error(
      `seed: refusing to seed against the production server (${hostOf(url) ?? url}). Seeds use the dev server: npm run dev:server`,
    );
  }
}

/**
 * The seed's server as a group stores it: the canonical https origin of `url`, which may be given as `http://` for
 * a server on this machine or the local network (anything else must be https). Throws for a URL that has no
 * canonical form, a remote `http://` one, and the production server.
 */
export function seedServerOrigin(url: string): string {
  const text = url.trim();
  const insecure = /^http:\/\//i.test(text);
  const origin = canonicalOrigin(insecure ? `https://${text.slice('http://'.length)}` : text);
  if (insecure && !isLocalHost(hostOf(origin) ?? '')) {
    throw new Error(`seed: http:// works only for this Mac or the local network, not ${url}`);
  }
  assertNotProduction(origin);
  return origin;
}

/** A group this phone holds on the production server: a `groups` row, or a keychain entry without one. */
export interface ProductionHolding {
  localId: string;
  /** The row's server, or the keychain entry's (null: an entry from before the index recorded one). */
  serverUrl: string | null;
  hasRow: boolean;
}

/**
 * The groups this phone holds on the production server, which only seeds from before the dev server made: rows on
 * it, and keychain entries without a row whose server is it or unrecorded. `even://dev/cleanup` deletes their
 * copies there; the seed refuses to run until it has, since removing them would lose the secrets it needs.
 */
export async function productionHoldings(
  s: Pick<AppServices, 'store' | 'secrets'>,
): Promise<ProductionHolding[]> {
  const rows = await s.store.listGroups();
  const withRow = new Set(rows.map((row) => row.localId));
  const held: ProductionHolding[] = rows
    .filter((row) => isProductionServer(row.serverUrl))
    .map((row) => ({ localId: row.localId, serverUrl: row.serverUrl, hasRow: true }));
  for (const entry of await s.secrets.listGroups()) {
    if (withRow.has(entry.localId)) continue;
    if (entry.serverUrl === null || isProductionServer(entry.serverUrl)) {
      held.push({ localId: entry.localId, serverUrl: entry.serverUrl, hasRow: false });
    }
  }
  return held;
}
