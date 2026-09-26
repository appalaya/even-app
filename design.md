# Design — Even

Architecture decisions and patterns. This document is the reference for how
the app is structured and why. The sync contract is in
`../even-server/PROTOCOL.md`; this document covers everything on the phone,
including the parts the server never sees.

## Stack

- **Framework**: React Native + Expo (Expo Router), managed workflow, npm workspaces
- **Platform floor**: iOS 27 and the Android version Expo SDK 58 supports. Expo
  SDK 58 (React Native 0.88) is the first SDK built for iOS 27; it requires
  Xcode 27 and generates the UIKit scene-based lifecycle that iOS 27 apps must
  use. Start on the SDK 58 beta and move to stable when it lands; do not start
  on SDK 57, since apps built with it need opt-in scene support and Expo's
  Xcode 27 build images arrive with 58.
- **Language**: TypeScript, strict
- **Local database**: SQLite via expo-sqlite
- **Secrets**: expo-secure-store, accessibility `AFTER_FIRST_UNLOCK` so background refresh can read keys while the phone is locked
- **Crypto**: `@noble/ciphers` (XChaCha20-Poly1305), `@noble/hashes` (SHA-256, HKDF); randomness via `globalThis.crypto.getRandomValues`, polyfilled once at app entry from `expo-crypto`
- **State**: React Context + hooks over a memoised per-group derived state; SQLite is the source of truth
- **Background**: expo-background-task, expo-notifications (local only)
- **Tests**: Vitest for `packages/core`; the app has no simulator-based test suite in v1

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                       Screens                        │
│   Groups  │  Group (balances · expenses · activity)  │
│   Add/Edit expense sheet · Settle sheet · Settings   │
├──────────────────────────────────────────────────────┤
│                  Group state (context)                │
│   derived state = reduce(decrypt(envelopes)), memoised│
├──────────────────────────────────────────────────────┤
│                     packages/core                     │
│  events · schema · reduce · balances · simplify       │
│  keys · envelope (seal/open) · invite · hlc · money   │
├───────────────────────┬──────────────────────────────┤
│   SQLite (envelopes,  │   Sync engine                │
│   groups, cursors)    │   outbox → push → pull → merge│
│   Secure store (keys) │   HTTP transport · group file │
└───────────────────────┴──────────────────────────────┘
```

Two rules make this shape hold:

1. **`packages/core` has no React Native or Expo imports.** It is plain
   TypeScript with its own `package.json`, tested in Node under Vitest. It
   defines the event schema, the reducer, the money math, and the crypto.
   Screens call it; they never reimplement it. Metro resolves it through npm
   workspaces.
2. **No decrypted content on disk, with two named exceptions.** SQLite holds
   envelopes. Bodies are decrypted on open, held in memory per group, and
   discarded when the group closes. The exceptions: each event's ordering
   timestamp `ts` (a number, no content) and the group's current name (also
   plaintext in the invite), both cached for the Groups list and for cheap
   ordering. Notification text is handed to the OS and is covered in the
   threat model. This is what makes device backups safe to allow.

## Identity model

There are no accounts. Four ids exist:

| Id | Scope | Format | Where it lives | Purpose |
|---|---|---|---|---|
| **Device id** | This install | 22-char base64url, random | secure store | Tags every event this device creates. Self-asserted; detects accidental double-claims, not impersonation. |
| **Member id** | A group | 22-char base64url, random | inside the log | A named seat in the group. "Maya." |
| **Local group id** | Global | 43-char, derived from the secret | SQLite key | Server-independent identity of the group on this phone. |
| **Server group id** | One server | 43-char, derived from secret + server origin | computed on demand | The id in URLs. Different on every server. |

A device *claims* a member id when it joins ("Which one are you?"). The claim
is stored locally in `groups.my_member_id`, stamped as `by` on events, and
also written to the log as `member.claimed`, so every phone knows which
members have joined and from how many devices. Two devices may claim the same
member (phone plus tablet). The join screen shows "joined" next to claimed
names, and tapping one asks "Is that you on another phone, or are you a
different Maya?"; the second answer adds a new member with a different name.
The activity feed shows the device id's short form next to the member name,
so the group can see that "Maya" is posting from two places.

**Names are unique within a group**, compared case-insensitively and ignoring
surrounding whitespace, among non-archived members. The UI refuses to add a
duplicate and suggests a last initial. The reducer cannot refuse (two devices
can add "Maya" concurrently while offline), so it keeps both, flags the
collision, and the UI shows a "two members named Maya, rename one" banner
until it is resolved.

**Avatars.** Every member renders as initials on a colour chosen from a fixed
twelve-colour palette by a hash of the member id, identical on every phone
with no choice made. A member may optionally set one emoji, stored on the
member record in the log, which replaces the initials. No photos. A local
"me" default, name and emoji, is kept in a `prefs` table and prefilled on
every join and create.

## Keys

From `../even-server/PROTOCOL.md` §2. Implemented once in `core/keys.ts`:

```ts
deriveLocal(secret: Uint8Array): { encryptionKey: Uint8Array; localId: string }
deriveServer(secret: Uint8Array, origin: string): { authToken: Uint8Array; groupId: string }
canonicalOrigin(url: string): string        // protocol §8.1; throws on http://
```

- The **secret** (32 bytes) is stored in secure store under
  `even.secret.<localId>`, accessibility `AFTER_FIRST_UNLOCK`.
- Derived keys are computed on demand and held in memory only while a group
  is open. They are never written to SQLite.
- The **device id** is stored in secure store under `even.device`.

Secure store also holds an index, `even.groups`, listing the local ids that
have a secret, because secure store cannot enumerate keys. On iOS the keychain
is backed up and survives uninstall, so a restore or reinstall can list the
index, recover each secret, and re-pull the logs. On Android the keystore
wrapping key is not restorable, so a restored Android phone has ciphertext
without keys; recovery there is a re-shared invite or the group file. The
privacy page states both.

## Event log

A group is an ordered set of immutable events. Every device holds all of them.
State is never stored; it is derived by replaying the log through a pure
reducer. Replaying a few thousand events takes single-digit milliseconds and
the result is memoised per group.

### Envelope vs body

- **Envelope** (`{ id, v, n, c }`, plus `seq` from the server) is defined in
  the protocol and is what SQLite's `events.envelope` column holds.
- **Body** is the decrypted JSON below. It exists only in memory.

### Body schema (v1)

Common fields on every event:

```ts
{
  sv: 1,                 // body schema version; bumped only for breaking changes
  type: string,          // see table
  ts: number,            // hybrid logical timestamp, unix ms; ordering only
  at: number,            // wall-clock unix ms on the creating device; display only
  by: string,            // member id claimed by the creating device
  dev: string            // device id of the creating device
}
```

| `type` | Payload | Notes |
|---|---|---|
| `group.created` | `{ name, currency }` | The one with the smallest `(ts, id)` wins; others are ignored. `name` is 1..80 characters (`LIMITS.groupNameMax`). `currency` is an ISO 4217 code and is immutable for the life of the group. |
| `group.renamed` | `{ name }` | `name` as in `group.created`. |
| `group.closed` | `{ reason: 'rotated', to?: localId }` | Written into the **old** group by whoever rotates. Reducer marks the group read-only with "ask a member for the new invite." |
| `group.rotated` | `{ from: localId }` | Written into the **new** group by whoever rotates. Any such event, not necessarily the first, links the groups. |
| `group.moved` | `{ server: string }` | Written into the group before the writer switches servers. Receivers are offered "follow to <host>". |
| `member.added` | `{ member: Member }` | For a self-add during join, `by` is the new member's own id. |
| `member.updated` | `{ id, changes: { name?, emoji? \| null } }` | Field-level last-writer-wins. `emoji: null` clears it. |
| `member.claimed` | `{ id }` | Written by a device when it picks its name. `dev` identifies the device. Idempotent per `(id, dev)`. |
| `member.archived` | `{ id }` | Hidden from pickers; balances retained. |
| `member.unarchived` | `{ id }` | |
| `expense.added` | `{ expense: Expense }` | |
| `expense.updated` | `{ id, changes: ExpenseChanges }` | Field-level last-writer-wins by `(ts, id)`, with `amount` + `split` as one atomic field. |
| `expense.deleted` | `{ id }` | Tombstone. Final; later updates are ignored. |
| `payment.added` | `{ payment: Payment }` | A settlement from one member to another. |
| `payment.deleted` | `{ id }` | Tombstone. |

```ts
interface Member {
  id: string;            // 22-char random
  name: string;          // 1..40 chars, unique per group (UI-enforced)
  emoji?: string;        // exactly one emoji grapheme cluster, ≤ 16 code points
}

type Category =
  | 'food' | 'groceries' | 'drinks' | 'coffee'
  | 'lodging' | 'flights' | 'transit' | 'fuel' | 'parking' | 'rental'
  | 'activities' | 'shopping' | 'fees' | 'health' | 'gifts' | 'other';

interface Expense {
  id: string;            // 22-char random
  title: string;         // 1..80 chars
  amount: number;        // integer minor units per ISO 4217 exponent, 1..1_000_000_000_000
  currency: string;      // ISO 4217; must equal the group currency
  paidBy: string;        // member id
  date: string;          // YYYY-MM-DD, the day it happened
  category: Category;    // inferred from the title, one tap to change
  note?: string;         // 0..500 chars
  split: Record<string, number>;   // member id → minor units ≥ 0; non-empty; values sum to amount
}

type ExpenseChanges =
  Partial<Pick<Expense, 'title' | 'paidBy' | 'date' | 'category' | 'note'>> &
  ({ amount: number; split: Record<string, number> } | { amount?: never; split?: never });
  // id and currency are never changeable; amount and split travel together or not at all

interface Payment {
  id: string;
  from: string;          // member id who paid
  to: string;            // member id who received; must differ from `from`
  amount: number;        // integer minor units, 1..1_000_000_000_000
  currency: string;      // must equal the group currency
  date: string;
  note?: string;
}
```

**Minor units, not cents.** `amount` is an integer in the currency's smallest
unit. JPY has exponent 0, KWD has 3. `core/money.ts` ships a **frozen ISO 4217
exponent table** and is the only place that converts between minor units and
display. It passes the exponent explicitly as `minimumFractionDigits` and
`maximumFractionDigits` to `Intl.NumberFormat`, because the CLDR data behind
`Intl` disagrees with ISO for several currencies and varies by OS version;
two phones must never read the same integer as amounts 100× apart.

**Splits are stored resolved.** The UI offers equal / exact / percent, but the
event carries the final minor units per member. Changing the rule later never
rewrites history, and the reducer never needs to know how a split was chosen.

**Categories.** Sixteen, fixed, each with one emoji, defined once in
`core/categories.ts`:

| Category | Emoji | Category | Emoji |
|---|---|---|---|
| food | 🍽️ | activities | 🎟️ |
| groceries | 🛒 | shopping | 🛍️ |
| drinks | 🍻 | fees | 🧾 |
| coffee | ☕ | health | 💊 |
| lodging | 🏨 | gifts | 🎁 |
| flights | ✈️ | other | 📌 |
| transit | 🚕 | | |
| fuel | ⛽ | | |
| parking | 🅿️ | | |
| rental | 🚗 | | |

The same file holds a keyword table (`parking`, `parkade`, `meter` → parking;
`uber`, `lyft`, `taxi`, `cab`, `bus`, `train`, `gondola` → transit; `gas`,
`fuel`, `petrol`, `shell`, `esso` → fuel; `hotel`, `airbnb`, `motel`, `hostel`,
`lodge` → lodging; `dinner`, `lunch`, `breakfast`, `pizza`, `sushi`, …).
`inferCategory(title)` lowercases, matches on word boundaries, prefers the
longest matching keyword, and returns `other` when nothing matches. It runs
on every keystroke and fills the category chip; one tap changes it. It is
deterministic, offline, and identical on every phone. Splitwise does the same
thing with a bigger taxonomy.

**Model refinement.** When the user pauses typing (500 ms) and the device has
an on-device language model, the title is sent to it with guided generation
constrained to the `Category` enum, and the answer replaces the keyword guess
on the chip. On iOS 27 this is `SystemLanguageModel` from the Foundation
Models framework behind a one-function Expo module,
`classifyExpense(title) → Category | null`, gated on
`SystemLanguageModel.availability`. On Android it is Gemini Nano through the
ML Kit GenAI prompt API where the device has it. **Only the on-device model,
ever**: the same API can route to Private Cloud Compute or to a cloud provider
through the provider protocol, and a title must never leave the phone. The
model handles the long tail the table cannot ("Sunshine Village lift",
"Fairmont", "Nourish"); the table remains the instant, universal baseline.
The model's accuracy is checked with Apple's Evaluations framework against a
labelled title set kept in the repo; the table with a unit test.

**Chip state machine.** The category chip holds `{ category, source }` with
`source ∈ keyword | model | user`, and these rules prevent the model from
overwriting a choice the user has made:

- A user tap sets `source = user`, cancels any in-flight model request, and
  drops any reply that arrives afterwards. Later title edits do not re-infer.
- Keyword inference runs on a keystroke only while `source = keyword`.
- Each model request carries the exact title it was asked about. A reply is
  applied only if that title still matches the field and `source` is still
  `keyword`; otherwise it is discarded.
- Tapping Save freezes the chip; the event carries whatever it shows.
- When the model changes the chip, the swap animates and shows "suggested"
  for a moment, so a change the user did not make is never invisible.

Replies and taps are both handled on the JavaScript thread in arrival order,
so there is no window in which a user tap can be lost.

Either way, inference is only a default: the event carries the category that
was on the chip at save time, never the guess, so no two phones ever need to
agree on an inference. No learning from overrides in v1.

**Rounding.** Equal splits are `floor(amount / n)` per member. Percent splits
use integer basis points and `floor(amount × bp / 10000)`, computed in
`BigInt` because `amount` may reach 10¹² and the product exceeds 2⁵³. In both
cases the remaining units are distributed one each, starting at an index
derived from a hash of the expense id and proceeding in member-id order, so
the leftover unit does not always land on the same person. For percent splits
the remainder goes only to members with bp > 0 (the start index is taken over
that subset), so a member at 0% never owes a unit. `core` has a
property test: for any amount and any member set, splits sum to the amount.
Before sealing, the client checks the padded body fits the event size limit
(`pad` throws `too_large`). With members capped at 50, an expense never
exceeds it: the largest valid `expense.added` (80-character title and
500-character note of characters JSON escapes to 6 bytes each, 50 members,
maximum amount and timestamps) is 5,656 bytes of the 8,175 allowed, sealing to
5,888; `core/integration.test.ts` pins this.

### Validation

`core/schema.ts` exports `parseEvent(json: unknown): Event | null` built on
Zod. It never throws. It enforces every bound above plus:

- `by`, `dev`, member ids, expense ids, and payment ids are 22-char base64url.
- `ts` and `at` are integers in the absolute range `[1_704_067_200_000, 4_102_444_800_000)`
  (2024-01-01 to 2100-01-01). Never relative to "now", so a valid event can
  never become invalid later.
- Group names (`group.created`, `group.renamed`) are 1..80 code points
  (`LIMITS.groupNameMax`), member names 1..40 (`LIMITS.nameMax`); both
  without leading or trailing whitespace. The invite's `g` shares the 80
  bound: `makeInvite` enforces the group-name rule, `decodeInvite` accepts any
  string up to 80 code points, since `g` is display-only and must never make a
  valid secret unusable.
- `split` is non-empty, every value ≥ 0, values sum to `amount`. A value of
  `-0` (the JSON text `-0`) is normalised to `0`.
- `changes` is non-empty, contains both `amount` and `split` or neither, and
  if both, the sum rule holds. `changes` is strict: `id`, `currency`, or any
  key that is not an `Expense` field rejects the event.
- `from ≠ to` on payments.
- `emoji`, when present, is a single grapheme cluster of emoji code points.
- `group.moved.server` is a canonical `https` origin (protocol §8.1), meaning
  exactly `canonicalOrigin(server) === server` with `core/keys.ts`'s
  canonicaliser, the same function invites and `deriveServer` use, so the
  three can never disagree about what a server is.
- Unknown `type` → null. Unknown `sv` → null. Unknown **fields** on a known
  `sv` in `expense.added`, `payment.added`, and group/member events are
  stripped, not rejected, so additive changes do not orphan old clients.

The reducer only ever sees events that passed.

Referential checks (a `paidBy` that names no member, a split naming a member
that does not exist yet) are the **reducer's** job, not the validator's,
because the referenced member may arrive in a later sync. The reducer treats a
dangling reference as "unknown member" and still counts the money, so balances
never silently drop an amount.

### Ordering

Every event carries a hybrid logical timestamp:

```
ts = max(Date.now(), lastSeenTs + 1)
```

where `lastSeenTs` is the largest `ts` among the group's events that is not
more than 24 hours ahead of this device's clock at write time. Events further
ahead are still applied, but they do not drag the group clock forward, so one
phone set years ahead cannot push everyone's timestamps into the future. The
rule is stateless: it is evaluated against the current clock each time an
event is written, and no receive times are stored.

An event that **targets an existing entity** (`expense.updated`,
`expense.deleted`, `payment.deleted`, `member.*` with an `id`) additionally
takes `ts = max(that, maxTs(entity) + 1)`, where `maxTs(entity)` is the
largest `ts` among events already targeting that entity, however far ahead.
This guarantees an edit or delete sorts after the thing it edits even when
the original came from a fast clock; the elevated value is still not absorbed
into the group clock.

If the device clock is outside the validator's absolute range, the app
refuses to write and shows a "check your phone's date" message rather than
producing events that fail validation everywhere. The same applies when the
computed `ts` would reach the top of the range: an entity whose latest event
sits at `tsMax − 1` (only a far-future clock can put it there) cannot be
edited, because its edit would need `ts = tsMax`. Every write is therefore
gated on `canWrite(nowMs, log, targetId?)` from `core/hlc.ts`, which is
`isClockSane(nowMs) && nextTs(nowMs, log, targetId) < tsMax`.

`at` is the plain wall clock and is what the activity feed shows. `ts` is
never displayed.

This is enough for last-writer-wins on `expense.updated`; it is not a full
CRDT and does not need to be. Two devices editing the same field while both
are offline resolve by `(ts, id)`, which is a coin toss weighted by clock. That
is acceptable for a trip app, and the activity feed shows both edits.

Server `seq` is never used for ordering state. It is only a sync cursor.

### Reducer

`core/reduce.ts` exports `reduce(log: LogEntry[], options?): GroupState`,
where each `LogEntry` is `{ id: envelopeId, event }`. It sorts by `(ts, id)`,
replays each envelope id once, and folds:

- `expense.updated` applies each field only if the event's `(ts, id)` is newer
  than the last write to that field; `amount`+`split` is one field.
  `expense.deleted` sets a tombstone that subsequent updates cannot clear.
- An expense or payment whose currency differs from the group's, or whose
  split does not sum to its amount, is **excluded** from balances and listed
  in `flagged`, with the reason. These cannot be produced by a correct
  client; they are defence against old or hostile ones.
- `member.archived` sets a flag; the member stays in every map.
- `member.claimed` adds `dev` to the member's device set. When it only
  confirms a self-join (the member added itself from this same device), it
  produces no activity item, since the self-add already reads "Maya joined".
  A name collision among non-archived members sets `nameCollisions`.
- Every event targeting an expense is kept in that expense's `history`, in
  order, so the detail screen can show versions and restore one. A restore is
  an ordinary `expense.updated` carrying that version's fields (`amount` and
  `split` together). A deleted expense leaves `expenses` for
  `deletedExpenses`, its history ending in a `deleted` entry, so the activity
  feed can still open it; it never counts in balances or totals.
- An actor (`by`) that is not a member at that point in the fold is named
  from the first `member.added` for that id anywhere in the log, so summaries
  say "Someone" only for an id that is never added. A `format` callback that
  throws (for example `formatMinor` on a shape-valid but unknown currency)
  falls back to the plain integer for that summary; the fold never aborts.
- Unknown member references create a placeholder member named "Unknown" with
  the raw id, flagged, so the UI can show it.
- All maps keyed by ids are `Map`s, never plain objects, so an id such as
  `__proto__` is just a key.
- `group.closed` sets `closed = true` unless its `to` equals this group's own
  `localId` (which can only happen if a control event was copied by mistake);
  the UI makes the group read-only and shows the reason.
- `group.moved`: only the latest by `(ts, id)` counts, and only if its
  `server` differs from the group's current `server_url`.

`GroupState` contains the group meta, members (with device sets and
avatars), live expenses (each with its history), deleted expenses (with their
history), live payments, spend totals by category, the activity list (every
applied event, in order, with a human summary such as "Maya changed Nathan's
Food from 100.00 to 10.00"), `flagged`, `unknownMembers`, and
`nameCollisions`. The skipped counts (`undecryptable`, `invalid`,
`unsupported_envelope`, `unsupported_body`) are not reducer output, since the
reducer only sees valid events; they come from the `events.status` column.

### Balances and simplification

```
net[m] = Σ paid[m] − Σ share[m] + Σ paymentsSent[m] − Σ paymentsReceived[m]
```

Σ net over all members is zero by construction over the non-flagged set;
`core` asserts it in tests. `nets` accumulates in `BigInt` and converts at
the end, so only a final net outside the safe-integer range throws
(`RangeError`). That takes a hostile log (10,000 events of 10¹² minor units
owed by one member); the app wraps `nets` and shows "balances unavailable"
for that group rather than crashing.

`simplify(net)` is greedy: sort creditors and debtors descending by amount,
ties broken by member id, repeatedly match the largest debtor with the largest
creditor, emit a transfer of the smaller magnitude, and advance whichever hits
zero. Deterministic, so every phone shows the same settle list. Produces at
most `members − 1` transfers. Optimal transfer *count* is NP-hard in general
and nobody needs it for a trip.

### Schema evolution

- `sv` is bumped only for breaking changes. Additive fields ride on the
  current `sv`; old clients strip them. Because updates are field-level, an
  old client's edit never overwrites a field it does not know about.
- If any **money** event (expense or payment) is skipped as unsupported or
  `invalid`, the group screen shows a hard "Update Even to see everything in
  this group" banner, not just a counter, because balances are known to be
  incomplete.

## Local storage

### SQLite schema

```sql
CREATE TABLE groups (
  local_id        TEXT PRIMARY KEY,   -- derived from the secret, server-independent
  server_url      TEXT NOT NULL,      -- canonical form (protocol §8.1)
  epoch           TEXT,               -- last epoch seen from server_url; null until first sync
  cursor          INTEGER NOT NULL DEFAULT 0,
  my_member_id    TEXT,               -- null until claimed
  name_cache      TEXT,               -- group name: seeded from the invite's `g`, updated from group.created/renamed on sync
  currency_cache  TEXT,               -- from the invite's `cur`, confirmed by group.created
  created_at      INTEGER NOT NULL,
  last_synced_at  INTEGER,
  last_sync_error TEXT,               -- protocol error code, 'epoch_unstable', or null
  state           TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'closed' | 'hidden' | 'blocked'
  epoch_resets_this_cycle INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE prefs (                  -- local, never synced: default name/emoji for joins, toggles
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE pending_deletes (        -- server copies we still owe a DELETE to
  local_id   TEXT NOT NULL,
  server_url TEXT NOT NULL,
  PRIMARY KEY (local_id, server_url)
);

CREATE TABLE events (
  local_id   TEXT NOT NULL,
  id         TEXT NOT NULL,
  origin     TEXT NOT NULL,                -- 'local' (this device wrote it) | 'remote'; never synced
  acked      INTEGER NOT NULL DEFAULT 0,   -- 1 once the current server has acknowledged it
  seq        INTEGER,                      -- from the current server; null if unknown
  ts         INTEGER,                      -- from the body, cached for cheap ordering; null if unreadable
  envelope   TEXT NOT NULL,                -- JSON, ciphertext for the CURRENT server's group id
  status     TEXT NOT NULL,                -- 'ok' | 'undecryptable' | 'invalid' | 'unsupported_envelope' | 'unsupported_body'
  push_state TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'rejected'
  PRIMARY KEY (local_id, id)
);
CREATE INDEX events_outbox ON events (local_id) WHERE acked = 0 AND push_state = 'pending';
CREATE INDEX events_ts     ON events (local_id, ts);
```

- **The outbox is a query, not a table**: `acked = 0 AND push_state = 'pending'`.
  Rows inserted from a pull are inserted with `acked = 1`.
- **The cursor and epoch are per group per server.** Changing `server_url`
  re-encrypts every readable envelope for the new group id, resets `cursor`
  to 0, clears `epoch`, sets `acked = 0` and `push_state = 'pending'`
  everywhere so the whole log is replayed to the new server, and **drops**
  `undecryptable` and `unsupported_envelope` rows, which cannot be
  re-encrypted (relabelling them would forge the associated data).
- `ts` cached from the body and `name_cache` are the two pieces of decrypted
  information kept on disk, as stated under Architecture.
- `status = 'undecryptable'` rows (AEAD failure under the correct key) are
  capped at 1,000 per group; beyond that the oldest are dropped, and settings
  offers "clear unreadable entries". `invalid`, `unsupported_envelope`
  (unknown `v`, cannot be opened) and `unsupported_body` (opened, unknown
  `sv` or `type`) rows are kept, since a future client may read them.
- `origin` is what makes rotation safe: only `local` rows are ever carried
  from an old group into its rotated successor.
- Secrets are **not** in SQLite.

### Migrations

`PRAGMA user_version` with an ordered array of migration functions, run at
open. Same pattern as Stow.

## Sync engine

`src/services/sync/` — one engine, one HTTP transport, plus group-file I/O.

### Triggers

- App comes to foreground
- After any local write, debounced 1 s
- Pull-to-refresh on the group screen
- Background task (below)
- Group opened for the first time after join

### Cycle, per group

Only groups in state `active` sync. `closed`, `hidden`, and `blocked` groups
never sync and never self-heal, except the single recognition sync described
under Rotation.

1. **Push**: select outbox events in `ts` order, send in batches of
   `min(max_batch, current batch size)`. On `200`, mark **every** envelope in
   the batch `acked = 1` (accepted or duplicate). Apply the epoch rule below to
   the response.
2. **Pull**: `GET …?since=cursor` while `more`. Apply the epoch rule **before**
   committing the page. For each envelope: check its structure and `v` with
   `envelopeShape` from `core/envelope.ts`, which accepts any positive
   integer `v` (not ok → `undecryptable`: junk a conforming server never
   returns; ok with `v ≠ 1` → `unsupported_envelope`, kept per protocol §10);
   `isEnvelope` is the strict v1 check and is not used for this step. Then
   open with AAD for this server's group id (fail → `undecryptable`);
   `parseEvent` (fail → `invalid`, unknown `sv`/`type` → `unsupported_body`);
   else `ok`, cache `ts`. Insert with `acked = 1`,
   `origin = 'remote'`, ignore if present; on conflict set `acked = 1` and
   `seq`. Commit each page **and** the cursor update in one SQLite
   transaction. Update `name_cache` from any `group.created`/`group.renamed`.
3. **Recompute**: invalidate the group's memoised state; observers re-render.
4. Record `last_synced_at` or `last_sync_error`; reset
   `epoch_resets_this_cycle`.

**Epoch rule.** If no epoch is stored and the response carries one, store it
and continue. If the response's epoch differs from the stored one, or is
`null` where one is stored: if `epoch_resets_this_cycle` is already 1, stop
the group with `last_sync_error = 'epoch_unstable'`; otherwise increment it,
store the new epoch (or `'unknown'` for `null`), set `cursor = 0`, set
`acked = 0` on every event, and restart the cycle. The group's full log is
re-pushed (the server ignores what it already has) and re-pulled. This is the
self-heal for expiry, accidental deletion, and server replacement, and it
costs at most one full log's worth of traffic, up to the server's group cap.

**410 group_blocked.** Set `state = 'blocked'`, stop, and show "This server
refuses this group." The user can move the group to another server, which
resets the state to `active`.

Groups sync sequentially; a failure in one does not block others.

### Error handling

| Server error | App behaviour |
|---|---|
| network / 5xx / 429 / 503 | Silent; exponential backoff per group (30 s → 2 m → 10 m, reset on success), or `Retry-After` when the server sends one. On the third consecutive 5xx for the same batch, halve the batch size (floor 1). Sync state shows "Not synced since …". |
| `unauthorized` | Cannot happen for a correctly joined group. Treated as a bug: log locally, back off, show "Can't reach this group's server" with the URL. |
| `not_found` / `method_not_allowed` on a documented route | Show "That URL isn't an Even server. Check the address." |
| `group_blocked` | Terminal for this server; see above. |
| `group_full` | Stop pushing. Show the cap, the group's local usage, and offer export. |
| `unsupported_version` | Stop. Show "This server needs updating" with the server's URL. |
| `invalid_request` | Refresh `/v1/info`, re-batch, retry once; then treat as 5xx. |
| `invalid_envelope` | Set `push_state = 'rejected'` on the envelope at `index`, continue with the rest. Count shown in settings. |

**Usage meter.** The client sums its own envelope sizes per group and shows
usage against the server's published caps in settings, with a warning at 80%.
Events are immutable and a full group stays full, so the only remedy is a new
group; v2 may add a checkpoint event.

### Transport

```ts
interface Transport {
  info(): Promise<ServerInfo>;
  push(groupId: string, token: Uint8Array, envelopes: Envelope[]): Promise<{ accepted: number; duplicates: number; seq: number; epoch: string }>;
  pull(groupId: string, token: Uint8Array, since: number, limit: number): Promise<{ events: StoredEnvelope[]; next: number; more: boolean; epoch: string | null }>;
  delete(groupId: string, token: Uint8Array): Promise<void>;
}
```

**HttpTransport**: `fetch` against the group's canonical `server_url`.
Refuses non-HTTPS URLs at construction. No certificate options exist.

### Group file

Not a transport; two functions.

- `exportGroup()` writes `{ format: "even-group", v: 1, invite, envelopes }`
  to a `.even` file and hands it to the share sheet. The file contains the
  secret next to the ciphertext: it is exactly as sensitive as the invite and
  the share sheet says so. It is called a **group file**, never "encrypted
  export".
- `importGroup()` lives on the Groups screen, because it must work for groups
  this phone does not have yet. It reads a file, verifies the invite checksum,
  stores the secret if new, insert-or-ignores every envelope with
  `origin = 'remote'` (re-encrypting readable ones for the current server's
  group id if the file's server differs, dropping the unreadable), and sets
  `acked = 0` on **all** of the group's events so the server copy is fully
  restored on next sync. If the group is locally `closed` or `hidden` (rotated
  away), the import is refused unless the user confirms they want to revive
  the old group.

## Rotation, moving, closing

**Rotate invite** (settings → "New invite"). Removes access for anyone holding
the old invite.

1. Sync the current group one last time, so nothing pushed by others in the
   last minutes is lost.
2. Generate a new secret → new `localId`, new encryption key.
3. Re-encrypt every `ok`, `invalid`, and `unsupported_body` envelope under the
   new key for the chosen server's new group id, **preserving envelope ids and
   bodies**, with fresh nonces, keeping each row's `origin`. `undecryptable`
   and `unsupported_envelope` rows are dropped; they cannot be opened. Control
   events (`group.closed`, `group.rotated`, `group.moved`) from the old group
   are **not** copied.
4. Append `group.rotated { from: oldLocalId }` to the new group. The rotating
   device marks the new group as "recognition done" so its own marker does
   not trigger the procedure below.
5. Push the new group. Present the new invite.
6. Append `group.closed { reason: 'rotated', to: newLocalId }` to the **old**
   group and keep syncing the old group until that event is acknowledged;
   then set the old group's state to `hidden`. Do not delete the old server
   copy; it expires on its own and is never self-healed because hidden groups
   do not sync. Carry over `my_member_id`.

**Recognising a rotation.** When any event in a group is
`group.rotated { from }` and `from` matches a local group whose state is not
already `hidden`: sync the old group one last time (the one exception to
"closed groups never sync"), then re-encrypt into the new group every
old-group envelope with `origin = 'local'` whose id the new group lacks. This
rescues this device's own writes, including any unpushed outbox, and nothing
else: events written by the removed party after the rotation never cross,
because no device claims them as its own. Control events are never copied.
Set `acked = 0` on the rescued rows, set the old group to `hidden`, and carry
over `my_member_id`. Two `group.rotated` events with the same `from` in
different groups mean two members rotated concurrently; the app shows both
groups, lets the user pick, and sets the other to `hidden`.

**Recognising a closure.** A `group.closed` event sets state `closed`: the
group is read-only, never syncs again, and shows "This group was rotated. Ask
a member for the new invite." The paste-invite flow on that screen, when given
the new invite, performs the recognition above. A straggler who never gets the
new invite keeps a read-only copy of the history up to the closure.

**Move to another server** (settings → server). Writes `group.moved { server }`
to the current server and waits for its acknowledgement, then switches
`server_url` as described under storage, which also resets the group's state
to `active` if it was `blocked`. Other members see the latest `group.moved`
and are offered "Follow to <host>", which performs the same switch. A member
can also move by accepting a fresh invite that names a different server for a
group they already hold; the app shows "Move Banff 2026 from <old host> to
<new host>?" and refuses for `closed` or `hidden` groups. That is the recovery
path when the old server is dead and no `group.moved` could be written.

**Leave** is local only: delete the group's rows and its secret from this
phone. It never calls the server. If the group has unacknowledged events, the
confirmation says how many and that other members will never see them.

**Delete server copy** exists in two places, both confirmed, and never as a
standalone action on the current server, because the deleter's own next sync
would recreate it:

- After a move, settings offers "Delete the copy on <old host>", using the
  token derived for the old origin.
- Leave offers "Also delete this group's copy on <host>", with the warning
  that other members will recreate it on their next sync unless they leave too.

If a delete request fails, `pending_deletes` records the debt and the next
sync retries it. Operator takedown is a server-side blocklist, not a client
action.

## Background refresh

- `expo-background-task` registers one task that runs the sync cycle for
  `active` groups that have an event, local or remote, dated within the last
  30 days, skipping the rest, and stays under 25 seconds of work per run.
  Closed, hidden, and blocked groups are never touched.
- After the cycle, for each new `ok` event authored by **another device** since
  the last notification, schedule a local notification through
  `expo-notifications`: title is the group name, body is the activity summary
  ("Maya added Dinner · 90.00"). Coalesce multiple events per group into one
  notification ("3 new in Banff 2026").
- iOS runs background tasks at its discretion, often only when the phone is
  idle or charging, and never after the user force-quits the app. Android has
  a 15-minute floor. The settings label reads "Background updates (best effort)"
  with one sentence saying the phone decides when. This is verified on a real
  device before the claim goes into store copy.
- Notification permission is requested contextually, the first time the user
  opens a group that has more than one member, with one sentence explaining
  what it is for.

## Invites

`core/invite.ts` encodes and decodes the protocol §8 payload, verifies the
checksum, and canonicalises the server URL.

- **Share**: the group screen has one Share button. The sheet offers "Copy
  code" first and "Share link" second. The link is
  `https://even.appalaya.com/i#<payload>`. Share is disabled until the group's
  `group.created` and the creator's own `member.added` are acknowledged by the
  server, so a joiner never lands in an empty group and creates a duplicate
  member.
- **Open**: the universal link and App Link route to `/i`. The app reads the
  full URL via `Linking.useURL()` and parses the fragment itself, since the
  router may not surface fragments. The custom scheme `even://` is registered
  for the landing page's "open app" button only and never carries a payload;
  `even://join` opens the Groups screen with "Join with code" expanded, so the
  user pastes the code they just copied. `canonicalOrigin` uses a small
  pure-TypeScript URL parser in `core`, not Hermes's incomplete `URL`.
- **Paste**: the Groups screen has "Join with code." It accepts the bare
  payload or a full link and strips the URL. A checksum failure says "That
  code isn't complete. Copy it again."
- **Join screen**: shows the group name and currency from the invite (or "a
  group" if absent), the server host, and Join. On join: store the secret,
  create the `groups` row, pull, then show "Which one are you?" from the
  member list, each with its avatar and a "joined" mark if already claimed,
  with "I'm not listed" to add a member (prefilled from `prefs`). Picking a
  name writes `member.claimed`. If the server is
  unreachable, the group is created in state "Joined, waiting for first sync";
  the name pick is deferred until members arrive.
- **Already have it**: an invite whose `localId` matches a local group and
  whose server differs is treated as a move (above), with confirmation, not as
  a duplicate.
- **Create**: name, currency, your name, and an "Advanced: sync server" field
  that defaults to `https://sync.even.appalaya.com`. This is where a
  self-hoster points a new group at their own server. The create flow writes,
  in this order, the creator's `member.added` (with `by` = their new member
  id), their `member.claimed`, then `group.created`, each with its `ts` from
  `nextTs`, so the log reads "Maya joined", "Maya created the group" in order
  even without the reducer's actor-name fallback.

## Landing page (`web/`)

Static, deployed to Cloudflare Pages at `even.appalaya.com`.

- `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  for universal links and App Links, covering paths `/i` and `/i/`. A
  `_headers` file sets `Content-Type: application/json` on the extensionless
  AASA file. `assetlinks.json` carries the Play App Signing certificate
  fingerprint, not the upload key's.
- `/i`: reads `location.hash`, shows "You've been invited to *Banff 2026*"
  (inserted with `textContent`), an "Open in Even" button that fires the bare
  `even://join` scheme with no payload (Android: an `intent://` URL naming the
  package), store badges, and the code in a copy box with the sentence
  "Installed already? Open Even and tap Join with code." The fragment is never
  sent anywhere.
- Served with `Content-Security-Policy: default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'`.
  The hash covers one inline `<script>` block; it uses `addEventListener`,
  never `on*=` attributes, and all styling is in one hashed `<style>` block
  with no `style=""` attributes, since hashes cover neither. No analytics, no
  third-party scripts, and Cloudflare's script-injecting features (Rocket
  Loader, Web Analytics, Zaraz) are off for the zone.
- `/terms`, `/privacy`, `/abuse`: plain pages. The privacy page is
  `THREAT-MODEL.md` in human words, including the backup and browser-history
  notes.

## Navigation

Expo Router, stack only. **No tab bar.** The app has one primary object, the
group, and everything hangs off it.

```
src/app/
├── _layout.tsx              → Root stack, providers, deep-link handling
├── index.tsx                → Groups list (+ Create, + Join with code)
├── i.tsx                    → Invite route: decodes, redirects to join
├── join.tsx                 → Join confirmation + pick your name
├── group/[id]/
│   ├── _layout.tsx          → Group stack
│   ├── index.tsx            → Group: balance header, segmented Expenses · Balances · Activity
│   ├── expense.tsx          → Add / edit expense (presented as a sheet)
│   ├── [expenseId].tsx      → Expense detail
│   ├── settle.tsx           → Record a payment (sheet)
│   └── settings.tsx         → Invite, members, server + usage + move, background updates, exports, new invite, leave
└── +not-found.tsx
```

Three primary screens: **Groups**, **Group**, **Add expense**. Everything else
is a sheet or a settings sub-page.

## Screens, in one line each

- **Groups**: cards with name, your net ("you're owed 44.00" / "you owe 12.00"
  / "settled"), sync dot. Create, Join with code, and Import group file live
  here. Empty state: two buttons, Create and Join, and one sentence: "A group
  is a link. Share it and you're in."
- **Group**: big number at top (your net), the simplified settle list under
  it, then a segmented list: Expenses, Balances (per-member nets and spend by
  category for the trip), Activity. Pull to refresh. A subtle line: "Synced 2 min
  ago" or the error. Banners, when relevant: unreadable entries, update
  required, group closed, group moved.
- **Add expense**: amount keypad-first, title with the inferred category
  emoji appearing beside it as you type, paid-by chip (defaults to you), split
  row (defaults to "Everyone, equally"). Two required fields. Save is
  one tap with haptic feedback. Advanced split is a push, not a modal in a
  modal. Archived members already on the expense stay visible in the editor.
- **Expense detail**: the facts, the split, who added it and when, edit and
  delete, and a History section listing every version with who changed what;
  any version can be restored in one tap.
- **Settle**: from → to → amount, prefilled from the tapped settle-list row.
- **Settings**: invite (always visible, with the one-sentence warning),
  members (rename, emoji, archive, unarchive; shows which have joined), your
  default name and emoji, server (host, operator, limits,
  retention, usage meter, move, delete old copy after a move), background
  updates toggle, export CSV, group file export, new invite, leave (with the
  optional server-copy delete).

## Elegance constraints

These are budgets, checked in review:

- Three primary screens, no tab bar.
- Two required fields to add an expense; a first-time user saves one in under
  ten seconds.
- One accent colour, system fonts, no illustrations, no onboarding carousel.
- Dark mode and dynamic type from the first commit.
- Nothing asks for a permission at launch.
- Every list has an empty state that says what to do, in one sentence.
- Money formatting is `Intl.NumberFormat` with the group currency and the
  currency's real exponent; no hand-rolled formatting.

## Key patterns

**Minor units, always.** Integers below the formatting layer.

**Skipped-item visibility.** `undecryptable` shows as "N entries couldn't be
read" with a purge option in settings. `unsupported_envelope`,
`unsupported_body`, or `invalid` money events show the update-required
banner. Never hide either.

**Pure core.** Anything that could be unit-tested without a phone lives in
`packages/core`. Screens are allowed to be boring.

**Offline by default.** Every screen renders from SQLite plus in-memory
decryption. Network is a background concern with a status line, never a
spinner that blocks.

**CSV safety.** Exported cells beginning with `=`, `+`, `-`, or `@` are
prefixed with `'` so a spreadsheet does not execute another member's title.

**Platform conventions.** Expo Router gives back gestures and the Android back
button. Respect safe areas, dark mode, dynamic type.

## On-device capture (designed for, not in v1)

Receipt scan and statement import are additive inputs to the add-expense
sheet. The seam is planned now so they slot in later without touching the
event schema. With an iOS 27 floor the iOS side gets much simpler than it
would have been a year ago:

- **iOS: Foundation Models with image input.** iOS 27's on-device model
  accepts image attachments and supports guided generation, so a receipt
  photo goes straight to a `@Generable` struct `{ merchant, total, currency,
  date }` in one call, with the built-in `OCRTool` attached for the text
  layer. The framework runs entirely on the device. **Private Cloud Compute
  is never used**, even though the same API offers it: the request would
  leave the phone, which breaks the promise. A small Expo module in Swift
  wraps one function, `extractReceipt(imageUri)`. Availability is checked at
  runtime (`SystemLanguageModel.availability`), because the model needs
  Apple Intelligence to be enabled and a supported device; when it is not
  available, the app falls back to the path below.
- **Fallback, and Android: text recognition plus heuristics.** Apple Vision's
  `RecognizeDocumentsRequest` on iOS and ML Kit text recognition on Android,
  behind one adapter, `recognize(imageUri) → lines[]`, then
  `core/parse/receipt.ts`: merchant is the first prominent line, total is the
  amount on the "total" line or the largest near the bottom, date is the first
  thing that parses. Tested in Node against sample texts. No cloud OCR
  provider is ever an implementation.
- **Statement import, screenshot first.** The primary input is one or more
  screenshots of a bank or card app's transactions list, since every app
  renders the same shape. On iOS the images go to the on-device model with
  guided generation returning `[{ date, description, amount, kind }]` where
  `kind ∈ debit | credit | pending`. Rows say "Today", "Yesterday", or
  "Sep 14" with no year, so the prompt carries a reference date, and that
  date is **the image's own timestamp, not the clock**: a screenshot imported
  five days later still resolves "Today" to the day it was taken. Order of
  preference: the Photos asset creation date (with its timezone), then EXIF,
  then the file's modification time, then the device clock with the review
  screen saying it guessed. For a PDF: its creation date, then the statement
  period printed inside it. The review list header states the reference date
  ("Dates resolved as of Sep 21, when this screenshot was taken") and lets
  the user change it, which re-resolves every relative row; every row's date
  is shown and editable; a resolved date later than the reference date is
  flagged. Guardrails that make it trustworthy:
  every extracted amount must appear verbatim in the image's OCR text
  (`OCRTool` output), or the row is shown as "check this" and unticked;
  tall screenshots are split into overlapping strips to fit the 8,192-token
  window; rows from several images are merged by `(date, description,
  amount)`; credits and pending rows are greyed and unticked. PDFs (PDFKit
  text) and photographed paper statements feed the same review screen through
  `core/parse/statement.ts`, a pure line parser producing the same rows.
  Android, and iOS without the model, use OCR plus the line parser. The
  review list has checkboxes, a paid-by default of you, one split picker for
  the batch, and per-row categories from the same inference as typed titles.
  Only ticked rows become events.
- Images and PDFs are processed in memory and discarded. Nothing about them
  is stored, synced, or logged.
- **Not needed:** the Background Inference entitlement. It gates Neural
  Engine use inside background tasks; all capture here runs while the user is
  looking at the screen.

## Siri and App Intents (designed for, not in v1)

iOS 27's App Intents framework lets Siri and Spotlight act on app content by
natural language ("add 40 dollars for parking to Banff, split with everyone").
An `AddExpenseIntent` mapping onto the same core function the sheet calls,
plus entity schemas for groups and members, would be a v2 addition with no
data-model impact. It stays out of v1 because it is native Swift with a
config plugin and because the intent must resolve names against the local
log without ever exposing content to anything but the on-device system.

## Build order

1. `packages/core`: ids, hlc, keys, envelope seal/open with padding, invite
   codec with checksum, money, event schema + validation, reducer, balances,
   simplify. Tests for each, property tests for money and ordering.
2. SQLite layer and secure-store wrappers; the RNG polyfill at entry.
3. Sync engine + HttpTransport against the reference server (or the Python
   one locally through a tunnel). Epoch handling and quarantine included.
4. Groups, Join, Group, Add expense. Real device, real invite, two phones.
5. Settle, detail, settings, exports, rotation, move, closure.
6. Landing page, association files, CSP, universal links on device.
7. Background refresh + local notifications, verified on device.
8. Store assets and submission.
