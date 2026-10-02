/// <reference types="node" />
/**
 * NotFound (src/app/+not-found.tsx) is the only page for a link or route the app does not know: app.json turns
 * Expo Router's generated `_sitemap` route off, which lists every route and crashed a release build when opened
 * (`even://_sitemap`), so that link lands on NotFound too.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

describe('unknown links', () => {
  it("turns Expo Router's sitemap off, and draws its own not-found route", () => {
    const app = JSON.parse(readFileSync(`${ROOT}app.json`, 'utf8')) as {
      expo: { plugins: (string | [string, Record<string, unknown>])[] };
    };
    const router = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-router');
    expect(router?.[1]).toMatchObject({ root: './src/app', sitemap: false });
    expect(existsSync(`${ROOT}src/app/+not-found.tsx`)).toBe(true);
    expect(existsSync(`${ROOT}src/app/_sitemap.tsx`)).toBe(false);
  });
});
