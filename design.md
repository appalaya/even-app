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
- **In-app browser**: expo-web-browser for the contact page (Help and feedback, Report this group) and About's Privacy, Terms and Source code. On Android it is a Chrome Custom Tab, accepted as it is: it closes with an ✕ instead of Done, adds Chrome's minimise, share and ⋮ menu, and shows Chrome's own first-run screen the first time a Custom Tab opens on the phone; its bar takes `surface`, and Back returns to the app
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

**Model refinement.** The chip's guess comes from three sources in order, and
only the last is a model:

1. **History.** The category saved with the same or a similar title earlier,
   in the open group first and then in any group on this phone
   (`recallCategory`, `core/categoryHistory.ts`). *Same* is equal after the
   keyword table's normalisation with a trailing "s" folded ("Tim Horton's" =
   "tim hortons"). *Similar* is one title plus trailing words the table cannot
   read ("Safeway run", "Shell Canmore"), so "Costco" never recalls "Costco
   gas" and "Uber" never recalls "Uber Eats". Every same match beats every
   similar one, and the latest save wins among equal titles. History is the
   expenses already in each group's decrypted state
   (`GroupStateStore.peekStates`, memory only; the index is kept per state
   object and nothing is written), so a tap that gets saved teaches the phone
   with no new storage. A recalled title shows at once, carries no sparkle, and
   is never sent to the model.
2. **The keyword table** (above), on every keystroke. A keyword hit stands,
   unless the title holds keywords of two categories ("Hotel bar": hotel is
   lodging, bar is drinks). Then the chip shows the table's guess as you type
   (the longer keyword) and the model decides after the pause.
3. **The on-device model**, only for a title neither knows (the chip shows
   Other) or whose keywords name two categories (`needsModel`, the gate). When
   the user pauses typing (500 ms) and the device has an on-device language
   model, the title is sent to it with guided generation constrained to the
   `Category` enum, and a valid answer replaces the chip and carries the
   sparkle (Chip state machine). The model's `other` is no answer: the chip
   keeps its local guess with no sparkle, because a sparkle on Other reads as a
   suggestion of nothing. On iOS 27 this is `SystemLanguageModel` from the
   Foundation Models framework behind a small Expo module, gated on
   `SystemLanguageModel.availability`. On Android it would be Gemini Nano
   through the ML Kit GenAI prompt API.

**Only the on-device model, ever**: the same API can route to Private Cloud
Compute or to a cloud provider through the provider protocol, and a title must
never leave the phone. The content-tagging use case
(`SystemLanguageModel(useCase: .contentTagging)`) is the same on-device model
specialised for tagging, and is the only other model the module names.

A keyword hit stands because, measured, the model overturned a right keyword
chip about as often as it fixed a wrong one (10 against 11 over 214 titles
with the tuned prompt), and an overturned right chip is the swap a person
sees. Giving the model the table's guess as a hint, gating on a
self-reported confidence, voting over three samples, and naming the merchant's
kind first all did no better (table below). Foundation Models exposes no
log-probabilities or top-k alternatives, so there is no real confidence
signal to gate on; the self-reported one came back `high` on wrong answers
("Resort fee" → lodging, "The Keg" → drinks) and `medium` on right fixes
("Hotel bar" → drinks). The cost: a title the table misreads with a keyword
of one category ("Subway footlong", "Train and Co Drama Theater" as Transit)
keeps its keyword guess until a tap, and history then remembers the tap.

Keywords of two categories are the one exception, measured with four gates
(below): asking the model also when a 3+ word title rests on a single keyword
undid three right chips ("Banff Upper Hot Springs" → health, "Shoppers Drug
Mart" → groceries, "Hat from the gift shop" → gifts) and gained nothing on the
original held-out titles; asking it when the table found keywords of two
categories fixed "Hotel bar", "Gas station snacks", "Hotel valet" and "Rental
car gas" and undid one ("Tip for the ski guide" → activities).

*As built:* the local Expo module `modules/even-classifier` exposes
`classifyExpense(title)`, `availability()` and `prewarm()`. On iOS it asks
`SystemLanguageModel.default` first and, only after a guardrail violation, a
refusal or another error, the content-tagging model once more
(`ExpenseClassifier.models`); one fresh `LanguageModelSession` per title and
model, whose instructions give each category's meaning, and guided generation
into a `@Generable` enum of the sixteen ids (a test keeps the enum equal to
`CATEGORIES` and fails if the native code names any model but those two). A
reply comes within 6 s, the retry included, or not at all: a late reply costs
nothing, because the chip drops a reply whose title has moved on, and a cold
first request took 3.8 s here (below). `classifyExpense` resolves to
`{ category, outcome, ms, model, detail }` with `outcome` one of `answered`,
`other`, `refused`, `timeout`, `error`, `unavailable`; `refineCategory` checks
every field and returns a category only for `answered` with an id other than
`other`. The chip controller asks only when `shouldAskModel` holds
(`needsModel(guessCategory(title))`: nothing known, or keywords of two
categories). Availability (`available`, or unavailable with the framework's
reason: `deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`)
is asked once per launch, so a model that becomes ready is used from the next
launch. Add expense calls `prepareCategoryModel(groupId)` when it opens: it
prewarms both models with the prompt's prefix (*Determinism*, below), so the
first title is not a cold start, and points history at that group first.
Android reports unavailable (`notBuilt`): ML Kit's Prompt API needs minSdk 26
(the app is on 24), brings ML Kit's usage logging, and is still beta. Custom
adapters are not an option: `SystemLanguageModel.Adapter` is obsoleted in the
iOS 27 SDK (deprecated since 26.4).

*Reading the logs.* On the phone, Settings › About › Diagnostics shows the
model's availability and the last 20 outcomes since launch (never a title),
and can run the labelled titles on the phone's own model. For the detail of
each request, the device log says why a chip got no suggestion, and never
with the title. Connect the phone to a Mac, open
Console.app, pick the phone, press Start, and search for `category model`
(the simulator: `xcrun simctl spawn booted log stream --predicate
'subsystem == "com.appalaya.even"'`). Two sources write, one line each:

- Swift, subsystem `com.appalaya.even`, category `category-model`, shown by
  default: `availability available` or `availability unavailable
  reason=appleIntelligenceNotEnabled` (once per launch), `prewarm
  models=general,contentTagging` (each time Add expense opens), and for each
  request `classify outcome=… category=… model=… ms=… detail=…
  attempts=general:refused:180,contentTagging:answered:240`, where each
  attempt is model:outcome:milliseconds.
- JavaScript, subsystem `com.facebook.react.log`, category `javascript`, at
  the info level (Console.app: Action › Include Info Messages): `[even]
  category model availability …` once per launch and `[even] category model
  outcome=… category=… ms=… model=…` for each reply, with the round trip as
  the chip saw it.

What a line means for the chip: no `classify` line at all, the model was not
asked (history or keywords of one category stood, the person tapped, or
availability said no); `unavailable` with a reason, no model on this phone or
not yet downloaded; `outcome=other`, the model knew no category and the chip
kept its guess; `outcome=refused detail=guardrailViolation` (or `refusal`)
after two attempts, both models declined the title; `outcome=timeout` near
6000 ms, a cold model that did not answer in time; `outcome=error` with
`detail` naming the kind (`rateLimited`, `unsupportedLanguageOrLocale`, and
on the JavaScript side `nativeCallFailed`, `malformedReply`, `notACategory`).

*Measurements.* `packages/core/src/categories.eval.json` holds 251 labelled
titles: 133 `train` (the first 96 plus 37 long-tail ones) that prompts and
rules may be tuned on, and 118 `heldout` that never are: 81 long-tail ones,
seven that put a common keyword inside a longer proper name (added for the
gate below), and the last thirty in the styles a phone sees from this owner
(Canadian trip and household names, craft beer, coffee chains, ski resorts,
hardware stores), added after the phone's "Hazy IPA" and written before any
prompt change was scored (`--added 30` scores them on their own). The tables
up to *Latency* were measured on the first 214 or 221 titles with the build
119 and 120 prompt.
`npm run eval:categories` adds each title's keyword guess, the keywords it
matched (`keywordMatches`) and leave-one-out history recall from
`packages/core`, then scores strategies with a plain Swift script compiled
together with the module's classifier (`--strategy all`; `+g` puts history
first; `shipped` is exactly the app's path). On macOS 27's model ("AFM 3 Core
Advanced"), with *undone* counting right chips swapped away after the pause,
and latency per model request, prewarmed. This first table is the first 214
titles with the 2.5 s timeout of build 119:

| Strategy | Train | Held-out | Undone | Sent to the model | p50 |
|---|---|---|---|---|---|
| Keyword table only | 55% | 14% | – | 0 of 214 | – |
| Model always (the first version) | 86% | 72% | 14 | 214 | 251 ms |
| Model when the table finds nothing | 87% | 67% | 5 | 129 | 248 ms |
| Table's guess as a hint | 89% | 67% | 5 | 214 | 249 ms |
| Override a hit only at high confidence | 87% | 69% | 10 | 214 | 371 ms |
| Short reason, then confidence | 89% | 73% | 8 | 214 | 743 ms |
| Three samples, override only at 3/3 | 87% | 70% | 13 | 214 | 754 ms |
| Merchant kind first, mapped | 80% | 72% | 16 | 214 | 246 ms |
| Few-shot examples, always | 85% | 67% | 13 | 214 | 325 ms |
| Tuned prompt, always | 89% | 78% | 10 | 214 | 275 ms |
| Tuned prompt with the hint | 92% | 72% | 1 | 214 | 258 ms |
| Shipped to build 119: history, table, tuned model | 91% | 73% | 0 | 121 | 272 ms |

The build 119 prompt was tuned once, on train misses only: rental now means a
vehicle to drive and other names household services, which stopped dry
cleaning, key cutting and storage units coming back as rental (*A prompt for
the smaller model*, below, is the second tuning). The held-out split is the
long tail on purpose (the table places 13 of its 81 titles, 7 of them wrongly,
several of them the ambiguous titles above), so it rewards overriding the
table more than everyday titles ("Dinner", "Gas", "Groceries") would. With
the shipped path, 102 of 214 chips change after the pause, all from Other.
History's hit rate depends on how often a group repeats a title; on the set's
own 12 near-repeats it recalled all 12 with the right label, 7 of them titles
the table does not know, and each hit also saves a model request and a swap.
*The gate.* Which keyword hits the model may overturn, over all 221 titles
with history first and the model's `other` as no answer (`npm run
eval:categories -- --strategy gate-a,gate-b,gate-c,gate-d,gate-b1,gate-d1`;
held-out split into the 81 original titles and the 7 added ones; *agreed*
counts right keyword chips the model only agreed with, which gain the sparkle
with no swap):

| Ask the model also when | Train | Held-out (81) | Added (7) | Held-out (88) | Undone | Agreed | Sent |
|---|---|---|---|---|---|---|---|
| (a) never: only when nothing is known | 91% | 73% | 1 | 68% | 0 | 0 | 121 |
| (b) 3+ words and a single keyword | 90% | 73% | 4 | 72% | 3 | 33 | 167 |
| **(c) keywords of two categories (shipped)** | **92%** | **77%** | **2** | **73%** | **1** | **3** | **133** |
| (d) (b) or (c) | 92% | 77% | 5 | 76% | 4 | 36 | 179 |
| (b′) 3+ words and a single one-word keyword | 92% | 74% | 4 | 73% | 0 | 28 | 159 |
| (d′) (b′) or (c) | 93% | 78% | 5 | 77% | 1 | 31 | 171 |

(b) and (d) undo more than two right chips, all through multi-word keywords
("hot springs", "shoppers drug mart", "gift shop"), and (b)'s gain is only the
added titles. (c) ships. (b′) and (d′) read "a single keyword" as a one-word
keyword, a reading chosen after seeing (b)'s undone chips; most of their
extra gain is the added titles ("Train and Co Drama Theater", "Hotel
California tribute show", "Cabin Fever Brewing"), and they put the sparkle on
about thirty right chips the model only agreed with ("Taxi from the station"),
so they wait for a decision about the sparkle on everyday titles.

*Two on-device models.* The content-tagging model is the fallback, not the
first model: it refused no more than the general one here and scored lower.
`npm run eval:categories -- --refusals` asks each arrangement about
`packages/core/src/categories.refusals.json`, 38 legitimate titles guardrails
might refuse (beer, bars, spirits, wine, cannabis, gambling, pharmacy items,
alarming words), 35 of them labelled and 11 also in the eval set:

| | General | Content tagging |
|---|---|---|
| Refusal set: refused, error, timeout | 0, 0, 0 | 0, 0, 0 |
| Refusal set: answered `other` | 1 | 4 |
| Refusal set: right, of 35 labelled (11 in the eval set) | 31 (9) | 28 (9) |
| Eval, history and table first (gate a): train, held-out, undone | 91%, 68%, 0 | 89%, 68%, 2 |
| Eval, the model on every title: train, held-out | 89%, 77% | 86%, 74% |
| p50 per request | 247 ms | 262 ms |

The retry (general, then content tagging after a refusal or error) scored
exactly as the general model alone: nothing here was refused or failed, so it
never ran. It is there for the phone.

*Latency.* The first request of a fresh process for "Hazy IPA": 3.8 s after a
long idle following heavy use, 0.76 to 1.6 s after three idle minutes (four
runs), 0.3 s with the model warm. Prewarmed 1.5 s before the request: 288 and
301 ms; 4 s before: 306 and 711 ms (`npm run eval:categories --
--first-request cold|prewarmed`). A cold first request can pass the old 2.5 s
timeout here, and a phone is slower. Those prewarms named no prompt prefix,
which changed some answers (*Determinism*, below); the prewarm that ships
names one and costs more on a warm model: 355 to 368 ms for the first request
after it, against about 280 ms for a prewarm without a prefix and 257 ms for
no prewarm once the process has asked once (its first request without a
prewarm took 760 ms). Later requests are unchanged. After three idle minutes,
the first request took 842 and 1,755 ms with no prewarm, 420 and 2,007 ms
after a prewarm without a prefix, and 392 and 392 ms after the prefix prewarm
(two runs each).

The phone runs a smaller variant. On the owner's iPhone 18 Pro Max, build 120,
the model is "AFM 3 Core" and "Hazy IPA" came back Coffee (an earlier build
gave it no answer; the logs above say whether a refusal or a cold start past
the timeout). No API makes the smaller variant on a Mac
(`SystemLanguageModel.Variant` names `core3` and `coreAdvanced3`, but a model
cannot be made from one), so every number here is the Mac's "AFM 3 Core
Advanced", a proxy; Diagnostics' "Check the model" scores the phone's own.
This Mac refused none of the refusal set with either model.

*A prompt for the smaller model.* The build 120 prompt never said "beer":
drinks was "bars, pubs, breweries, alcohol and liquor stores", so "hazy" and
an acronym read as a coffee order, and this Mac's model answered "Hazy IPA"
coffee on a fresh session. The prompt is now written for a small model: one
short line per category with at most five concrete words, then one plain
sentence for each pair the eval set shows confused (drinks and coffee,
groceries and shopping, lodging and rental, transit, fuel and parking), and no
examples to generalise from. A minimal and a richer variant, and the two
between them, were tuned on the train split and the refusal set only (leaving
out the four refusal titles held out in the eval set), then scored once on
held-out, the model on every title (`npm run eval:categories -- --strategy
all-general,p-build120,p-lines,p-minimal,p-minimal-b --added 30`, and
`--refusals`, general model):

| Prompt | Tokens (chars) | Train | Held-out (88) | Added (30) | Held-out (118) | With a trailing newline: train, held-out (118) | Refusal set right, of 35 | "Hazy IPA" | p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|
| Build 120: lists of up to eight | 334 (1,301) | 118 | 68 | 19 | 87, 74% | 119, 88 | 30 | coffee | 248 / 260 ms |
| Minimal: three words a line | 227 (751) | 112 | 64 | 15 | 79, 67% | 112, 80 | 29 | drinks | 212 / 215 ms |
| Minimal and the four sentences | 286 (994) | 120 | 66 | 16 | 82, 69% | 121, 80 | 28 | drinks | 231 / 233 ms |
| Five words a line | 278 (971) | 115 | 69 | 18 | 87, 74% | 114, 83 | 29 | drinks | 230 / 236 ms |
| **Five words a line and the four sentences (shipped)** | **337 (1,214)** | **115** | **68** | **20** | **88, 75%** | **120, 87** | **30** | **drinks** | **251 / 270 ms** |

The same prompt with a newline added at the end, which says nothing new, moved
train by up to five titles and held-out by up to four: differences of a few
titles are noise, so each prompt was scored both ways. The rule was the
shortest variant within a point of the best held-out, and only the shipped one
is on both strings (88 and 87, against the build 120 prompt's 87 and 88): the
five-word lines alone average 85 of 118, the minimal ones 79.5 and 81 (on the
compiled string alone the five-word lines would have been within a point).
Three words a line lose eight held-out titles against the build 120 prompt on
this model, and the four sentences add more on train than the longer lines do.
The shipped prompt is as long as the one it replaces (337 tokens against 334),
so latency stays near 250 ms.

What moved: the beer titles among the added ones ("Double IPA", which the
build 120 prompt also called coffee, "Grizzly Paw", "Oatmeal porter") are now
drinks, but unknown names lean to drinks too ("Blenz", "Second Cup" and "tims"
coffee → drinks, "Mary Brown's" food → drinks), and the coffee chains,
hardware stores and ski hill the Mac's model does not know ("49th Parallel",
"RONA", "Nakiska") stay wrong either way, for history to learn after one tap.
On the shipped path (history, the table, then the model), against the build
120 prompt: train 118 (123), held-out 84 (84), added 20 (19), undone 3 (1:
"Tip for the ski guide"; now also "Dry cleaning" and "Stamps", right Other
chips the model moved) (`--strategy shipped,shipped-build120`). The refusal
set, the general model through the module: 30 of 35 right and two `other`
(build 120: 31 and one, its "Hazy IPA" answered on the prewarmed session), no
refusals.

*Determinism.* Greedy decoding gives the same answer for the same prompt on a
fresh session: two passes over 160 titles (train and the refusal set) agreed
on all 160. A session prewarmed with `prewarm()` and no prompt prefix did not:
with the build 120 prompt it answered 7 of those 160 differently from a fresh
session ("Hazy IPA" coffee → drinks, "Highway toll", "Surly's" and four other
refusal-set titles), every run, with or without a wait before the request;
with the shipped prompt, 21 of all 278 titles (the eval set and the refusal
set). Its transcript was the same (instructions, prompt, response format), and
leaving the schema out of the prompt changed nothing, so the difference sits
in the framework's cached prefix, not in what the session carries. Prewarming
with a prompt prefix (the prompt's own "Expense title: ", or even an empty
one), or prewarming one session and answering on another, changed 0 of 160,
and the prefix 0 of 278 with the shipped prompt. `ExpenseClassifier.prewarm`
now names `promptPrefix`, the start of every request, so the first title after
the sheet opens gets the answer any later title gets: `all-general-prewarmed`
(each of the 251 titles on its own prewarmed session) scores exactly as
`all-general`, and `--first-request cold` and `prewarmed` both answer "Hazy
IPA" drinks (three runs each; build 120 answered coffee cold and drinks
prewarmed). The cost is the first request after the prewarm (*Latency*,
above).

**Chip state machine.** The category chip holds `{ category, source }` with
`source ∈ keyword | model | user`, and these rules prevent the model from
overwriting a choice the user has made:

- A user tap sets `source = user`, cancels any in-flight model request, and
  drops any reply that arrives afterwards. Later title edits do not re-infer.
  `user` is sticky until the sheet is dismissed.
- While `source` is `keyword` or `model`, every keystroke runs the local
  guess (`guessCategory`: history, then the keyword table). If the guess
  stands (a history hit, or keywords of one category), it is applied at once
  and `source` becomes `keyword`. If the model decides it (`needsModel`:
  nothing known, or keywords of two categories) and `source` is `model`, the
  model's pick stays (`source` stays `model`, the sparkle stays) while the new
  title continues the title the model answered: one starts with the other
  after trimming and case folding, so the person is extending it or
  backspacing through it (an empty field continues nothing). Otherwise the
  guess is applied (Other, or the table's longer keyword), `source =
  keyword`. The controller remembers the asked title of the reply that set or
  last confirmed the pick for this. After the 500 ms pause it issues a model
  request for the new title only when the model decides the guess ("Model
  refinement"); a reply that differs swaps the chip, one that agrees changes
  nothing shown. So typing "Surly's brewing" with pauses keeps the model's
  Drinks from the first answer on, instead of dropping to Other on each
  keystroke between answers, and "Hotel bar tab" keeps the model's Drinks
  instead of flicking back to the table's Lodging.
- The model's `other` is no answer (`refineCategory` returns null): the chip
  keeps what it shows, so the sparkle never sits on Other ("Sur" stays Other
  with no sparkle). A pick the model already made for an earlier form of the
  title stays too.
- Each model request carries the exact title it was asked about. A reply is
  applied only if that title still matches the field and `source` is not
  `user`; otherwise it is discarded. So a model result can be refined by a
  later model result, but never overwrite a tap.
- Tapping Save freezes the chip; the event carries whatever it shows, and
  the chip keeps what it shows, the sparkle included.
- The sparkle (AddExpenseStates, "Category chip"; AddExpense and
  CategoryPicker draw it): while `source` is `model` (the model's pick, not
  yet touched) the chip carries a small muted sparkle after its label,
  Apple's mark for a model suggestion: SF Symbols' "sparkle" as a filled
  14 pt glyph in `textSecondary`, 6 pt after the label, the chip's right
  padding 12 instead of 14. There is no timer and no word; the chip's
  accessibility label says "suggested". It goes when the user taps the chip
  and picks a category, even the one the model picked (`source = user`): it
  fades out over 250 ms. A keystroke whose local guess is applied
  (`source = keyword`) drops it at once; a model reply for the new title
  brings it back. A keystroke that keeps the model's pick keeps it. A model
  reply that agrees with the keyword guess makes the chip the model's pick
  too, so it carries the sparkle, with no swap. A keyword-inferred chip
  carries nothing, and a user-chosen chip never carries it. When the model
  changes the chip, the swap animates (a 260 ms
  fade and scale in from 0.9). The chip's width never jumps for the sparkle:
  its 18 pt of room closes over the same 250 ms as the fade (or as a
  keystroke drops it), and opens over 260 ms as it fades in, in step with the
  swap when a swap brings it. Under Reduce Motion none of this animates. With
  no title yet (and nothing chosen) the chip is the dashed "Category"
  placeholder.

Replies and taps are both handled on the JavaScript thread in arrival order,
so there is no window in which a user tap can be lost.

Either way, inference is only a default: the event carries the category that
was on the chip at save time, never the guess, so no two phones ever need to
agree on an inference. The one thing the phone learns from an override is
the title itself: the category saved with a title is recalled for the same or
a similar title later ("Model refinement", history first).

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
  valid secret unusable (one holding a bidirectional-control character is
  dropped, below).
- Group names, member names, titles and notes hold no bidirectional-control
  character, U+202A–U+202E or U+2066–U+2069 (`hasBidiControl`; pre-launch
  review L4). One reorders the text around it wherever it is shown (the Join
  preview, a notification, Activity), so a member could make one line read as
  another. The marks U+200E, U+200F and U+061C stay allowed. This is a
  tightening on the current `sv`, made after v1 events were first written: an
  event written before it with such a character is now skipped like any
  invalid one, on every build with the rule, and is never rewritten; a build
  without the rule still applies it, so until those builds are gone the two
  can show such an event differently. The app's own checks refuse one before
  a write (`invalid`). `makeInvite` refuses such a `g`; `decodeInvite` drops
  it, so the invite still joins and the preview reads as one with no name.
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
- The validator checks a currency's shape only, so a group's currency (from
  `group.created`) may be one this build's frozen ISO 4217 table does not
  know: a newer table's, or a hostile member's. That group shows the same
  banner, offers no Add expense or Settle (there is no exponent to enter an
  amount in), and its amounts read as plain integers through core
  `displayMinor`, never a throw in a render, as the reducer's summaries and
  the CSV export already do.

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
  created_at INTEGER NOT NULL,        -- when the debt was recorded, unix ms
  attempts   INTEGER NOT NULL DEFAULT 0,  -- DELETEs that got no answer or a transient one
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
  offers "clear unreadable entries". `unsupported_envelope` rows (unknown
  `v`, cannot be opened) are capped the same way, at 1,000 per group, oldest
  dropped first: only a server or a newer client can write them, and a
  server can write them without end (pre-launch review M2). The group shows
  the update banner from the first one, and a later build that reads them
  needs any dropped ones pulled again. `invalid` and `unsupported_body` (opened,
  unknown `sv` or `type`) rows are kept, since a future client may read
  them; only a holder of the key can write one. Both caps are applied with
  each pulled page that brings such a row, inside the page's transaction.
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
- v3: adds `pending_deletes.created_at` and `attempts`. A debt recorded
  before it counts its age from the migration, with no attempts.

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
   `min(max_batch, 100, current batch size)`. On `200`, mark **every**
   envelope in the batch `acked = 1` (accepted or duplicate). Apply the epoch
   rule below to the response.
2. **Pull**: `GET …?since=cursor&limit=min(max_page, 1000)` while `more`,
   within the cycle's budget (below). Apply the epoch rule **before**
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
   transaction. Each opened body goes into the decode cache (below), and an
   envelope the cache already holds is not opened again.
3. **Recompute**: invalidate the group's memoised state; observers re-render.
4. Record `last_synced_at` or `last_sync_error`; reset
   `epoch_resets_this_cycle`. Both happen at the end of every cycle,
   successful or not, so an `epoch_unstable` group tries again on a later
   cycle instead of staying stuck.

`name_cache` and `currency_cache` are taken from the derived state by the
lifecycle check that follows every cycle (`GroupService.processLifecycle`):
the reducer already holds the group's name and currency, so nothing opens the
log again for them.

**One decode cache.** Every body the app decrypts is held in memory once, per
group and envelope id, with the exact envelope text and the server group id it
was opened for, in one cache shared by the engine, the derived state and
rotation (`services/sync/decodeCache.ts`; pre-launch review H3, where a join
opened every envelope three times). The pull puts what it opens; the derive
and rotation's copy take from it; a server move carries each entry over to its
re-encrypted envelope, whose plaintext is byte-identical; and a pull that
brings back an envelope already held (after a move or an epoch reset) does not
open it again. A lookup with other text or another group id misses, so an
entry never stands in for an envelope it was not opened from. It is memory
only, like every decrypted body, and a group's entries go when it is left.
A pulled entry that is not an envelope at all is stored as `undecryptable`
with its text cut to 4 KiB, so one oversized item cannot fail its page; one
with no usable id is skipped. A page that says `more` without advancing
`next` stops the cycle as `server_error`.

**What a server publishes is bounded.** The server is whoever the invite
names, so the client does not take its word for sizes (pre-launch review
M2). It sends at most 100 envelopes per append and asks for at most 1,000
per page, whatever `max_batch` and `max_page` say; the protocol lets a client
send and ask for less. One cycle pulls at most 20,000 entries' worth of
pages, epoch restarts included: twice the public server's 10,000-event cap,
so a whole group pulled before and after one epoch reset fits. Each page is
charged the entries it asked for, or those it brought if more, so pages that
say `more` forever end the cycle whether they carry entries or not. Past the
budget the cycle stops as `server_error` and backs off; what it pulled stays
committed, and the next cycle carries on from that cursor (a group above
20,000 events on a self-hosted server takes more than one cycle).

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
| network / 5xx / 429 | Silent; exponential backoff per group (30 s → 2 m → 10 m, reset on success), or `Retry-After` when the server sends one, honoured up to a day (a longer one counts as a day). Within a cycle, a 5xx retries the same outbox head after 0.5 s → 1 s → 2 s; every third consecutive 5xx halves the batch size (floor 1, kept until the app restarts or the group moves); the cycle gives up after six consecutive 5xx while pushing (three while pulling) and backs off. Sync state shows "Not synced since …". |
| `503 over_budget` | Pushes to that server pause until its `Retry-After` (30 s without one, a day at most) while pulls go on ("reads still work"); the cycle reports `failed` with that retry time and the group is not backed off. |
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

Local log lines for a sync failure are fixed words, the error code and the
HTTP status (`sync failed code=unauthorized status=401`, `sync dropped a
pending delete code=unauthorized status=401`): never the server's URL or
host, the error's message, or any text from a response (its `message`, an
`error` that is not a protocol code). React Native writes every console line
to the device log, release builds included, and the server is whoever the
invite names, so nothing it writes is repeated there. A local failure outside
a cycle (the store, a listener) adds its error's name and message. Never a
group id, token, envelope or body (the same rule as the server's, in
`THREAT-MODEL.md` "What we log").

Every other log line in the app (the screens, the state layer, the
background task and notifications) gives a failure as fixed words plus
`describeForLog(error)` (`state/errors.ts`): the error's name and, when it
has one, its code (`StoreError code=group_not_found`), never its message,
which can quote a local id (a `StoreError`'s "no group <localId>"), a server
URL or a server's own words (pre-launch review L7). Only the engine's own
lines for a local failure outside a cycle still add the message, as above.

**Pending deletes.** A debt is retried at the start of each cycle (step 0).
`204`, or `404` (nothing left there), pays it. No response, 5xx, 429 and 503
keep it for the next cycle. Any other answer (`401`, `410`, `405`, …) cannot
change on retry, so the debt is dropped with a local log line. The group id
for the `DELETE` is `base64url(SHA-256(auth_token))`, so no secret is needed.

A kept debt is not kept for ever (pre-launch review L3): it is given up, with
a local log line (`sync gave up a pending delete code=network`), at its 20th
failed attempt or at its first failed attempt 30 days after it was recorded,
whichever comes first. Giving up means the copy stays on that server until
the server's own expiry removes it (`retention_days` after its last write;
12 months on the public server), and the token leaves this phone's disk and
its backups, which is the point: a server gone for good would otherwise keep
its token in `pending_deletes` forever. An attempt with no answer counts, so
twenty cycles offline give a debt up too; a debt older than 30 days whose
server answers is still paid. Asking again ("Delete the copy on <old host>"
after a move) records the debt anew only once the old one is gone.

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
Every request times out after 30 s as `network`. A response body over
16 MB is refused as `server_error`: by its `Content-Length` before it is
read, or as it streams in, and once read where `fetch` cannot stream (React
Native's), never parsed or kept. A full page from a conforming server is at
most about 11 MB (1,000 envelopes of 8,192 bytes of ciphertext). It never
retries; retry, backoff and `Retry-After` belong to the engine. Error
messages are fixed
words: the route pattern (`/v1/groups/{groupId}/events`), the status and the
code; never the path, and never text from the response body. An explicit
option (`allowInsecureLocal`) accepts `http://` for a server on this machine or
its local network (loopback; 10/8, which holds the Android emulator's
`10.0.2.2`; 172.16/12; 192.168/16), still deriving keys for the `https` form.
Tests set it, and so does a development build for such a server (the dev
server, "Development" below); a release build never does, since `__DEV__` is
false there. The group's server URL is always the canonical `https` form.

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
`group.rotated { from }`, `from` matches a local group whose state is not
already `hidden`, and that old group's own log holds a `group.closed { to }`
naming this group: sync the old group one last time (the one exception to
"closed groups never sync"), then re-encrypt into the new group every
old-group envelope with `origin = 'local'` whose id the new group lacks. This
rescues this device's own writes, including any unpushed outbox, and nothing
else: events written by the removed party after the rotation never cross,
because no device claims them as its own. Control events are never copied.
Set `acked = 0` on the rescued rows, set the old group to `hidden`, and carry
over `my_member_id`. Two `group.rotated` events with the same `from` in
different groups mean two members rotated concurrently; the app shows both
groups, lets the user pick, and sets the other to `hidden`.

The closure is the check. A `group.rotated` alone is a claim anyone in the
new group can write, naming any group whose `localId` they know; acted on
alone, it would copy this device's writes from that group into a group whose
other members never had its invite, and hide it here (pre-launch review M1).
The old group's `group.closed { to }` is its agreement, and the rotator
always writes it (step 6). Until it is on this phone nothing happens, and
recognition runs again at the next lifecycle check of either group: the new
group's after each of its syncs, and the old group's when its sync brings the
closure. The cost: a straggler whose rotator's closure never reached the old
server keeps the old group visible and un-rescued. The check raises the bar
without closing it: a member of both groups can write both halves, which
closes the old group for everyone in it and says so in its activity.

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
- On Android every activity notification is posted in the app's one
  notification channel, "Group activity" (id `group-activity`, description
  "New expenses and payments in your groups."), which people see and can turn
  off in Settings › Apps › Even › Notifications. The app creates it at launch
  and again before the task posts (`ensureActivityChannel`); creating it asks
  for nothing. Its importance is the one expo-notifications' fallback channel
  ("Miscellaneous") had: high, which Settings shows as Default with Pop on
  screen. An app can lower a channel's importance later, never raise it.
- iOS runs background tasks at its discretion, often only when the phone is
  idle or charging, and never after the user force-quits the app. Android has
  a 15-minute floor. App settings makes no promise about timing (the
  Notifications row has no sentence under it). Any claim about when updates
  arrive is verified on a real device before it goes into store copy.
- Background sync is always on; there is no per-group or app-level switch for it, because the OS already decides when it runs and a switch would only make the app look broken when flipped by mistake. The one user-facing control is **Notifications** in App settings, tied to the OS permission, requested contextually the first time the user opens a group that has more than one member (once per install; the `prefs` row `notifications.asked` remembers it, and an answer given through the switch counts too); the switch carries no caption, since it says what it does.
- A prompt closed with no answer is not an answer. Android 13 and later let
  people close it with Back or a tap outside; the OS then records no decision
  and would show the prompt again, but expo-notifications reads that close
  exactly like a final refusal (denied, can't ask again), and so does
  Android's rationale flag. Only a first "Don't allow" reads differently
  (denied, can ask again). So on Android, "denied, can't ask again" right
  after a prompt counts as unanswered (`promptWentUnanswered`, state/prefs.ts;
  the `prefs` row `notifications.unanswered` counts them in a row): the next
  group open that qualifies asks again, and the switch shows the prompt
  instead of opening Settings. After two prompts in a row end unanswered
  (`UNANSWERED_PROMPT_LIMIT`) the group screen stops asking and the switch
  opens Settings. A real final refusal read this way costs one request that
  shows nothing. An answer, any answer, ends the contextual asks. iOS's prompt
  cannot be closed without an answer, so iOS asks exactly once.

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
- **Open**: expo-router hands every URL the system opens the app with to
  `src/app/+native-intent.ts` (`redirectSystemPath`) before it routes it, at
  launch and when a link reaches the running app. The universal link and App
  Link with a payload (`https://even.appalaya.com/i#<payload>`, also `/i/#`)
  leave there as `/join?code=<payload>` (`routeForSystemUrl` in
  `features/join/invite.ts`), so the code travels in the route and the Join
  preview opens whether Even was closed, in the background or on screen, with
  or without groups. The app claims exactly `/i` and `/i/…` on
  even.appalaya.com, as the iOS association does: Android's App Link filter
  (app.json, `intentFilters`) is `path: "/i"` plus `pathPrefix: "/i/"`, not a
  `/i` prefix, which would also take `/index.html` and any later page whose
  path starts `/i` (pre-launch review L5). Nothing listens for the link
  after a screen mounts: `/i` used to (`Linking.useURL()`), and missed every
  link that reached a running
  app, which arrives as one `url` event that had passed by the time `/i`
  mounted. `redirectSystemPath` also clears expo-linking's launch URL
  (`clearInitialURL`), which the router reads whenever its root mounts: iOS can
  mount it again while the process lives (a new scene connection, which shows
  the splash) and records a universal link there only while it is empty, so a
  link already routed must not stay there. `/i` without a payload goes to
  Groups. Another invite opened while Join shows replaces its code. The custom
  scheme `even://` is registered for the landing page's "open app" button only
  and never carries a payload (`even://i#…` goes to Groups); `even://join`
  opens the Groups screen with "Join with code" expanded, so the user pastes
  the code they just copied. `canonicalOrigin` uses a small pure-TypeScript URL
  parser in `core`, not Hermes's incomplete `URL`.
- **Paste**: the Groups screen has "Join with code." It accepts the bare
  payload or a full link and strips the URL. A checksum failure says "That
  code isn't complete. Copy it again." A code that reads, pasted, typed,
  scanned or opened as a link, puts the keyboard away so the preview card and
  Join show (`afterCheck`); a tap on the sheet outside the field, or a drag of
  its content, puts it away too. While the keyboard is up the sheet's content
  ends 12 above it and scrolls.
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
- **Already in** (boards JoinCodeHeld, JoinCodeHeldDark): a code, pasted,
  scanned or opened as a link, that names a group this phone holds on the
  invite's server says so before any tap. The preview card reads "You're
  already in" in the check line in place of "Code complete", the group's name
  alone as its title (the name this phone knows it by, else the invite's), the
  currency and server rows as they are, and Open in place of Join. Open runs
  Join, whose `already` opens the group; Group then offers "Which name is
  yours?" (SeatPick) while this phone has no seat. The check never reaches a
  server: the group's `localId` derives from the invite's key as Join derives
  it, and `inviteFit` (`state/groups.ts`) reads only that row; `joinInvite`
  acts on the same decision, so the preview says what the tap does. An
  archived group is still held and reads the same: archiving is an event in
  the group's log, reversible and still syncing, not the end of this phone's
  hold on it, so Open lands on the group, read-only with its Unarchive banner,
  and the invite does not unarchive it. A group closed or hidden here (rotated
  away) keeps the plain preview; Join then says "This group's invite was
  regenerated. Ask a member for the new one."
- **Already have it**: an invite whose `localId` matches a local group and
  whose server differs is treated as a move (above), with confirmation, not as
  a duplicate. Its preview reads as any invite's (JoinCodePreview); the
  confirmation comes after Join.
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
├── +native-intent.ts        → Invite links (/i#<code>) → /join?code=<code>
├── i.tsx                    → /i without a code: redirects to Groups
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
  cards with Unarchive. The top right is you, not a gear: your 32 pt avatar
  (initials on your colour, or your emoji, as App settings' You card draws
  it) in a 44 pt target beside the large title, or a person glyph on the
  neutral `separator` fill until a name is set; it opens App settings
  ("App settings. You: Sam." / "App settings. No name set yet.").
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
  On a screen shorter than the boards (402 × 874), Save and the keypad (or the
  category grid) keep their size and their place at the bottom, and the rest
  gives way in this order (`fitShortScreen`): the space above the amount; the
  amount, its code first moving beside it on the baseline (as while typing),
  then the amount shrinking to 30/34; the gap above the keypad, 12 to 4; and
  last, the rows between the amount and Save scroll, and only then, so the
  sheet's swipe down works everywhere else. A 16:9 Android phone (411 × 731
  dp) fits without scrolling; on an iPhone SE (375 × 667) the Split row is
  scrolled to. While the title is typed only the scrolling applies, so Save
  stays above the keyboard. At the boards' size and taller nothing changes.
- **Split** (pushed from Add expense): segmented Equal · Exact · Percent. In
  Equal each member row has an optional "×n" multiplier and an optional
  "+ extra" amount. Extras come off the top and the rest splits by share; the
  line under Total says what that makes of this amount, "$12.00 in extras
  first, then $84.00 split 2 : 1 : 1 : 1." (SplitEqual), or "$36.00 split
  1 : 1 : 1." with no extras (SplitStates), and no line states the rule
  itself. The field is 72 wide and grows to fit its amount, so money
  is never clipped: it keeps the row's right edge under the amount, and the
  stepper to its left moves over (the name truncating first) or, when even
  that is not enough, drops below it. Over-assigned Exact and Percent read
  "Over by $6.00" / "Over by 5%" (never red) and Done stays off until
  Remaining reaches zero, with no caption saying so.
- **Expense detail**: the facts, the split, who added it and when, edit and
  delete, and a History section listing every version with who changed what;
  any version can be restored in one tap.
- **Settle**: from → to → amount, prefilled from the tapped settle-list row;
  from Balances' "Settle up" it starts empty (you pay, "Choose" whom). From
  and To open the member sheet; recorded, the button reads "✓ Recorded" for
  0.8 s, then the sheet closes. On a screen shorter than the boards, Record
  payment, the line under it and the keypad keep their size and their place,
  and the rest gives way in Add expense's order (`fitShortScreen`), From and
  To, the amount, the date and the note being the rows that scroll last: a
  16:9 Android phone (411 × 731 dp) fits without scrolling, an iPhone SE
  (375 × 667) scrolls to the date and note, and while the note is typed it
  stays just above Record payment, above the keyboard. At the boards' size
  and taller nothing changes.
- **App settings** (your avatar at the top right of Groups): a "You" card with the avatar
  centred at the top, 72 px, a small pencil badge on its corner and no
  caption (tapping opens the same emoji picker sheet used everywhere, with
  "Use initials" to clear), and the Name field on its own row beneath; Appearance (System · Light · Dark); Notifications (the only
  switch, tied to the OS permission, with no sentence under it); Import group
  file ("Opens a group from a .even file."); Help ("Help and
  feedback" opens `/contact` in the in-app browser, captioned "Opens our
  contact page. Nothing about your groups is sent."); and last, in a card of
  its own 20 below that caption, one "About ›" row that pushes About. No
  background-sync switch exists anywhere.
- **About** (AppAbout, AppAboutDark; pushed from App settings): "‹ Settings"
  with "About" centred; 28 below, the mark at 64 pt in the accent, "Even"
  28/34 bold, and the version and build ("1.0 (120)", a zero patch dropped);
  one card of Privacy, Terms and Source code (the public repository), each in
  the in-app browser; then a card with "Diagnostics ›", captioned "What the
  app knows about its model and sync. Nothing here leaves your phone." (on
  Android the caption leaves out the model, as Diagnostics does there; see
  Copy). A settings sub-page: the links and the version had outgrown App
  settings, and Diagnostics needed a place out of everyday reach.
- **Diagnostics** (AppDiagnostics, AppDiagnosticsDark, DiagnosticsStates;
  pushed from About): read-only except one button, and everything on it is
  already on the phone. Why it exists: a tester can say what the category
  model and sync are doing without a Mac, a cable or Console.app, and it sits
  two levels down, so the everyday screens pay nothing for it.
  *Category model*: Status, asked afresh when the page opens ("Available",
  "Unavailable: Apple Intelligence is off", "Unavailable: the model isn't
  ready yet", and "Unavailable: this device can't run it" for every other
  reason), Model ("System language model" while it can answer, else "—"),
  and "Since Even opened": the last 20 replies to the chip (`refineCategory`),
  newest first, as Outcome (Answered, No answer, Timed out, Refused, Error),
  Category ("🍻 Drinks", or "—"), Time ("0.4 s") and Model (`general`,
  `tagging`). They are kept in memory only, never a title, and are gone at the
  next launch; a call that never reached the model (blank title, no model)
  adds nothing. Empty: "Nothing yet. The model runs when a title doesn't match
  a keyword." Caption: "Only outcomes are kept, never titles."
  *Check on this phone*: "Check the model" runs every labelled title of
  `categories.eval.json` (all splits, bundled) through the on-device model
  one at a time, straight to the native module, so none of it reaches the
  outcomes above, the JavaScript log lines or history (the native `classify`
  line is still written for each title, without it). While it runs, "Checking…
  37 of 221" over a progress bar and the button off; done, "178 of 221
  right, 81%", "Median 0.4 s per title", and each category's right of total
  with a bar as on Balances, the button on again (a second run starts over).
  Leaving the page stops the run, and so does the app going to the
  background: the titles scored by then are kept as a stopped run, never
  shown as done (no board draws it, so the page shows the button as before a
  run). A title with no reply after 8 s (the native side gives up at 6 s)
  counts as wrong, timed out, and the run moves on. The button is off while
  the model is unavailable (not drawn; the Status row above says why).
  Caption: "Runs the app's built-in test titles on this phone's model. About
  a minute. Nothing leaves the phone."
  *Sync*: one row per group on Groups (archived included): the name, "3
  unsent", "Last synced 2 min ago" (or "1 hr ago", "3 days ago", "just
  now"; "Never synced"), and after a failed cycle the error under a warning
  glyph in the words Group's status line uses ("Can't reach this group's
  server.", "Not synced since 2:10 PM"). The section is left out with no
  groups (not drawn).
  *This build*: Version ("1.0 (120)"), iOS (the system version), Device (React
  Native knows only "iPhone" or "iPad" on iOS; the model name needs
  `expo-device`), and Apple Intelligence (On while the model is available or
  getting ready, else Off); on Android, Android (the release, "17") and Device
  (the model React Native reports), with no Apple Intelligence row. No device
  id, not even shortened (the AppDiagnostics boards still draw "d91f…Kq2e" and
  are to lose it): the page is made to be screenshotted and sent, the id is
  the one value on it that is the same in every group and survives a
  reinstall, and nothing a tester or support holds can be matched against it
  (the server never sees it; group members already see its short form in
  Activity).
  *On Android* (no board; the owner's call): the on-device model is iOS only,
  so the page leaves out Category model and Check on this phone altogether
  (`diagnosticsSections`) rather than show "Unavailable" and a button that can
  never turn on. It opens on Sync, 16 below the nav bar as the first section
  is on iOS, or on This build with no groups. iOS draws the boards unchanged.
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
- One accent colour per theme, the system font on iOS and Inter on Android
  (bundled; `src/theme/typography.ts`), no onboarding carousel.
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

Copy boards share, word for word, with one meaning each:

- "You're already in": said only of a group this phone holds. The Join
  preview for such a group on the invite's server (JoinCodeHeld, over the
  group's name alone) and the name pick offered again (SeatPick).
- "Open": JoinCodeHeld's button, in place of Join. It opens the group, or its
  name pick while this phone has no seat, and joins nothing.

Copy no board draws:

- Android's notification channel, shown by the system (Settings › Apps ›
  Even › Notifications): name "Group activity", description "New expenses
  and payments in your groups."
- About's caption under Diagnostics. iOS, as AppAbout draws it: "What the app
  knows about its model and sync. Nothing here leaves your phone." Android,
  whose Diagnostics has no model sections: "What the app knows about sync.
  Nothing here leaves your phone." (`diagnosticsCaption`)

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
button. Respect safe areas, dark mode, dynamic type. On iOS, push and pop draw
both screens as rounded cards over the native stack's own view, which takes the
canvas (`NavigationTheme`, React Navigation's theme background), so no grey
shows at their corners and edges in either theme. On Android, three-button
navigation shows the canvas behind its buttons (the system's contrast scrim is
off; the buttons are dark in light and light in dark), and `Alert.alert` stays
the system's dialog, in Even's theme: `surface`, `text` and `textSecondary`,
28 dp corners (the sheets' radius), Inter, sentence-case buttons in the
accent. Both buttons take the accent, because Android cannot make only Delete
red without a native module. At the largest text sizes a sheet header's
Cancel and Done keep their full width and never truncate. A back button's
label (Split's "‹ New expense") takes the room Done leaves and ends in an
ellipsis, as a screen's back button does. The centred title gives way to all
of them: it moves off centre only as far as it must, then ends in an
ellipsis, and is not drawn when they leave it no room.

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

## Development: the dev seed and its server

The dev seed (`src/dev/seed.ts`, opened by `even://dev/seed?state=<state>`)
writes the canvas's data for every screen through the app's services, for
screenshots. Its groups sync with the dev server and never with the production
one:

- `npm run dev:server` runs the Python reference server
  (`../even-server/python`) on 127.0.0.1:8787: its venv made with Homebrew's
  Python 3.14 and its pinned requirements on first use, an empty database in
  `${EVEN_DEV_SERVER_DATA:-~/Library/Caches/even-dev-server}` at each start
  (outside the project root, so Metro never sees its writes), rates raised to
  100,000 a minute so seeds can create many groups from one address, and the
  public server's caps, so Usage lines read as drawn. It logs only the
  server's own route-pattern line.
- The seed's server is `http://127.0.0.1:8787` on the iOS simulator and
  `http://10.0.2.2:8787` on the Android emulator (`Platform.OS`), or the link's
  `server` for a phone on the local network. Groups store its canonical
  `https://` form; a Debug build reaches it over http (Transport, above). iOS
  needs nothing more (`NSAllowsLocalNetworking` is Expo's default) and neither
  does Android (the debug manifest already sets `usesCleartextTraffic`; the
  main one does not).
- The seed refuses `PROTOCOL.defaultServer` and every host under
  appalaya.com, at its entry and in each writer, and `seed.guard.test.ts` runs
  every state against the fake servers to check that production receives
  nothing. It also refuses to run while the phone holds a group on production,
  since its wipe would drop the secret that `even://dev/cleanup` needs: that
  page leaves such groups with their production copy deleted, and deletes the
  production copy of every fixed seed key, past and present (a fixed key is the
  same group id on every phone). It sends production nothing but those DELETEs.
- Each state leaves its groups with their dev server copy deleted, and a group
  with a fixed key has that copy deleted again before it is written, so an old
  run's log is never pulled into a new one.
- The seed page waits, saying so, until the dev server answers. Screens that
  name the group's server now name the dev server where the boards draw
  `sync.even.appalaya.com`: Group settings' Host, "Moved from", Leave's
  checkbox, Move server, Report (the other-operator sheet, as the group is not
  on Appalaya's server), and the recovery sheet. The Join preview keeps the
  board's code, which names the default server; joining it would reach
  production, so screenshots stop at the preview.

Release bundles leave the seed and the dev routes out (pre-launch review
L8): metro.config.js adds `src/dev/` and `src/app/dev/` to
`resolver.blockList` when `NODE_ENV` is `production`, which `expo export` and
`expo export:embed --dev false` (what release builds run) set before they
load it; `expo start` keeps them. Nothing outside the two folders may import
from them (`src/metroConfig.test.ts` checks both). In a release build
`even://dev/…` therefore reaches Expo Router's unmatched-route screen, as any
unknown path does, where the routes used to redirect home.

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
