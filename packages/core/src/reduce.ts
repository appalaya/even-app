/**
 * The reducer: replays a group's log into `GroupState`. See design.md "Reducer" and "Ordering".
 *
 * Pure and deterministic: the log is sorted by (min(ts, R), ts, id) (`compareLog`, R the server's arrival time) and
 * folded in that order, so any input permutation of the same entries yields a deep-equal state (including Map
 * insertion order).
 * Inputs are never mutated and never aliased into the output (splits and records are copied).
 *
 * Decisions where the spec leaves room (all tested in reduce.test.ts):
 * - An event is "applied" only if it changes state. Ignored events (a later `group.created`, a
 *   second `member.added` for a real member, a second `expense.added`/`payment.added`, updates to an
 *   unknown or deleted expense, a `group.closed` naming this group) AND no-op events (a duplicate
 *   `member.claimed` for the same device, a rename to the current name, an update whose every field
 *   equals the current value or loses last-writer-wins, re-archiving an archived member, deleting an
 *   id never seen, marking a done member done, un-marking a member who is not done, re-archiving an
 *   archived group or unarchiving one that is not archived) produce no activity item and no history entry.
 * - One applied event produces no activity item: a `member.claimed` that merely confirms a self-join
 *   (the claim's `by` is the member, and its `dev` is the device whose self-add `member.added` created
 *   the member). The device set is still updated; the self-add already reads "X joined".
 * - Entries sharing an envelope id are replayed once (the first in `compareLog` order).
 * - `by` never creates a placeholder member. An actor not (yet) a real member at that point in the fold
 *   is named from a pre-scan of the whole log (the name in its first `member.added`), so the creator's
 *   `group.created` reads "Maya created the group" even if her `member.added` sorts after it. Only an
 *   actor never added anywhere reads as "Someone" (or "Unknown" if a reference made a placeholder).
 * - A deleted expense moves from `expenses` to `deletedExpenses` with a final `deleted` history entry,
 *   so the activity feed can still open its history. It never counts in balances or totals.
 * - `format` is caller code (the app binds `formatMinor` to the group currency, which the validator only
 *   checks for shape); if it throws, the summary falls back to `String(minor)` rather than the fold.
 * - `member.added` over a placeholder takes the record's name and emoji (it is the newer write) and
 *   keeps the placeholder's devices and archived flag.
 * - An empty-string note is stored as "no note" (the only way an `ExpenseChanges` can clear a note).
 * - Each flagged item appears once; `currency_mismatch` takes precedence over `split_mismatch`.
 *   `unknown_member` is never emitted: dangling references still count money (design.md "Validation").
 * - An `expense.deleted`/`payment.deleted` for an id never seen still records a tombstone, so an
 *   add sorting after it (only possible with equal-ts oddities or hostile clients) is ignored.
 * - `totalsByCategory` lists only categories with a non-zero total, in `CATEGORIES` order.
 * - `member.done` targets create a placeholder like every `member.*` target, so `doneMembers` only
 *   names members that exist. A `member.undone` for a member who is not done changes nothing at
 *   all: it creates no placeholder either.
 * - Auto-clear: an APPLIED `expense.added` whose `by` is a done member removes that member from
 *   `doneMembers` and adds no activity item of its own (the expense's item explains it). An ignored
 *   add (duplicate or tombstoned id), `expense.updated`, `expense.deleted`, and `payment.added` never
 *   clear it, and neither does an expense merely paid by a done member but added by someone else.
 * - Archiving a member does not clear its done mark; `allDone` just stops counting it. `allDone` is
 *   true iff at least one non-archived member has a claimed device and every such member is done
 *   (placeholders included when a device claimed them).
 * - `group.archived`/`group.unarchived` toggle `archived`; the latest in (ts, id) order wins. It is
 *   independent of `closed`: neither event reads or changes the other.
 * - Hold (pre-launch review H2, design.md "Ordering"): an event with an R whose claimed `ts` is more than a day past
 *   the latest R in the log (`holdBackHorizon`, over the de-duplicated log) is skipped like an event that changes
 *   nothing, whatever its type: no state change, no activity item, no history entry, no placeholder, and it names no
 *   actor. It applies at its effective time, its arrival, once a later R brings the horizon past its `ts`. An event
 *   with no R is never held.
 */
import { AVATAR_COLOR_COUNT } from './constants.js';
import { compareLog, effectiveTs, holdBackHorizon, isHeldBack } from './hlc.js';
import {
  CATEGORIES,
  type ActivityItem,
  type Category,
  type Event,
  type EventOf,
  type Expense,
  type ExpenseChanges,
  type ExpenseState,
  type FlaggedItem,
  type GroupState,
  type HistoryEntry,
  type LogEntry,
  type MemberState,
  type Payment,
  type PaymentState,
} from './types.js';

export interface ReduceOptions {
  /**
   * Formats minor units for activity summaries; defaults to String(n). The app passes formatMinor bound to the group
   * currency. If it throws (e.g. a shape-valid but unknown currency code), that summary uses String(n) instead.
   */
  format?: (minor: number) => string;
  /** This group's own localId; a group.closed whose `to` equals it is ignored. */
  selfLocalId?: string;
}

export function emptyState(): GroupState {
  return {
    created: false,
    name: '',
    currency: '',
    closed: null,
    archived: false,
    rotatedFrom: [],
    movedTo: null,
    members: new Map(),
    doneMembers: [],
    allDone: false,
    expenses: new Map(),
    deletedExpenses: new Map(),
    payments: new Map(),
    activity: [],
    totalsByCategory: new Map(),
    flagged: [],
    unknownMembers: [],
    nameCollisions: [],
  };
}

/** Plain UTF-16 code-unit comparison (never locale-aware). */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted by `compareLog`, (min(ts, R), ts, id) ascending. Does not mutate. */
export function sortLog(log: readonly LogEntry[]): LogEntry[] {
  return [...log].sort(compareLog);
}

/** Deterministic avatar colour index 0..AVATAR_COLOR_COUNT-1 from a member id. FNV-1a 32-bit over UTF-16 code units. */
export function memberColor(memberId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < memberId.length; i++) {
    hash ^= memberId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0) % AVATAR_COLOR_COUNT;
}

/** 1–2 uppercase initials from a name ("maya andersen" → "MA", "Nathan" → "N"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter((w) => w.length > 0);
  const first = words[0];
  if (first === undefined) return '?';
  const head = (word: string): string => Array.from(word)[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (head(first) + (last === undefined ? '' : head(last))).toUpperCase();
}

// ---------- internals ----------

/** An event's place in the fold: its effective time, claimed `ts` and envelope id (`compareLog`'s key). */
interface Stamp {
  effective: number;
  ts: number;
  id: string;
}

function stampOf(entry: LogEntry): Stamp {
  return { effective: effectiveTs(entry), ts: entry.event.ts, id: entry.id };
}

/** True if `a` sorts strictly after `b` in (min(ts, R), ts, id) order, the fold's own. */
function newer(a: Stamp, b: Stamp | undefined): boolean {
  if (b === undefined) return true;
  if (a.effective !== b.effective) return a.effective > b.effective;
  if (a.ts !== b.ts) return a.ts > b.ts;
  return a.id > b.id;
}

type ExpenseField = 'title' | 'money' | 'paidBy' | 'date' | 'category' | 'note';
const EXPENSE_FIELDS: readonly ExpenseField[] = ['title', 'money', 'paidBy', 'date', 'category', 'note'];

/** Copies a split with own-data-property semantics, so a key like `__proto__` stays an ordinary key. */
function cloneSplit(split: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(split));
}

function sameSplit(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ae = Object.entries(a);
  const be = new Map(Object.entries(b));
  if (ae.length !== be.size) return false;
  for (const [k, v] of ae) {
    if (be.get(k) !== v) return false;
  }
  return true;
}

function normNote(note: string | undefined): string | undefined {
  return note === undefined || note === '' ? undefined : note;
}

/** A fresh `Expense` (only the contract's fields) from any expense-shaped value. */
function toExpense(src: Expense): Expense {
  const e: Expense = {
    id: src.id,
    title: src.title,
    amount: src.amount,
    currency: src.currency,
    paidBy: src.paidBy,
    date: src.date,
    category: src.category,
    split: cloneSplit(src.split),
  };
  const note = normNote(src.note);
  if (note !== undefined) e.note = note;
  return e;
}

function toPayment(src: Payment): Payment {
  const p: Payment = {
    id: src.id,
    from: src.from,
    to: src.to,
    amount: src.amount,
    currency: src.currency,
    date: src.date,
  };
  if (src.note !== undefined) p.note = src.note;
  return p;
}

function splitSumsTo(split: Readonly<Record<string, number>>, amount: number): boolean {
  const values = Object.values(split);
  if (values.length === 0) return false;
  let sum = 0;
  for (const v of values) sum += v;
  return Number.isSafeInteger(sum) && sum === amount;
}

function hostOf(server: string): string {
  return server.startsWith('https://') ? server.slice('https://'.length) : server;
}

/** What the first `member.added` for a member id (in fold order) says: the name it gave and who wrote it from where. */
interface FirstAdd {
  name: string;
  by: string;
  dev: string;
}

/** Pre-scan of the sorted, de-duplicated log: the first `member.added` per member id (the one the fold applies). */
function firstAdds(log: readonly LogEntry[]): Map<string, FirstAdd> {
  const out = new Map<string, FirstAdd>();
  for (const { event } of log) {
    if (event.type !== 'member.added' || out.has(event.member.id)) continue;
    out.set(event.member.id, { name: event.member.name, by: event.by, dev: event.dev });
  }
  return out;
}

class Fold {
  readonly state: GroupState = emptyState();
  private readonly lastWrite = new Map<string, Map<ExpenseField, Stamp>>();
  private readonly expenseTombstones = new Set<string>();
  private readonly paymentTombstones = new Set<string>();
  // Sets for the membership checks a hostile log can make long (10,000 claims of one member, 10,000 `member.done`
  // or `group.rotated` with distinct ids): an array scan and re-sort per event made those folds quadratic. The
  // state's arrays are filled from these in `finish`, in the same order as before.
  /** Device ids per member that claimed it; each member's `devices` is sorted once in `finish`. */
  private readonly claims = new Map<string, Set<string>>();
  /** Members marked done; `doneMembers` is materialised, sorted, in `finish`. */
  private readonly done = new Set<string>();
  /** localIds named by `group.rotated`, in fold order; `rotatedFrom` is materialised in `finish`. */
  private readonly rotated = new Set<string>();

  constructor(
    private readonly formatter: (minor: number) => string,
    private readonly selfLocalId: string | undefined,
    private readonly firstAdded: ReadonlyMap<string, FirstAdd>,
  ) {}

  /** Caller-supplied formatting must not be able to abort the fold. */
  private format(minor: number): string {
    try {
      const text = this.formatter(minor);
      return typeof text === 'string' ? text : String(minor);
    } catch {
      return String(minor);
    }
  }

  /** A member's current name; for use on targets, which are always ensured first. */
  private nameOf(memberId: string): string {
    return this.state.members.get(memberId)?.name ?? 'Someone';
  }

  /** The actor (`by`) of an event: the real member's name, else the name it is first added with anywhere in the log. */
  private actorName(memberId: string): string {
    const m = this.state.members.get(memberId);
    if (m !== undefined && !m.unknown) return m.name;
    return this.firstAdded.get(memberId)?.name ?? m?.name ?? 'Someone';
  }

  /** True if this claim only confirms a self-join: the member added itself from this very device. */
  private confirmsSelfJoin(ev: EventOf<'member.claimed'>): boolean {
    const add = this.firstAdded.get(ev.id);
    return ev.by === ev.id && add !== undefined && add.by === ev.id && add.dev === ev.dev;
  }

  /** Returns the member, creating an "Unknown" placeholder for a dangling reference. */
  private ensureMember(memberId: string): MemberState {
    const existing = this.state.members.get(memberId);
    if (existing !== undefined) return existing;
    const placeholder: MemberState = {
      id: memberId,
      name: 'Unknown',
      archived: false,
      devices: [],
      unknown: true,
      color: memberColor(memberId),
      initials: '?',
    };
    this.state.members.set(memberId, placeholder);
    return placeholder;
  }

  private emit(entry: LogEntry, summary: string): void {
    const { type, ts, at, by, dev } = entry.event;
    const item: ActivityItem = { eventId: entry.id, type, ts, at, by, dev, summary };
    this.state.activity.push(item);
  }

  /** Applies one entry and records an activity item unless the event was ignored or changed nothing. */
  apply(entry: LogEntry): void {
    const ev = entry.event;
    const actor = this.actorName(ev.by);
    const summary = this.dispatch(entry, ev, actor);
    if (summary !== null) this.emit(entry, summary);
  }

  /** Returns the activity summary, or null if the event was ignored or changed nothing. */
  private dispatch(entry: LogEntry, ev: Event, actor: string): string | null {
    const s = this.state;
    switch (ev.type) {
      case 'group.created': {
        if (s.created) return null;
        s.created = true;
        s.name = ev.name;
        s.currency = ev.currency;
        return `${actor} created the group`;
      }
      case 'group.renamed': {
        if (s.name === ev.name) return null;
        s.name = ev.name;
        return `${actor} renamed the group to ${ev.name}`;
      }
      case 'group.closed': {
        if (ev.to !== undefined && ev.to === this.selfLocalId) return null;
        const prev = s.closed;
        if (prev !== null && prev.reason === ev.reason && prev.to === ev.to) return null;
        s.closed = ev.to === undefined ? { reason: ev.reason } : { reason: ev.reason, to: ev.to };
        // Worded as the action the member took (Group settings, "Regenerate invite link").
        return `${actor} regenerated the invite link`;
      }
      case 'group.rotated': {
        if (this.rotated.has(ev.from)) return null;
        this.rotated.add(ev.from);
        return `${actor} regenerated the invite link`;
      }
      case 'group.moved': {
        if (s.movedTo === ev.server) return null;
        s.movedTo = ev.server;
        return `${actor} moved the group to ${hostOf(ev.server)}`;
      }
      case 'group.archived': {
        if (s.archived) return null;
        s.archived = true;
        return `${actor} archived the group`;
      }
      case 'group.unarchived': {
        if (!s.archived) return null;
        s.archived = false;
        return `${actor} unarchived the group`;
      }
      case 'member.added':
        return this.memberAdded(ev, actor);
      case 'member.updated':
        return this.memberUpdated(ev, actor);
      case 'member.claimed': {
        const m = this.ensureMember(ev.id);
        let devices = this.claims.get(ev.id);
        if (devices === undefined) {
          devices = new Set(m.devices);
          this.claims.set(ev.id, devices);
        }
        if (devices.has(ev.dev)) return null;
        const hadDevice = devices.size > 0;
        devices.add(ev.dev);
        m.devices.push(ev.dev); // fold-owned array; sorted in `finish`
        if (this.confirmsSelfJoin(ev)) return null; // the self-add already said "X joined"
        return hadDevice ? `${m.name} joined on a new device` : `${m.name} joined`;
      }
      case 'member.archived': {
        const m = this.ensureMember(ev.id);
        if (m.archived) return null;
        m.archived = true;
        return `${actor} archived ${m.name}`;
      }
      case 'member.unarchived': {
        const m = this.ensureMember(ev.id);
        if (!m.archived) return null;
        m.archived = false;
        return `${actor} unarchived ${m.name}`;
      }
      case 'member.done': {
        if (this.done.has(ev.id)) return null;
        const m = this.ensureMember(ev.id);
        this.done.add(ev.id);
        return `${m.name} is done adding expenses`;
      }
      case 'member.undone': {
        if (!this.done.has(ev.id)) return null; // before ensureMember: a no-op creates no placeholder
        this.done.delete(ev.id);
        return `${this.nameOf(ev.id)} is adding more expenses`;
      }
      case 'expense.added':
        return this.expenseAdded(entry, ev, actor);
      case 'expense.updated':
        return this.expenseUpdated(entry, ev, actor);
      case 'expense.deleted': {
        if (this.expenseTombstones.has(ev.id)) return null;
        this.expenseTombstones.add(ev.id);
        const e = s.expenses.get(ev.id);
        if (e === undefined) return null;
        s.expenses.delete(ev.id);
        this.lastWrite.delete(ev.id);
        e.updatedAt = Math.max(e.updatedAt, ev.at);
        e.history.push(this.history(entry, 'deleted', toExpense(e)));
        s.deletedExpenses.set(ev.id, e);
        return `${actor} deleted ${e.title}`;
      }
      case 'payment.added': {
        const p = ev.payment;
        if (s.payments.has(p.id) || this.paymentTombstones.has(p.id)) return null;
        const from = this.ensureMember(p.from);
        const to = this.ensureMember(p.to);
        const state: PaymentState = { ...toPayment(p), addedBy: ev.by, addedAt: ev.at };
        s.payments.set(p.id, state);
        return `${from.name} paid ${to.name} ${this.format(p.amount)}`;
      }
      case 'payment.deleted': {
        if (this.paymentTombstones.has(ev.id)) return null;
        this.paymentTombstones.add(ev.id);
        if (!s.payments.delete(ev.id)) return null;
        return `${actor} deleted a payment`;
      }
    }
  }

  private memberAdded(ev: EventOf<'member.added'>, actor: string): string | null {
    const rec = ev.member;
    const existing = this.state.members.get(rec.id);
    if (existing !== undefined && !existing.unknown) return null;
    const m: MemberState = {
      id: rec.id,
      name: rec.name,
      archived: existing?.archived ?? false,
      devices: existing?.devices ?? [],
      unknown: false,
      color: memberColor(rec.id),
      initials: initialsOf(rec.name),
    };
    if (rec.emoji !== undefined) m.emoji = rec.emoji;
    this.state.members.set(rec.id, m);
    return ev.by === rec.id ? `${rec.name} joined` : `${actor} added ${rec.name}`;
  }

  private memberUpdated(ev: EventOf<'member.updated'>, actor: string): string | null {
    const m = this.ensureMember(ev.id);
    const parts: string[] = [];
    const { name, emoji } = ev.changes;
    if (name !== undefined && name !== m.name) {
      parts.push(`${actor} renamed ${m.name} to ${name}`);
      m.name = name;
      m.initials = initialsOf(name);
    }
    if (emoji === null) {
      if (m.emoji !== undefined) {
        delete m.emoji;
        parts.push(`${actor} set ${m.name}'s avatar to initials`);
      }
    } else if (emoji !== undefined && emoji !== m.emoji) {
      m.emoji = emoji;
      parts.push(`${actor} set ${m.name}'s avatar to ${emoji}`);
    }
    return parts.length === 0 ? null : parts.join('; ');
  }

  private history(entry: LogEntry, kind: HistoryEntry['kind'], snapshot: Expense, changes?: ExpenseChanges): HistoryEntry {
    const { ts, at, by, dev } = entry.event;
    const h: HistoryEntry = { eventId: entry.id, ts, at, by, dev, kind, snapshot };
    if (changes !== undefined) h.changes = changes;
    return h;
  }

  private expenseAdded(entry: LogEntry, ev: EventOf<'expense.added'>, actor: string): string | null {
    const s = this.state;
    const rec = ev.expense;
    if (s.expenses.has(rec.id) || this.expenseTombstones.has(rec.id)) return null;
    this.ensureMember(rec.paidBy);
    for (const memberId of Object.keys(rec.split)) this.ensureMember(memberId);
    const expense = toExpense(rec);
    const state: ExpenseState = {
      ...expense,
      split: cloneSplit(expense.split),
      addedBy: ev.by,
      addedAt: ev.at,
      updatedAt: ev.at,
      history: [this.history(entry, 'added', expense)],
    };
    s.expenses.set(rec.id, state);
    const stamp = stampOf(entry);
    this.lastWrite.set(rec.id, new Map(EXPENSE_FIELDS.map((f) => [f, stamp] as const)));
    // Auto-clear: adding an expense shows the adder is not done. No separate activity item.
    this.done.delete(ev.by);
    return `${actor} added ${expense.title} · ${this.format(expense.amount)}`;
  }

  private expenseUpdated(entry: LogEntry, ev: EventOf<'expense.updated'>, actor: string): string | null {
    const s = this.state;
    if (this.expenseTombstones.has(ev.id)) return null;
    const e = s.expenses.get(ev.id);
    if (e === undefined) return null;
    const writes = this.lastWrite.get(ev.id) ?? new Map<ExpenseField, Stamp>();
    const stamp = stampOf(entry);
    const c = ev.changes;
    const wins = (field: ExpenseField): boolean => newer(stamp, writes.get(field));

    // Applied fields, narrated in a fixed order against the expense as it stands after each step.
    const parts: string[] = [];
    const applied: {
      title?: string;
      paidBy?: string;
      date?: string;
      category?: Category;
      note?: string;
    } = {};
    let money: { amount: number; split: Record<string, number> } | undefined;

    for (const field of EXPENSE_FIELDS) {
      if (!wins(field)) continue;
      switch (field) {
        case 'title': {
          if (c.title === undefined || c.title === e.title) break;
          parts.push(`${actor} renamed ${e.title} to ${c.title}`);
          e.title = c.title;
          applied.title = c.title;
          writes.set(field, stamp);
          break;
        }
        case 'money': {
          if (c.amount === undefined || c.split === undefined) break;
          if (c.amount === e.amount && sameSplit(c.split, e.split)) break;
          const payer = e.paidBy === ev.by ? '' : `${this.nameOf(e.paidBy)}'s `;
          parts.push(
            c.amount === e.amount
              ? `${actor} changed the split of ${payer}${e.title}`
              : `${actor} changed ${payer}${e.title} from ${this.format(e.amount)} to ${this.format(c.amount)}`,
          );
          for (const memberId of Object.keys(c.split)) this.ensureMember(memberId);
          e.amount = c.amount;
          e.split = cloneSplit(c.split);
          money = { amount: c.amount, split: cloneSplit(c.split) };
          writes.set(field, stamp);
          break;
        }
        case 'paidBy': {
          if (c.paidBy === undefined || c.paidBy === e.paidBy) break;
          const payer = this.ensureMember(c.paidBy);
          parts.push(`${actor} changed who paid for ${e.title} to ${payer.name}`);
          e.paidBy = c.paidBy;
          applied.paidBy = c.paidBy;
          writes.set(field, stamp);
          break;
        }
        case 'date': {
          if (c.date === undefined || c.date === e.date) break;
          parts.push(`${actor} changed the date of ${e.title}`);
          e.date = c.date;
          applied.date = c.date;
          writes.set(field, stamp);
          break;
        }
        case 'category': {
          if (c.category === undefined || c.category === e.category) break;
          parts.push(`${actor} changed the category of ${e.title}`);
          e.category = c.category;
          applied.category = c.category;
          writes.set(field, stamp);
          break;
        }
        case 'note': {
          if (c.note === undefined) break;
          const next = normNote(c.note);
          if (next === normNote(e.note)) break;
          parts.push(`${actor} edited the note on ${e.title}`);
          if (next === undefined) delete e.note;
          else e.note = next;
          applied.note = c.note;
          writes.set(field, stamp);
          break;
        }
      }
    }

    if (parts.length === 0) return null;
    this.lastWrite.set(ev.id, writes);
    const changes: ExpenseChanges =
      money === undefined ? { ...applied } : { ...applied, amount: money.amount, split: money.split };
    e.updatedAt = Math.max(e.updatedAt, ev.at);
    e.history.push(this.history(entry, 'updated', toExpense(e), changes));
    return parts.join('; ');
  }

  finish(): GroupState {
    const s = this.state;
    for (const m of s.members.values()) if (m.devices.length > 1) m.devices.sort(compareCodeUnits);
    s.doneMembers = [...this.done].sort(compareCodeUnits);
    s.rotatedFrom = [...this.rotated];

    // Flags: at most one per item; currency first.
    const flagged: FlaggedItem[] = [];
    for (const e of s.expenses.values()) {
      if (e.currency !== s.currency) flagged.push({ kind: 'expense', id: e.id, reason: 'currency_mismatch' });
      else if (!splitSumsTo(e.split, e.amount)) flagged.push({ kind: 'expense', id: e.id, reason: 'split_mismatch' });
    }
    for (const p of s.payments.values()) {
      if (p.currency !== s.currency) flagged.push({ kind: 'payment', id: p.id, reason: 'currency_mismatch' });
    }
    flagged.sort((a, b) => compareCodeUnits(a.kind, b.kind) || compareCodeUnits(a.id, b.id));
    s.flagged = flagged;
    const flaggedExpenses = new Set(flagged.filter((f) => f.kind === 'expense').map((f) => f.id));

    // Totals over non-flagged live expenses, in CATEGORIES order, non-zero only.
    const sums = new Map<Category, number>();
    for (const e of s.expenses.values()) {
      if (flaggedExpenses.has(e.id)) continue;
      sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
    }
    const order = (c: Category): number => {
      const i = CATEGORIES.indexOf(c);
      return i === -1 ? CATEGORIES.length : i;
    };
    const cats = [...sums.keys()].sort((a, b) => order(a) - order(b) || compareCodeUnits(a, b));
    s.totalsByCategory = new Map();
    for (const c of cats) {
      const total = sums.get(c) ?? 0;
      if (total !== 0) s.totalsByCategory.set(c, total);
    }

    // Placeholders still unknown at the end.
    s.unknownMembers = [...s.members.values()]
      .filter((m) => m.unknown)
      .map((m) => m.id)
      .sort(compareCodeUnits);

    // Name collisions among non-archived, non-placeholder members.
    const byName = new Map<string, string[]>();
    for (const m of s.members.values()) {
      if (m.archived || m.unknown) continue;
      const key = m.name.trim().toLowerCase();
      const ids = byName.get(key);
      if (ids === undefined) byName.set(key, [m.id]);
      else ids.push(m.id);
    }
    s.nameCollisions = [...byName.values()]
      .filter((ids) => ids.length >= 2)
      .map((ids) => [...ids].sort(compareCodeUnits))
      .sort((a, b) => compareCodeUnits(a[0] ?? '', b[0] ?? ''));

    // Everyone's done: every non-archived member with a claimed device is done, and there is at least one.
    const done = this.done;
    const joined = [...s.members.values()].filter((m) => !m.archived && m.devices.length > 0);
    s.allDone = joined.length > 0 && joined.every((m) => done.has(m.id));

    return s;
  }
}

/**
 * The entries the fold applies, in its order: sorted by `compareLog`, each envelope id once (the first), and held
 * entries left out (design.md "Ordering": a claimed `ts` more than a day past the latest R waits).
 */
export function liveLog(log: readonly LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const entries = sortLog(log).filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  const horizon = holdBackHorizon(entries);
  return entries.filter((entry) => !isHeldBack(entry, horizon));
}

/** Replays the log per design.md "Reducer". Pure. Every event in `log` has already passed parseEvent. */
export function reduce(log: readonly LogEntry[], options?: ReduceOptions): GroupState {
  const entries = liveLog(log);
  const fold = new Fold(
    options?.format ?? ((n: number) => String(n)),
    options?.selfLocalId,
    firstAdds(entries),
  );
  for (const entry of entries) fold.apply(entry);
  return fold.finish();
}
