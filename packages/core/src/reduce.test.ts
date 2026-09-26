import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLOR_COUNT } from './constants.js';
import { emptyState, initialsOf, memberColor, reduce, sortLog } from './reduce.js';
import type { Event, EventBase, EventPayload, Expense, GroupState, LogEntry, Payment } from './types.js';

// ---------- fixtures ----------

const T0 = 1_750_000_000_000;
/** A realistic 22-char id from a readable stem (base64url alphabet includes `_`). */
const pad = (stem: string): string => stem.padEnd(22, '_');
/** Envelope id from a counter; equal-length decimal strings sort numerically. */
const eid = (n: number): string => String(n).padStart(22, '0');

const MAYA = pad('maya');
const JORDAN = pad('jordan');
const NATHAN = pad('nathan');
const GHOST = pad('ghost');
const DEV: Record<string, string> = { [MAYA]: pad('dev-maya'), [JORDAN]: pad('dev-jordan'), [NATHAN]: pad('dev-nathan') };

const DINNER = pad('dinner');
const GAS = pad('gas');
const FOOD = pad('food');
const PAY1 = pad('pay1');

const two = (n: number): string => (n / 100).toFixed(2);

type Draft = EventPayload & Partial<EventBase>;

/** Builds an already-valid LogEntry. A numeric id also sets the default ts (T0 + n s), so fixtures read in order. */
function entry(n: number | string, draft: Draft): LogEntry {
  const id = typeof n === 'number' ? eid(n) : n;
  const ts = draft.ts ?? T0 + (typeof n === 'number' ? n : 0) * 1000;
  const by = draft.by ?? MAYA;
  const event = { sv: 1, ts, at: draft.at ?? ts, by, dev: draft.dev ?? DEV[by] ?? pad('dev-other'), ...draft } as Event;
  return { id, event };
}

function expense(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id,
    title: 'Dinner',
    amount: 9000,
    currency: 'CAD',
    paidBy: MAYA,
    date: '2026-02-14',
    category: 'food',
    split: { [MAYA]: 3000, [JORDAN]: 3000, [NATHAN]: 3000 },
    ...over,
  };
}

function payment(id: string, over: Partial<Payment> = {}): Payment {
  return { id, from: NATHAN, to: JORDAN, amount: 800, currency: 'CAD', date: '2026-02-16', ...over };
}

const created = (n: number, over: Partial<EventBase> = {}): LogEntry =>
  entry(n, { type: 'group.created', name: 'Banff 2026', currency: 'CAD', ...over });
const added = (n: number, id: string, name: string, over: Partial<EventBase> = {}): LogEntry =>
  entry(n, { type: 'member.added', member: { id, name }, ...over });

/** The three-person Banff trip: dinner split three ways, gas, an edit of dinner, a payment. */
function banff(): LogEntry[] {
  return [
    created(1),
    added(2, MAYA, 'Maya'),
    entry(3, { type: 'member.claimed', id: MAYA }),
    added(4, JORDAN, 'Jordan'),
    added(5, NATHAN, 'Nathan'),
    entry(6, { type: 'member.claimed', id: JORDAN, by: JORDAN }),
    entry(7, { type: 'expense.added', expense: expense(DINNER) }),
    entry(8, {
      type: 'expense.added',
      by: JORDAN,
      expense: expense(GAS, {
        title: 'Gas',
        amount: 6000,
        paidBy: JORDAN,
        category: 'fuel',
        split: { [MAYA]: 2000, [JORDAN]: 2000, [NATHAN]: 2000 },
      }),
    }),
    entry(9, {
      type: 'expense.updated',
      id: DINNER,
      changes: { amount: 9600, split: { [MAYA]: 3200, [JORDAN]: 3200, [NATHAN]: 3200 } },
    }),
    entry(10, { type: 'payment.added', by: NATHAN, payment: payment(PAY1) }),
  ];
}

/** Base log: group plus the three members, for tests that add a few events of their own. */
function base(): LogEntry[] {
  return [created(1), added(2, MAYA, 'Maya'), added(3, JORDAN, 'Jordan'), added(4, NATHAN, 'Nathan')];
}

const summaries = (s: GroupState): string[] => s.activity.map((a) => a.summary);

/** Maps → entry arrays, so strict equality also checks Map insertion order. */
function canon(s: GroupState): unknown {
  return { ...s, members: [...s.members], expenses: [...s.expenses], payments: [...s.payments], totalsByCategory: [...s.totalsByCategory] };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// ---------- helpers ----------

describe('sortLog', () => {
  it('sorts by (ts, id) with code-unit id comparison, without mutating', () => {
    const a = entry('a'.padEnd(22, 'x'), { type: 'group.renamed', name: 'a', ts: T0 + 5 });
    const Z = entry('Z'.padEnd(22, 'x'), { type: 'group.renamed', name: 'Z', ts: T0 + 5 });
    const under = entry('_'.padEnd(22, 'x'), { type: 'group.renamed', name: '_', ts: T0 + 5 });
    const dash = entry('-'.padEnd(22, 'x'), { type: 'group.renamed', name: '-', ts: T0 + 5 });
    const early = entry('z'.padEnd(22, 'x'), { type: 'group.renamed', name: 'early', ts: T0 + 1 });
    const log = [a, Z, under, dash, early];
    const copy = [...log];
    const sorted = sortLog(log);
    // '-' 0x2D < 'Z' 0x5A < '_' 0x5F < 'a' 0x61; localeCompare would disagree.
    expect(sorted.map((e) => e.event.type === 'group.renamed' && e.event.name)).toEqual(['early', '-', 'Z', '_', 'a']);
    expect(log).toEqual(copy);
    expect(sorted).not.toBe(log);
  });

  it('is stable for identical keys', () => {
    const x = entry(1, { type: 'group.renamed', name: 'x' });
    const y = entry(1, { type: 'group.renamed', name: 'y' });
    expect(sortLog([x, y])).toEqual([x, y]);
    expect(sortLog([y, x])).toEqual([y, x]);
  });
});

describe('memberColor', () => {
  it('is FNV-1a 32 over UTF-16 code units, mod AVATAR_COLOR_COUNT', () => {
    // FNV-1a("") = 0x811c9dc5, ("a") = 0xe40c292c, ("foobar") = 0xbf9cf968 (standard vectors).
    expect(memberColor('')).toBe(0x811c9dc5 % AVATAR_COLOR_COUNT);
    expect(memberColor('a')).toBe(0xe40c292c % AVATAR_COLOR_COUNT);
    expect(memberColor('foobar')).toBe(0xbf9cf968 % AVATAR_COLOR_COUNT);
    expect(memberColor(MAYA)).toBe(0x2550a133 % AVATAR_COLOR_COUNT);
  });

  it('is always an index in range', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        const c = memberColor(s);
        return Number.isInteger(c) && c >= 0 && c < AVATAR_COLOR_COUNT && c === memberColor(s);
      }),
    );
  });
});

describe('initialsOf', () => {
  it.each([
    ['maya andersen', 'MA'],
    ['Nathan', 'N'],
    ['  jean  claude van damme ', 'JD'],
    ['élodie', 'É'],
    ['😀 smile', '😀S'],
    ['𝒜lice 𝒞arl', '𝒜𝒞'],
    ['a\tb', 'AB'],
    ['', '?'],
    ['   ', '?'],
  ])('%j → %j', (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });
});

describe('emptyState', () => {
  it('is all-empty and equals reduce([])', () => {
    const s = emptyState();
    expect(s).toEqual({
      created: false,
      name: '',
      currency: '',
      closed: null,
      rotatedFrom: [],
      movedTo: null,
      members: new Map(),
      expenses: new Map(),
      payments: new Map(),
      activity: [],
      totalsByCategory: new Map(),
      flagged: [],
      unknownMembers: [],
      nameCollisions: [],
    });
    expect(canon(reduce([]))).toStrictEqual(canon(s));
    expect(emptyState().members).not.toBe(s.members);
  });
});

// ---------- reduce ----------

describe('reduce: Banff walkthrough', () => {
  const s = reduce(banff(), { format: two });

  it('derives group meta and members', () => {
    expect(s.created).toBe(true);
    expect(s.name).toBe('Banff 2026');
    expect(s.currency).toBe('CAD');
    expect([...s.members.keys()]).toEqual([MAYA, JORDAN, NATHAN]);
    expect(s.members.get(MAYA)).toEqual({
      id: MAYA,
      name: 'Maya',
      archived: false,
      devices: [DEV[MAYA]],
      unknown: false,
      color: memberColor(MAYA),
      initials: 'M',
    });
    expect(s.members.get(NATHAN)?.devices).toEqual([]);
    expect(s.unknownMembers).toEqual([]);
    expect(s.nameCollisions).toEqual([]);
    expect(s.flagged).toEqual([]);
  });

  it('applies the edit and keeps history with snapshots', () => {
    const dinner = s.expenses.get(DINNER);
    expect(dinner).toBeDefined();
    if (dinner === undefined) return;
    expect(dinner.amount).toBe(9600);
    expect(dinner.split).toEqual({ [MAYA]: 3200, [JORDAN]: 3200, [NATHAN]: 3200 });
    expect(dinner.addedBy).toBe(MAYA);
    expect(dinner.addedAt).toBe(T0 + 7000);
    expect(dinner.updatedAt).toBe(T0 + 9000);
    expect(dinner.history).toHaveLength(2);
    expect(dinner.history[0]).toEqual({
      eventId: eid(7),
      ts: T0 + 7000,
      at: T0 + 7000,
      by: MAYA,
      dev: DEV[MAYA],
      kind: 'added',
      snapshot: expense(DINNER),
    });
    expect(dinner.history[1]?.kind).toBe('updated');
    expect(dinner.history[1]?.changes).toEqual({ amount: 9600, split: { [MAYA]: 3200, [JORDAN]: 3200, [NATHAN]: 3200 } });
    expect(dinner.history[1]?.snapshot).toEqual({ ...expense(DINNER), amount: 9600, split: { [MAYA]: 3200, [JORDAN]: 3200, [NATHAN]: 3200 } });
    expect(s.expenses.get(GAS)?.history).toHaveLength(1);
    expect(s.payments.get(PAY1)).toEqual({ ...payment(PAY1), addedBy: NATHAN, addedAt: T0 + 10000 });
  });

  it('totals by category', () => {
    expect([...s.totalsByCategory]).toEqual([
      ['food', 9600],
      ['fuel', 6000],
    ]);
  });

  it('narrates activity', () => {
    expect(summaries(s)).toEqual([
      'Someone created the group',
      'Maya joined',
      'Maya joined',
      'Maya added Jordan',
      'Maya added Nathan',
      'Jordan joined',
      'Maya added Dinner · 90.00',
      'Jordan added Gas · 60.00',
      'Maya changed Dinner from 90.00 to 96.00',
      'Nathan paid Jordan 8.00',
    ]);
    expect(s.activity[9]).toEqual({
      eventId: eid(10),
      type: 'payment.added',
      ts: T0 + 10000,
      at: T0 + 10000,
      by: NATHAN,
      dev: DEV[NATHAN],
      summary: 'Nathan paid Jordan 8.00',
    });
  });

  it('defaults format to String', () => {
    expect(summaries(reduce(banff()))[6]).toBe('Maya added Dinner · 9000');
  });
});

describe('reduce: expense.updated summaries', () => {
  const foodLog = (): LogEntry[] => [
    ...base(),
    entry(10, {
      type: 'expense.added',
      by: NATHAN,
      expense: expense(FOOD, { title: 'Food', amount: 10000, paidBy: NATHAN, split: { [NATHAN]: 5000, [MAYA]: 5000 } }),
    }),
  ];

  it('uses the payer possessive when the payer is not the actor (design.md example)', () => {
    const s = reduce(
      [...foodLog(), entry(11, { type: 'expense.updated', id: FOOD, changes: { amount: 1000, split: { [NATHAN]: 500, [MAYA]: 500 } } })],
      { format: two },
    );
    expect(summaries(s).at(-1)).toBe("Maya changed Nathan's Food from 100.00 to 10.00");
  });

  it('describes a split-only change', () => {
    const s = reduce(
      [...foodLog(), entry(11, { type: 'expense.updated', id: FOOD, changes: { amount: 10000, split: { [NATHAN]: 2000, [MAYA]: 8000 } } })],
      { format: two },
    );
    expect(summaries(s).at(-1)).toBe("Maya changed the split of Nathan's Food");
    const own = reduce(
      [...foodLog(), entry(11, { type: 'expense.updated', by: NATHAN, id: FOOD, changes: { amount: 10000, split: { [NATHAN]: 2000, [MAYA]: 8000 } } })],
    );
    expect(summaries(own).at(-1)).toBe('Nathan changed the split of Food');
  });

  it('narrates every changed field in fixed order, using the title as it stands', () => {
    const s = reduce(
      [
        ...foodLog(),
        entry(11, {
          type: 'expense.updated',
          id: FOOD,
          changes: { note: 'tip incl.', category: 'drinks', date: '2026-02-15', paidBy: JORDAN, title: 'Pub', amount: 12000, split: { [JORDAN]: 12000 } },
        }),
      ],
      { format: two },
    );
    expect(summaries(s).at(-1)).toBe(
      [
        'Maya renamed Food to Pub',
        "Maya changed Nathan's Pub from 100.00 to 120.00",
        'Maya changed who paid for Pub to Jordan',
        'Maya changed the date of Pub',
        'Maya changed the category of Pub',
        'Maya edited the note on Pub',
      ].join('; '),
    );
    const food = s.expenses.get(FOOD);
    expect(food?.history[1]?.changes).toEqual({
      title: 'Pub',
      paidBy: JORDAN,
      date: '2026-02-15',
      category: 'drinks',
      note: 'tip incl.',
      amount: 12000,
      split: { [JORDAN]: 12000 },
    });
    expect(food?.history[1]?.snapshot).toEqual({
      id: FOOD,
      title: 'Pub',
      amount: 12000,
      currency: 'CAD',
      paidBy: JORDAN,
      date: '2026-02-15',
      category: 'drinks',
      note: 'tip incl.',
      split: { [JORDAN]: 12000 },
    });
  });

  it('records only the fields that changed; a no-op update produces nothing', () => {
    const s = reduce([
      ...foodLog(),
      entry(11, { type: 'expense.updated', id: FOOD, changes: { title: 'Food', date: '2026-03-01' } }),
      entry(12, { type: 'expense.updated', id: FOOD, changes: { title: 'Food', category: 'food' } }),
    ]);
    const food = s.expenses.get(FOOD);
    expect(food?.history.map((h) => h.changes)).toEqual([undefined, { date: '2026-03-01' }]);
    expect(summaries(s).slice(-1)).toEqual(['Maya changed the date of Food']);
    expect(food?.updatedAt).toBe(T0 + 11000);
  });

  it('clears a note with an empty string', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(DINNER, { note: 'hi' }) }),
      entry(11, { type: 'expense.updated', id: DINNER, changes: { note: '' } }),
      entry(12, { type: 'expense.updated', id: DINNER, changes: { note: '' } }),
    ]);
    const dinner = s.expenses.get(DINNER);
    expect(dinner && 'note' in dinner).toBe(false);
    expect(dinner?.history).toHaveLength(2);
    expect(summaries(s).at(-1)).toBe('Maya edited the note on Dinner');
  });

  it('ignores updates to an unknown expense (no placeholder, no activity)', () => {
    const s = reduce([...base(), entry(10, { type: 'expense.updated', id: DINNER, changes: { paidBy: GHOST } })]);
    expect(s.expenses.size).toBe(0);
    expect(s.members.has(GHOST)).toBe(false);
    expect(s.activity).toHaveLength(4);
  });
});

describe('reduce: last-writer-wins', () => {
  const add = entry(10, { type: 'expense.added', expense: expense(DINNER) });

  it('the newer (ts) write wins regardless of input order', () => {
    const older = entry(11, { type: 'expense.updated', id: DINNER, changes: { title: 'Older' }, ts: T0 + 20_000 });
    const newer = entry(12, { type: 'expense.updated', id: DINNER, by: JORDAN, changes: { title: 'Newer' }, ts: T0 + 30_000 });
    const a = reduce([...base(), add, older, newer]);
    const b = reduce([newer, older, add, ...base().reverse()]);
    expect(a.expenses.get(DINNER)?.title).toBe('Newer');
    expect(canon(b)).toStrictEqual(canon(a));
    expect(a.expenses.get(DINNER)?.history.map((h) => h.snapshot.title)).toEqual(['Dinner', 'Older', 'Newer']);
    expect(summaries(a).slice(-2)).toEqual(['Maya renamed Dinner to Older', 'Jordan renamed Older to Newer']);
  });

  it('breaks equal ts by envelope id', () => {
    const lo = entry('A'.padEnd(22, '0'), { type: 'expense.updated', id: DINNER, changes: { title: 'Lo' }, ts: T0 + 20_000 });
    const hi = entry('a'.padEnd(22, '0'), { type: 'expense.updated', id: DINNER, changes: { title: 'Hi' }, ts: T0 + 20_000 });
    expect(reduce([...base(), add, hi, lo]).expenses.get(DINNER)?.title).toBe('Hi');
    expect(reduce([...base(), add, lo, hi]).expenses.get(DINNER)?.title).toBe('Hi');
  });

  it('concurrent edits of different fields both apply', () => {
    const title = entry(11, { type: 'expense.updated', id: DINNER, changes: { title: 'Supper' }, ts: T0 + 20_000 });
    const note = entry(12, { type: 'expense.updated', id: DINNER, by: JORDAN, changes: { note: 'with tip' }, ts: T0 + 20_000 });
    for (const log of [[...base(), add, title, note], [note, title, add, ...base()]]) {
      const d = reduce(log).expenses.get(DINNER);
      expect(d?.title).toBe('Supper');
      expect(d?.note).toBe('with tip');
    }
  });

  it('amount and split move together', () => {
    const newerMoney = entry(11, {
      type: 'expense.updated',
      id: DINNER,
      changes: { amount: 1000, split: { [MAYA]: 500, [JORDAN]: 500 } },
      ts: T0 + 30_000,
    });
    const olderMoney = entry(12, {
      type: 'expense.updated',
      id: DINNER,
      by: JORDAN,
      changes: { amount: 2000, split: { [NATHAN]: 2000 } },
      ts: T0 + 20_000,
    });
    const laterTitle = entry(13, { type: 'expense.updated', id: DINNER, changes: { title: 'Snacks' }, ts: T0 + 40_000 });
    for (const log of [[...base(), add, newerMoney, olderMoney, laterTitle], [laterTitle, olderMoney, newerMoney, add, ...base()]]) {
      const s = reduce(log);
      const d = s.expenses.get(DINNER);
      expect(d?.amount).toBe(1000);
      expect(d?.split).toEqual({ [MAYA]: 500, [JORDAN]: 500 });
      expect(d?.title).toBe('Snacks');
      expect(s.flagged).toEqual([]);
      for (const h of d?.history ?? []) {
        const sum = Object.values(h.snapshot.split).reduce((x, y) => x + y, 0);
        expect(sum).toBe(h.snapshot.amount);
      }
    }
  });
});

describe('reduce: tombstones', () => {
  it('a delete beats a later update and blocks a re-add', () => {
    const log = [
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(DINNER) }),
      entry(11, { type: 'expense.deleted', id: DINNER, by: JORDAN }),
      entry(12, { type: 'expense.updated', id: DINNER, changes: { title: 'Zombie' } }),
      entry(13, { type: 'expense.added', expense: expense(DINNER, { title: 'Again' }) }),
      entry(14, { type: 'expense.deleted', id: DINNER }),
    ];
    const s = reduce(log);
    expect(s.expenses.has(DINNER)).toBe(false);
    expect(summaries(s).slice(4)).toEqual(['Maya added Dinner · 9000', 'Jordan deleted Dinner']);
    expect(canon(reduce(shuffled(log, 7)))).toStrictEqual(canon(s));
  });

  it('a delete for an unseen id is remembered (equal-ts add sorting after it is ignored)', () => {
    const del = entry('A'.padEnd(22, '0'), { type: 'expense.deleted', id: DINNER, ts: T0 + 20_000 });
    const add = entry('B'.padEnd(22, '0'), { type: 'expense.added', expense: expense(DINNER), ts: T0 + 20_000 });
    const s = reduce([...base(), add, del]);
    expect(s.expenses.size).toBe(0);
    expect(s.activity).toHaveLength(4);
  });

  it('payments: delete removes, duplicates and re-adds are ignored', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'payment.added', by: NATHAN, payment: payment(PAY1) }),
      entry(11, { type: 'payment.added', by: NATHAN, payment: payment(PAY1, { amount: 5 }) }),
      entry(12, { type: 'payment.deleted', by: JORDAN, id: PAY1 }),
      entry(13, { type: 'payment.added', by: NATHAN, payment: payment(PAY1) }),
      entry(14, { type: 'payment.deleted', id: PAY1 }),
    ]);
    expect(s.payments.size).toBe(0);
    expect(summaries(s).slice(4)).toEqual(['Nathan paid Jordan 800', 'Jordan deleted a payment']);
  });

  it('a second expense.added with the same id is ignored', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(DINNER) }),
      entry(11, { type: 'expense.added', expense: expense(DINNER, { title: 'Dup', amount: 1, split: { [MAYA]: 1 } }) }),
    ]);
    expect(s.expenses.get(DINNER)?.title).toBe('Dinner');
    expect(s.expenses.get(DINNER)?.history).toHaveLength(1);
    expect(s.activity).toHaveLength(5);
  });
});

describe('reduce: members', () => {
  it('an unknown paidBy creates a placeholder and the money still counts', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(DINNER, { title: 'Lunch', amount: 1000, paidBy: GHOST, split: { [MAYA]: 500, [GHOST]: 500 } }) }),
    ]);
    expect(s.members.get(GHOST)).toEqual({
      id: GHOST,
      name: 'Unknown',
      archived: false,
      devices: [],
      unknown: true,
      color: memberColor(GHOST),
      initials: '?',
    });
    expect(s.unknownMembers).toEqual([GHOST]);
    expect(s.flagged).toEqual([]);
    expect(s.totalsByCategory.get('food')).toBe(1000);
  });

  it('member.added fills a placeholder, keeping its devices and archive flag', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'member.claimed', id: GHOST, by: GHOST, dev: pad('dev-ghost') }),
      entry(11, { type: 'member.archived', id: GHOST }),
      entry(12, { type: 'payment.added', payment: payment(PAY1, { from: GHOST, to: MAYA }) }),
      entry(13, { type: 'member.added', by: GHOST, member: { id: GHOST, name: 'casey lee', emoji: '🦊' } }),
      entry(14, { type: 'member.added', member: { id: GHOST, name: 'Imposter' } }),
    ]);
    expect(s.members.get(GHOST)).toEqual({
      id: GHOST,
      name: 'casey lee',
      emoji: '🦊',
      archived: true,
      devices: [pad('dev-ghost')],
      unknown: false,
      color: memberColor(GHOST),
      initials: 'CL',
    });
    expect(s.unknownMembers).toEqual([]);
    expect(summaries(s).slice(4)).toEqual(['Unknown joined', 'Maya archived Unknown', 'Unknown paid Maya 800', 'casey lee joined']);
  });

  it('member.* targets create placeholders', () => {
    const s = reduce([...base(), entry(10, { type: 'member.updated', id: GHOST, changes: { name: 'Bob' } })]);
    expect(s.members.get(GHOST)).toMatchObject({ name: 'Bob', unknown: true, initials: 'B' });
    expect(s.unknownMembers).toEqual([GHOST]);
    expect(summaries(s).at(-1)).toBe('Maya renamed Unknown to Bob');
  });

  it('member.updated: rename recomputes initials; emoji set and clear', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'member.updated', id: NATHAN, by: NATHAN, changes: { name: 'nathan park', emoji: '🐻' } }),
      entry(11, { type: 'member.updated', id: NATHAN, changes: { emoji: '🐼' } }),
      entry(12, { type: 'member.updated', id: NATHAN, changes: { emoji: null } }),
      entry(13, { type: 'member.updated', id: NATHAN, changes: { emoji: null, name: 'nathan park' } }),
    ]);
    const n = s.members.get(NATHAN);
    expect(n?.name).toBe('nathan park');
    expect(n?.initials).toBe('NP');
    expect(n && 'emoji' in n).toBe(false);
    expect(summaries(s).slice(4)).toEqual([
      "Nathan renamed Nathan to nathan park; Nathan set nathan park's emoji to 🐻",
      "Maya set nathan park's emoji to 🐼",
      "Maya cleared nathan park's emoji",
    ]);
  });

  it('member.added for an existing real member is ignored', () => {
    const s = reduce([...base(), added(10, MAYA, 'Other Maya')]);
    expect(s.members.get(MAYA)?.name).toBe('Maya');
    expect(s.activity).toHaveLength(4);
  });

  it('member.claimed builds a sorted, unique device set', () => {
    const [a, b, c] = [pad('dev-a'), pad('dev-b'), pad('dev-c')];
    const s = reduce([
      ...base(),
      entry(10, { type: 'member.claimed', id: NATHAN, by: NATHAN, dev: c }),
      entry(11, { type: 'member.claimed', id: NATHAN, by: NATHAN, dev: a }),
      entry(12, { type: 'member.claimed', id: NATHAN, by: NATHAN, dev: c }),
      entry(13, { type: 'member.claimed', id: NATHAN, by: NATHAN, dev: b }),
    ]);
    expect(s.members.get(NATHAN)?.devices).toEqual([a, b, c]);
    expect(summaries(s).slice(4)).toEqual(['Nathan joined', 'Nathan joined on a new device', 'Nathan joined on a new device']);
  });

  it('archive / unarchive', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'member.archived', id: JORDAN }),
      entry(11, { type: 'member.archived', id: JORDAN }),
      entry(12, { type: 'member.unarchived', id: JORDAN, by: NATHAN }),
      entry(13, { type: 'member.archived', id: NATHAN }),
    ]);
    expect(s.members.get(JORDAN)?.archived).toBe(false);
    expect(s.members.get(NATHAN)?.archived).toBe(true);
    expect(summaries(s).slice(4)).toEqual(['Maya archived Jordan', 'Nathan restored Jordan', 'Maya archived Nathan']);
  });

  it('detects name collisions case-insensitively, ignoring archived and placeholders', () => {
    const M2 = pad('maya2');
    const M3 = pad('maya3');
    const J2 = pad('aaa-jordan');
    const s = reduce([
      ...base(),
      added(10, M2, ' maya '),
      added(11, M3, 'MAYA'),
      entry(12, { type: 'member.archived', id: M3 }),
      added(13, J2, 'JORDAN'),
      entry(14, { type: 'member.updated', id: GHOST, changes: { name: 'Maya' } }),
    ]);
    // '2' (0x32) sorts before '_' (0x5F), so maya2… precedes maya_…
    expect(s.nameCollisions).toEqual([
      [J2, JORDAN],
      [M2, MAYA],
    ]);
    const restored = reduce([...base(), added(10, M3, 'MAYA'), entry(11, { type: 'member.archived', id: M3 }), entry(12, { type: 'member.unarchived', id: M3 })]);
    expect(restored.nameCollisions).toEqual([[M3, MAYA]]);
  });

  it('treats an id like __proto__ as an ordinary key', () => {
    const PROTO = '__proto__';
    const split = JSON.parse(`{"${PROTO}": 700, "${MAYA}": 300}`) as Record<string, number>;
    const s = reduce([...base(), entry(10, { type: 'expense.added', expense: expense(DINNER, { amount: 1000, paidBy: PROTO, split }) })]);
    expect(s.members.get(PROTO)?.unknown).toBe(true);
    const d = s.expenses.get(DINNER);
    expect(Object.keys(d?.split ?? {})).toEqual([PROTO, MAYA]);
    expect(Object.getPrototypeOf(d?.split)).toBe(Object.prototype);
    expect(s.flagged).toEqual([]);
  });
});

describe('reduce: flags and totals', () => {
  it('flags a currency mismatch and excludes it from totals', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(DINNER) }),
      entry(11, { type: 'expense.added', expense: expense(GAS, { currency: 'USD', category: 'fuel', amount: 10, split: { [MAYA]: 7 } }) }),
      entry(12, { type: 'payment.added', payment: payment(PAY1, { currency: 'USD' }) }),
    ]);
    expect(s.flagged).toEqual([
      { kind: 'expense', id: GAS, reason: 'currency_mismatch' },
      { kind: 'payment', id: PAY1, reason: 'currency_mismatch' },
    ]);
    expect(s.expenses.has(GAS)).toBe(true);
    expect(s.payments.has(PAY1)).toBe(true);
    expect([...s.totalsByCategory]).toEqual([['food', 9000]]);
  });

  it('flags a split that does not sum to the amount, or is empty', () => {
    const bad = pad('bad');
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(GAS, { amount: 1000, split: { [MAYA]: 400, [JORDAN]: 400 } }) }),
      entry(11, { type: 'expense.added', expense: expense(bad, { amount: 1000, split: {} }) }),
      entry(12, { type: 'expense.added', expense: expense(DINNER, { category: 'lodging' }) }),
    ]);
    expect(s.flagged).toEqual([
      { kind: 'expense', id: bad, reason: 'split_mismatch' },
      { kind: 'expense', id: GAS, reason: 'split_mismatch' },
    ]);
    expect([...s.totalsByCategory]).toEqual([['lodging', 9000]]);
  });

  it('lists totals in CATEGORIES order and drops categories with nothing live', () => {
    const s = reduce([
      ...base(),
      entry(10, { type: 'expense.added', expense: expense(GAS, { category: 'other' }) }),
      entry(11, { type: 'expense.added', expense: expense(DINNER, { category: 'coffee' }) }),
      entry(12, { type: 'expense.added', expense: expense(FOOD, { category: 'gifts' }) }),
      entry(13, { type: 'expense.deleted', id: FOOD }),
    ]);
    expect([...s.totalsByCategory.keys()]).toEqual(['coffee', 'other']);
  });
});

describe('reduce: group events', () => {
  it('group.created: the first in (ts, id) order wins; later ones are ignored', () => {
    const late = entry(1, { type: 'group.created', name: 'Late', currency: 'USD', ts: T0 + 500 });
    const early = entry(2, { type: 'group.created', name: 'Early', currency: 'CAD', ts: T0 + 100 });
    const tieLo = entry('A'.padEnd(22, '0'), { type: 'group.created', name: 'TieLo', currency: 'EUR', ts: T0 + 100 });
    const s = reduce([late, early]);
    expect([s.name, s.currency]).toEqual(['Early', 'CAD']);
    expect(s.activity.map((a) => a.eventId)).toEqual([eid(2)]);
    // '0'… < 'A'…, so eid(2) wins the tie.
    expect(reduce([tieLo, early, late]).name).toBe('Early');
  });

  it('group.renamed: latest wins', () => {
    const s = reduce([
      created(1),
      added(2, MAYA, 'Maya'),
      entry(4, { type: 'group.renamed', name: 'Lake Louise' }),
      entry(3, { type: 'group.renamed', name: 'Jasper' }),
    ]);
    expect(s.name).toBe('Lake Louise');
    expect(summaries(s).slice(2)).toEqual(['Maya renamed the group to Jasper', 'Maya renamed the group to Lake Louise']);
  });

  it('group.closed: ignored when `to` is our own localId', () => {
    const toSelf = entry(5, { type: 'group.closed', reason: 'rotated', to: 'self-local-id' });
    expect(reduce([...base(), toSelf], { selfLocalId: 'self-local-id' }).closed).toBeNull();
    expect(reduce([...base(), toSelf], { selfLocalId: 'self-local-id' }).activity).toHaveLength(4);
    const s = reduce([...base(), toSelf], { selfLocalId: 'other' });
    expect(s.closed).toEqual({ reason: 'rotated', to: 'self-local-id' });
    expect(summaries(s).at(-1)).toBe('Maya closed this group');
    expect(reduce([...base(), entry(5, { type: 'group.closed', reason: 'rotated' })]).closed).toEqual({ reason: 'rotated' });
  });

  it('group.rotated: collects `from`, deduplicated', () => {
    const s = reduce([
      ...base(),
      entry(5, { type: 'group.rotated', from: 'old-a' }),
      entry(6, { type: 'group.rotated', from: 'old-b' }),
      entry(7, { type: 'group.rotated', from: 'old-a' }),
    ]);
    expect(s.rotatedFrom).toEqual(['old-a', 'old-b']);
    expect(summaries(s).slice(4)).toEqual(['Maya created this group from a new invite', 'Maya created this group from a new invite']);
  });

  it('group.moved: the latest wins regardless of input order', () => {
    const a = entry(5, { type: 'group.moved', server: 'https://a.example.com' });
    const b = entry(6, { type: 'group.moved', server: 'https://b.example.com', by: JORDAN });
    const s = reduce([b, a, ...base()]);
    expect(s.movedTo).toBe('https://b.example.com');
    expect(summaries(s).slice(4)).toEqual(['Maya moved the group to a.example.com', 'Jordan moved the group to b.example.com']);
  });

  it('an unknown actor reads as Someone', () => {
    const s = reduce([created(1, { by: GHOST })]);
    expect(summaries(s)).toEqual(['Someone created the group']);
    expect(s.members.has(GHOST)).toBe(false);
  });
});

describe('reduce: purity and determinism', () => {
  /** Every event type, same-ts ties, a tombstone, a placeholder, a flag, a collision. */
  function kitchenSink(): LogEntry[] {
    return [
      ...banff(),
      entry(20, { type: 'group.renamed', name: 'Banff!' }),
      entry(21, { type: 'member.updated', id: NATHAN, by: NATHAN, changes: { emoji: '🐻' } }),
      entry(22, { type: 'member.claimed', id: NATHAN, by: NATHAN }),
      entry(23, { type: 'member.claimed', id: NATHAN, by: NATHAN, dev: pad('dev-nathan-2') }),
      entry(24, { type: 'expense.updated', id: GAS, changes: { title: 'Fuel' }, ts: T0 + 30_000 }),
      entry(25, { type: 'expense.updated', id: GAS, by: JORDAN, changes: { title: 'Petrol', note: 'Esso' }, ts: T0 + 30_000 }),
      entry(26, { type: 'expense.added', expense: expense(FOOD, { paidBy: GHOST, currency: 'USD' }) }),
      entry(27, { type: 'expense.deleted', id: DINNER, ts: T0 + 40_000 }),
      entry(28, { type: 'expense.updated', id: DINNER, changes: { title: 'Late' }, ts: T0 + 40_000 }),
      entry(29, { type: 'member.archived', id: JORDAN }),
      entry(30, { type: 'member.unarchived', id: JORDAN }),
      added(31, pad('maya-2'), 'MAYA'),
      entry(32, { type: 'payment.deleted', id: PAY1 }),
      entry(33, { type: 'payment.added', payment: payment(pad('pay2'), { from: MAYA, to: NATHAN, amount: 100 }) }),
      entry(34, { type: 'group.moved', server: 'https://sync.example.org' }),
      entry(35, { type: 'group.rotated', from: 'old-local' }),
      entry(36, { type: 'group.closed', reason: 'rotated', to: 'new-local' }),
      created(37),
    ];
  }

  it('is deep-equal (including Map order) for any permutation', () => {
    const log = kitchenSink();
    const expected = canon(reduce(log, { format: two }));
    fc.assert(
      fc.property(fc.shuffledSubarray(log, { minLength: log.length, maxLength: log.length }), (perm) => {
        expect(canon(reduce(perm, { format: two }))).toStrictEqual(expected);
      }),
      { numRuns: 200 },
    );
    for (let seed = 1; seed <= 20; seed++) {
      expect(canon(reduce(shuffled(log, seed), { format: two }))).toStrictEqual(expected);
    }
  });

  it('replays a duplicated envelope once', () => {
    const log = kitchenSink();
    expect(canon(reduce([...log, ...log]))).toStrictEqual(canon(reduce(log)));
    // A reused envelope id: only the first in (ts, id) order is replayed.
    const first = entry(5, { type: 'group.renamed', name: 'A' });
    const reused = entry(5, { type: 'group.renamed', name: 'C', ts: T0 + 7000 });
    const between = entry(6, { type: 'group.renamed', name: 'B' });
    const s = reduce([reused, between, first, ...base()]);
    expect(s.name).toBe('B');
    expect(summaries(s).slice(4)).toEqual(['Maya renamed the group to A', 'Maya renamed the group to B']);
  });

  it('never mutates or aliases its input', () => {
    const log = deepFreeze(kitchenSink());
    const before = JSON.stringify(log);
    const s = reduce(log);
    expect(JSON.stringify(log)).toBe(before);
    const gas = s.expenses.get(GAS);
    expect(gas).toBeDefined();
    if (gas === undefined) return;
    gas.split[MAYA] = 1;
    expect(gas.history[0]?.snapshot.split[MAYA]).toBe(2000);
    expect(reduce(log).expenses.get(GAS)?.split[MAYA]).toBe(2000);
  });
});
