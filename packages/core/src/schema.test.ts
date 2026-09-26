import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, LIMITS } from './constants.js';
import { isGroupName, isIsoDate, isSingleEmoji, parseEvent } from './schema.js';
import type { EventType } from './types.js';

// ---------- Fixtures ----------

const id = (seed: string): string => seed.padEnd(22, '0');
const localId = (seed: string): string => seed.padEnd(43, 'x');

const MAYA = id('maya');
const NATHAN = id('nathan');
const PRIYA = id('priya');
const EXPENSE = id('expense1');
const PAYMENT = id('payment1');

const base = { sv: 1, ts: 1_750_000_000_000, at: 1_750_000_000_123, by: MAYA, dev: id('device1') } as const;

type Json = Record<string, unknown>;

const FIXTURES: Record<EventType, Json> = {
  'group.created': { ...base, type: 'group.created', name: 'Banff 2026', currency: 'CAD' },
  'group.renamed': { ...base, type: 'group.renamed', name: 'Banff trip' },
  'group.closed': { ...base, type: 'group.closed', reason: 'rotated', to: localId('newgroup') },
  'group.rotated': { ...base, type: 'group.rotated', from: localId('oldgroup') },
  'group.moved': { ...base, type: 'group.moved', server: 'https://home.example.net:8443/even' },
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
      id: EXPENSE,
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
    id: EXPENSE,
    changes: { title: 'Dinner', amount: 10_000, split: { [MAYA]: 5_000, [NATHAN]: 5_000 } },
  },
  'expense.deleted': { ...base, type: 'expense.deleted', id: EXPENSE },
  'payment.added': {
    ...base,
    type: 'payment.added',
    payment: { id: PAYMENT, from: NATHAN, to: MAYA, amount: 6_172, currency: 'CAD', date: '2026-02-15', note: 'e-transfer' },
  },
  'payment.deleted': { ...base, type: 'payment.deleted', id: PAYMENT },
};

function fixture(type: EventType): Json {
  return structuredClone(FIXTURES[type]);
}

/** Clone a fixture, apply `edit`, and parse it. */
function parseEdited(type: EventType, edit: (e: Json) => void): unknown {
  const e = fixture(type);
  edit(e);
  return parseEvent(e);
}

function withExpense(edit: (x: Json) => void): unknown {
  return parseEdited('expense.added', (e) => edit(e.expense as Json));
}
function withPayment(edit: (x: Json) => void): unknown {
  return parseEdited('payment.added', (e) => edit(e.payment as Json));
}
function withChanges(changes: Json): unknown {
  return parseEdited('expense.updated', (e) => {
    e.changes = changes;
  });
}
function withMemberChanges(changes: Json): unknown {
  return parseEdited('member.updated', (e) => {
    e.changes = changes;
  });
}
function manyKeys(n: number, each: number): Record<string, number> {
  const split: Record<string, number> = {};
  for (let i = 0; i < n; i++) split[id(`m${String(i).padStart(3, '0')}x`)] = each;
  return split;
}

// ---------- Round-trip ----------

describe('parseEvent: valid fixtures', () => {
  it('has a fixture for every event type', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it.each(EVENT_TYPES)('%s round-trips as a fresh equal object', (type) => {
    const input = fixture(type);
    const parsed = parseEvent(input);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(FIXTURES[type]);
    expect(parsed).not.toBe(input);
    expect(input).toEqual(FIXTURES[type]); // input not mutated
  });

  it('accepts optional fields when absent', () => {
    expect(parseEdited('group.closed', (e) => delete e.to)).not.toBeNull();
    expect(parseEdited('member.added', (e) => delete (e.member as Json).emoji)).not.toBeNull();
    expect(withExpense((x) => delete x.note)).not.toBeNull();
    expect(withPayment((x) => delete x.note)).not.toBeNull();
  });

  it('accepts an event built from JSON text', () => {
    expect(parseEvent(JSON.parse(JSON.stringify(FIXTURES['expense.added'])))).toEqual(FIXTURES['expense.added']);
  });

  it('accepts a body with a null prototype', () => {
    const e = Object.assign(Object.create(null) as Json, FIXTURES['member.claimed']);
    expect(parseEvent(e)).toEqual(FIXTURES['member.claimed']);
  });
});

// ---------- Stripping vs strict ----------

describe('parseEvent: unknown fields', () => {
  it('strips an unknown top-level field', () => {
    const parsed = parseEdited('group.renamed', (e) => {
      e.future = { anything: true };
    });
    expect(parsed).toEqual(FIXTURES['group.renamed']);
    expect(parsed).not.toHaveProperty('future');
  });

  it('strips unknown fields inside member, expense, and payment records', () => {
    expect(parseEdited('member.added', (e) => ((e.member as Json).pronouns = 'she'))).toEqual(FIXTURES['member.added']);
    expect(withExpense((x) => (x.receipt = 'abc'))).toEqual(FIXTURES['expense.added']);
    expect(withPayment((x) => (x.method = 'cash'))).toEqual(FIXTURES['payment.added']);
  });

  it('does not let a JSON __proto__ key through', () => {
    const text = JSON.stringify(FIXTURES['member.claimed']).replace('{', '{"__proto__":{"polluted":1},');
    const parsed = parseEvent(JSON.parse(text));
    expect(parsed).toEqual(FIXTURES['member.claimed']);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Json).polluted).toBeUndefined();
  });

  it('rejects an unknown field inside expense.updated.changes', () => {
    expect(withChanges({ title: 'Dinner', bogus: 1 })).toBeNull();
  });

  it('rejects an unknown field inside member.updated.changes', () => {
    expect(withMemberChanges({ name: 'Nate', bogus: 1 })).toBeNull();
  });
});

// ---------- Base fields ----------

describe('parseEvent: base fields', () => {
  it.each([
    ['sv 2', (e: Json) => (e.sv = 2)],
    ['sv 0', (e: Json) => (e.sv = 0)],
    ['sv as string', (e: Json) => (e.sv = '1')],
    ['missing sv', (e: Json) => delete e.sv],
    ['unknown type', (e: Json) => (e.type = 'group.deleted')],
    ['missing type', (e: Json) => delete e.type],
    ['type of another shape', (e: Json) => (e.type = 'member.added')],
    ['ts below tsMin', (e: Json) => (e.ts = LIMITS.tsMin - 1)],
    ['ts at tsMax', (e: Json) => (e.ts = LIMITS.tsMax)],
    ['ts non-integer', (e: Json) => (e.ts = base.ts + 0.5)],
    ['ts as string', (e: Json) => (e.ts = String(base.ts))],
    ['ts NaN', (e: Json) => (e.ts = Number.NaN)],
    ['ts Infinity', (e: Json) => (e.ts = Number.POSITIVE_INFINITY)],
    ['at below tsMin', (e: Json) => (e.at = 0)],
    ['at at tsMax', (e: Json) => (e.at = LIMITS.tsMax)],
    ['at non-integer', (e: Json) => (e.at = base.at + 0.1)],
    ['missing at', (e: Json) => delete e.at],
    ['by 21 chars', (e: Json) => (e.by = MAYA.slice(1))],
    ['by 23 chars', (e: Json) => (e.by = `${MAYA}A`)],
    ['by with +', (e: Json) => (e.by = `+${MAYA.slice(1)}`)],
    ['by with /', (e: Json) => (e.by = `/${MAYA.slice(1)}`)],
    ['by with =', (e: Json) => (e.by = `${MAYA.slice(1)}=`)],
    ['dev 21 chars', (e: Json) => (e.dev = base.dev.slice(1))],
    ['dev non-ASCII', (e: Json) => (e.dev = `é${base.dev.slice(1)}`)],
    ['missing dev', (e: Json) => delete e.dev],
  ])('rejects %s', (_name, edit) => {
    expect(parseEdited('member.claimed', edit)).toBeNull();
  });

  it('accepts ts and at at the edges of the range', () => {
    expect(parseEdited('member.claimed', (e) => ((e.ts = LIMITS.tsMin), (e.at = LIMITS.tsMin)))).not.toBeNull();
    expect(parseEdited('member.claimed', (e) => ((e.ts = LIMITS.tsMax - 1), (e.at = LIMITS.tsMax - 1)))).not.toBeNull();
  });

  it('accepts every base64url character in ids', () => {
    expect(parseEdited('member.claimed', (e) => (e.id = 'Az09_-Az09_-Az09_-Az09'))).not.toBeNull();
  });
});

// ---------- Ids in payloads ----------

describe('parseEvent: payload ids', () => {
  const badIds: Array<[string, EventType, (e: Json) => void]> = [
    ['member.claimed', 'member.claimed', (e) => void (e.id = 'short')],
    ['member.archived', 'member.archived', (e) => void (e.id = `${NATHAN}x`)],
    ['member.unarchived', 'member.unarchived', (e) => void (e.id = 42)],
    ['member.done', 'member.done', (e) => void (e.id = MAYA.slice(1))],
    ['member.done missing id', 'member.done', (e) => void delete e.id],
    ['member.undone', 'member.undone', (e) => void (e.id = `${MAYA.slice(1)}=`)],
    ['member.undone missing id', 'member.undone', (e) => void delete e.id],
    ['expense.deleted', 'expense.deleted', (e) => void (e.id = EXPENSE.replace('0', '.'))],
    ['payment.deleted', 'payment.deleted', (e) => void delete e.id],
    ['expense.updated id', 'expense.updated', (e) => void (e.id = '')],
    ['member.updated id', 'member.updated', (e) => void (e.id = null)],
    ['member.added member.id', 'member.added', (e) => void ((e.member as Json).id = 'x')],
  ];
  it.each(badIds)('rejects a bad id in %s', (_name, type, edit) => {
    expect(parseEdited(type, edit)).toBeNull();
  });

  it('rejects bad ids inside expense and payment records', () => {
    expect(withExpense((x) => (x.id = 'nope'))).toBeNull();
    expect(withExpense((x) => (x.paidBy = `${MAYA}!`.slice(1)))).toBeNull();
    expect(withPayment((x) => (x.id = 'nope'))).toBeNull();
    expect(withPayment((x) => (x.from = 'nope'))).toBeNull();
    expect(withPayment((x) => (x.to = 'nope'))).toBeNull();
  });

  it('requires 43-char local ids in group.closed and group.rotated', () => {
    expect(parseEdited('group.closed', (e) => (e.to = id('newgroup')))).toBeNull();
    expect(parseEdited('group.closed', (e) => (e.to = `${localId('g')}x`))).toBeNull();
    expect(parseEdited('group.rotated', (e) => (e.from = id('oldgroup')))).toBeNull();
    expect(parseEdited('group.rotated', (e) => delete e.from)).toBeNull();
    expect(parseEdited('group.rotated', (e) => (e.from = localId('g').replace('x', '/')))).toBeNull();
  });

  it('requires reason "rotated" on group.closed', () => {
    expect(parseEdited('group.closed', (e) => (e.reason = 'deleted'))).toBeNull();
    expect(parseEdited('group.closed', (e) => delete e.reason)).toBeNull();
  });
});

// ---------- Done adding and archive ----------

describe('parseEvent: member.done/undone and group.archived/unarchived', () => {
  it('group.archived and group.unarchived carry only the base fields; extra fields are stripped', () => {
    for (const type of ['group.archived', 'group.unarchived'] as const) {
      const parsed = parseEdited(type, (e) => {
        e.id = NATHAN;
        e.reason = 'settled';
      });
      expect(parsed).toEqual(FIXTURES[type]);
      expect(parsed).not.toHaveProperty('id');
      expect(parsed).not.toHaveProperty('reason');
    }
  });

  it('member.done and member.undone strip unknown fields and do not require by === id', () => {
    for (const type of ['member.done', 'member.undone'] as const) {
      expect(parseEdited(type, (e) => (e.note = 'all in'))).toEqual(FIXTURES[type]);
      expect(parseEdited(type, (e) => (e.id = NATHAN))).toEqual({ ...FIXTURES[type], id: NATHAN });
    }
  });

  it('the new events still require valid base fields', () => {
    for (const type of ['group.archived', 'group.unarchived', 'member.done', 'member.undone'] as const) {
      expect(parseEdited(type, (e) => delete e.by)).toBeNull();
      expect(parseEdited(type, (e) => (e.ts = LIMITS.tsMax))).toBeNull();
      expect(parseEdited(type, (e) => (e.sv = 2))).toBeNull();
    }
  });
});

// ---------- Strings ----------

describe('parseEvent: names, titles, notes, currency', () => {
  const setName = (name: unknown) => parseEdited('group.renamed', (e) => (e.name = name));
  const setMemberName = (name: unknown) => parseEdited('member.added', (e) => ((e.member as Json).name = name));

  it('accepts names of 1 and nameMax code points', () => {
    expect(setName('M')).not.toBeNull();
    expect(setName('a'.repeat(LIMITS.nameMax))).not.toBeNull();
    expect(setMemberName('😀'.repeat(LIMITS.nameMax))).not.toBeNull(); // 40 code points, 80 UTF-16 units
    expect(setName('Maya O Neil')).not.toBeNull(); // inner whitespace is fine
  });

  // Changed in the integration review: group names now have their own bound, LIMITS.groupNameMax (80), so the
  // "too long" cases moved to the member-only and group-only tests below.
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['leading space', ' Maya'],
    ['trailing space', 'Maya '],
    ['trailing newline', 'Maya\n'],
    ['leading no-break space', ' Maya'],
    ['trailing ideographic space', 'Maya　'],
    ['leading BOM', '﻿Maya'],
    ['trailing U+180E', 'Maya᠎'],
    ['not a string', 7],
  ])('rejects a %s name', (_label, name) => {
    expect(setName(name)).toBeNull();
    expect(setMemberName(name)).toBeNull();
  });

  it('bounds member names at nameMax code points', () => {
    expect(setMemberName('a'.repeat(LIMITS.nameMax + 1))).toBeNull();
    expect(setMemberName('😀'.repeat(LIMITS.nameMax + 1))).toBeNull();
  });

  it('bounds group names at groupNameMax code points, separately from member names', () => {
    expect(LIMITS.groupNameMax).toBe(80);
    const setCreated = (name: unknown) => parseEdited('group.created', (e) => (e.name = name));
    for (const set of [setName, setCreated]) {
      expect(set('a'.repeat(LIMITS.nameMax + 1))).not.toBeNull(); // longer than a member name is fine
      expect(set('a'.repeat(LIMITS.groupNameMax))).not.toBeNull();
      expect(set('😀'.repeat(LIMITS.groupNameMax))).not.toBeNull(); // 80 code points, 160 UTF-16 units
      expect(set('a'.repeat(LIMITS.groupNameMax + 1))).toBeNull();
      expect(set('😀'.repeat(LIMITS.groupNameMax + 1))).toBeNull();
      expect(set(' Banff')).toBeNull();
    }
    expect(isGroupName('Banff 2026')).toBe(true);
    expect(isGroupName('a'.repeat(LIMITS.groupNameMax + 1))).toBe(false);
    expect(isGroupName('Banff ')).toBe(false);
    expect(isGroupName(7 as unknown as string)).toBe(false);
  });

  it('applies the name rule to group.created and member.updated', () => {
    expect(parseEdited('group.created', (e) => (e.name = ' Banff'))).toBeNull();
    expect(parseEdited('group.created', (e) => (e.name = ''))).toBeNull();
    expect(withMemberChanges({ name: 'a'.repeat(LIMITS.nameMax + 1) })).toBeNull();
    expect(withMemberChanges({ name: '' })).toBeNull();
  });

  it('applies the trimmed rule to titles, bounded by titleMax', () => {
    expect(withExpense((x) => (x.title = 't'.repeat(LIMITS.titleMax)))).not.toBeNull();
    expect(withExpense((x) => (x.title = 't'.repeat(LIMITS.titleMax + 1)))).toBeNull();
    expect(withExpense((x) => (x.title = ''))).toBeNull();
    expect(withExpense((x) => (x.title = ' '))).toBeNull();
    expect(withExpense((x) => (x.title = 'Dinner '))).toBeNull();
    expect(withChanges({ title: '' })).toBeNull();
  });

  it('bounds notes at noteMax and allows empty and whitespace notes', () => {
    expect(withExpense((x) => (x.note = ''))).not.toBeNull();
    expect(withExpense((x) => (x.note = ' line one\nline two\n'))).not.toBeNull();
    expect(withExpense((x) => (x.note = 'n'.repeat(LIMITS.noteMax)))).not.toBeNull();
    expect(withExpense((x) => (x.note = 'n'.repeat(LIMITS.noteMax + 1)))).toBeNull();
    expect(withPayment((x) => (x.note = 'n'.repeat(LIMITS.noteMax + 1)))).toBeNull();
    expect(withChanges({ note: 'n'.repeat(LIMITS.noteMax + 1) })).toBeNull();
    expect(withExpense((x) => (x.note = null))).toBeNull();
  });

  it.each(['cad', 'Cad', 'CA', 'CADX', 'C4D', '', 'ÇAD'])('rejects currency %j', (currency) => {
    expect(parseEdited('group.created', (e) => (e.currency = currency))).toBeNull();
    expect(withExpense((x) => (x.currency = currency))).toBeNull();
    expect(withPayment((x) => (x.currency = currency))).toBeNull();
  });

  it('does not check currency against a table (money.ts owns that)', () => {
    expect(parseEdited('group.created', (e) => (e.currency = 'XYZ'))).not.toBeNull();
  });

  it('rejects a category outside the enum', () => {
    expect(withExpense((x) => (x.category = 'Food'))).toBeNull();
    expect(withExpense((x) => (x.category = 'rent'))).toBeNull();
    expect(withChanges({ category: 'rent' })).toBeNull();
    expect(withChanges({ category: 'lodging' })).not.toBeNull();
  });
});

// ---------- Dates ----------

describe('isIsoDate', () => {
  it.each(['2024-02-29', '2000-02-29', '2023-02-28', '2000-01-01', '2099-12-31', '2026-04-30', '2026-01-31'])(
    'accepts %s',
    (d) => {
      expect(isIsoDate(d)).toBe(true);
    },
  );

  it.each([
    '2023-02-29', // not a leap year
    '2024-02-30',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '2024-04-31',
    '2024-01-32',
    '1999-12-31', // before range
    '2100-01-01', // after range
    '2100-02-29',
    '2024-1-01',
    '2024-01-1',
    '24-01-01',
    '2024/01/01',
    '2024-01-01T00:00:00Z',
    ' 2024-01-01',
    '２０２４-01-01', // full-width digits
    '',
  ])('rejects %j', (d) => {
    expect(isIsoDate(d)).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    expect(isIsoDate(20240101 as unknown as string)).toBe(false);
    expect(isIsoDate(null as unknown as string)).toBe(false);
  });

  it('agrees with the calendar for every day of 2000..2099', () => {
    // Reference: count days with UTC arithmetic from numbers (not string parsing).
    let valid = 0;
    for (let y = 2000; y <= 2099; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const text = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const real = new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
          expect(isIsoDate(text)).toBe(real);
          if (real) valid++;
        }
      }
    }
    expect(valid).toBe(36_525);
  });

  it('is used for expense, payment, and change dates', () => {
    expect(withExpense((x) => (x.date = '2023-02-29'))).toBeNull();
    expect(withPayment((x) => (x.date = '2024-02-30'))).toBeNull();
    expect(withChanges({ date: '2024-13-01' })).toBeNull();
    expect(withChanges({ date: '2024-02-29' })).not.toBeNull();
  });
});

// ---------- Amounts and splits ----------

describe('parseEvent: amounts and splits', () => {
  it.each([
    ['0', 0],
    ['negative', -100],
    ['float', 100.5],
    ['over max', LIMITS.amountMax + 1],
    ['string', '100'],
    ['NaN', Number.NaN],
  ])('rejects amount %s', (_label, amount) => {
    expect(withExpense((x) => ((x.amount = amount), (x.split = { [MAYA]: amount })))).toBeNull();
    expect(withPayment((x) => (x.amount = amount))).toBeNull();
    expect(withChanges({ amount, split: { [MAYA]: amount } })).toBeNull();
  });

  it('accepts amountMin and amountMax', () => {
    expect(withExpense((x) => ((x.amount = LIMITS.amountMin), (x.split = { [MAYA]: 1, [NATHAN]: 0 })))).not.toBeNull();
    const max = LIMITS.amountMax;
    expect(withExpense((x) => ((x.amount = max), (x.split = { [MAYA]: max / 2, [NATHAN]: max / 2 })))).not.toBeNull();
    expect(withPayment((x) => (x.amount = max))).not.toBeNull();
  });

  it.each([
    ['empty', {}],
    ['negative value', { [MAYA]: 12_346, [NATHAN]: -1 }],
    ['float value', { [MAYA]: 6_172.5, [NATHAN]: 6_172.5 }],
    ['string value', { [MAYA]: '12345' }],
    ['sum too small', { [MAYA]: 6_000, [NATHAN]: 6_000 }],
    ['sum too large', { [MAYA]: 6_173, [NATHAN]: 6_173 }],
    ['bad key length', { [MAYA]: 6_173, nathan: 6_172 }],
    ['bad key charset', { [MAYA]: 6_173, [NATHAN.replace('0', '+')]: 6_172 }],
    ['__proto__ key', JSON.parse(`{"__proto__": 12345}`) as Json],
    ['array', [12_345]],
    ['null', null],
    ['unsafe integer value', { [MAYA]: 2 ** 53, [NATHAN]: 0 }],
    ['value far above amount', { [MAYA]: Number.MAX_SAFE_INTEGER, [NATHAN]: 0 }],
  ])('rejects an expense split: %s', (_label, split) => {
    expect(withExpense((x) => (x.split = split))).toBeNull();
  });

  it('accepts zero shares and up to membersMax members', () => {
    expect(withExpense((x) => (x.split = { [MAYA]: 12_345, [NATHAN]: 0, [PRIYA]: 0 }))).not.toBeNull();
    const split = manyKeys(LIMITS.membersMax, 100);
    expect(withExpense((x) => ((x.amount = 100 * LIMITS.membersMax), (x.split = split)))).not.toBeNull();
  });

  it('rejects membersMax + 1 members', () => {
    const n = LIMITS.membersMax + 1;
    expect(withExpense((x) => ((x.amount = 100 * n), (x.split = manyKeys(n, 100))))).toBeNull();
    expect(withChanges({ amount: 100 * n, split: manyKeys(n, 100) })).toBeNull();
  });

  it('rejects a missing split', () => {
    expect(withExpense((x) => delete x.split)).toBeNull();
  });

  it('normalises a -0 share (JSON text "-0") to 0 in added expenses and in changes', () => {
    const text = JSON.stringify(FIXTURES['expense.added']).replace('"split":{', `"split":{"${PRIYA}":-0,`);
    const parsed = parseEvent(JSON.parse(text)) as { expense: { split: Record<string, number> } } | null;
    expect(parsed).not.toBeNull();
    expect(Object.is(parsed?.expense.split[PRIYA], 0)).toBe(true);
    const changed = withChanges({ amount: 5, split: { [MAYA]: 5, [NATHAN]: -0 } }) as { changes: { split: Record<string, number> } } | null;
    expect(Object.is(changed?.changes.split[NATHAN], 0)).toBe(true);
    expect(changed?.changes.split[MAYA]).toBe(5);
  });
});

// ---------- expense.updated ----------

describe('parseEvent: expense.updated changes', () => {
  it('accepts single-field and multi-field changes', () => {
    expect(withChanges({ title: 'Lunch' })).toEqual({ ...FIXTURES['expense.updated'], changes: { title: 'Lunch' } });
    expect(withChanges({ paidBy: NATHAN, note: '' })).not.toBeNull();
    expect(withChanges({ amount: 3, split: { [MAYA]: 1, [NATHAN]: 2 } })).not.toBeNull();
  });

  it.each([
    ['empty', {}],
    ['with id', { id: EXPENSE }],
    ['with id plus a valid field', { id: EXPENSE, title: 'Lunch' }],
    ['with currency', { currency: 'CAD' }],
    ['with currency plus a valid field', { title: 'Lunch', currency: 'USD' }],
    ['with an unknown key', { vendor: 'Nourish' }],
    ['amount without split', { amount: 10_000 }],
    ['split without amount', { split: { [MAYA]: 10_000 } }],
    ['amount and split mismatched', { amount: 10_000, split: { [MAYA]: 5_000, [NATHAN]: 4_999 } }],
    ['amount and empty split', { amount: 10_000, split: {} }],
    ['not an object', 'title'],
    ['an array', [{ title: 'Lunch' }]],
    ['null', null],
  ])('rejects changes %s', (_label, changes) => {
    expect(withChanges(changes as Json)).toBeNull();
  });

  it('rejects a missing changes object', () => {
    expect(parseEdited('expense.updated', (e) => delete e.changes)).toBeNull();
  });
});

// ---------- Payments ----------

describe('parseEvent: payments', () => {
  it('rejects from === to', () => {
    expect(withPayment((x) => (x.to = x.from))).toBeNull();
  });

  it('requires every payment field except note', () => {
    for (const key of ['id', 'from', 'to', 'amount', 'currency', 'date']) {
      expect(withPayment((x) => delete x[key])).toBeNull();
    }
  });
});

// ---------- group.moved ----------

describe('parseEvent: group.moved server', () => {
  const setServer = (server: unknown) => parseEdited('group.moved', (e) => (e.server = server));

  it.each([
    'https://sync.even.appalaya.com',
    'https://home.example.net:8443/even',
    'https://10.0.0.2:8080',
    'https://xn--bcher-kva.example/a/b',
    'https://example.com:65535',
  ])('accepts %s', (server) => {
    expect(setServer(server)).not.toBeNull();
  });

  it.each([
    'http://sync.even.appalaya.com',
    'https://sync.even.appalaya.com/',
    'https://home.example.net:8443/even/',
    'https://sync.even.appalaya.com:443',
    'https://Sync.Even.Appalaya.com',
    'HTTPS://sync.even.appalaya.com',
    'https://sync.even.appalaya.com?x=1',
    'https://sync.even.appalaya.com#frag',
    'https://user@sync.even.appalaya.com',
    'https://bücher.example',
    'https://example.com:0',
    'https://example.com:08443',
    'https://example.com:65536',
    'https://example.com:',
    'https://example.com/a/../b',
    'https://example.com/./b',
    'https://',
    'sync.even.appalaya.com',
    '',
    // Accepted by the old local regex, rejected by canonicalOrigin (keys.ts), which is now the one definition:
    'https://a..example.com',
    'https://-bad.example.com',
    'https://example.com/%65ven',
    'https://127.1',
    'https://1.2.3.4.5',
    ' https://sync.even.appalaya.com',
  ])('rejects %j', (server) => {
    expect(setServer(server)).toBeNull();
  });
});

// ---------- Emoji ----------

describe('isSingleEmoji', () => {
  it.each([
    ['🅿️', 'parking, VS16'],
    ['☕', 'default emoji presentation'],
    ['🏨', 'hotel'],
    ['👨‍👩‍👧', 'ZWJ family'],
    ['🇨🇦', 'flag'],
    ['1️⃣', 'keycap'],
    ['#️⃣', 'keycap #'],
    ['👍🏽', 'skin tone'],
    ['🧑🏽‍🚀', 'skin tone in a ZWJ sequence'],
    ['🏳️‍🌈', 'VS16 in a ZWJ sequence'],
    ['❤️‍🔥', 'heart on fire'],
    ['🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'subdivision flag (tags)'],
    ['🍽️', 'fork and knife with plate'],
    ['👩🏻‍❤️‍💋‍👨🏼', 'kiss with skin tones'],
  ])('accepts %s (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(true);
  });

  it.each([
    ['ab', 'letters'],
    ['🍽️🍽️', 'two emoji'],
    ['', 'empty'],
    ['a', 'letter'],
    ['1', 'bare digit'],
    ['#', 'bare hash'],
    ['🇨', 'lone regional indicator'],
    ['🇨🇦🇺🇸', 'two flags'],
    ['🏽', 'lone skin tone'],
    ['‍', 'lone ZWJ'],
    ['👨‍', 'trailing ZWJ'],
    ['‍👨', 'leading ZWJ'],
    ['☕ ', 'trailing space'],
    ['☕︎', 'text presentation selector'],
    ['😀a', 'emoji plus letter'],
    ['👨‍👩‍👧‍👦‍👨‍👩‍👧‍👦‍👨', 'more than 16 code points'],
  ])('rejects %j (%s)', (text) => {
    expect(isSingleEmoji(text)).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    expect(isSingleEmoji(null as unknown as string)).toBe(false);
    expect(isSingleEmoji(1 as unknown as string)).toBe(false);
  });

  it('its Extended_Pictographic table matches this runtime', () => {
    // The table is written out so every engine agrees; this checks it against V8/ICU's own property data.
    const property = /^\p{Extended_Pictographic}$/u;
    const mismatches: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const text = String.fromCodePoint(cp);
      if (property.test(text) !== isSingleEmoji(text)) mismatches.push(cp.toString(16));
    }
    expect(mismatches).toEqual([]);
  });

  it('is enforced on member.added and member.updated', () => {
    expect(parseEdited('member.added', (e) => ((e.member as Json).emoji = 'ab'))).toBeNull();
    expect(parseEdited('member.added', (e) => ((e.member as Json).emoji = null))).toBeNull();
    expect(parseEdited('member.added', (e) => ((e.member as Json).emoji = '🇨🇦'))).not.toBeNull();
    expect(withMemberChanges({ emoji: '🍽️🍽️' })).toBeNull();
    expect(withMemberChanges({ emoji: '' })).toBeNull();
    expect(withMemberChanges({ emoji: '1️⃣' })).not.toBeNull();
    expect(withMemberChanges({ emoji: null })).not.toBeNull();
  });
});

// ---------- member.updated ----------

describe('parseEvent: member.updated changes', () => {
  it.each([
    ['empty', {}],
    ['with id', { id: NATHAN }],
    ['with an unknown key', { color: 3 }],
    ['name null', { name: null }],
    ['an array', []],
  ])('rejects changes %s', (_label, changes) => {
    expect(withMemberChanges(changes as Json)).toBeNull();
  });

  it('accepts name only, emoji only, and both', () => {
    expect(withMemberChanges({ name: 'Nate' })).not.toBeNull();
    expect(withMemberChanges({ emoji: '🏔️' })).not.toBeNull();
    expect(withMemberChanges({ name: 'Nate', emoji: '🏔️' })).not.toBeNull();
  });
});

// ---------- Robustness ----------

describe('parseEvent: never throws', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['number', 1],
    ['string', 'group.created'],
    ['array', [FIXTURES['group.created']]],
    ['function', () => FIXTURES['group.created']],
    ['Date', new Date(0)],
    ['Map', new Map([['type', 'group.created']])],
    ['BigInt', 1n],
    ['Symbol', Symbol('x')],
  ])('returns null for %s', (_label, value) => {
    expect(parseEvent(value)).toBeNull();
  });

  it('returns null for an object whose getter throws', () => {
    const e = fixture('member.claimed');
    Object.defineProperty(e, 'id', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(parseEvent(e)).toBeNull();
  });

  it('never throws for arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(parseEvent(value)).toBeNull();
      }),
      { numRuns: 2_000 },
    );
  });

  it('never throws for arbitrary values of any kind', () => {
    fc.assert(
      fc.property(fc.anything({ withBigInt: true, withBoxedValues: true, withMap: true, withSet: true, withNullPrototype: true }), (value) => {
        expect(() => parseEvent(value)).not.toThrow();
      }),
      { numRuns: 1_000 },
    );
  });

  it('never throws when a field of a valid event is replaced by arbitrary JSON', () => {
    const paths: Array<[EventType, string[]]> = [];
    for (const type of EVENT_TYPES) {
      const walk = (value: unknown, path: string[]): void => {
        paths.push([type, path]);
        if (typeof value === 'object' && value !== null) {
          for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
        }
      };
      walk(FIXTURES[type], []);
    }
    fc.assert(
      fc.property(fc.constantFrom(...paths), fc.jsonValue(), ([type, path], replacement) => {
        const e = fixture(type);
        if (path.length === 0) {
          expect(() => parseEvent(replacement)).not.toThrow();
          return;
        }
        let target = e;
        for (const key of path.slice(0, -1)) target = target[key] as Json;
        target[path[path.length - 1] as string] = replacement;
        const parsed = parseEvent(e);
        // Whatever comes back must itself be a valid event that re-parses to the same value.
        if (parsed !== null) expect(parseEvent(parsed)).toEqual(parsed);
      }),
      { numRuns: 3_000 },
    );
  });
});
