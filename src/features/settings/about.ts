/**
 * App settings → About: where the links go, how the version reads ("1.0 (1)", AppSettings board) and the caption
 * under Diagnostics. Pure.
 */

/** The landing site's plain pages (design.md "Landing page"). */
export const LINKS = {
  privacy: 'https://even.appalaya.com/privacy',
  terms: 'https://even.appalaya.com/terms',
  source: 'https://github.com/appalaya/even-app',
  /** Help and feedback, and "Report this group" (with the group in its fragment: features/report/contact.ts). */
  contact: 'https://even.appalaya.com/contact',
  /** "Update": the store listings (the Play page exists once the app is published there). */
  store: {
    ios: 'https://apps.apple.com/app/id6816425117',
    android: 'https://play.google.com/store/apps/details?id=com.appalaya.even',
  },
} as const;

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
