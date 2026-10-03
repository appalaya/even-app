/**
 * App settings → About: where the links go, how the version reads ("1.0 (1)", AppSettings board) and the caption
 * under Diagnostics. Pure.
 */

/**
 * The landing site's plain pages (design.md "Landing page"), as the app opens them: with `?from=app` (`fromApp`).
 * The source code is GitHub's page, not ours, so it goes as it is.
 */
export const LINKS = {
  privacy: 'https://even.appalaya.com/privacy?from=app',
  terms: 'https://even.appalaya.com/terms?from=app',
  source: 'https://github.com/appalaya/even-app',
  /** Help and feedback, and "Report this group" (with the group in its fragment: features/report/contact.ts). */
  contact: 'https://even.appalaya.com/contact?from=app',
  /** "Update": the store listings (the Play page exists once the app is published there). */
  store: {
    ios: 'https://apps.apple.com/app/id6816425117',
    android: 'https://play.google.com/store/apps/details?id=com.appalaya.even',
  },
} as const;

/** A page on the landing site, `https://even.appalaya.com` (scheme and host in any case), up to its query. */
const SITE_PAGE = /^https:\/\/even\.appalaya\.com(?=[/?]|$)/i;
const FLAG = 'from=app';

/**
 * A page of the landing site as the app opens it: with `from=app` in the query, before any fragment (design.md "In-app
 * browser"). With it the site makes its header lockup and its link to appalaya.com plain text, keeps the flag on
 * links to its own pages and drops the home page's tip card, so nothing reached from the app leads to a payment
 * (App Store Review Guideline 3.1.1, Google Play's Payments policy). The fragment is kept byte for byte: the contact
 * page reads a report from it. Any other URL comes back unchanged; one that has the flag already keeps it, once.
 */
export function fromApp(url: string): string {
  const hash = url.indexOf('#');
  const head = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash);
  if (!SITE_PAGE.test(head)) return url;
  const query = head.indexOf('?');
  const path = query === -1 ? head : head.slice(0, query);
  const params =
    query === -1
      ? []
      : head
          .slice(query + 1)
          .split('&')
          .filter((param) => param !== '' && !/^from(?:=|$)/.test(param));
  return `${path}?${[...params, FLAG].join('&')}${fragment}`;
}

/** "1.0.0" and "1" → "1.0 (1)": a zero patch is dropped, as the board writes it. */
export function versionLabel(
  version: string | null | undefined,
  build: string | null | undefined,
): string {
  const v = (version ?? '1.0.0').replace(/^(\d+\.\d+)\.0$/, '$1');
  return `${v} (${build ?? '1'})`;
}

/**
 * The caption under About's Diagnostics row. It names the model only where Diagnostics shows the model's sections
 * (`diagnosticsSections`): iOS, as AppAbout draws it. Android has no on-device model, so its page is about sync.
 */
export function diagnosticsCaption(os: string): string {
  return os === 'ios'
    ? 'What the app knows about its model and sync. Nothing here leaves your phone.'
    : 'What the app knows about sync. Nothing here leaves your phone.';
}
