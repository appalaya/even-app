/**
 * Cross-module tests: the paths an event really takes (keys → seal → store → open → parseEvent → reduce → balances),
 * and the rules two modules must agree on. Each module's own file tests it in isolation; this file tests the seams.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nets, simplify } from './balances.js';
import { LIMITS, PROTOCOL } from './constants.js';
import { b64urlDecode, utf8Encode } from './encoding.js';
import { EnvelopeError, envelopeShape, envelopeStoredSize, isEnvelope, open, seal } from './envelope.js';
import type { EnvelopeErrorCode } from './envelope.js';
import { canWrite, nextTs } from './hlc.js';
import { decodeInvite, encodeInvite, inviteLink, makeInvite, secretFromInvite } from './invite.js';
import { canonicalOrigin, deriveLocal, deriveServer, newSecret } from './keys.js';
import { formatMinor, splitEqual } from './money.js';
import { reduce } from './reduce.js';
import { parseEvent } from './schema.js';
import {
  CATEGORIES,
  type Envelope,
  type Event,
  type EventOf,
  type EventPayload,
  type EventType,
  type GroupState,
  type LogEntry,
} from './types.js';

// ---------- fixtures (kept local: test files do not import each other) ----------

const T0 = 1_767_225_600_000; // 2026-01-01T00:00Z
const MINUTE = 60_000;
const pad = (stem: string): string => stem.padEnd(22, '_');
const localIdOf = (stem: string): string => stem.padEnd(43, 'x');

const MAYA = pad('maya');
const JORDAN = pad('jordan');
const NATHAN = pad('nathan');
const DEV_MAYA = pad('dev-maya');
const DEV_JORDAN = pad('dev-jordan');
const DEV_NATHAN = pad('dev-nathan');
const DINNER = pad('dinner');
const GAS = pad('gas');
const PAY1 = pad('pay1');

const SERVER_A = PROTOCOL.defaultServer;
const SERVER_B = 'https://home.example.net:8443/even';

/** Maps → entry arrays, so strict equality also checks Map insertion order. */
function canon(s: GroupState): unknown {
  return {
    ...s,
    members: [...s.members],
    expenses: [...s.expenses],
    deletedExpenses: [...s.deletedExpenses],
    payments: [...s.payments],
    totalsByCategory: [...s.totalsByCategory],
  };
}

function expectEnvelopeError(fn: () => unknown, code: EnvelopeErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(EnvelopeError);
  expect((caught as EnvelopeError).code).toBe(code);
}

/** What SQLite and HTTP do to an envelope: a JSON round trip. */
const stored = (env: Envelope): Envelope => JSON.parse(JSON.stringify(env)) as Envelope;

/** One valid body per event type (the schema.test.ts fixtures, re-declared). */
const base = { sv: 1, ts: T0 + 1234, at: T0 + 1500, by: MAYA, dev: DEV_MAYA } as const;
const FIXTURES: { [T in EventType]: EventOf<T> } = {
  'group.created': { ...base, type: 'group.created', name: 'Banff 2026', currency: 'CAD' },
  'group.renamed': { ...base, type: 'group.renamed', name: 'Banff trip' },
  'group.closed': { ...base, type: 'group.closed', reason: 'rotated', to: localIdOf('newgroup') },
  'group.rotated': { ...base, type: 'group.rotated', from: localIdOf('oldgroup') },
  'group.moved': { ...base, type: 'group.moved', server: SERVER_B },
  'group.archived': { ...base, type: 'group.archived' },
  'group.unarchived': { ...base, type: 'group.unarchived' },
  'member.added': { ...base, type: 'member.added', member: { id: NATHAN, name: 'Nathan', emoji: '🏔️' } },
  'member.updated': { ...base, type: 'member.updated', id: NATHAN, changes: { name: 'Nate', emoji: null } },
  'member.claimed': { ...base, type: 'member.claimed', id: MAYA },
  'member.archived': { ...base, type: 'member.archived', id: NATHAN },
  'member.unarchived': { ...base, type: 'member.unarchived', id: NATHAN },
  'member.done': { ...base, type: 'member.done', id: MAYA },
  'member.undone': { ...base, type: 'member.undone', id: MAYA },
  'expense.added': {
    ...base,
    type: 'expense.added',
    expense: {
      id: DINNER,
      title: 'Dinner at Nourish',
      amount: 12_345,
      currency: 'CAD',
      paidBy: MAYA,
      date: '2026-02-14',
      category: 'food',
      note: 'Birthday',
      split: { [MAYA]: 6_173, [NATHAN]: 6_172 },
    },
  },
  'expense.updated': {
    ...base,
    type: 'expense.updated',
    id: DINNER,
    changes: { title: 'Dinner', amount: 10_000, split: { [MAYA]: 5_000, [NATHAN]: 5_000 } },
  },
  'expense.deleted': { ...base, type: 'expense.deleted', id: DINNER },
  'payment.added': {
    ...base,
    type: 'payment.added',
    payment: { id: PAY1, from: NATHAN, to: MAYA, amount: 6_172, currency: 'CAD', date: '2026-02-15', note: 'e-transfer' },
  },
  'payment.deleted': { ...base, type: 'payment.deleted', id: PAY1 },
};

/**
 * A group as the app runs it: every write takes its ts from `nextTs` behind the `canWrite` gate, is sealed for the
 * server's group id, stored as JSON, and read back through envelopeShape → open → parseEvent before the reducer sees it.
 */
function makeGroup(server: string = SERVER_A) {
  const secret = newSecret();
  const { encryptionKey: key, localId } = deriveLocal(secret);
  const { groupId } = deriveServer(secret, server);
  const log: LogEntry[] = [];
  const envelopes: Envelope[] = [];
  let clock = T0;

  function write(by: string, dev: string, payload: EventPayload, targetId?: string): Event {
    clock += MINUTE;
    expect(canWrite(clock, log, targetId)).toBe(true);
    const body = { sv: 1, ts: nextTs(clock, log, targetId), at: clock, by, dev, ...payload } as Event;
    const env = stored(seal({ key, groupId, body }));
    expect(envelopeShape(env)).toEqual({ ok: true, v: 1 });
    const event = parseEvent(open({ key, groupId, envelope: env }));
    expect(event).toEqual(body);
    if (event === null) throw new Error('unreachable');
    log.push({ id: env.id, event });
    envelopes.push(env);
    return event;
  }

  /** Reads envelopes back the way a joining phone would (any order), returning the reducer's input. */
  function readAll(envs: readonly Envelope[]): LogEntry[] {
    return envs.map((env) => {
      const event = parseEvent(open({ key, groupId, envelope: env }));
      if (event === null) throw new Error('an envelope failed validation');
      return { id: env.id, event };
    });
  }

  return { secret, key, localId, groupId, log, envelopes, write, readAll };
}

const cad = (minor: number): string => formatMinor(minor, 'CAD', 'en-US');

/**
 * The Banff trip (the walkthrough in reduce.test.ts / balances.test.ts), written through the real pipeline. Maya
 * creates the group with the documented create order (her member.added and member.claimed before group.created),
 * adds Jordan and Nathan; Jordan joins from his phone; dinner and gas are split equally with splitEqual; Maya edits
 * dinner from 90.00 to 96.00; Nathan pays Jordan 8.00.
 */
function banff(withPayment = true) {
  const g = makeGroup();
  g.write(MAYA, DEV_MAYA, { type: 'member.added', member: { id: MAYA, name: 'Maya' } });
  g.write(MAYA, DEV_MAYA, { type: 'member.claimed', id: MAYA }, MAYA);
  g.write(MAYA, DEV_MAYA, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
  g.write(MAYA, DEV_MAYA, { type: 'member.added', member: { id: JORDAN, name: 'Jordan' } });
  g.write(MAYA, DEV_MAYA, { type: 'member.added', member: { id: NATHAN, name: 'Nathan' } });
  g.write(JORDAN, DEV_JORDAN, { type: 'member.claimed', id: JORDAN }, JORDAN);
  const everyone = [MAYA, JORDAN, NATHAN];
  g.write(MAYA, DEV_MAYA, {
    type: 'expense.added',
    expense: { id: DINNER, title: 'Dinner', amount: 9000, currency: 'CAD', paidBy: MAYA, date: '2026-02-14', category: 'food', split: splitEqual(9000, everyone, DINNER) },
  });
  g.write(JORDAN, DEV_JORDAN, {
    type: 'expense.added',
    expense: { id: GAS, title: 'Gas', amount: 6000, currency: 'CAD', paidBy: JORDAN, date: '2026-02-14', category: 'fuel', split: splitEqual(6000, everyone, GAS) },
  });
  g.write(MAYA, DEV_MAYA, { type: 'expense.updated', id: DINNER, changes: { amount: 9600, split: splitEqual(9600, everyone, DINNER) } }, DINNER);
  if (withPayment) {
    g.write(NATHAN, DEV_NATHAN, {
      type: 'payment.added',
      payment: { id: PAY1, from: NATHAN, to: JORDAN, amount: 800, currency: 'CAD', date: '2026-02-16' },
    });
  }
  return g;
}

// ---------- round trips ----------

describe('integration: full round trip', () => {
  it('newSecret → deriveLocal → seal → isEnvelope → open → parseEvent equals the event, and reduce yields the expense', () => {
    const secret = newSecret();
    const { encryptionKey, localId } = deriveLocal(secret);
    expect(localId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { groupId } = deriveServer(secret, SERVER_A);
    const event = FIXTURES['expense.added'];

    const env = stored(seal({ key: encryptionKey, groupId, body: event }));
    expect(isEnvelope(env)).toBe(true);
    const parsed = parseEvent(open({ key: encryptionKey, groupId, envelope: env }));
    expect(parsed).toEqual(event);
    if (parsed === null) return;

    const state = reduce([{ id: env.id, event: parsed }]);
    expect(state.expenses.get(DINNER)).toEqual({
      ...event.expense,
      addedBy: MAYA,
      addedAt: event.at,
      updatedAt: event.at,
      history: [{ eventId: env.id, ts: event.ts, at: event.at, by: MAYA, dev: DEV_MAYA, kind: 'added', snapshot: event.expense }],
    });
  });

  it.each(Object.keys(FIXTURES) as EventType[])('parseEvent(open(seal(x))) equals x for %s', (type) => {
    const secret = newSecret();
    const { encryptionKey: key } = deriveLocal(secret);
    const { groupId } = deriveServer(secret, SERVER_A);
    const x = FIXTURES[type];
    expect(parseEvent(x)).toEqual(x); // the fixture is itself valid
    expect(parseEvent(open({ key, groupId, envelope: stored(seal({ key, groupId, body: x })) }))).toEqual(x);
  });
});

describe('integration: per-server keys and AAD binding', () => {
  const secret = newSecret();
  const { encryptionKey: key, localId } = deriveLocal(secret);
  const originA = canonicalOrigin('HTTPS://Sync.Even.Appalaya.com:443/');
  const originB = canonicalOrigin(`${SERVER_B}/`);
  const a = deriveServer(secret, originA);
  const b = deriveServer(secret, originB);
  const body = FIXTURES['expense.added'];

  it('one secret gives one localId but a different groupId per canonical origin', () => {
    expect([originA, originB]).toEqual([SERVER_A, SERVER_B]);
    expect(a.groupId).not.toBe(b.groupId);
    expect(deriveLocal(secret).localId).toBe(localId);
  });

  it('an envelope sealed for A does not open for B (undecryptable), and re-sealing for B with the same id does', () => {
    const envA = stored(seal({ key, groupId: a.groupId, body }));
    expectEnvelopeError(() => open({ key, groupId: b.groupId, envelope: envA }), 'undecryptable');

    // Moving a group (PROTOCOL §8.3): same envelope id, same body, fresh nonce, B's group id in the AAD.
    const bodyA = parseEvent(open({ key, groupId: a.groupId, envelope: envA }));
    expect(bodyA).not.toBeNull();
    if (bodyA === null) return;
    const envB = stored(seal({ key, groupId: b.groupId, body: bodyA, id: envA.id }));
    expect(envB.id).toBe(envA.id);
    expect(envB.n).not.toBe(envA.n);
    expect(parseEvent(open({ key, groupId: b.groupId, envelope: envB }))).toEqual(body);
    expectEnvelopeError(() => open({ key, groupId: a.groupId, envelope: envB }), 'undecryptable');
  });
});

describe('integration: invite round trip through keys', () => {
  it('makeInvite → encodeInvite → inviteLink → decodeInvite → secretFromInvite recovers the secret and every derived id', () => {
    const secret = newSecret();
    const invite = makeInvite(secret, 'HTTPS://Sync.Even.Appalaya.com:443/', { g: 'Banff 2026', cur: 'CAD' });
    const link = inviteLink(encodeInvite(invite));
    expect(link.startsWith(`${PROTOCOL.inviteHost}${PROTOCOL.invitePath}#`)).toBe(true);

    const decoded = decodeInvite(link);
    const joined = secretFromInvite(decoded);
    expect(joined).toEqual(secret);
    expect(deriveLocal(joined).localId).toBe(deriveLocal(secret).localId);
    // The invite's `s` is already canonical, so it feeds deriveServer and group.moved directly.
    expect(decoded.s).toBe(SERVER_A);
    expect(deriveServer(joined, decoded.s)).toEqual(deriveServer(secret, SERVER_A));
    expect(parseEvent({ ...FIXTURES['group.moved'], server: decoded.s })).not.toBeNull();
    // The invite's group name is one group.created would accept.
    expect(parseEvent({ ...FIXTURES['group.created'], name: decoded.g, currency: decoded.cur })).not.toBeNull();

    // And the joiner can read what the creator wrote.
    const creator = deriveLocal(secret);
    const env = seal({ key: creator.encryptionKey, groupId: deriveServer(secret, SERVER_A).groupId, body: FIXTURES['group.created'] });
    const joiner = deriveLocal(joined);
    expect(parseEvent(open({ key: joiner.encryptionKey, groupId: deriveServer(joined, decoded.s).groupId, envelope: env }))).toEqual(
      FIXTURES['group.created'],
    );
  });
});

// ---------- canonical origin: one definition across keys, schema, invite ----------

describe('integration: canonical origin agreement', () => {
  const label = fc.stringMatching(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,14}[a-zA-Z0-9])?$/);
  const dnsHost = fc
    .array(label, { minLength: 1, maxLength: 4 })
    .chain((labels) => fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,5}$/).map((tld) => [...labels, tld].join('.')));
  const ipv4 = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((o) => o.join('.'));
  const port = fc.oneof(
    fc.constant(''),
    fc.constant(':443'),
    fc.constant(':0443'),
    fc.integer({ min: 1, max: 65535 }).map((p) => `:${p}`),
    fc.integer({ min: 1, max: 9999 }).map((p) => `:0${p}`),
  );
  const segment = fc.stringMatching(/^[A-Za-z0-9\-._~!$&'()*+,;=:@]{1,12}$/).filter((s) => s !== '.' && s !== '..');
  const path = fc.tuple(fc.array(segment, { maxLength: 3 }), fc.boolean()).map(([segs, slash]) =>
    segs.length === 0 ? (slash ? '/' : '') : `/${segs.join('/')}${slash ? '/' : ''}`,
  );
  const scheme = fc.constantFrom('https', 'HTTPS', 'Https', 'hTTps');
  const space = fc.constantFrom('', ' ', '\n', '\t ');
  const url = fc
    .tuple(space, scheme, fc.oneof(dnsHost, ipv4), port, path, space)
    .map(([lead, s, host, p, pth, trail]) => `${lead}${s}://${host}${p}${pth}${trail}`);

  const accepts = (origin: string): void => {
    expect(canonicalOrigin(origin)).toBe(origin); // idempotent
    expect(parseEvent({ ...FIXTURES['group.moved'], server: origin })).not.toBeNull();
    expect(makeInvite(new Uint8Array(32).fill(7), origin).s).toBe(origin);
    expect(() => deriveServer(new Uint8Array(32).fill(7), origin)).not.toThrow();
  };

  it('every origin canonicalOrigin produces is accepted by group.moved, makeInvite and deriveServer (property)', () => {
    let produced = 0;
    fc.assert(
      fc.property(url, (input) => {
        let origin: string;
        try {
          origin = canonicalOrigin(input);
        } catch {
          return; // not a server URL; nothing to agree on
        }
        produced++;
        accepts(origin);
        expect(parseEvent({ ...FIXTURES['group.moved'], server: input })).toEqual(
          input === origin ? { ...FIXTURES['group.moved'], server: input } : null,
        );
      }),
      { numRuns: 2_000 },
    );
    expect(produced).toBeGreaterThan(1_000); // the generator mostly produces real server URLs
  });

  it.each([
    'https://Sync.Even.Appalaya.com:443/',
    'https://home.example.net:8443/even/',
    'https://example.com:08443',
    'https://example.com/v1.2/~me/a-b_c',
    "https://example.com/!$&'()*+,;=:@",
    'https://xn--bcher-kva.example',
    'https://localhost:8443',
    'https://192.0.2.10:8443/even',
    `https://${'a'.repeat(63)}.example`,
  ])('accepts the canonical form of %j everywhere', (input) => {
    accepts(canonicalOrigin(input));
  });
});

// ---------- the size budget (design.md "Rounding": "an expense never exceeds it") ----------

describe('integration: size budget of the largest valid expense', () => {
  /**
   * Split digits: amount ≤ 10^12 spread over 50 members maximises total digits with 5 twelve-digit shares (10^11 each)
   * and 45 eleven-digit shares (k twelve-digit shares need 10^11·k + 10^10·(50 − k) ≤ 10^12, so k ≤ 5): 555 digits.
   */
  function widestSplit(): Record<string, number> {
    const split: Record<string, number> = {};
    for (let i = 0; i < LIMITS.membersMax; i++) {
      split[pad(`member-${i}`)] = i < 5 ? 100_000_000_000 : i < LIMITS.membersMax - 1 ? 11_111_111_111 : 11_111_111_116;
    }
    return split;
  }

  const longestCategory = [...CATEGORIES].sort((x, y) => y.length - x.length)[0] ?? 'other';

  function largestExpenseAdded(ch: string): EventOf<'expense.added'> {
    return {
      sv: 1,
      ts: LIMITS.tsMax - 1,
      at: LIMITS.tsMax - 1,
      by: pad('by'),
      dev: pad('dev'),
      type: 'expense.added',
      expense: {
        id: pad('expense'),
        title: ch.repeat(LIMITS.titleMax),
        amount: LIMITS.amountMax,
        currency: 'CAD',
        paidBy: pad('payer'),
        date: '2026-02-14',
        category: longestCategory,
        note: ch.repeat(LIMITS.noteMax),
        split: widestSplit(),
      },
    };
  }

  function largestExpenseUpdated(ch: string): EventOf<'expense.updated'> {
    const { expense } = largestExpenseAdded(ch);
    const { id, currency, ...changes } = expense;
    void currency;
    return { sv: 1, ts: LIMITS.tsMax - 1, at: LIMITS.tsMax - 1, by: pad('by'), dev: pad('dev'), type: 'expense.updated', id, changes };
  }

  const jsonBytes = (value: unknown): number => utf8Encode(JSON.stringify(value)).length;

  it('no code point costs more than 6 bytes in UTF-8(JSON.stringify(…)) — the escaped controls and lone surrogates', () => {
    let max = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const n = jsonBytes(String.fromCodePoint(cp)) - 2;
      if (n > max) max = n;
    }
    expect(max).toBe(6);
    expect(jsonBytes('\u0001') - 2).toBe(6);
    expect(jsonBytes('\ud800') - 2).toBe(6);
    expect(jsonBytes('😀') - 2).toBe(4);
  });

  it.each([
    ['U+0001 (JSON-escaped, 6 bytes each: the true worst case)', '\u0001', 5656],
    ['emoji (4 bytes each)', '😀', 4496],
    ['CJK Extension B (4 bytes each)', '𠀀', 4496],
  ])('the largest expense.added with a title and note of %s fits in maxPlaintextBytes', (_label, ch, expectedBytes) => {
    const event = largestExpenseAdded(ch);
    expect([...event.expense.title]).toHaveLength(LIMITS.titleMax);
    expect([...(event.expense.note ?? '')]).toHaveLength(LIMITS.noteMax);
    expect(Object.keys(event.expense.split)).toHaveLength(LIMITS.membersMax);
    expect(parseEvent(event)).toEqual(event); // valid, and nothing was stripped

    const bytes = jsonBytes(event);
    expect(bytes).toBe(expectedBytes);
    expect(bytes).toBeLessThanOrEqual(LIMITS.maxPlaintextBytes);

    const secret = newSecret();
    const { encryptionKey: key } = deriveLocal(secret);
    const { groupId } = deriveServer(secret, SERVER_A);
    const env = seal({ key, groupId, body: event });
    const cipherBytes = b64urlDecode(env.c).length;
    expect(cipherBytes % LIMITS.padBlock).toBe(0);
    expect(cipherBytes).toBe(Math.ceil((bytes + 1 + LIMITS.tagLength) / LIMITS.padBlock) * LIMITS.padBlock);
    expect(cipherBytes).toBeLessThanOrEqual(LIMITS.maxEventBytes);
    expect(envelopeStoredSize(env)).toBeLessThanOrEqual(LIMITS.maxEventBytes + LIMITS.envelopeOverheadBytes);
    expect(parseEvent(open({ key, groupId, envelope: stored(env) }))).toEqual(event);
  });

  it('the largest expense.updated (every field changed) fits too', () => {
    const event = largestExpenseUpdated('\u0001');
    expect(parseEvent(event)).toEqual(event);
    expect(jsonBytes(event)).toBeLessThanOrEqual(LIMITS.maxPlaintextBytes);
    expect(jsonBytes(event)).toBeLessThan(jsonBytes(largestExpenseAdded('\u0001')));
  });
});

// ---------- determinism across modules ----------

describe('integration: determinism', () => {
  /** Banff plus every other event type, written through the pipeline. */
  function kitchenSink() {
    const g = banff();
    g.write(JORDAN, DEV_JORDAN, { type: 'group.renamed', name: 'Banff & Jasper' });
    g.write(NATHAN, DEV_NATHAN, { type: 'member.updated', id: NATHAN, changes: { emoji: '🐻' } }, NATHAN);
    g.write(MAYA, DEV_MAYA, { type: 'member.archived', id: JORDAN }, JORDAN);
    g.write(MAYA, DEV_MAYA, { type: 'member.unarchived', id: JORDAN }, JORDAN);
    g.write(JORDAN, DEV_JORDAN, { type: 'member.done', id: JORDAN }, JORDAN);
    g.write(MAYA, DEV_MAYA, { type: 'member.done', id: MAYA }, MAYA);
    g.write(MAYA, DEV_MAYA, { type: 'member.undone', id: MAYA }, MAYA);
    g.write(MAYA, DEV_MAYA, { type: 'group.archived' });
    g.write(JORDAN, DEV_JORDAN, { type: 'group.unarchived' });
    g.write(JORDAN, DEV_JORDAN, { type: 'expense.updated', id: GAS, changes: { title: 'Fuel', note: 'Esso' } }, GAS);
    g.write(NATHAN, DEV_NATHAN, { type: 'payment.deleted', id: PAY1 }, PAY1);
    g.write(MAYA, DEV_MAYA, { type: 'expense.deleted', id: DINNER }, DINNER);
    g.write(MAYA, DEV_MAYA, { type: 'group.moved', server: SERVER_B });
    g.write(MAYA, DEV_MAYA, { type: 'group.rotated', from: localIdOf('previous') });
    g.write(MAYA, DEV_MAYA, { type: 'group.closed', reason: 'rotated', to: localIdOf('next') });
    return g;
  }

  it('covers every event type', () => {
    expect(new Set(kitchenSink().log.map((e) => e.event.type)).size).toBe(19);
  });

  it('reduce of envelopes opened in any order equals reduce of the original log', () => {
    const g = kitchenSink();
    const format = (n: number): string => cad(n);
    const expected = canon(reduce(g.log, { format }));
    fc.assert(
      fc.property(fc.shuffledSubarray(g.envelopes, { minLength: g.envelopes.length, maxLength: g.envelopes.length }), (envs) => {
        expect(canon(reduce(g.readAll(envs), { format }))).toStrictEqual(expected);
      }),
      { numRuns: 100 },
    );
    // Re-sealed with fresh nonces (a move to another server), the state is still identical.
    const moved = deriveServer(g.secret, SERVER_B).groupId;
    const resealed = g.envelopes.map((env) => stored(seal({ key: g.key, groupId: moved, body: g.log.find((e) => e.id === env.id)!.event, id: env.id })));
    const readMoved = resealed.reverse().map((env) => ({ id: env.id, event: parseEvent(open({ key: g.key, groupId: moved, envelope: env }))! }));
    expect(canon(reduce(readMoved, { format }))).toStrictEqual(expected);
  });
});

// ---------- the Banff walkthrough, end to end ----------

describe('integration: Banff walkthrough with formatMinor bound to CAD', () => {
  it('formats CAD with the ISO exponent', () => {
    expect(cad(9000).replace(/\s/g, ' ')).toMatch(/^CA\$ ?90\.00$/);
  });

  it('before the payment: Nathan owes Maya 44.00 and Jordan 8.00', () => {
    const s = reduce(banff(false).log, { format: cad });
    expect([...nets(s)]).toEqual([
      [MAYA, 4400],
      [JORDAN, 800],
      [NATHAN, -5200],
    ]);
    expect(simplify(nets(s))).toEqual([
      { from: NATHAN, to: MAYA, amount: 4400 },
      { from: NATHAN, to: JORDAN, amount: 800 },
    ]);
  });

  it('after Nathan pays Jordan 8.00, the settle list is one transfer, and the feed reads in formatted money', () => {
    const g = banff();
    const s = reduce(g.log, { format: cad });
    expect(s.name).toBe('Banff 2026');
    expect(s.currency).toBe('CAD');
    expect(s.flagged).toEqual([]);
    expect([...s.totalsByCategory]).toEqual([
      ['food', 9600],
      ['fuel', 6000],
    ]);
    expect(simplify(nets(s))).toEqual([{ from: NATHAN, to: MAYA, amount: 4400 }]);
    expect(s.members.get(MAYA)?.devices).toEqual([DEV_MAYA]);
    expect(s.members.get(JORDAN)?.devices).toEqual([DEV_JORDAN]);

    expect(s.activity.map((a) => a.summary)).toEqual([
      'Maya joined',
      'Maya created the group',
      'Maya added Jordan',
      'Maya added Nathan',
      'Jordan joined',
      `Maya added Dinner · ${cad(9000)}`,
      `Jordan added Gas · ${cad(6000)}`,
      `Maya changed Dinner from ${cad(9000)} to ${cad(9600)}`,
      `Nathan paid Jordan ${cad(800)}`,
    ]);
    expect(s.activity.at(-1)?.summary.replace(/\s/g, ' ')).toMatch(/^Nathan paid Jordan CA\$ ?8\.00$/);
    // The activity item carries the envelope id, device and wall clock the feed shows.
    expect(s.activity.at(-1)).toMatchObject({ eventId: g.envelopes.at(-1)?.id, dev: DEV_NATHAN, by: NATHAN });
  });

  it('a group whose currency formatMinor does not know still reduces (format falls back, never throws)', () => {
    const g = makeGroup();
    g.write(MAYA, DEV_MAYA, { type: 'member.added', member: { id: MAYA, name: 'Maya' } });
    g.write(MAYA, DEV_MAYA, { type: 'group.created', name: 'Odd', currency: 'XYZ' }); // shape-valid, not in ISO 4217
    g.write(MAYA, DEV_MAYA, {
      type: 'expense.added',
      expense: { id: DINNER, title: 'Dinner', amount: 9000, currency: 'XYZ', paidBy: MAYA, date: '2026-02-14', category: 'food', split: { [MAYA]: 9000 } },
    });
    const s = reduce(g.log, { format: (n) => formatMinor(n, 'XYZ') });
    expect(s.activity.at(-1)?.summary).toBe('Maya added Dinner · 9000');
  });
});

// ---------- the write gate agrees with the validator ----------

describe('integration: canWrite agrees with parseEvent at the top of the ts range', () => {
  it('an edit canWrite allows validates; one it refuses would not', () => {
    const now = T0 + MINUTE;
    const add = (id: string, ts: number): LogEntry => ({
      id: pad(`env-${id}`),
      event: { ...FIXTURES['expense.added'], ts, expense: { ...FIXTURES['expense.added'].expense, id } },
    });
    const edit = (id: string, log: LogEntry[]): unknown => ({ ...FIXTURES['expense.deleted'], id, ts: nextTs(now, log, id), at: now });

    const almost = [add(DINNER, LIMITS.tsMax - 2)];
    expect(canWrite(now, almost, DINNER)).toBe(true);
    expect(parseEvent(edit(DINNER, almost))).not.toBeNull();

    const top = [add(GAS, LIMITS.tsMax - 1)];
    expect(canWrite(now, top, GAS)).toBe(false);
    expect(parseEvent(edit(GAS, top))).toBeNull();
  });
});
