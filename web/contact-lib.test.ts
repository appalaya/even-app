/**
 * contact-lib.js, the contact page's module, against the app's own code: the group id it works out in the browser
 * must be byte for byte the one @even/core derives (PROTOCOL.md §2), it must read invites exactly as the app does,
 * and every body it builds must pass the Worker's request rules (web/worker/validate.ts).
 *
 *   npx vitest run --config web/vitest.config.mts
 */
import {
  b64urlDecode as coreB64urlDecode,
  b64urlEncode as coreB64urlEncode,
  canonicalOrigin as coreCanonicalOrigin,
  decodeInvite,
  deriveServer,
  encodeInvite,
  groupIdForToken as coreGroupIdForToken,
  inviteLink,
  makeInvite,
  newSecret,
  secretFromInvite,
  utf8Encode,
} from '@even/core';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isHttpsOrigin as workerIsHttpsOrigin, validateContact } from './worker/validate';
import {
  authToken,
  b64urlDecode,
  b64urlEncode,
  canonicalOrigin,
  contactBody,
  DEFAULT_SERVER,
  groupIdFor,
  groupIdForToken,
  InviteError,
  isHttpsOrigin,
  outcome,
  readFragment,
  readInvite,
  REASONS,
  REPORT_PREFIX_MAX,
  reportMessage,
  serverLabel,
  shortGroupId,
  takeInvite,
  targetFromInvite,
} from './contact-lib.js';

/** secret = 0x00 0x01 … 0x1f, as in packages/core/src/keys.test.ts. */
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => i);
const HOME = 'https://home.example.net:8443/even';

/**
 * packages/core/src/keys.test.ts, VECTORS: computed there independently with Node's crypto.hkdfSync and
 * createHash('sha256'), not with @noble or with this file.
 */
const VECTORS = {
  [DEFAULT_SERVER]: {
    authToken: 'Bth1dhK4nn2tJ_RNu2DTi0ZWWiCKyPXtYFJsoUA4TA8',
    groupId: '5440R1lj0RAH5z7UZJ48_Fbl2cbrEBrp4DFswxKPwTI',
  },
  [HOME]: {
    authToken: 'GAL3XisRWEhk3X6FLeypv78mKgTSHgM0OO92ONP8XqM',
    groupId: 'ohV9w_-dFphsCPCXCv7OQnwDcxnuhBeGmQNKiJkI8z4',
  },
} as const;

/** The invite pasted on the ContactWeb board (link pasted state). */
const BOARD_LINK =
  'https://even.appalaya.com/i#eyJ2IjoxLCJzIjoiaHR0cHM6Ly9zeW5jLmV2ZW4uYXBwYWxheWEuY29tIiwiayI6IkJ3Z0pDZ3NNRFE0UEVCRVNFeFFWRmhjWUdSb2JIQjBlSHlBaElpTWtKU1kiLCJoIjoiemtQek9RIiwiZyI6IkJhbmZmIDIwMjYiLCJjdXIiOiJDQUQifQ';

const ORIGINS = [
  DEFAULT_SERVER,
  HOME,
  'https://home.example.net',
  'https://home.example.net:8443',
  'https://192.0.2.1:8080/a/b',
  'https://xn--bcher-kva.example',
  'https://x.test',
];

/** Same result from both, or both throw. */
function agree<T>(a: () => T, b: () => T): void {
  let left: { ok: true; value: T } | { ok: false };
  let right: { ok: true; value: T } | { ok: false };
  try {
    left = { ok: true, value: a() };
  } catch {
    left = { ok: false };
  }
  try {
    right = { ok: true, value: b() };
  } catch {
    right = { ok: false };
  }
  expect(left).toEqual(right);
}

async function inviteErrorCode(text: string): Promise<string | null> {
  try {
    await readInvite(text);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(InviteError);
    return (error as InviteError).code;
  }
}

function coreErrorCode(text: string): string | null {
  try {
    decodeInvite(text);
    return null;
  } catch (error) {
    return (error as { code: string }).code;
  }
}

describe('the group id', () => {
  it.each([DEFAULT_SERVER, HOME] as const)('matches the known answers for %s', async (server) => {
    const token = await authToken(SECRET, server);
    expect(b64urlEncode(token)).toBe(VECTORS[server].authToken);
    expect(await groupIdForToken(token)).toBe(VECTORS[server].groupId);
    expect(await groupIdFor(SECRET, server)).toBe(VECTORS[server].groupId);
  });

  it('equals @even/core’s deriveServer and groupIdForToken for random secrets and servers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.constantFrom(...ORIGINS),
        async (secret, server) => {
          const core = deriveServer(secret, server);
          const token = await authToken(secret, server);
          expect(b64urlEncode(token)).toBe(coreB64urlEncode(core.authToken));
          expect(await groupIdForToken(token)).toBe(core.groupId);
          expect(await groupIdForToken(core.authToken)).toBe(coreGroupIdForToken(core.authToken));
          expect(await groupIdFor(secret, server)).toMatch(/^[A-Za-z0-9_-]{43}$/);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('refuses a server that is not canonical and a secret that is not 32 bytes, as core does', async () => {
    await expect(authToken(SECRET, 'https://sync.even.appalaya.com/')).rejects.toThrow();
    await expect(authToken(SECRET, 'https://Sync.Even.Appalaya.com')).rejects.toThrow();
    await expect(authToken(new Uint8Array(31), DEFAULT_SERVER)).rejects.toThrow(RangeError);
    await expect(groupIdForToken(new Uint8Array(16))).rejects.toThrow(RangeError);
  });

  it('derives the board’s sample link the way the app does', async () => {
    const target = await targetFromInvite(BOARD_LINK);
    const invite = decodeInvite(BOARD_LINK);
    expect(target).toEqual({
      groupId: deriveServer(secretFromInvite(invite), invite.s).groupId,
      server: DEFAULT_SERVER,
      reportable: true,
      appalaya: true,
    });
    // A bare code, and one pasted with surrounding whitespace, name the same group.
    expect(await targetFromInvite(`  ${BOARD_LINK.split('#')[1]}\n`)).toEqual(target);
  });
});

describe('base64url', () => {
  it('encodes and decodes as @even/core does', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 80 }), (bytes) => {
        const text = b64urlEncode(bytes);
        expect(text).toBe(coreB64urlEncode(bytes));
        expect(b64urlDecode(text)).toEqual(coreB64urlDecode(text));
      }),
    );
    for (const bad of ['A', 'ab+c', 'ab/c', 'Zg==', 'AAAAA', 'a b']) {
      agree(
        () => b64urlDecode(bad),
        () => coreB64urlDecode(bad),
      );
    }
  });
});

describe('canonicalOrigin', () => {
  const CASES = [
    'https://Sync.Even.Appalaya.com:443/',
    'https://home.example.net:8443/even/',
    'HTTPS://EXAMPLE.COM',
    'https://example.com:0443',
    'https://example.com:08443',
    'https://example.com/Even/Sync',
    'https://example.com/v1.2/~me/a-b_c',
    '  https://example.com/even \n',
    'https://xn--bcher-kva.example',
    'https://192.0.2.10:8443/even',
    `https://${'a'.repeat(63)}.example`,
    'http://sync.even.appalaya.com',
    'sync.even.appalaya.com',
    'https:example.com',
    'https://user@example.com',
    'https://example.com/?x=1',
    'https://example.com#',
    'https://bücher.example',
    'https://',
    'https://example.com/even/..',
    'https://example.com//even',
    'https://example.com/%65ven',
    'https://example.com\\even',
    'https://example.com:0',
    'https://example.com:65536',
    'https://example.com:',
    'https://[::1]',
    'https://my_server.example.com',
    'https://example.com.',
    `https://${'a'.repeat(64)}.example`,
    'https://127.1',
    'https://0x7f.0.0.1',
    'https://192.0.2.256',
    '',
  ];

  it.each(CASES)('agrees with @even/core on %j', (input) => {
    agree(
      () => canonicalOrigin(input),
      () => coreCanonicalOrigin(input),
    );
  });

  it('agrees with @even/core on arbitrary URL-like text', () => {
    const piece = fc.constantFrom(
      'https://',
      'HTTPS://',
      'http://',
      'a',
      'Z',
      '0',
      '9',
      '.',
      '-',
      '_',
      ':',
      '443',
      '8443',
      '/',
      '//',
      '..',
      '%',
      '@',
      '?',
      '#',
      '~',
      ' ',
      'é',
      '[',
      ']',
      'xn--',
      'example',
      'com',
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (parts) => {
        const input = parts.join('');
        agree(
          () => canonicalOrigin(input),
          () => coreCanonicalOrigin(input),
        );
      }),
      { numRuns: 3000 },
    );
  });
});

describe('reading an invite', () => {
  it('returns the secret and canonical server that @even/core’s decodeInvite does', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        fc.constantFrom(...ORIGINS, 'HTTPS://Sync.Even.Appalaya.com:443/'),
        fc.option(fc.constantFrom('Banff 2026', 'Ski 🎿', 'x'.repeat(80)), { nil: undefined }),
        fc.option(fc.constantFrom('CAD', 'EUR'), { nil: undefined }),
        fc.boolean(),
        async (secret, server, g, cur, asLink) => {
          const code = encodeInvite(
            makeInvite(secret, server, { ...(g ? { g } : {}), ...(cur ? { cur } : {}) }),
          );
          const text = asLink ? inviteLink(code) : code;
          const core = decodeInvite(text);
          const read = await readInvite(text);
          expect(read.server).toBe(core.s);
          expect(b64urlEncode(read.secret)).toBe(core.k);
          const target = await targetFromInvite(text);
          expect(target.groupId).toBe(deriveServer(secret, core.s).groupId);
          expect(target.reportable).toBe(!core.s.slice('https://'.length).includes('/'));
        },
      ),
      { numRuns: 200 },
    );
  });

  const raw = (payload: unknown) => coreB64urlEncode(utf8Encode(JSON.stringify(payload)));
  const good = makeInvite(SECRET, DEFAULT_SERVER);

  it.each([
    ['empty', ''],
    ['not base64url', 'not an invite!'],
    ['impossible length', 'AAAAA'],
    ['not JSON', raw('x').slice(0, -1) + 'A'],
    ['a JSON array', raw([1])],
    ['a JSON string', raw('invite')],
    ['no version', raw({ s: good.s, k: good.k, h: good.h })],
    ['version 2', raw({ ...good, v: 2 })],
    ['version as text', raw({ ...good, v: '1' })],
    ['no server', raw({ v: 1, k: good.k, h: good.h })],
    ['http server', raw({ ...good, s: 'http://sync.even.appalaya.com' })],
    ['short secret', raw({ ...good, k: good.k.slice(0, 42) })],
    ['secret with padding', raw({ ...good, k: `${good.k.slice(0, 42)}=` })],
    ['wrong checksum', raw({ ...good, h: 'AAAAAA' })],
    ['group name too long', raw({ ...good, g: 'x'.repeat(81) })],
    ['group name not text', raw({ ...good, g: 5 })],
    ['lowercase currency', raw({ ...good, cur: 'cad' })],
    ['a link with nothing after #', 'https://even.appalaya.com/i#'],
    ['the board link cut short', BOARD_LINK.slice(0, -12)],
    ['a contact page fragment', 'https://even.appalaya.com/contact#purpose=report&id=abc'],
  ])('rejects %s with the same code as @even/core', async (_label, text) => {
    const code = await inviteErrorCode(text);
    expect(code).not.toBeNull();
    expect(code).toBe(coreErrorCode(text));
  });

  it('accepts what @even/core accepts: unknown fields, a trailing slash on the server', async () => {
    for (const text of [raw({ ...good, extra: true }), raw({ ...good, s: `${DEFAULT_SERVER}/` })]) {
      expect(await inviteErrorCode(text)).toBeNull();
      expect(coreErrorCode(text)).toBeNull();
    }
  });

  it('never holds a fresh secret longer than it needs: the target carries only the id and server', async () => {
    const secret = newSecret();
    const target = await targetFromInvite(encodeInvite(makeInvite(secret, DEFAULT_SERVER)));
    expect(Object.keys(target).sort()).toEqual(['appalaya', 'groupId', 'reportable', 'server']);
    expect(JSON.stringify(target)).not.toContain(coreB64urlEncode(secret));
  });
});

describe('the pasted link field', () => {
  it('is cleared the moment the link is taken, before the id is derived, and stays cleared after', async () => {
    const field = { value: BOARD_LINK };
    const pending = takeInvite(field);
    expect(field.value).toBe('');
    const target = await pending;
    expect(field.value).toBe('');
    expect(target).toEqual(await targetFromInvite(BOARD_LINK));
    expect(Object.keys(target ?? {}).sort()).toEqual([
      'appalaya',
      'groupId',
      'reportable',
      'server',
    ]);
    expect(JSON.stringify(target)).not.toContain(BOARD_LINK.split('#')[1]);
  });

  it('is cleared too when the text is not an invite, or is blank', async () => {
    const cut = { value: BOARD_LINK.slice(0, -6) };
    const reading = takeInvite(cut);
    expect(cut.value).toBe('');
    await expect(reading).rejects.toBeInstanceOf(InviteError);
    expect(cut.value).toBe('');

    const blank = { value: '  \n' };
    expect(await takeInvite(blank)).toBeNull();
    expect(blank.value).toBe('');
  });
});

describe('servers the form can and cannot take', () => {
  it('uses the Worker’s rule for an origin', () => {
    for (const value of [
      ...ORIGINS,
      'https://sync.even.appalaya.com/',
      'https://sync.even.appalaya.com:443',
      'http://sync.even.appalaya.com',
      'https://Sync.even.appalaya.com',
      'not a url',
    ]) {
      expect(isHttpsOrigin(value)).toBe(workerIsHttpsOrigin(value));
    }
  });

  it('labels a server by its host, port and path', () => {
    expect(serverLabel(DEFAULT_SERVER)).toBe('sync.even.appalaya.com');
    expect(serverLabel(HOME)).toBe('home.example.net:8443/even');
  });

  it('shortens an id as the app’s report sheet does', () => {
    expect(shortGroupId(VECTORS[DEFAULT_SERVER].groupId)).toBe('5440…PwTI');
    expect(shortGroupId('short')).toBe('short');
  });
});

describe('the fragment the app opens the page with', () => {
  const id = VECTORS[DEFAULT_SERVER].groupId;

  it('preselects help and feedback', () => {
    expect(readFragment('#purpose=help')).toEqual({ purpose: 'help', target: null });
    expect(readFragment('#purpose=feedback')).toEqual({ purpose: 'feedback', target: null });
    expect(readFragment('')).toEqual({ purpose: null, target: null });
    expect(readFragment('#purpose=spam')).toEqual({ purpose: null, target: null });
  });

  it('fills in a report on Appalaya’s server', () => {
    expect(readFragment(`#purpose=report&id=${id}&server=${DEFAULT_SERVER}`)).toEqual({
      purpose: 'report',
      target: { groupId: id, server: DEFAULT_SERVER, reportable: true, appalaya: true },
    });
    // Percent-encoded, as URLSearchParams would write it.
    expect(
      readFragment(`#purpose=report&id=${id}&server=${encodeURIComponent(DEFAULT_SERVER)}`).target
        ?.server,
    ).toBe(DEFAULT_SERVER);
  });

  it('fills in a report on another server, and one with a path it cannot take', () => {
    expect(
      readFragment(`#purpose=report&id=${id}&server=https://home.example.net:8443`).target,
    ).toEqual({
      groupId: id,
      server: 'https://home.example.net:8443',
      reportable: true,
      appalaya: false,
    });
    expect(readFragment(`#purpose=report&id=${id}&server=${HOME}`).target?.reportable).toBe(false);
  });

  it('ignores an id or server of the wrong shape', () => {
    expect(readFragment(`#purpose=report&id=${id.slice(1)}&server=${DEFAULT_SERVER}`)).toEqual({
      purpose: 'report',
      target: null,
    });
    expect(readFragment(`#purpose=report&id=${id}&server=http://x.example`).target).toBeNull();
    expect(readFragment(`#purpose=report&id=${id}`).target).toBeNull();
  });
});

describe('the request body', () => {
  const target = {
    groupId: VECTORS[DEFAULT_SERVER].groupId,
    server: DEFAULT_SERVER,
    reportable: true,
    appalaya: true,
  };
  const token = 'XXXX.DUMMY.TOKEN.XXXX';

  it('passes the Worker’s rules for each purpose, with and without an email', () => {
    for (const purpose of ['report', 'help', 'feedback'] as const) {
      for (const email of ['', '  ', 'you@example.com']) {
        const body = contactBody({
          purpose,
          message: purpose === 'report' ? reportMessage('Spam or scam', '') : 'It does not sync.',
          email,
          target: purpose === 'report' ? target : null,
          turnstileToken: token,
        });
        expect(validateContact(body)).toMatchObject({ ok: true });
        expect(Object.hasOwn(body, 'email')).toBe(email.trim() !== '');
        expect(Object.hasOwn(body, 'groupId')).toBe(purpose === 'report');
        expect(Object.hasOwn(body, 'server')).toBe(purpose === 'report');
      }
    }
  });

  it('refuses a report with no group, or one the form cannot take', () => {
    const base = {
      purpose: 'report',
      message: 'Reason: Spam or scam',
      email: '',
      turnstileToken: token,
    };
    expect(() => contactBody({ ...base, target: null })).toThrow(RangeError);
    expect(() =>
      contactBody({ ...base, target: { ...target, server: HOME, reportable: false } }),
    ).toThrow(RangeError);
  });

  it('writes a report message the Worker accepts, at the longest the page allows', () => {
    for (const reason of REASONS) {
      expect(reportMessage(reason, '')).toBe(`Reason: ${reason}`);
      expect(reportMessage(reason, '  In the group name.\n')).toBe(
        `Reason: ${reason}\n\nIn the group name.`,
      );
      const longest = reportMessage(reason, 'x'.repeat(4000 - REPORT_PREFIX_MAX));
      expect(longest.length).toBeLessThanOrEqual(4000);
      const body = contactBody({
        purpose: 'report',
        message: longest,
        target,
        turnstileToken: token,
      });
      expect(validateContact(body)).toMatchObject({ ok: true });
    }
  });

  it('strips what the Worker would refuse from typed text', () => {
    const message = reportMessage('Something else', 'a\u0000b\u000Bc\td\ud800');
    expect(message).toBe('Reason: Something else\n\nabc\td�');
    const body = contactBody({ purpose: 'report', message, target, turnstileToken: token });
    expect(validateContact(body)).toMatchObject({ ok: true });
  });
});

describe('what the page says after a POST', () => {
  it.each([
    [202, { ok: true }, 'sent'],
    [403, { ok: false, error: 'turnstile_failed' }, 'turnstile'],
    [429, { ok: false, error: 'rate_limited' }, 'rate_limited'],
    [503, { ok: false, error: 'unavailable' }, 'unavailable'],
    [502, { ok: false, error: 'send_failed' }, 'unavailable'],
    [500, { ok: false, error: 'internal' }, 'unavailable'],
    [400, { ok: false, error: 'invalid', field: 'email' }, 'unavailable'],
    [403, { ok: false, error: 'forbidden' }, 'unavailable'],
    [202, null, 'unavailable'],
  ])('%i %j → %s', (status, body, expected) => {
    expect(outcome(status, body)).toBe(expected);
  });
});
