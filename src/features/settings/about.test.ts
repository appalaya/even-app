import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { diagnosticsSections } from '@/features/diagnostics/format';

import { diagnosticsCaption, fromApp, LINKS, versionLabel } from './about';

/** The URL before its fragment, and the fragment with its `#` ('' when there is none). */
const split = (url: string): [string, string] => {
  const hash = url.indexOf('#');
  return hash === -1 ? [url, ''] : [url.slice(0, hash), url.slice(hash)];
};

describe('about', () => {
  it('writes the version as the board does', () => {
    expect(versionLabel('1.0.0', '1')).toBe('1.0 (1)');
    expect(versionLabel('1.2.3', '45')).toBe('1.2.3 (45)');
    expect(versionLabel(null, null)).toBe('1.0 (1)');
  });

  it("captions the Diagnostics row with what that platform's page shows", () => {
    expect(diagnosticsCaption('ios')).toBe(
      'What the app knows about its model and sync. Nothing here leaves your phone.',
    );
    expect(diagnosticsCaption('android')).toBe(
      'What the app knows about sync. Nothing here leaves your phone.',
    );
  });

  it('opens our pages with ?from=app, and GitHub and the stores as they are', () => {
    expect(LINKS.privacy).toBe('https://even.appalaya.com/privacy?from=app');
    expect(LINKS.terms).toBe('https://even.appalaya.com/terms?from=app');
    expect(LINKS.contact).toBe('https://even.appalaya.com/contact?from=app');
    for (const url of [LINKS.privacy, LINKS.terms, LINKS.contact]) {
      expect(new URL(url).search).toBe('?from=app');
      expect(fromApp(url)).toBe(url);
    }
    expect(LINKS.source).toBe('https://github.com/appalaya/even-app');
    for (const url of [LINKS.source, LINKS.store.ios, LINKS.store.android])
      expect(fromApp(url)).toBe(url);
  });

  it('names the model only where Diagnostics has the model sections', () => {
    for (const os of ['ios', 'android']) {
      expect(diagnosticsCaption(os).includes('model')).toBe(
        diagnosticsSections(os, 1).includes('model'),
      );
    }
  });
});

describe('fromApp', () => {
  it('puts the flag in the query, before the fragment, and keeps the fragment as it was', () => {
    expect(fromApp('https://even.appalaya.com/privacy')).toBe(
      'https://even.appalaya.com/privacy?from=app',
    );
    expect(fromApp('https://even.appalaya.com/contact#purpose=help')).toBe(
      'https://even.appalaya.com/contact?from=app#purpose=help',
    );
    const report =
      '#purpose=report&id=ab12cdEFghIJklMNopQRstUVwxYZ012345678-_u7Qx&server=https%3A%2F%2Fsync.even.appalaya.com';
    expect(fromApp(`https://even.appalaya.com/contact${report}`)).toBe(
      `https://even.appalaya.com/contact?from=app${report}`,
    );
    // A `?` or a second `#` inside the fragment is the fragment's.
    expect(fromApp('https://even.appalaya.com/contact#a?b#c')).toBe(
      'https://even.appalaya.com/contact?from=app#a?b#c',
    );
  });

  it('keeps any other query, adds the flag once, and replaces another from', () => {
    expect(fromApp('https://even.appalaya.com/terms?lang=en#tips')).toBe(
      'https://even.appalaya.com/terms?lang=en&from=app#tips',
    );
    expect(fromApp('https://even.appalaya.com/terms?from=app')).toBe(
      'https://even.appalaya.com/terms?from=app',
    );
    expect(fromApp('https://even.appalaya.com/terms?from=web&lang=en')).toBe(
      'https://even.appalaya.com/terms?lang=en&from=app',
    );
    expect(fromApp('https://even.appalaya.com/terms?')).toBe(
      'https://even.appalaya.com/terms?from=app',
    );
    expect(fromApp('https://even.appalaya.com')).toBe('https://even.appalaya.com?from=app');
    expect(fromApp('HTTPS://Even.Appalaya.com/terms')).toBe(
      'HTTPS://Even.Appalaya.com/terms?from=app',
    );
  });

  it('leaves every other URL alone', () => {
    for (const url of [
      'https://github.com/appalaya/even-app',
      'https://appalaya.com',
      'https://sync.even.appalaya.com/terms',
      'https://even.appalaya.com.example.net/terms',
      'https://even.appalaya.com@example.net/terms',
      'https://even.appalaya.com:8443/terms',
      'http://even.appalaya.com/terms',
      'https://home.example.net/terms#even.appalaya.com',
      'even://join',
      '',
    ]) {
      expect(fromApp(url)).toBe(url);
    }
  });

  it('for any path, query and fragment: the flag once, before the fragment, the fragment unchanged', () => {
    const part = fc.string({
      unit: fc.constantFrom('a', 'Z', '0', '/', '=', '&', '%', '?', '-', '_'),
    });
    fc.assert(
      fc.property(
        part,
        part,
        fc.option(fc.string(), { nil: undefined }),
        (path, query, fragment) => {
          const page = `https://even.appalaya.com/${path.replace(/\?/g, '')}`;
          const head = query === '' ? page : `${page}?${query}`;
          const url = fragment === undefined ? head : `${head}#${fragment}`;
          const [before, after] = split(fromApp(url));
          expect(after).toBe(fragment === undefined ? '' : `#${fragment}`);
          const params = new URLSearchParams(before.slice(before.indexOf('?') + 1));
          expect(params.getAll('from')).toEqual(['app']);
          expect(before.startsWith(`${page}?`)).toBe(true);
          expect(fromApp(fromApp(url))).toBe(fromApp(url));
        },
      ),
    );
  });
});
