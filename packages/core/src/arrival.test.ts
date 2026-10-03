/**
 * The arrival-time rule over whole histories (design.md "Ordering", pre-launch review H2): a simulated server that
 * stamps every request with R (equal within a request, strictly increasing across requests), devices whose clocks
 * run a few hours fast or slow writing through `nextTs`, and a hostile member stamping writes decades ahead.
 *
 * - Causality: every write sorts after everything its author had seen when it wrote, before its own R arrives and
 *   after (and after every other device's R has arrived too).
 * - Re-arm: re-assigning every R the way a server move or wipe does (cleared, then new values in the claimed-ts order
 *   of the re-push) leaves the state as it was. The hold is what keeps a far write from re-arming: the clamp alone
 *   would give it the newest R on the new copy.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { LIMITS } from './constants.js';
import { compareLog, nextTs } from './hlc.js';
import { reduce } from './reduce.js';
import type { Event, EventPayload, GroupState, LogEntry } from './types.js';

const T0 = 1_760_000_000_000;
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const TOP = LIMITS.tsMax - 1;

const pad = (stem: string): string => stem.padEnd(22, '_');

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

// ---------- the simulated server ----------

class Server {
  /** Stored entries in seq order, each with the R its request assigned. */
  readonly stored: LogEntry[] = [];
  private readonly ids = new Map<string, number>();
  private lastR = 0;

  /** One append request at server time `now`: new envelopes get one R, a duplicate reports its stored one. */
  push(now: number, batch: readonly LogEntry[]): number[] {
    const fresh = batch.filter((e) => !this.ids.has(e.id));
    if (fresh.length > 0) {
      this.lastR = Math.max(now, this.lastR + 1);
      for (const e of fresh) {
        this.ids.set(e.id, this.lastR);
        this.stored.push({ id: e.id, event: e.event, receivedAt: this.lastR });
      }
    }
    return batch.map((e) => this.ids.get(e.id) as number);
  }

  since(cursor: number): LogEntry[] {
    return this.stored.slice(cursor);
  }
}

// ---------- devices ----------

interface Device {
  dev: string;
  member: string;
  /** How far this phone's clock runs ahead of the server's (negative: behind). */
  offset: number;
  log: Map<string, LogEntry>;
  /** This phone's writes not pushed yet. */
  outbox: Set<string>;
  cursor: number;
}

interface Write {
  author: Device;
  id: string;
  /** What the author's log held when it wrote. */
  seen: string[];
}

let envelopeCounter = 0;
const newEnvelopeId = (): string => pad(`e${++envelopeCounter}`);

function body(d: Device, ts: number, payload: EventPayload): Event {
  return { sv: 1, ts, at: ts, by: d.member, dev: d.dev, ...payload } as Event;
}

class World {
  now = T0;
  readonly server = new Server();
  readonly devices: Device[] = [];
  readonly writes: Write[] = [];
  private readonly byId = new Map<string, Write>();
  readonly expenses: string[] = [];

  constructor(
    readonly rnd: () => number,
    offsets: readonly number[],
  ) {
    offsets.forEach((offset, i) => {
      this.devices.push({
        dev: pad(`dev${i}`),
        member: pad(`member${i}`),
        offset,
        log: new Map(),
        outbox: new Set(),
        cursor: 0,
      });
    });
    const [first] = this.devices as [Device];
    this.write(first, { type: 'group.created', name: 'Banff 2026', currency: 'CAD' });
    for (const d of this.devices) {
      this.write(first, { type: 'member.added', member: { id: d.member, name: `Member ${d.dev}` } });
    }
    this.sync(first);
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)] as T;
  }

  /** Writes through `nextTs` at the device's clock, checking it sorts after everything the device has seen. */
  write(d: Device, payload: EventPayload, target?: string): LogEntry {
    const log = [...d.log.values()];
    const ts = nextTs(this.now + d.offset, log, target);
    const entry: LogEntry = { id: newEnvelopeId(), event: body(d, ts, payload) };
    // Before its own R arrives: after everything in the author's log.
    for (const seen of log) expect(compareLog(entry, seen)).toBeGreaterThan(0);
    d.log.set(entry.id, entry);
    d.outbox.add(entry.id);
    const write = { author: d, id: entry.id, seen: log.map((e) => e.id) };
    this.writes.push(write);
    this.byId.set(entry.id, write);
    return entry;
  }

  /** Expenses this device has seen added. */
  known(d: Device): string[] {
    const out: string[] = [];
    for (const { event } of d.log.values()) if (event.type === 'expense.added') out.push(event.expense.id);
    return out;
  }

  /** A random honest write: an expense, an edit or delete of one, a rename, a member archived or back. */
  randomWrite(d: Device): void {
    const members = this.devices.map((x) => x.member);
    const roll = this.rnd();
    const known = this.known(d);
    if (roll < 0.3 || known.length === 0) {
      this.addExpense(d);
    } else if (roll < 0.65) {
      const id = this.pick(known);
      this.write(d, { type: 'expense.updated', id, changes: { title: `Edit by ${d.dev} at ${this.now}` } }, id);
    } else if (roll < 0.7) {
      const id = this.pick(known);
      this.write(d, { type: 'expense.deleted', id }, id);
    } else if (roll < 0.85) {
      this.write(d, { type: 'group.renamed', name: `Name ${Math.floor(this.rnd() * 1000)}` });
    } else {
      const m = this.pick(members);
      this.write(d, { type: this.rnd() < 0.5 ? 'member.archived' : 'member.unarchived', id: m }, m);
    }
  }

  addExpense(d: Device): string {
    const members = this.devices.map((x) => x.member);
    const id = pad(`x${this.expenses.length}`);
    this.expenses.push(id);
    const share = 100 * (1 + Math.floor(this.rnd() * 20));
    const split = Object.fromEntries(members.map((m) => [m, share]));
    this.write(d, {
      type: 'expense.added',
      expense: {
        id,
        title: `Item ${id}`,
        amount: share * members.length,
        currency: 'CAD',
        paidBy: d.member,
        date: '2026-02-14',
        category: 'food',
        split,
      },
    });
    return id;
  }

  /** Push the outbox in claimed-ts order, a few per request, then pull everything new. */
  sync(d: Device, batch = 1 + Math.floor(this.rnd() * 4)): void {
    const queued = [...d.outbox].map((id) => d.log.get(id) as LogEntry).sort((a, b) => a.event.ts - b.event.ts || (a.id < b.id ? -1 : 1));
    for (let i = 0; i < queued.length; i += batch) {
      const chunk = queued.slice(i, i + batch);
      const arrivals = this.server.push(this.now, chunk);
      chunk.forEach((e, j) => {
        d.log.set(e.id, { ...e, receivedAt: arrivals[j] as number });
        d.outbox.delete(e.id);
      });
      this.now += 1 + Math.floor(this.rnd() * 3 * SECOND);
    }
    // After its own R arrives: still after everything the author had seen, as its log holds them now.
    const pushed = queued.map((e) => this.byId.get(e.id)).filter((w): w is Write => w !== undefined);
    expectCausal(d.log, pushed);
    for (const e of this.server.since(d.cursor)) d.log.set(e.id, e);
    d.cursor = this.server.stored.length;
  }

  advance(): void {
    this.now += 1 + Math.floor(this.rnd() ** 3 * 6 * HOUR);
  }

  /** Every device syncs, twice, so everyone holds every event with its R. */
  settle(): void {
    for (let round = 0; round < 2; round++) for (const d of this.devices) this.sync(d);
  }

  run(steps: number): void {
    for (let step = 0; step < steps; step++) {
      const d = this.pick(this.devices);
      const roll = this.rnd();
      if (roll < 0.55) this.randomWrite(d);
      else if (roll < 0.85) this.sync(d);
      else this.advance();
    }
    this.settle();
  }
}

/** Each write against what its author had seen, as `log` holds them: strictly after every one. */
function expectCausal(log: ReadonlyMap<string, LogEntry>, writes: readonly Write[]): void {
  for (const w of writes) {
    const x = log.get(w.id);
    if (x === undefined) continue;
    for (const id of w.seen) {
      const y = log.get(id);
      if (y !== undefined) expect(compareLog(x, y), `${w.id} after ${id}`).toBeGreaterThan(0);
    }
  }
}

describe('causality over simulated histories', () => {
  it('every write sorts after everything its author had seen, before its own R arrives and after', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.integer({ min: -3 * HOUR, max: 3 * HOUR }), { minLength: 2, maxLength: 4 }),
        (seed, offsets) => {
          // `write` checks each write before its R, and `sync` after, in its author's log.
          const world = new World(mulberry32(seed), offsets);
          world.run(60);
          // And once every device holds every event with its R.
          const everything = new Map(world.server.stored.map((e) => [e.id, e]));
          expect(everything.size).toBe(world.writes.length);
          expect([...everything.values()].every((e) => typeof e.receivedAt === 'number')).toBe(true);
          expectCausal(everything, world.writes);
          // Every device reduces to the same state.
          const states = world.devices.map((d) => canon(reduce([...d.log.values()])));
          for (const s of states) expect(s).toStrictEqual(states[0]);
        },
      ),
      { numRuns: 120 },
    );
  });
});

// ---------- re-arm ----------

/**
 * Every R re-assigned the way a move or a wipe does it: cleared, then the whole log re-pushed in claimed-ts order
 * (the outbox's), `batch` per request, to a copy whose clock starts at `at`.
 */
function reassign(log: readonly LogEntry[], at: number, batch: number): LogEntry[] {
  const server = new Server();
  const queued = log
    .map(({ id, event }) => ({ id, event }))
    .sort((a, b) => a.event.ts - b.event.ts || (a.id < b.id ? -1 : 1));
  const out: LogEntry[] = [];
  let now = at;
  for (let i = 0; i < queued.length; i += batch) {
    const chunk = queued.slice(i, i + batch);
    const arrivals = server.push(now, chunk);
    chunk.forEach((e, j) => out.push({ ...e, receivedAt: arrivals[j] as number }));
    now += 10;
  }
  return out;
}

/** A hostile member's write stamped far ahead, from one of `devs` (forged device ids), pushed at once. */
function farWrite(world: World, devs: readonly string[], payload: EventPayload, ts = TOP): void {
  const hostile = world.devices[world.devices.length - 1] as Device;
  const entry: LogEntry = {
    id: newEnvelopeId(),
    event: { ...body(hostile, ts, payload), dev: world.pick(devs) },
  };
  hostile.log.set(entry.id, entry);
  hostile.outbox.add(entry.id);
  world.sync(hostile, 1);
}

describe('re-arm: a move or a wipe re-assigns every R, and the state stays as it was', () => {
  it("the review's attacks: far archive, rename, member and expense writes from two device ids", () => {
    // Honest clocks at or behind the server's; the last member is hostile.
    const world = new World(mulberry32(7), [0, -HOUR, -2 * HOUR]);
    world.run(25);
    const honest = world.devices[0] as Device;
    const first = world.addExpense(honest);
    const second = world.addExpense(honest);
    world.settle();
    const devs = [pad('dev-far-1'), pad('dev-far-2')];
    const victim = world.devices[1] as Device;
    for (const payload of [
      { type: 'group.archived' },
      { type: 'group.renamed', name: 'Pwned' },
      { type: 'member.archived', id: victim.member },
      { type: 'member.updated', id: victim.member, changes: { name: 'Pwned' } },
      { type: 'expense.updated', id: first, changes: { title: 'Pwned', amount: 1, split: { [victim.member]: 1 } } },
      { type: 'expense.deleted', id: second },
    ] as const) {
      farWrite(world, devs, payload);
      farWrite(world, devs, payload);
    }
    // Then honest members write on, as they would on seeing the group: unarchive, rename, edits.
    world.settle();
    world.advance();
    world.write(honest, { type: 'group.unarchived' });
    world.write(honest, { type: 'group.renamed', name: 'Banff!' });
    world.write(honest, { type: 'expense.updated', id: first, changes: { title: 'Dinner' } }, first);
    world.settle();

    const log = world.server.stored;
    const before = reduce(log);
    for (const batch of [1, 25, 100]) {
      const moved = reassign(log, world.now + DAY, batch);
      expect(canon(reduce(moved))).toStrictEqual(canon(before));
    }
    // And that state is the honest one: none of the far writes took effect, before the move or after.
    expect([before.archived, before.name, before.expenses.get(first)?.title]).toEqual([false, 'Banff!', 'Dinner']);
    expect(before.expenses.has(second)).toBe(true);
    expect(before.members.get(victim.member)).toMatchObject({ archived: false, name: `Member ${victim.dev}` });
  });

  it('over generated histories, with far writes from any number of device ids', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.integer({ min: -3 * HOUR, max: 0 }), { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 100 }),
        (seed, offsets, k, batch) => {
          const world = new World(mulberry32(seed), offsets);
          const devs = Array.from({ length: k }, (_, i) => pad(`dev-far-${i}`));
          world.run(20);
          for (let i = 0; i < 6; i++) {
            const known = world.expenses;
            const target = world.pick(known.length > 0 ? known : [pad('none')]);
            const ts = world.rnd() < 0.5 ? TOP : T0 + Math.floor((1 + world.rnd() * 60) * 365 * DAY);
            farWrite(
              world,
              devs,
              world.pick<EventPayload>([
                { type: 'group.archived' },
                { type: 'group.renamed', name: `Far ${i}` },
                { type: 'expense.updated', id: target, changes: { title: `Far ${i}` } },
                { type: 'expense.deleted', id: target },
                { type: 'member.archived', id: (world.devices[0] as Device).member },
              ]),
              ts,
            );
            world.run(5);
          }
          const log = world.server.stored;
          const before = canon(reduce(log));
          expect(canon(reduce(reassign(log, world.now + HOUR, batch)))).toStrictEqual(before);
        },
      ),
      { numRuns: 120 },
    );
  });
});
