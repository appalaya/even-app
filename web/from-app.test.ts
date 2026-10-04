/**
 * The from=app rule (README.md, "Pages the app opens") on every page, as shipped: each page's HTML is loaded in jsdom
 * at its URL, with and without ?from=app, its inline scripts run as a browser runs them (the shared
 * <script id="from-app">, and on /i the invite script as well), and its links are read back. Under the flag no link
 * on any page leads to the home page or to appalaya.com, the tip card is gone, links to this site's pages carry the
 * flag, and links to the stores and GitHub are untouched; without JavaScript the links stay as they are.
 *
 * The crawl at the end starts from the URLs the app itself opens (src/features/settings/about.ts and
 * src/features/report/contact.ts) and follows every link to this site, to show that nothing reached from the app
 * shows the tip card.
 *
 *   npx vitest run web/from-app.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { HELP_PAGE, reportUrl } from '../src/features/report/contact';
import { LINKS } from '../src/features/settings/about';
import { readFragment } from './contact-lib.js';

const WEB = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://even.appalaya.com';
const COMPANY = '© 2026 Appalaya Inc.';
const TIP = /^https:\/\/buy\.stripe\.com\//;
/** Where a page may still link under the flag besides itself: the two stores and the repositories on GitHub. */
const KEPT = /^https:\/\/(?:apps\.apple\.com|play\.google\.com|github\.com\/appalaya)\//;
const GROUP_ID = 'ab12cdEFghIJklMNopQRstUVwxYZ012345678-_u7Qx';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';

/** Every page, at a path Cloudflare serves it on (404.html answers any unknown path). */
const PAGES = [
  { file: 'index.html', path: '/' },
  { file: 'privacy.html', path: '/privacy' },
  { file: 'terms.html', path: '/terms' },
  { file: 'abuse.html', path: '/abuse' },
  { file: 'contact.html', path: '/contact' },
  { file: 'android.html', path: '/android' },
  { file: '404.html', path: '/no-such-page' },
  { file: 'i.html', path: '/i' },
];

const fileFor = (pathname: string): string =>
  PAGES.find((p) => p.path === pathname && p.file !== '404.html')?.file ?? '404.html';

interface Page {
  document: Document;
  location: Location;
  /** Uncaught exceptions from the page's scripts. */
  errors: string[];
}

/** The page in jsdom at `url`; its inline scripts run unless `scripts` is false. Nothing is fetched. */
function load(
  file: string,
  url: string,
  { scripts = true, userAgent }: { scripts?: boolean; userAgent?: string } = {},
): Page {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: { type?: string; message: string; cause?: unknown }) => {
    if (error.type === 'unhandled-exception') errors.push(String(error.cause ?? error.message));
  });
  const dom = new JSDOM(readFileSync(join(WEB, file), 'utf8'), {
    url,
    runScripts: scripts ? 'dangerously' : undefined,
    virtualConsole,
    beforeParse(window: Window) {
      if (userAgent !== undefined)
        Object.defineProperty(window.navigator, 'userAgent', { value: userAgent });
    },
  });
  return { document: dom.window.document, location: dom.window.location, errors };
}

interface Link {
  text: string;
  href: string;
  /** The href resolved against the page. */
  url: URL;
}

function links(page: Page): Link[] {
  return [...page.document.querySelectorAll('a[href]')].map((a) => {
    const href = a.getAttribute('href') ?? '';
    return { text: a.textContent?.trim() ?? '', href, url: new URL(href, page.location.href) };
  });
}

const isHere = (link: Link) => link.url.origin === SITE;
/** The visible text of the page (scripts are outside .wrap), with its whitespace collapsed. */
const text = (root: Element | null | undefined) =>
  (root?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe.each(PAGES)('$file', ({ file, path }) => {
  const plain = load(file, `${SITE}${path}`);
  const flagged = load(file, `${SITE}${path}?from=app`);

  it('runs its scripts without an error', () => {
    expect(plain.errors).toEqual([]);
    expect(flagged.errors).toEqual([]);
  });

  it('without the flag, links as it always has', () => {
    const all = links(plain);
    for (const link of all.filter(isHere)) expect(link.url.search).toBe('');
    const lockup = plain.document.querySelector('header .lockup');
    if (lockup !== null) {
      expect(lockup.tagName).toBe('A');
      expect(lockup.getAttribute('href')).toBe('/');
    }
    if (plain.document.querySelector('.foot') !== null) {
      expect(all.find((l) => l.text === COMPANY)?.href).toBe('https://appalaya.com');
    }
  });

  it('with ?from=app, its header lockup is the same mark and word, not a link', () => {
    const before = plain.document.querySelector('header .lockup');
    const after = flagged.document.querySelector('header .lockup');
    if (before === null) {
      // The home page's lockup is its heading, never a link.
      expect(file).toBe('index.html');
      expect(flagged.document.querySelector('h1.lockup')?.tagName).toBe('H1');
      return;
    }
    expect(after?.tagName).toBe('SPAN');
    expect(after?.className).toBe(before.className);
    expect(after?.innerHTML).toBe(before.innerHTML);
    expect(after?.querySelector('svg.mark')).not.toBeNull();
    expect(text(after)).toBe('Even');
    expect(flagged.document.querySelector('a.lockup')).toBeNull();
  });

  it('with ?from=app, its company line is plain text', () => {
    const foot = flagged.document.querySelector('.foot');
    if (foot === null) return; // 404.html has no footer.
    const line = [...foot.children].find((child) => text(child) === COMPANY);
    expect(line?.tagName).toBe('SPAN');
    expect(links(flagged).some((l) => l.url.hostname === 'appalaya.com')).toBe(false);
  });

  it('with ?from=app, every link to this site carries the flag, and only the stores and GitHub link elsewhere', () => {
    const before = links(plain);
    const after = links(flagged);
    for (const link of after) {
      if (isHere(link)) {
        expect(link.url.searchParams.get('from')).toBe('app');
        expect(link.href).toBe(`${link.url.pathname}?from=app${link.url.hash}`);
      } else {
        expect(link.url.href).toMatch(KEPT);
      }
      expect(link.url.href).not.toMatch(TIP);
    }
    // The same links to this site as before, by path, less the lockup; the same links out to the stores and GitHub.
    const lockup = plain.document.querySelector('header a.lockup') === null ? 0 : 1;
    expect(after.filter(isHere).map((l) => l.url.pathname)).toEqual(
      before
        .filter(isHere)
        .slice(lockup)
        .map((l) => l.url.pathname),
    );
    expect(after.filter((l) => !isHere(l)).map((l) => l.href)).toEqual(
      before.filter((l) => KEPT.test(l.url.href)).map((l) => l.href),
    );
  });

  it('with ?from=app, says the same words, less the tip card', () => {
    const wrap = plain.document.querySelector('.wrap')?.cloneNode(true) as Element | undefined;
    wrap?.querySelector('.tip')?.remove();
    expect(text(flagged.document.querySelector('.wrap'))).toBe(text(wrap));
  });

  it('without JavaScript, links as it always has, flag or not', () => {
    const noScript = load(file, `${SITE}${path}?from=app`, { scripts: false });
    expect(links(noScript).map((l) => l.href)).toEqual(links(plain).map((l) => l.href));
  });
});

describe('index.html with ?from=app', () => {
  const plain = load('index.html', `${SITE}/`);
  const page = load('index.html', `${SITE}/?from=app`);

  it('has no tip card and no link to the tip page', () => {
    expect(plain.document.querySelector('.tip')).not.toBeNull();
    expect(links(plain).some((l) => TIP.test(l.url.href))).toBe(true);
    expect(page.document.querySelector('.tip')).toBeNull();
    expect(page.document.getElementById('tip')).toBeNull();
    expect(links(page).some((l) => TIP.test(l.url.href))).toBe(false);
  });

  it('keeps the App Store badge, the Android beta button and the server repository', () => {
    const stores = [...page.document.querySelectorAll('.stores a.store')];
    expect(stores.map((a) => a.querySelector('img')?.getAttribute('alt'))).toEqual([
      'Download on the App Store',
    ]);
    expect(stores.map((a) => a.getAttribute('href'))).toEqual([
      'https://apps.apple.com/app/id6816425117',
    ]);
    expect(links(page).find((l) => l.text === 'Join the Android beta')?.href).toBe(
      '/android?from=app',
    );
    expect(links(page).find((l) => l.text === 'Run your own server')?.href).toBe(
      'https://github.com/appalaya/even-server',
    );
  });

  it('keeps the flag on the Android beta button and its footer links', () => {
    expect(
      links(page)
        .filter((l) => l.url.origin === SITE)
        .map((l) => l.href),
    ).toEqual([
      '/android?from=app',
      '/privacy?from=app',
      '/terms?from=app',
      '/abuse?from=app',
      '/contact?from=app',
    ]);
  });
});

describe('android.html, Android in closed testing', () => {
  const plain = load('android.html', `${SITE}/android`);
  const flagged = load('android.html', `${SITE}/android?from=app`);

  it('links to the tester group, the testing page, and the contact page with Get help chosen', () => {
    expect(links(plain).map((l) => [l.text, l.href])).toEqual([
      ['Even', '/'],
      ['Ask to join the group', 'https://groups.google.com/a/appalaya.com/g/even-android-beta'],
      ['Open the testing page', 'https://play.google.com/apps/testing/com.appalaya.even'],
      ['Get help', '/contact#purpose=help'],
      ['Privacy', '/privacy'],
      ['Terms', '/terms'],
      ['Abuse', '/abuse'],
      ['Contact', '/contact'],
      [COMPANY, 'https://appalaya.com'],
    ]);
    const help = links(plain).find((l) => l.text === 'Get help');
    expect(readFragment(help?.url.hash)).toEqual({ purpose: 'help', target: null });
  });

  it('with ?from=app, keeps the testing page and Get help, and shows the group button as plain text', () => {
    // The app never opens /android; under the flag the group, like any link out but the stores and GitHub, is text.
    expect(links(flagged).map((l) => l.href)).toEqual([
      'https://play.google.com/apps/testing/com.appalaya.even',
      '/contact?from=app#purpose=help',
      '/privacy?from=app',
      '/terms?from=app',
      '/abuse?from=app',
      '/contact?from=app',
    ]);
    const group = flagged.document.querySelector('.steps li:first-child .button-soft');
    expect(group?.tagName).toBe('SPAN');
    expect(text(group)).toBe('Ask to join the group');
  });
});

describe('contact.html opened by "Report this group"', () => {
  const url = reportUrl({ groupId: GROUP_ID, server: 'https://sync.even.appalaya.com' });
  const page = load('contact.html', url);

  it('leaves the fragment the form reads exactly as the app wrote it', () => {
    expect(page.location.search).toBe('?from=app');
    expect(page.location.hash).toBe(url.slice(url.indexOf('#')));
  });

  it('keeps the flag on the form\'s "Report abuse" link and the current page marked', () => {
    expect(page.document.querySelector('#handle a')?.getAttribute('href')).toBe('/abuse?from=app');
    const current = page.document.querySelector('.foot a[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe('/contact?from=app');
  });
});

describe('i.html with ?from=app and an invite', () => {
  const code = Buffer.from(
    JSON.stringify({
      v: 1,
      s: 'https://sync.even.appalaya.com',
      k: 'A'.repeat(43),
      h: 'B'.repeat(6),
      g: 'Banff 2026',
    }),
  ).toString('base64url');
  const page = load('i.html', `${SITE}/i?from=app#${code}`, { userAgent: IPHONE });

  it('still shows the invite and its "Open in Even" button, and leaves the fragment alone', () => {
    expect(page.errors).toEqual([]);
    expect(page.document.getElementById('invite')?.hidden).toBe(false);
    expect(page.document.getElementById('group')?.textContent).toBe('Banff 2026');
    const open = page.document.getElementById('open');
    expect(open?.tagName).toBe('A');
    expect(open?.getAttribute('href')).toBe('even://join');
    expect(page.location.hash).toBe(`#${code}`);
  });

  it('sends "What is Even?" home with the flag', () => {
    expect(links(page).find((l) => l.text === 'What is Even?')?.href).toBe('/?from=app');
  });
});

describe('404.html with ?from=app', () => {
  it('sends "Go to the home page" home with the flag', () => {
    const page = load('404.html', `${SITE}/no-such-page?from=app`);
    expect(links(page).find((l) => l.text === 'Go to the home page')?.href).toBe('/?from=app');
  });
});

describe('from what the app opens, by following links', () => {
  it('no page reached shows the tip card, links home, or links anywhere but this site, the stores and GitHub', () => {
    const start = [
      LINKS.privacy,
      LINKS.terms,
      LINKS.contact,
      HELP_PAGE,
      reportUrl({ groupId: GROUP_ID, server: 'https://home.example.net:8443' }),
    ];
    const queue = [...start];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const url = new URL(queue.shift() ?? '');
      const key = url.pathname + url.search;
      if (seen.has(key)) continue;
      seen.add(key);
      expect(url.searchParams.get('from'), key).toBe('app');
      const page = load(fileFor(url.pathname), url.href);
      expect(page.errors, key).toEqual([]);
      expect(page.document.querySelector('.tip'), key).toBeNull();
      expect(page.document.querySelector('a.lockup'), key).toBeNull();
      for (const link of links(page)) {
        expect(link.url.href, key).not.toMatch(TIP);
        if (link.url.origin === SITE) queue.push(link.url.href);
        else expect(link.url.href, key).toMatch(KEPT);
      }
    }
    // Privacy, Terms, Contact and the Abuse page they link to; never the home page, and not /i, which no page links to.
    expect([...seen].sort()).toEqual([
      '/abuse?from=app',
      '/contact?from=app',
      '/privacy?from=app',
      '/terms?from=app',
    ]);
  });
});
