/**
 * A large synthetic group, for measuring (pre-launch review H3 and "The 10,000-event group"): the review's mix,
 * scaled to any size. Deterministic for a seed, so before and after measure the same log.
 *
 * - 50 members, each with `member.added` (by the creator) and `member.claimed` (from its own device);
 * - one `group.created`;
 * - of the rest: 69.7% `expense.added`, split equally among 2 to 11 members; 20.2% title edits; 5.1%
 *   `payment.added`; 2.0% `expense.deleted`; and the remainder `member.done` / `member.undone` marks. At 10,000
 *   events that is about 6,900 expenses (6,700 live), 2,000 edits, 500 payments and 200 deletes.
 *
 * Every event validates (`parseEvent`); timestamps rise evenly over `days` up to `end`. Used by the measurement
 * harness (`src/state/largeGroup.perf.test.ts`) at 10,000 events and by the dev seed's `large` state at 3,400, the
 * public server's practical maximum for this mix (its 2 MB cap at about 612 stored bytes an event). Dev and tests
 * only: nothing that ships imports it.
 */
import {
  b64urlEncode,
  CATEGORIES,
  type Category,
  type Event,
  type EventPayload,
  type LogEntry,
} from '@even/core';

export interface LargeGroupOptions {
  /** Total events, `group.created` and the members' events included. At least 101. */
  events: number;
  /** The newest event's `ts`. */
  end: number;
  /** How far back the first event is. Default 60 days. */
  days?: number;
  seed?: number;
  name?: string;
  currency?: string;
}

export interface LargeGroupMember {
  id: string;
  name: string;
  dev: string;
}

export interface LargeGroup {
  name: string;
  currency: string;
  /** In `ts` order; `entries[0]` is `group.created`. */
  entries: LogEntry[];
  members: LargeGroupMember[];
  /** Counts by event type. */
  counts: Record<string, number>;
}

const NAMES = [
  'Maya',
  'Nathan',
  'Jordan',
  'Priya',
  'Sam',
  'Alex',
  'Riley',
  'Casey',
  'Morgan',
  'Taylor',
  'Jamie',
  'Avery',
  'Quinn',
  'Rowan',
  'Sasha',
  'Noor',
  'Emeka',
  'Lena',
  'Mateo',
  'Ines',
  'Kai',
  'Yuki',
  'Omar',
  'Zara',
  'Felix',
  'Hana',
  'Luca',
  'Mira',
  'Theo',
  'Asha',
  'Diego',
  'Freya',
  'Ivan',
  'June',
  'Kofi',
  'Lior',
  'Nia',
  'Oskar',
  'Pia',
  'Ravi',
  'Sol',
  'Tess',
  'Uma',
  'Vik',
  'Wren',
  'Xavi',
  'Yara',
  'Zed',
  'Ana',
  'Ben',
];

const TITLES = [
  'Dinner at Park Distillery',
  'Sunshine Village lift tickets',
  'Banff Town Parking',
  'Gas at Petro-Canada',
  'Fairmont Banff Springs',
  'Groceries at Nesters',
  'Coffee at Wild Flour',
  'Gondola tickets',
  'Hot springs entry',
  'Taxi from Calgary airport',
  'Brunch at Juniper',
  'Rental car',
  'Ski rental',
  'Pharmacy run',
  'Beer at Banff Ave Brewing',
  'Pizza night',
  'Firewood',
  'Canoe rental at Lake Louise',
  'Breakfast burritos',
  'Souvenirs',
  'Parking at Moraine Lake',
  'Wine for the cabin',
  'Snacks for the drive',
  'Dinner at The Bison',
  'Laundry',
];

/** mulberry32: small, fast, good enough for a fixture. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function largeGroup(options: LargeGroupOptions): LargeGroup {
  const total = options.events;
  if (!Number.isSafeInteger(total) || total < 101) throw new RangeError('at least 101 events');
  const random = prng(options.seed ?? 1);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const id = () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(random() * 256);
    return b64urlEncode(bytes);
  };
  const name = options.name ?? 'Big trip';
  const currency = options.currency ?? 'CAD';
  const span = (options.days ?? 60) * 24 * 60 * 60 * 1000;
  const start = options.end - span;
  const step = Math.max(1, Math.floor(span / total));

  const members: LargeGroupMember[] = NAMES.map((n) => ({ id: id(), name: n, dev: id() }));
  const creator = members[0] as LargeGroupMember;
  const entries: LogEntry[] = [];
  const counts: Record<string, number> = {};
  let ts = start;
  const push = (author: LargeGroupMember, payload: EventPayload): void => {
    ts = entries.length === total - 1 ? options.end : Math.min(ts + step, options.end - 1);
    const event = { sv: 1, ts, at: ts, by: author.id, dev: author.dev, ...payload } as Event;
    entries.push({ id: id(), event });
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  };
  const isoDate = () => new Date(ts).toISOString().slice(0, 10);

  push(creator, { type: 'group.created', name, currency });
  for (const m of members)
    push(creator, { type: 'member.added', member: { id: m.id, name: m.name } });
  for (const m of members) push(m, { type: 'member.claimed', id: m.id });

  const live: string[] = [];
  const done = new Set<string>();
  while (entries.length < total) {
    const roll = random();
    const author = pick(members);
    if (roll < 0.697 || live.length < 20) {
      const count = int(2, 11);
      const sharers = new Set<string>([author.id]);
      while (sharers.size < count) sharers.add(pick(members).id);
      const amount = int(500, 50_000);
      const ids = [...sharers];
      const share = Math.floor(amount / ids.length);
      const split: Record<string, number> = {};
      ids.forEach((m, i) => {
        split[m] = share + (i < amount - share * ids.length ? 1 : 0);
      });
      const expenseId = id();
      live.push(expenseId);
      push(author, {
        type: 'expense.added',
        expense: {
          id: expenseId,
          title: pick(TITLES),
          amount,
          currency,
          paidBy: author.id,
          date: isoDate(),
          category: pick(CATEGORIES) as Category,
          split,
        },
      });
    } else if (roll < 0.899) {
      push(author, {
        type: 'expense.updated',
        id: pick(live),
        changes: { title: `${pick(TITLES)} (${int(1, 99)})` },
      });
    } else if (roll < 0.95) {
      let to = pick(members);
      while (to.id === author.id) to = pick(members);
      push(author, {
        type: 'payment.added',
        payment: {
          id: id(),
          from: author.id,
          to: to.id,
          amount: int(500, 20_000),
          currency,
          date: isoDate(),
        },
      });
    } else if (roll < 0.97) {
      const index = Math.floor(random() * live.length);
      const [gone] = live.splice(index, 1);
      push(author, { type: 'expense.deleted', id: gone as string });
    } else if (done.has(author.id)) {
      done.delete(author.id);
      push(author, { type: 'member.undone', id: author.id });
    } else {
      done.add(author.id);
      push(author, { type: 'member.done', id: author.id });
    }
  }
  return { name, currency, entries, members, counts };
}
