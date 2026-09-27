/**
 * "Help and feedback" and "Report this group" as plain data (AppSettings, GroupSettings, ReportGroup,
 * ReportGroupOther and ReportInBrowser boards; unit-tested in contact.test.ts): whether a group's server is the one
 * Appalaya runs, the contact page's report link, and what the other-server sheet shows of that server's `/v1/info`.
 */
import { canonicalOrigin, PROTOCOL } from '@even/core';

import type { ServerInfo } from '../../services/sync/types';
import { LINKS } from '../settings/about';

/** The contact page. Help and feedback opens it as is; a report adds the group in the fragment. */
export const CONTACT_PAGE = LINKS.contact;

/** A group id on a server (PROTOCOL.md §2): 32 bytes, unpadded base64url. */
const GROUP_ID = /^[A-Za-z0-9_-]{43}$/;

const APPALAYA_SERVER = canonicalOrigin(PROTOCOL.defaultServer);

/**
 * Whether a group syncs through the server Appalaya runs. Two server URLs are the same server exactly when their
 * canonical forms are equal (PROTOCOL.md §8.1), so the group's server is compared with `PROTOCOL.defaultServer`
 * canonically; a URL that has no canonical form is nobody's server, so not Appalaya's.
 */
export function isAppalayaServer(serverUrl: string): boolean {
  try {
    return canonicalOrigin(serverUrl) === APPALAYA_SERVER;
  } catch {
    return false;
  }
}

/**
 * The scheme, host and port of a server URL, without a path ("https://home.example.net:8443" for
 * "https://home.example.net:8443/even"): the contact form takes an origin (web/worker/validate.ts, `isHttpsOrigin`).
 * Throws for a URL with no canonical form.
 */
export function serverOrigin(serverUrl: string): string {
  const canonical = canonicalOrigin(serverUrl);
  const path = canonical.indexOf('/', 'https://'.length);
  return path === -1 ? canonical : canonical.slice(0, path);
}

/**
 * "Continue to report" and "Tell Appalaya anyway": the contact page with the group in the fragment,
 * `https://even.appalaya.com/contact#purpose=report&id=<groupId>&server=<https origin>`. A browser never sends the
 * fragment, so neither value reaches a server or its log until the person sends the form. Only these two: never the
 * secret, the invite or the group's name. Neither value can hold a character that needs escaping (base64url; a
 * canonical https origin), so they are checked instead, and a group id of the wrong shape throws.
 */
export function reportUrl(report: { groupId: string; server: string }): string {
  if (!GROUP_ID.test(report.groupId)) throw new RangeError('a group id is 43 base64url characters');
  return `${CONTACT_PAGE}#purpose=report&id=${report.groupId}&server=${serverOrigin(report.server)}`;
}

/** "ab12…u7Qx": a group id as the report sheet shows it, its first and last four characters. */
export function shortGroupId(groupId: string): string {
  return groupId.length <= 9 ? groupId : `${groupId.slice(0, 4)}…${groupId.slice(-4)}`;
}

export interface ServerDetails {
  /** The server's `operator`, or null when it sends none (the row is left out). */
  operator: string | null;
  /** The server's `terms` as a link, or null when it sends none or not an https URL (the row is left out). */
  terms: { url: string; label: string } | null;
}

/** An https URL whose authority is a plain host and optional port: no user name, nothing that is not ASCII. */
const HTTPS_URL = /^https:\/\/([A-Za-z0-9.-]+(?::[0-9]{1,5})?)(?:[/?#][\x21-\x7E]*)?$/i;

/**
 * What ReportGroupOther shows of the server's `/v1/info` (PROTOCOL.md §6.1: `operator` and `terms` are optional
 * strings): each only when the server sends it. Terms become a link only when they are an https URL, since the
 * in-app browser opens them; the label drops the scheme and a trailing slash ("home.example.net/terms").
 */
export function serverDetails(info: ServerInfo | null | undefined): ServerDetails {
  const operator = info?.operator?.trim() ?? '';
  const terms = info?.terms?.trim() ?? '';
  const link = HTTPS_URL.exec(terms);
  return {
    operator: operator === '' ? null : operator,
    terms:
      link === null
        ? null
        : { url: terms, label: terms.replace(/^https:\/\//i, '').replace(/\/$/, '') },
  };
}
