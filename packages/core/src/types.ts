/**
 * The shared type contract for @even/core. Every module codes against these.
 * Source of truth for the shapes: even-app/design.md ("Body schema (v1)", "Reducer") and PROTOCOL.md (§4, §8).
 * Do not change a type here without updating design.md.
 */

export const CATEGORIES = [
  'food', 'groceries', 'drinks', 'coffee',
  'lodging', 'flights', 'transit', 'fuel', 'parking', 'rental',
  'activities', 'shopping', 'fees', 'health', 'gifts', 'other',
] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------- Records carried inside events ----------

export interface Member {
  id: string;            // 22-char base64url
  name: string;          // 1..LIMITS.nameMax, unique per group (UI-enforced; reducer flags collisions)
  emoji?: string;        // exactly one emoji grapheme cluster
}

export interface Expense {
  id: string;                     // 22-char base64url
  title: string;                  // 1..LIMITS.titleMax
  amount: number;                 // integer minor units per ISO 4217 exponent, LIMITS.amountMin..amountMax
  currency: string;               // ISO 4217 code; must equal the group currency (reducer flags otherwise)
  paidBy: string;                 // member id
  date: string;                   // YYYY-MM-DD
  category: Category;
  note?: string;                  // 0..LIMITS.noteMax
  split: Record<string, number>;  // member id → minor units ≥ 0; non-empty; values sum to amount
}

/** Field-level changes. `amount` and `split` travel together or not at all; `id` and `currency` never change. Non-empty. */
export type ExpenseChanges =
  Partial<Pick<Expense, 'title' | 'paidBy' | 'date' | 'category' | 'note'>> &
  ({ amount: number; split: Record<string, number> } | { amount?: undefined; split?: undefined });

export interface Payment {
  id: string;
  from: string;          // member id who paid
  to: string;            // member id who received; ≠ from
  amount: number;        // integer minor units, LIMITS.amountMin..amountMax
  currency: string;      // must equal the group currency
  date: string;          // YYYY-MM-DD
  note?: string;
}

// ---------- Events (the decrypted body) ----------

export interface EventBase {
  sv: 1;         // body schema version; bumped only for breaking changes
  ts: number;    // hybrid logical timestamp, unix ms; ordering only; LIMITS.tsMin ≤ ts < tsMax
  at: number;    // wall-clock unix ms on the creating device; display only; same range
  by: string;    // member id claimed by the creating device
  dev: string;   // device id of the creating device (self-asserted)
}

export type EventPayload =
  | { type: 'group.created'; name: string; currency: string }        // name: 1..LIMITS.groupNameMax, trimmed
  | { type: 'group.renamed'; name: string }
  | { type: 'group.closed'; reason: 'rotated'; to?: string }         // written into the OLD group; `to` = new localId
  | { type: 'group.rotated'; from: string }                          // written into the NEW group; `from` = old localId
  | { type: 'group.moved'; server: string }                          // canonical https origin
  | { type: 'group.archived' }                                       // read-only by choice; still syncs; independent of group.closed
  | { type: 'group.unarchived' }
  | { type: 'member.added'; member: Member }
  | { type: 'member.updated'; id: string; changes: { name?: string; emoji?: string | null } }
  | { type: 'member.claimed'; id: string }                           // `dev` is the claiming device
  | { type: 'member.archived'; id: string }
  | { type: 'member.unarchived'; id: string }
  | { type: 'member.done'; id: string }                              // "I'm done adding"; `by` is normally `id`, not required
  | { type: 'member.undone'; id: string }
  | { type: 'expense.added'; expense: Expense }
  | { type: 'expense.updated'; id: string; changes: ExpenseChanges }
  | { type: 'expense.deleted'; id: string }
  | { type: 'payment.added'; payment: Payment }
  | { type: 'payment.deleted'; id: string };

export type Event = EventBase & EventPayload;
export type EventType = EventPayload['type'];
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;

/** One entry of a group's log as the reducer sees it: the envelope id (tie-break key) plus the decrypted, validated body. */
export interface LogEntry {
  id: string;     // envelope id, 22-char base64url
  event: Event;
  /**
   * When the server first stored this envelope in its current epoch (R, Unix ms; PROTOCOL.md §4), as this phone last
   * heard it: absent until a push response, a pulled page or a group file reports one. Outside the ciphertext, so
   * never part of the body. A value that is not `isReceivedAt` counts as absent (design.md "Ordering").
   */
  receivedAt?: number;
}

// ---------- Wire shapes (PROTOCOL.md) ----------

export interface Envelope {
  id: string;   // 22 chars base64url, random
  v: 1;
  n: string;    // 32 chars base64url (24-byte nonce)
  c: string;    // base64url ciphertext; decoded length is a multiple of 256, ≤ 8192
}
export interface StoredEnvelope extends Envelope {
  seq: number;
  /** R, PROTOCOL.md §4: when the server first stored it in this epoch. Absent from a server that predates it. */
  received_at?: number;
}

/** Invite payload (PROTOCOL.md §8.2). Encoded as base64url(JSON). */
export interface Invite {
  v: 1;
  s: string;      // canonical server URL (§8.1)
  k: string;      // secret, 43 chars base64url
  h: string;      // checksum: first 4 bytes of SHA-256(secret bytes), base64url, 6 chars
  g?: string;     // group name
  cur?: string;   // ISO 4217 currency
}

// ---------- Derived state (output of reduce) ----------

export interface MemberState {
  id: string;
  name: string;
  emoji?: string;
  archived: boolean;
  devices: string[];     // device ids that claimed this member, sorted
  unknown: boolean;      // placeholder created for a dangling reference
  color: number;         // 0..AVATAR_COLOR_COUNT-1, from a hash of the id
  initials: string;      // 1–2 uppercase characters from the name
}

export interface HistoryEntry {
  eventId: string;
  ts: number;
  at: number;
  by: string;
  dev: string;
  kind: 'added' | 'updated' | 'deleted';   // 'deleted' is the last entry of an expense in GroupState.deletedExpenses
  changes?: ExpenseChanges;   // for 'updated'
  snapshot: Expense;          // the expense as it stood AFTER this entry was applied (for 'deleted': as it stood when deleted)
}

export interface ExpenseState extends Expense {
  addedBy: string;
  addedAt: number;       // `at` of the adding event
  updatedAt: number;     // `at` of the latest applied event
  history: HistoryEntry[];
}

export interface PaymentState extends Payment {
  addedBy: string;
  addedAt: number;
}

export interface ActivityItem {
  eventId: string;
  type: EventType;
  ts: number;
  at: number;
  by: string;
  dev: string;
  summary: string;       // human sentence, e.g. "Maya changed Nathan's Food from 100.00 to 10.00"
}

export type FlagReason = 'split_mismatch' | 'currency_mismatch' | 'unknown_member';

export interface FlaggedItem {
  kind: 'expense' | 'payment';
  id: string;
  reason: FlagReason;
}

export interface GroupState {
  created: boolean;                       // a group.created has been seen
  name: string;
  currency: string;
  closed: { reason: 'rotated'; to?: string } | null;
  archived: boolean;                      // latest of group.archived / group.unarchived; independent of `closed`
  rotatedFrom: string[];                  // localIds named by group.rotated events
  movedTo: string | null;                 // server from the latest group.moved, or null
  members: Map<string, MemberState>;
  doneMembers: string[];                  // member ids marked done adding, sorted; placeholders included
  allDone: boolean;                       // every non-archived member with a claimed device is done, and there is at least one
  expenses: Map<string, ExpenseState>;    // live (non-deleted) expenses only
  deletedExpenses: Map<string, ExpenseState>; // tombstoned expenses, history ending in a 'deleted' entry; never in balances or totals
  payments: Map<string, PaymentState>;    // live only
  activity: ActivityItem[];               // every applied event, in (ts, id) order
  totalsByCategory: Map<Category, number>; // over non-flagged live expenses
  flagged: FlaggedItem[];                 // excluded from balances and totals
  unknownMembers: string[];               // ids referenced but never added
  nameCollisions: string[][];             // groups of member ids sharing a name (case-insensitive, trimmed), non-archived
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;   // minor units > 0
}
