/// <reference types="node" />
/**
 * The paths Even claims on even.appalaya.com (design.md "Invites" → Open; pre-launch review L5): Android's App Link
 * filter in app.json, the manifest prebuild generated from it (committed), and the iOS association file the site
 * serves must claim exactly `/i` and `/i/…`, never `/index.html` or a later page whose path starts `/i`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOST = 'even.appalaya.com';

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');
}

interface IntentData {
  scheme?: string;
  host?: string;
  path?: string;
  pathPrefix?: string;
  pathPattern?: string;
}

interface IntentFilter {
  action: string;
  autoVerify?: boolean;
  data: IntentData[];
}

const appJson = JSON.parse(read('app.json')) as {
  expo: { android: { intentFilters: IntentFilter[] }; ios: { associatedDomains: string[] } };
};

/** The data entries of every filter on the invite host. */
function appLinkData(): IntentData[] {
  return appJson.expo.android.intentFilters.flatMap((filter) =>
    filter.data.filter((d) => d.host === HOST),
  );
}

/** Android's rule: `path` is the whole path, `pathPrefix` its start. */
function androidClaims(data: readonly IntentData[], path: string): boolean {
  return data.some(
    (d) =>
      (d.path !== undefined && d.path === path) ||
      (d.pathPrefix !== undefined && path.startsWith(d.pathPrefix)),
  );
}

/** The AASA component rule for the patterns the file uses: `*` is any run of characters. */
function iosClaims(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => {
    const re = new RegExp(
      `^${pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`,
    );
    return re.test(path);
  });
}

const CLAIMED = ['/i', '/i/', '/i/x'];
const NOT_CLAIMED = ['/', '/index.html', '/ii', '/info', '/install', '/contact', '/privacy'];

describe('the invite link paths (review L5)', () => {
  it('app.json claims /i exactly and /i/ as a prefix, verified, over https only', () => {
    const filters = appJson.expo.android.intentFilters.filter((f) =>
      f.data.some((d) => d.host === HOST),
    );
    expect(filters).toHaveLength(1);
    expect(filters[0]?.autoVerify).toBe(true);
    expect(appLinkData()).toEqual([
      { scheme: 'https', host: HOST, path: '/i' },
      { scheme: 'https', host: HOST, pathPrefix: '/i/' },
    ]);
    expect(appJson.expo.ios.associatedDomains).toEqual([`applinks:${HOST}`]);
  });

  it('Android and iOS claim the same paths', () => {
    const aasa = JSON.parse(read('web/.well-known/apple-app-site-association')) as {
      applinks: { details: { components: { '/': string }[] }[] };
    };
    const patterns = aasa.applinks.details.flatMap((d) => d.components.map((c) => c['/']));
    for (const path of CLAIMED) {
      expect(androidClaims(appLinkData(), path)).toBe(true);
      expect(iosClaims(patterns, path)).toBe(true);
    }
    for (const path of NOT_CLAIMED) {
      expect(androidClaims(appLinkData(), path)).toBe(false);
      expect(iosClaims(patterns, path)).toBe(false);
    }
  });

  it('the committed manifest is what prebuild makes of app.json', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const data = [...manifest.matchAll(/<data ([^>]*)\/>/g)]
      .map((m) => {
        const attrs: Record<string, string> = {};
        for (const [, name, value] of (m[1] ?? '').matchAll(/android:(\w+)="([^"]*)"/g)) {
          if (name !== undefined && value !== undefined) attrs[name] = value;
        }
        return attrs as IntentData;
      })
      .filter((d) => d.host === HOST);
    expect(data).toEqual(appLinkData());
  });
});
