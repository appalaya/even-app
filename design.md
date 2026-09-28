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
- **Camera and QR**: expo-camera for reading invite QR codes only (permission text "Even uses the camera only to read invite QR codes."; no microphone; Android blocks `RECORD_AUDIO` and `WRITE_SETTINGS`), `uqr` to encode the invite link (`jsqr` in tests only), expo-brightness to lift the screen while a code is shown
- **In-app browser**: expo-web-browser for the contact page (Help and feedback, Report this group)
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
2. **No decrypted content on disk, with named exceptions.** SQLite holds
   envelopes. Bodies are decrypted on open, held in memory per group, and
   discarded when the group closes. The exceptions: each event's ordering
   timestamp `ts` (a number, no content) and the group's current name and
   currency (both also plaintext in the invite), cached for the Groups list
   and for cheap ordering. Notification text is handed to the OS and is
   covered in the threat model. This is what makes device backups safe to
   allow.

## Identity model

There are no accounts. Four ids exist:

| Id | Scope | Format | Where it lives | Purpose |
|---|---|---|---|---|
| **Device id** | This install | 22-char base64url, random | secure store | Tags every event this device creates. Self-asserted; detects accidental double-claims, not impersonation. |
| **Member id** | A group | 22-char base64url, random | inside the log | A named seat in the group. "Maya." |
| **Local group id** | Global | 43-char, derived from the secret | SQLite key | Server-independent identity of the group on this phone. |
| **Server group id** | One server | 43-char, derived from secret + server origin | computed on demand | The id in URLs. Different on every server. |

A device *claims* a member id when it joins ("Which name is yours?"). The claim
is stored locally in `groups.my_member_id`, stamped as `by` on events, and
also written to the log as `member.claimed`, so every phone knows which
members have joined and from how many devices. Two devices may claim the same
member (phone plus tablet). The join screen shows "joined" next to claimed
names, and tapping one asks "Is that you on another phone, or a different Maya?"
("It's me" / "Different Maya"); the second answer adds a new member with a
different name.
The activity feed shows the device id's short form next to the member name,
so the group can see that "Maya" is posting from two places.

**Who may edit a member.** Enforced by the app (honest clients), not by
the reducer, like every other permission in Even: you may rename and change
the avatar of your own claimed seat; a member nobody has claimed yet (a
pre-added name) may be edited by anyone, since someone has to fix a typo they
typed; another joined member may only be archived or unarchived; nobody can
archive themselves (that is Leave). The activity feed attributes every change,
which is the real deterrent.

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

**This phone's seats.** The device id outlives an uninstall, so the log can
show which members this very device claimed before. When a group is held
without a seat and exactly one member carries this device, the seat is
restored silently; when several do, the re-offered name pick marks them
"this phone" and a tap asks "This phone was Maya before" ("Continue as Maya" /
"Choose again") instead of the other-phone question.

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
  is open. They are never written to SQLite, with one exception: a pending
  delete stores the per-server auth token it needs (see "Rotation, moving,
  closing"). A token authorises reads, writes and deletes of ciphertext on
  one server and cannot decrypt anything.
- The **device id** is stored in secure store under `even.device`.

Secure store also holds an index, `even.groups`, listing the local ids that
have a secret, because secure store cannot enumerate keys. On iOS the keychain
is backed up and survives uninstall, so a restore or reinstall can list the
index, recover each secret, and re-pull the logs. Each index entry carries the
group's server URL beside its local id (the URL is not secret), which is what
rebuilding the `groups` row needs, and the app offers this recovery on first
launch when the store is empty but the index is not. A recovered row has no
seat; after its first sync the seat this device claimed is restored from the
log (the device id is in the keychain too), and if none is found Group asks
"Which name is yours?". On Android the keystore
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
| `group.archived` | `{}` | An explicit, reversible end of the group: read-only by choice, still syncs. The latest `group.archived` / `group.unarchived` by `(ts, id)` wins; a repeat is a no-op. Independent of `group.closed` (rotated away, never syncs). |
| `group.unarchived` | `{}` | Reverses `group.archived`. |
| `member.added` | `{ member: Member }` | For a self-add during join, `by` is the new member's own id. |
| `member.updated` | `{ id, changes: { name?, emoji? \| null } }` | Field-level last-writer-wins. `emoji: null` clears it. |
| `member.claimed` | `{ id }` | Written by a device when it picks its name. `dev` identifies the device. Idempotent per `(id, dev)`. |
| `member.archived` | `{ id }` | Hidden from pickers; balances retained. |
| `member.unarchived` | `{ id }` | |
| `member.done` | `{ id }` | "I'm done adding." `by` is normally the member itself but need not be. **Auto-clear:** an `expense.added` whose `by` is a done member removes it from `doneMembers`, with no extra activity item; `expense.updated` and `payment.added` do not. |
| `member.undone` | `{ id }` | Reverses `member.done` ("adding more"). |
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
`formatMinor` takes a `display` option (`narrowSymbol`, `symbol`, `code` or
`none`) and defaults to `narrowSymbol`, so CAD reads "$36.00", not
"CA$36.00", and the screen shows the "CAD" label once.

**Splits are stored resolved.** The UI offers equal / exact / percent, but the
event carries the final minor units per member. Changing the rule later never
rewrites history, and the reducer never needs to know how a split was chosen.

**Categories.** Sixteen, fixed, each with one emoji, defined once in
`core/categories.ts`:

| Category | Emoji | Category | Emoji |
|---|---|---|---|
| food | 🍽️ | activities | 🎟️ |
| groceries | 🛒 | shopping | 🛍️ |
| drinks | 🍻 | fees | 🪙 |
| coffee | ☕ | health | 💊 |
| lodging | 🏨 | gifts | 🎁 |
| flights | ✈️ | other | 🧾 |
| transit | 🚆 | | |
| fuel | ⛽ | | |
| parking | 🅿️ | | |
| rental | 🚗 | | |

The picker labels each category with its capitalised key ("Rental", as the
category picker board draws it). The same file holds a keyword table (`parking`, `parkade`, `meter` → parking;
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

*As built:* the local Expo module `modules/even-classifier` exposes
`classifyExpense(title)`, `availability()` and `prewarm()`. On iOS it uses
`SystemLanguageModel.default` only, one fresh `LanguageModelSession` per title
whose instructions give each category's meaning, and guided generation into a
`@Generable` enum of the sixteen ids (a test keeps the enum equal to
`CATEGORIES` and fails if the native code names any other model). A reply
comes within 2.5 s or not at all; a refusal, a guardrail hit or any error is
no answer, and `refineCategory` drops anything that is not a category id.
Availability (`available`, or unavailable with the framework's reason:
`deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`) is asked
once per launch, so a model that becomes ready is used from the next launch.
Add expense calls `prewarm` when it opens, so the first title is not a cold
start. Android reports unavailable (`notBuilt`): ML Kit's Prompt API needs
minSdk 26 (the app is on 24), brings ML Kit's usage logging, and is still
beta. The labelled set is `packages/core/src/categories.eval.json` (96
titles); `npm run eval:categories` scores it with a plain Swift script, not
yet the Evaluations framework: 91% on macOS 27's model, against 68% for the
keyword table alone.

**Chip state machine.** The category chip holds `{ category, source }` with
`source ∈ keyword | model | user`, and these rules prevent the model from
overwriting a choice the user has made:

- A user tap sets `source = user`, cancels any in-flight model request, and
  drops any reply that arrives afterwards. Later title edits do not re-infer.
  `user` is sticky until the sheet is dismissed.
- While `source` is `keyword` or `model`, every keystroke runs keyword
  inference (applied immediately, source becomes `keyword`) and, after the
  500 ms pause, issues a fresh model request.
- Each model request carries the exact title it was asked about. A reply is
  applied only if that title still matches the field and `source` is not
  `user`; otherwise it is discarded. So a model result can be refined by a
  later model result, but never overwrite a tap.
- Tapping Save freezes the chip; the event carries whatever it shows.
- A keyword-inferred chip carries no tag (as drawn on the AddExpense board).
  When the model changes the chip, the swap animates and the chip shows a
  "suggested" tag briefly (about 1.5 s; a keystroke or a tap takes it away
  sooner), so a change the user did not make is never invisible. A
  user-chosen chip never shows the tag. With no title yet (and nothing
  chosen) the chip is the dashed "Category" placeholder.

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
that subset), so a member at 0% never owes a unit. Equal mode also accepts a
per-member multiplier and an extra amount (Splitwise's shares and
adjustments): extras come off the top and the remainder splits by weight,
with the same leftover rule. `splitWeighted` implements it; `splitEqual` is
the all-ones case. `core` has a property test: for any amount and any member
set, splits sum to the amount.
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
- `member.done` / `member.undone` add and remove the member in `doneMembers`
  (sorted; a repeat is a no-op; a `member.done` for an unknown id makes a
  placeholder like any `member.*` target). An `expense.added` whose `by` is a
  done member removes it, with no activity item of its own because the
  expense's item already says it; `expense.updated` and `payment.added` never
  do. `allDone` is true when every non-archived member with at least one
  claimed device is in `doneMembers` and there is at least one such member,
  so a name pre-added but never claimed cannot hold the group up.
- `group.archived` / `group.unarchived`: the latest by `(ts, id)` sets
  `archived`. It is independent of `closed`: a closed group was rotated away
  and never syncs again; an archived one is read-only by choice, still
  syncs, and can be unarchived.

`GroupState` contains the group meta (including `archived`), members (with
device sets and avatars), `doneMembers` (who has said "I'm done adding") and
`allDone`, live expenses (each with its history), deleted expenses (with their
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
  this group." banner, not just a counter, because balances are known to be
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
  auth_token TEXT NOT NULL,           -- the per-server bearer token, derived before the secret is gone
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
- `ts` cached from the body, `name_cache` and `currency_cache` are the only
  decrypted information kept on disk, as stated under Architecture.
  `pending_deletes.auth_token` is the only credential.
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
open. Same pattern as Stow. Each migration runs in one transaction with its
version bump; shipped migrations are never edited.

- v1: the schema above, without `pending_deletes.auth_token`.
- v2: rebuilds `pending_deletes` with `auth_token NOT NULL`. A v1 debt has
  no token and nothing at migration time can derive one, so it is dropped (no
  build that wrote one shipped).

When the store cannot open (a database written by a newer build, a failed
migration), the app shows the StartupError board instead of Groups: "Even
couldn't open your groups." and "Try again. If it keeps happening, restart
your phone.", with Try again (opens the store again) and Get help (the contact
page in the in-app browser). The error is logged.

## Sync engine

`src/services/sync/` — one engine, one HTTP transport, plus group-file I/O.

### Triggers

- App comes to foreground
- After any local write, debounced 1 s
- Pull-to-refresh on the group screen
- A tap on the sync glyph at the end of the group's status line ("sync
  now"), debounced: a tap within 10 s of the last successful sync replays the
  spinner without a request, and taps during an in-flight sync are ignored
- Background task (below)
- Group opened for the first time after join
- A server move: `moveServer` runs a full push to the new server as soon as
  the switch commits (trigger `server_move`)

How the triggers treat a group that is backing off after a failure (below):
`foreground`, `local_write` and `background` wait it out; `manual`,
`pull_to_refresh`, `first_open` and `server_move` are the user asking and go
ahead. A server's `Retry-After` binds every trigger, manual taps included.
The 10 s manual-tap debounce applies only when the last cycle succeeded.
Triggers for a group whose cycle is running share that cycle, except manual
taps, which are ignored; a local write during a cycle runs the cycle once
more after it, since it may have missed the outbox read. After a failure the
engine schedules its own retry at the time it reports (`retryAt`).

### Cycle, per group

Only groups in state `active` sync. `closed`, `hidden`, and `blocked` groups
never sync and never self-heal, except the single recognition sync described
under Rotation.

0. **Debts**: retry the group's outstanding `pending_deletes` (below).
   `syncAll` retries every debt once before its first group instead, and its
   group cycles skip this step.
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
   `epoch_resets_this_cycle`. Both happen at the end of every cycle,
   successful or not, so an `epoch_unstable` group tries again on a later
   cycle instead of staying stuck.

After a pull that brought a `group.created` or `group.renamed`, `name_cache`
and `currency_cache` are re-derived from all of the group's naming events.
A pulled entry that is not an envelope at all is stored as `undecryptable`
with its text cut to 4 KiB, so one oversized item cannot fail its page; one
with no usable id is skipped. A page that says `more` without advancing
`next` stops the cycle as `server_error`.

**Epoch rule.** If no epoch is stored and the response carries one, store it
and continue. If the stored epoch is `'unknown'` (recorded after a `null`)
and the response carries a real one, adopt it without a reset: that is the
normal end of a delete-or-expiry recovery, not instability. Otherwise, if the
response's epoch differs from the stored one, or is `null` where a real one
is stored: if `epoch_resets_this_cycle` is already 1, stop the group with
`last_sync_error = 'epoch_unstable'`; else increment it, store the new epoch
(or `'unknown'` for `null`), set `cursor = 0`, set `acked = 0` on every event
(rejected rows stay rejected), and restart the cycle. The group's full log is
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
| network / 5xx / 429 | Silent; exponential backoff per group (30 s → 2 m → 10 m, reset on success), or `Retry-After` when the server sends one. Within a cycle, a 5xx retries the same outbox head after 0.5 s → 1 s → 2 s; every third consecutive 5xx halves the batch size (floor 1, kept until the app restarts or the group moves); the cycle gives up after six consecutive 5xx while pushing (three while pulling) and backs off. Sync state shows "Not synced since …". |
| `503 over_budget` | Pushes to that server pause until its `Retry-After` (30 s without one) while pulls go on ("reads still work"); the cycle reports `failed` with that retry time and the group is not backed off. |
| `unauthorized` | Cannot happen for a correctly joined group. Treated as a bug: log locally, back off, show "Can't reach this group's server" with the URL. |
| `not_found` / `method_not_allowed` on a documented route, or a `200` that is not the documented shape | The transport reports `not_an_even_server`. Show "That URL isn't an Even server. Check the address." |
| `group_blocked` | Terminal for this server; see above. |
| `group_full` | Stop pushing; the pull still runs. Reported as `failed` with no retry time and no backoff, so later triggers keep pulling. Show the cap, the group's local usage, and offer export. |
| `unsupported_version` | For an envelope whose `v ≠ 1` (a kept `unsupported_envelope` row re-pushed after a reset): quarantine it like `invalid_envelope`. Otherwise stop and show "This server needs updating" with the server's URL; also when `/v1/info` does not list protocol 1. |
| `invalid_request` | Refresh `/v1/info`, re-batch, retry once; then treat as 5xx. |
| `invalid_envelope` | Set `push_state = 'rejected'` on the envelope at `index`, continue with the rest. Count shown in settings. |

A short `Retry-After` (5 s or less) on a 429 or 5xx is waited out inside the
cycle (for 429s at most twice per cycle), never past a background deadline;
a longer one ends the cycle and becomes the retry time. Outbox rows that are
not sendable envelopes (junk, or larger than the server's `max_event_bytes`)
are quarantined locally without a request.

Beyond the protocol's names, `last_sync_error` holds `epoch_unstable`,
`network` (no response: offline, DNS, TLS, timeout), `not_an_even_server`,
`no_secret` (the row exists but secure store has no matching secret, e.g. an
Android restore; never retried on its own), and
`local_error` (storage or a bug; logged, backed off). `syncGroup` never
throws: every failure is recorded there and announced with a `finished`
event, including a group row that could not be read (recorded if the row can
still be written).

Local log lines name the server origin and an error code or message, never a
group id, token, envelope or body (the same rule as the server's, in
`THREAT-MODEL.md` "What we log").

**Pending deletes.** A debt is retried at the start of each cycle (step 0).
`204`, or `404` (nothing left there), pays it. No response, 5xx, 429 and 503
keep it for the next cycle. Any other answer (`401`, `410`, `405`, …) cannot
change on retry, so the debt is dropped with a local log line. The group id
for the `DELETE` is `base64url(SHA-256(auth_token))`, so no secret is needed.

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

**HttpTransport**: `fetch` against the group's canonical `server_url`
(`canonicalOrigin`). Refuses non-HTTPS URLs at construction. No certificate
options exist. Requests are sent with `redirect: 'error'` so the bearer
token stays on its origin; React Native's `fetch` may not honour that option,
which is checked on a real device.
Every request times out after 30 s as `network`. It never retries; retry,
backoff and `Retry-After` belong to the engine. Error messages carry the
route pattern (`/v1/groups/{groupId}/events`), never the path. Tests may
allow `http://127.0.0.1` and `http://localhost` with an explicit option,
still deriving keys for the `https` form; the app never sets it.

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

**Rotate invite** (settings → "Regenerate invite link", with a confirmation sheet: "The old link stops working. You'll share the new one next."). Removes access for anyone holding
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
   not trigger the procedure below. If the user picked someone to remove in
   the confirmation sheet, append `member.archived { id }` for that member to
   the new group here: the member list, their expenses, and the history all
   carry over unchanged (balances must still add up), and archiving is what
   takes them out of pickers and out of the "done adding" count.
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
group is read-only, never syncs again, and shows "This group's invite was
regenerated. Ask a member for the new one." The paste-invite flow on that screen, when given
the new invite, performs the recognition above. A straggler who never gets the
new invite keeps a read-only copy of the history up to the closure.

**Move to another server** (settings → server). Writes `group.moved { server }`
to the current server and waits for its acknowledgement, then switches
`server_url` as described under storage, which also resets the group's state
to `active` if it was `blocked`. The switch is the engine's `moveServer`: it
waits for a running cycle (cycles asked for meanwhile are skipped, since its
own push follows), then in one transaction opens every readable envelope
under the old group id, seals it again for the new one with the same id and
body and a fresh nonce, drops the unreadable rows, calls `setServer`, and
clears any debt to delete the copy on the new server; then it pushes the
whole log there. Every re-encryption in this section is byte-exact: core's
`resealEnvelope` opens an envelope to its plaintext bytes and seals those same
bytes, never parsing the body, so an `unsupported_body` event (a newer `sv`,
integers past 2^53, any formatting) crosses bit for bit. Writing `group.moved`
first is the caller's job. The write
path seals for the `server_url` it reads in the same transaction as its
insert, so no write can land sealed for the old group id. Other members see
the latest `group.moved` and are offered "Follow to <host>", which performs the same switch. A member
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
  "Anyone still in the group will put it back." (other members recreate it on
  their next sync unless they leave too).

Both go through the engine's `deleteServerCopy`, which `pending_deletes`
backs: it records the debt **together with the per-server auth token**,
which is all a `DELETE` needs, and only then sends the request, so a failed
request or a killed app is retried even after Leave has removed the secret.
It refuses the server an `active` group still syncs through, so Leave runs
in this order: delete the group's rows, call it, delete the secret. The next
sync cycle retries outstanding debts first (see "Error handling"). Operator
takedown is a server-side blocklist, not a client action.

## Background refresh

- `expo-background-task` registers one task that runs the sync cycle for
  `active` groups that have an event, local or remote, dated within the last
  30 days (the store's `latestTs`, one `MAX(ts)` per group), skipping the
  rest, and stays under 25 seconds of work per run (a deadline no new group
  or debt starts after).
  Closed, hidden, and blocked groups are never touched.
- After the cycle, for each new `ok` event authored by **another device** since
  the last notification (the `prefs` row `notifications.ledger`: local ids
  and counts only), schedule a local notification through
  `expo-notifications`: title is the group name, body is the activity summary
  ("Maya added Dinner · 90.00"). Coalesce multiple events per group into one
  notification ("3 new changes"; the title already names the group).
- iOS runs background tasks at its discretion, often only when the phone is
  idle or charging, and never after the user force-quits the app. Android has
  a 15-minute floor. App settings makes no promise about timing (the
  Notifications row has no sentence under it). Any claim about when updates
  arrive is verified on a real device before it goes into store copy.
- Background sync is always on; there is no per-group or app-level switch for it, because the OS already decides when it runs and a switch would only make the app look broken when flipped by mistake. The one user-facing control is **Notifications** in App settings, tied to the OS permission, requested contextually the first time the user opens a group that has more than one member (once per install; the `prefs` row `notifications.asked` remembers it); the switch carries no caption, since it says what it does.

## Invites

`core/invite.ts` encodes and decodes the protocol §8 payload, verifies the
checksum, and canonicalises the server URL.

- **Share**: the group screen's share arrow opens a small menu anchored under
  it: "Share link" (the system share sheet) and "Show QR code" (the "Scan to
  join" sheet). Copy code lives on the invite card and in Group settings. The
  link is `https://even.appalaya.com/i#<payload>`. Sharing is disabled until
  the group's `group.created` and the creator's own `member.added` are
  acknowledged by the server, so a joiner never lands in an empty group and
  creates a duplicate member. The arrow is hidden while the invite card shows,
  in a read-only group, and while the phone has no seat.
- **Scan to join** (board InviteQR): the invite link as a QR code (error
  correction M, version 10 for a typical link) on a white tile with dark
  modules in both themes, the group name above, the one-sentence warning below, and
  the screen at full brightness while it is open. Reached from the QR button
  after Share link and Copy code on the invite card and in Group settings'
  invite section, and from the share menu. Their camera opens Even through the
  universal link, or the invite page if Even is not installed.
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
- **Scan** (boards JoinScan, JoinScanDenied, JoinScanNotInvite, JoinScanFound):
  a Scan pill beside Paste opens the camera sheet (viewfinder with corner
  brackets, a light button, Cancel). It accepts a bare code or the
  `https://even.appalaya.com/i#<code>` link and refuses `even://`. A code that
  is not an Even invite shows "That QR code isn't an Even invite." and keeps
  scanning; one shaped like an invite but unusable (newer version, bad
  checksum, server problem) counts as found so Join with code shows its usual
  error. Found shows for 0.9 s with a haptic, then the bare code goes into the
  field and the preview runs as after a paste. With camera access off the
  sheet offers Open Settings and "Paste instead"; the permission is read again
  when the app returns to the foreground.
- **Join screen**: shows the group name and currency from the invite (or "a
  group" if absent), the server host, and Join. On join: store the secret,
  create the `groups` row, pull, then show "Which name is yours?" from the
  member list, each with its avatar and a "joined" mark if already claimed,
  with "I'm not listed" to add a member (prefilled from `prefs`). Picking a
  name writes `member.claimed`. If the server is
  unreachable, the group is created in state "Joined, waiting for first sync";
  the name pick is deferred until members arrive. If the server refuses the
  group instead (a definitive answer), the join is undone (nothing of this
  phone's is in the group yet, so its row and secret go) and the sheet says why
  under Join, which stays on to try again (board JoinCodeRefused): "This group
  is blocked on its server, so you can't join it.", "That URL isn't an Even
  server. Check the address.", or "This server needs updating."; a join that
  fails outright says "Couldn't join. Try again." Closing the name pick leaves
  the Join route for Groups and keeps the group, unclaimed; Group offers the
  pick again when it is opened (see "Group").
- **Already have it**: an invite whose `localId` matches a local group and
  whose server differs is treated as a move (above), with confirmation, not as
  a duplicate.
- **Create**: name, currency, an optional "People" section to pre-add names
  (chips; they pick their name when they join), then your name and avatar
  ("You in this group", after People, as drawn), and an "Advanced: sync
  server" field that defaults to
  `https://sync.even.appalaya.com`, which is where a self-hoster points a new
  group at their own server. The create flow writes the creator's
  `member.added` and `member.claimed`, then `group.created`, then one
  `member.added` per pre-added name. After Create the app lands on the new
  group with an invite card at the top ("Share link", "Copy code", the
  one-sentence warning); the buttons are disabled with "Preparing your
  invite…" until the first push is acknowledged, and the card collapses into
  the settings gear once another member has joined. If the creator adds
  expenses before anyone joins, the card is pinned above the normal header
  and settle list rather than replacing them (board GroupNewWithExpenses). The create flow writes,
  in this order, the creator's `member.added` (with `by` = their new member
  id), their `member.claimed`, then `group.created`, each with its `ts` from
  `nextTs`, so the log reads "Maya joined", "Maya created the group" in order
  even without the reducer's actor-name fallback.

## Landing page (`web/`)

Static, deployed to Cloudflare as a Worker with static assets at `even.appalaya.com`,
by `.github/workflows/web.yml`; `web/README.md` has the details. The Worker's only
script serves `/api/*` (the contact form); every other path is a static asset.

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
- `/` ends with a tip card after How it works (boards LandingWeb,
  LandingWebDesktop): the heading "Keep Even free", one sentence, and a "Leave
  a tip" soft button, in the claim cards' style with `.button-soft`. The button
  is a plain link to Stripe's Payment Link; nothing from Stripe loads on the
  site, and the app links to no tip page. Tips go to Appalaya Inc., are not
  tax-deductible or refundable, and unlock nothing; `/terms` and `/privacy`
  each have a Tips section.
- `/terms`, `/privacy`, `/abuse`: plain pages. The privacy page is
  `THREAT-MODEL.md` in human words, including the backup and browser-history
  notes. No page prints a mailbox address; every "contact us" is `/contact`.
- `/contact` (boards ContactWeb, ContactWebDesktop): one page, three purposes
  (Report a group, Get help, Send feedback), each delivered to its own mailbox
  by `POST /api/contact`. A report takes the invite link and derives the group
  id in the browser (`web/contact-lib.js`, checked against `@even/core`), so
  only the id and the server origin are sent, never the key; the page says so
  in the drawn sentence. The app opens it with the group in the URL fragment,
  `#purpose=report&id=<groupId>&server=<canonical server URL>`, or with
  `#purpose=help` / `#purpose=feedback`; a server that is not Appalaya's gets
  the "we can't act on it, but we'll read your report" line, and a server with
  a path cannot be reported. The Worker checks same origin, validates, verifies
  a Turnstile token (action `contact`), rate-limits per IP, sends one plain-text
  mail through Resend from a sender on `send.appalaya.com`, and stores nothing;
  addresses and keys are Worker secrets set by the deploy, never in the repo.
  The page's CSP allows only `challenges.cloudflare.com` beyond `'self'`; its
  scripts are external files (hash-free, so the tests run the shipped code).
- Store badges are the official Apple and Google artwork, self-hosted under
  `/badges/`; the footer carries "© 2026 Appalaya Inc." linking to appalaya.com.

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
│   └── settings.tsx         → Invite, members, server + usage + move, background updates, exports, regenerate invite link, leave
└── +not-found.tsx
```

Three primary screens: **Groups**, **Group**, **Add expense**. Everything else
is a sheet or a settings sub-page.

## Screens

**Visual source of truth:** the design canvas at
https://claude.ai/artifact/HqwMHUvww8bGQqPSLckPir. It holds every screen,
state, and sheet in light and dark, the icon, and the empty-state keyframes.
The one-line descriptions below are an index, not a spec; where they and the
canvas differ, the canvas wins, and the difference is a doc bug to fix here.
Deviating from the canvas in implementation is a no-go.

## Screens, in one line each

- **Brand mark**: a lowercase "e" whose crossbar runs into an equals sign,
  in the accent. The app icon (light, dark, tinted) and the empty-state mark.
- **Empty-state animation**: the mark centred, with nine circles 9–14 px in
  the avatar palette tokens moving on curved paths around it and settling
  onto a loose orbit around the mark (as drawn on the canvas), then resting. About 3 s, ease-in-out, plays once on open,
  then a slow breathe; under Reduce Motion only the rest frame is shown.
  Built with Reanimated, no Lottie dependency. Because the circles use avatar
  tokens they follow themes with no change.
- **Groups**: cards with name, your net ("you're owed 44.00" / "you owe 12.00"
  / "settled"), sync dot. A group with no expense or payment yet shows no net
  at all: nothing is settled when nothing has happened (the list board does
  not draw this state; the just-created Group board says "No expenses yet"). Create, Join with code, and Import group file live
  here. Empty state: the mark and its circles, Create and Join, and the
  tagline; no explanatory sentence (as drawn). Archived groups sit in a
  collapsed Archived section at the bottom; opened, they are greyed outline
  cards with Unarchive.
- **Group**: big number at top (your net), under it the simplified settle
  list's transfers that involve you, in both directions ("You pay Maya",
  "Nathan pays you"), the done-adding row (at most five avatars, not-done first then done,
  then a "+N" chip, with "7 of 12 done adding"; tapping opens a sheet listing
  everyone's status), then a segmented list: Expenses, Balances (per-member nets, then spend
  by category with the trip total in the header and each row showing amount
  and percent of total, bars proportional to the total), Activity. Pull to refresh. A subtle line: "Synced 2 min
  ago" or the error. Under the header, "N of M done adding" (M counts
  non-archived members who have joined on a device; the row is hidden until
  at least two members have joined, so a fresh group and a pre-added name
  nobody claims never show or block it) with an "I'm done" pill that toggles
  your own mark; when `allDone` it reads "Everyone's done".
  Even state: at a zero net the big number reads "You're even"; with an empty
  settle list and at least one expense or payment it reads "Everyone's
  settled" and offers to archive the group (a group with nothing in it reads
  only "You're even" and "No expenses yet", as on the Groups card; the
  archived header follows the same rule).
  No seat (boards GroupNoSeat, SeatPick, SeatSameDevice): a phone that holds
  the group without a claimed member (a name pick closed after Join, or a
  keychain recovery) cannot add anything. When the log already shows this
  device claimed exactly one member (the device id outlives an uninstall), the
  seat is restored silently (`GroupService.restoreSeat`, on every lifecycle
  check) and nothing is asked. Otherwise, each time Group comes into view,
  once the members are known, it presents the name pick sheet titled "You're
  already in", with names this phone claimed marked "this phone" (claimed
  without the other-phone question; two or more of them ask "This phone was
  Maya before"). Closing it only closes it: Group then reads "Spent so far"
  with the trip total instead of a net, the note "Pick your name to add or
  settle expenses.", no settle list or done row, the share arrow hidden, and
  "Pick your name" in the footer instead of Add expense, which reopens the
  sheet; expense detail is read-only until a name is picked.
  On Balances a settled member reads "Nathan is settled" (no amount, last).
  Banners, when relevant: unreadable entries, update required, group closed,
  group moved, two members with one name, group archived. An archived group is
  read-only, and its banner carries Unarchive; a closed one greys its number and
  settle list ("Read-only. Record payments in the new group once you have its
  invite.") and has no Add expense. The header scrolls away on Balances and
  Activity (the segmented control sticks under the nav bar). The share arrow
  (a menu: Share link, Show QR code) is hidden while the new group's invite
  card shows, in a read-only group, and with no seat. Times read in the device
  locale's format ("9:14 PM").
- **Add expense**: amount keypad-first, title with the inferred category
  emoji appearing beside it as you type, paid-by chip (defaults to you), split
  row (defaults to "Everyone, equally"). Two required fields. Opened fresh it
  reads "$0" and the chip is a dashed "Category"; editing, the title reads
  "Edit expense" and Save "Save changes"; typing the title hides the keypad
  and shrinks the amount to one line; a failed save says so just above Save;
  Paid by and the date open small sheets (the date sheet has Today and
  Yesterday). Save is
  one tap with haptic feedback. Advanced split is a push, not a modal in a
  modal. Archived members already on the expense stay visible in the editor.
- **Split** (pushed from Add expense): segmented Equal · Exact · Percent. In
  Equal each member row has an optional "×n" multiplier and an optional
  "+ extra" amount (extras come off the top, the rest splits by share; no
  caption says so). Over-assigned Exact and Percent read "Over by $6.00" /
  "Over by 5%" (never red) and Done stays off until Remaining reaches zero, with
  no caption saying so.
- **Expense detail**: the facts, the split, who added it and when, edit and
  delete, and a History section listing every version with who changed what;
  any version can be restored in one tap.
- **Settle**: from → to → amount, prefilled from the tapped settle-list row;
  from Balances' "Settle up" it starts empty (you pay, "Choose" whom). From
  and To open the member sheet; recorded, the button reads "✓ Recorded" for
  0.8 s, then the sheet closes.
- **App settings** (gear on the Groups screen): a "You" card with the avatar
  centred at the top, 72 px, a small pencil badge on its corner and no
  caption (tapping opens the same emoji picker sheet used everywhere, with
  "Use initials" to clear), and the Name field on its own row beneath; Appearance (System · Light · Dark); Notifications (the only
  switch, tied to the OS permission, with no sentence under it); Import group
  file ("Opens a group from a .even file."); Help ("Help and
  feedback" opens `/contact` in the in-app browser, captioned "Opens our
  contact page. Nothing about your groups is sent."); About (Privacy, Terms,
  Source code opening the public repository, Version). No background-sync
  switch exists anywhere.
- **Group settings**: the group's name first (a row opening Rename group),
  invite (always visible, with the one-sentence warning, Share link, Copy code
  and the round Show QR code button, disabled with "Preparing your invite…"
  until the server has the group), members (shows which have joined;
  rename and avatar on your own seat and on unclaimed names, archive/unarchive
  on others, never yourself; archived members greyed and last; the caption:
  "Archived members stay in past expenses and balances."), Add
  member (a sheet whose avatar previews the new member's colour), server (host,
  operator, limits, retention, usage meter with its 80 % warning, Move server:
  Check reads `/v1/info`, then Move; "Delete the copy on <old host>" after a
  move), export CSV, group file export, new invite, archive group, leave (the
  unsent count, and the optional server-copy delete), and last, below Leave,
  "Report this group" (boards ReportGroup, ReportGroupOther): a sheet saying
  what we receive (the group's id on its server and a reason, never the
  invite or anything in the group) and what a block does; on a server that is not
  canonically `PROTOCOL.defaultServer` it names that server, shows its
  operator and terms from `/v1/info` when sent, says only that operator can
  act, and demotes the button to "Tell Appalaya anyway". Continue opens
  `/contact` in the in-app browser with the id and canonical server URL in the
  fragment. The row is hidden when the phone has no key for the group.

## Theme tokens

Every colour in the app is a **semantic token**, resolved at runtime from a
theme. Components never contain a literal colour; an ESLint rule rejects hex,
`rgb(`, and named colours outside `src/theme/`.

```ts
interface ThemeTokens {
  background: string; surface: string; surfaceRaised: string;
  text: string; textMuted: string; border: string; separator: string;
  accent: string; onAccent: string; accentSoft: string;   // soft = bars, chips
  attention: string;                                      // banners; never used for money
  avatar: readonly [string, string, string, string, string, string,
                    string, string, string, string, string, string];
}
interface Theme { id: string; name: string; light: ThemeTokens; dark: ThemeTokens }
```

- v1 ships one theme, `even` (spruce on warm neutrals, the canvas palette),
  defined once in `src/theme/themes.ts`. Adding a theme is adding an object.
- **Resolution order, fixed now:** the group's theme if it has one, else the
  app theme, else `even`; light or dark from the **Appearance** setting in
  App settings (System · Light · Dark, a `prefs` row, in v1), which defers to
  the system appearance when set to System. A `useTheme()` hook returns the resolved tokens;
  a `ThemeProvider` wraps the app and a nested one wraps each group screen.
- **Per-group theme (later)** is an event, `group.themed { theme: string }`,
  inside the ciphertext like a rename; unknown theme ids fall back to `even`,
  and clients that predate the field strip it. No protocol change.
- **App theme (later)** is a row in the local `prefs` table.
- The canvas's per-board accent picker is this mechanism in miniature.

## Elegance constraints

These are budgets, checked in review:

- Three primary screens, no tab bar.
- Two required fields to add an expense; a first-time user saves one in under
  ten seconds.
- One accent colour per theme, system fonts, no onboarding carousel.
- Dark mode and dynamic type from the first commit.
- Nothing asks for a permission at launch.
- Every list has an empty state that says what to do, in one sentence.
- Money formatting is `Intl.NumberFormat` with the group currency and the
  currency's real exponent; no hand-rolled formatting.

## Copy

Board annotations never ship: a note beside or under the phone frame, or a
caption that describes behaviour ("turns on when…", "sorts last", an API path)
is for the engineer, not the user. App copy matches the drawn UI copy word for
word, in the app's voice (short, plain, no "please", no exclamation marks,
straight apostrophes in the app, typographic ones on the site); the same
error is worded the same way everywhere. A sweep with an inventory of every
user-visible string is part of review before a release.

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
