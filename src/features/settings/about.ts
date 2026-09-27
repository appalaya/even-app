/** App settings → About: where the links go and how the version reads ("1.0 (1)", AppSettings board). Pure. */

/** The landing site's plain pages (design.md "Landing page"). */
export const LINKS = {
  privacy: 'https://even.appalaya.com/privacy',
  terms: 'https://even.appalaya.com/terms',
  /** The docs name no source repository yet; the landing page stands in. */
  source: 'https://even.appalaya.com',
  /** Help and feedback, and "Report this group" (with the group in its fragment: features/report/contact.ts). */
  contact: 'https://even.appalaya.com/contact',
} as const;

/** "1.0.0" and "1" → "1.0 (1)": a zero patch is dropped, as the board writes it. */
export function versionLabel(
  version: string | null | undefined,
  build: string | null | undefined,
): string {
  const v = (version ?? '1.0.0').replace(/^(\d+\.\d+)\.0$/, '$1');
  return `${v} (${build ?? '1'})`;
}
