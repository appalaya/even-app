import { PROTOCOL } from '@even/core';
import { describe, expect, it } from 'vitest';

import type { ServerInfo } from '../../services/sync/types';

import {
  CONTACT_PAGE,
  HELP_PAGE,
  isAppalayaServer,
  reportUrl,
  serverDetails,
  shortGroupId,
} from './contact';

const GROUP_ID = 'ab12cdEFghIJklMNopQRstUVwxYZ012345678-_u7Qx';

const INFO: ServerInfo = {
  protocol: [1],
  limits: {
    max_event_bytes: 8192,
    max_group_bytes: 2_097_152,
    max_group_events: 10_000,
    max_batch: 25,
    max_page: 500,
    daily_write_budget: 0,
    rate: { requests_per_minute: 120, writes_per_minute: 60, group_creates_per_minute: 3 },
  },
  retention_days: 365,
  push: false,
};

describe('isAppalayaServer', () => {
  it("compares the group's server with the default one canonically", () => {
    expect(isAppalayaServer(PROTOCOL.defaultServer)).toBe(true);
    expect(isAppalayaServer('https://sync.even.appalaya.com')).toBe(true);
    expect(isAppalayaServer('HTTPS://Sync.Even.Appalaya.com:443/')).toBe(true);
    expect(isAppalayaServer(' https://sync.even.appalaya.com ')).toBe(true);
  });

  it('is false for any other server, and for what is not a server URL', () => {
    expect(isAppalayaServer('https://home.example.net')).toBe(false);
    expect(isAppalayaServer('https://sync.even.appalaya.com:8443')).toBe(false);
    expect(isAppalayaServer('https://sync.even.appalaya.com/even')).toBe(false);
    expect(isAppalayaServer('https://even.appalaya.com')).toBe(false);
    expect(isAppalayaServer('https://sync.even.appalaya.com.example.net')).toBe(false);
    expect(isAppalayaServer('http://sync.even.appalaya.com')).toBe(false);
    expect(isAppalayaServer('')).toBe(false);
  });
});

describe('CONTACT_PAGE', () => {
  it('is the contact page with ?from=app and no fragment', () => {
    expect(CONTACT_PAGE).toBe('https://even.appalaya.com/contact?from=app');
    expect(new URL(CONTACT_PAGE).searchParams.get('from')).toBe('app');
    expect(CONTACT_PAGE.includes('#')).toBe(false);
  });
});

describe('HELP_PAGE', () => {
  it("is the contact page on Get help, with nothing else in the fragment (AppError's Report a problem)", () => {
    expect(HELP_PAGE).toBe('https://even.appalaya.com/contact?from=app#purpose=help');
    expect(HELP_PAGE.split('#')[0]).toBe(CONTACT_PAGE);
    const params = new URLSearchParams(HELP_PAGE.slice(HELP_PAGE.indexOf('#') + 1));
    expect([...params.entries()]).toEqual([['purpose', 'help']]);
  });

  it('carries the flag in the query, before the fragment', () => {
    const url = new URL(HELP_PAGE);
    expect(url.search).toBe('?from=app');
    expect(url.hash).toBe('#purpose=help');
  });
});

describe('reportUrl', () => {
  it('puts the purpose, the group id and the server in the fragment, after the query', () => {
    const url = reportUrl({ groupId: GROUP_ID, server: 'https://sync.even.appalaya.com' });
    expect(url).toBe(
      `https://even.appalaya.com/contact?from=app#purpose=report&id=${GROUP_ID}&server=https%3A%2F%2Fsync.even.appalaya.com`,
    );
    // Only the flag precedes the fragment, so the request is the contact page with ?from=app and nothing else.
    expect(url.split('#')[0]).toBe(CONTACT_PAGE);
    expect(url.split('#')).toHaveLength(2);
    expect(new URL(url).search).toBe('?from=app');
    expect(url.indexOf('?')).toBeLessThan(url.indexOf('#'));
  });

  it('writes the same fragment it always has', () => {
    for (const server of ['https://sync.even.appalaya.com', 'https://home.example.net:8443/even']) {
      const url = reportUrl({ groupId: GROUP_ID, server });
      expect(url.slice(url.indexOf('#'))).toBe(
        `#purpose=report&id=${GROUP_ID}&server=${encodeURIComponent(server)}`,
      );
    }
  });

  it('reads back exactly with URLSearchParams, as the page parses it', () => {
    for (const server of [
      'https://sync.even.appalaya.com',
      'https://home.example.net:8443',
      'https://home.example.net:8443/even',
      "https://home.example.net/a&b+c=d;e,f!g$h'i(j)k*l@m:n",
    ]) {
      const url = reportUrl({ groupId: GROUP_ID, server });
      const params = new URLSearchParams(url.slice(url.indexOf('#') + 1));
      expect([...params.keys()]).toEqual(['purpose', 'id', 'server']);
      expect(params.get('purpose')).toBe('report');
      expect(params.get('id')).toBe(GROUP_ID);
      expect(params.get('server')).toBe(server);
    }
  });

  it('sends the canonical server URL', () => {
    const url = reportUrl({ groupId: GROUP_ID, server: 'HTTPS://Home.Example.net:443/even/' });
    const params = new URLSearchParams(url.slice(url.indexOf('#') + 1));
    expect(params.get('server')).toBe('https://home.example.net/even');
  });

  it('refuses a group id of the wrong shape and a server that is not one', () => {
    expect(() => reportUrl({ groupId: 'short', server: PROTOCOL.defaultServer })).toThrow();
    expect(() => reportUrl({ groupId: `${GROUP_ID}=`, server: PROTOCOL.defaultServer })).toThrow();
    expect(() =>
      reportUrl({ groupId: GROUP_ID.replace('ab', 'a&'), server: PROTOCOL.defaultServer }),
    ).toThrow();
    expect(() =>
      reportUrl({ groupId: GROUP_ID, server: 'http://sync.even.appalaya.com' }),
    ).toThrow();
  });
});

describe('shortGroupId', () => {
  it('shows the first and last four characters', () => {
    expect(shortGroupId(GROUP_ID)).toBe('ab12…u7Qx');
  });
});

describe('serverDetails', () => {
  it('shows the operator and the terms the server sends', () => {
    expect(
      serverDetails({
        ...INFO,
        operator: 'Even (appalaya.com)',
        terms: 'https://even.appalaya.com/terms',
      }),
    ).toEqual({
      operator: 'Even (appalaya.com)',
      terms: { url: 'https://even.appalaya.com/terms', label: 'even.appalaya.com/terms' },
    });
    expect(serverDetails({ ...INFO, terms: 'https://home.example.net/' }).terms).toEqual({
      url: 'https://home.example.net/',
      label: 'home.example.net',
    });
  });

  it('leaves out each row the server does not send', () => {
    expect(serverDetails(INFO)).toEqual({ operator: null, terms: null });
    expect(serverDetails({ ...INFO, operator: '  ', terms: '' })).toEqual({
      operator: null,
      terms: null,
    });
    expect(serverDetails({ ...INFO, operator: 'Self-hosted' })).toEqual({
      operator: 'Self-hosted',
      terms: null,
    });
    expect(serverDetails(null)).toEqual({ operator: null, terms: null });
    expect(serverDetails(undefined)).toEqual({ operator: null, terms: null });
  });

  it('links only https terms with a plain host', () => {
    for (const terms of [
      'http://home.example.net/terms',
      'javascript:alert(1)',
      'file:///etc/hosts',
      'home.example.net/terms',
      'https://',
      'https://user@home.example.net/terms',
      'https://home.example.net/te rms',
      'https://hömé.example.net/terms',
    ]) {
      expect(serverDetails({ ...INFO, terms }).terms).toBeNull();
    }
    expect(
      serverDetails({ ...INFO, terms: 'HTTPS://home.example.net:8443/terms?lang=en' }).terms,
    ).toEqual({
      url: 'HTTPS://home.example.net:8443/terms?lang=en',
      label: 'home.example.net:8443/terms?lang=en',
    });
  });
});
