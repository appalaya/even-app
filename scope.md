# Scope — Even v1

## Purpose

Let a group of friends record who paid for what and see who owes whom, with no
accounts, no ads, and no one but the group able to read it.

## V1 — In Scope

### Core loop
1. **Create a group** — name, currency (ISO 4217 code), your name, and an
   optional sync server for self-hosters. Generates the secret and the invite.
2. **Invite** — share as a link (`even.appalaya.com/i#…`) or as a pasteable
   code. Joining shows "Join *Banff 2026*?" and a pick-your-name list that
   marks names already claimed; claims are visible to the whole group.
   Members can be pre-added by anyone or added by the joiner. Names are
   unique per group.
3. **Add an expense** — amount, title, who paid (defaults to you), split
   (defaults to everyone equally). Equal (with optional per-member
   multipliers and extras, which cover shares and adjustments), exact
   amounts, or percentages.
4. **Edit and delete an expense** — anyone in the group, as in Splitwise.
   Every change is attributed in the activity feed and in notifications, the
   expense shows its full history, and any version can be restored in one tap.
4a. **Done adding** — each member can say "I'm done adding" and take it back.
   The group shows "N of M done adding", and "Everyone's done" once every
   member who has joined on a device has said so. Adding an expense clears
   your own mark.
5. **Balances** — per-member net, and the simplified "who pays whom" list.
6. **Settle up** — record a payment between two members.
6a. **Archive group** — an explicit, reversible end. Once everyone is settled
   the group offers to archive; Settings has it too. Archived groups are
   read-only, still sync, sit in a collapsed Archived section of the groups
   list, and show an Unarchive banner.
7. **Activity feed** — chronological list of everything that happened, with
   who did it and from which device.
8. **Categories and notes** — sixteen fixed categories with emoji, inferred
   from the title as you type and changeable in one tap, plus a free-text
   note. Balances show spend by category for the group.
8a. **Avatars** — initials on a colour by default, an optional emoji per
   member, and a local default name and emoji prefilled on every join.

### Platform and data
9. **Offline first** — every screen works with no network; writes queue and
   sync later.
10. **Sync** — through the server named in the invite; visible sync state per
    group; pull-to-refresh; sync on foreground.
11. **Background refresh** — OS-scheduled check for new events, with a local
    notification showing real content ("Maya added Dinner · 90.00").
12. **Export** — CSV per group via the share sheet.
13. **Group file export/import** — the whole group as one file (secret plus
    ciphertext, as sensitive as the invite), for backup and for when no
    server is reachable.
14. **Rotate invite** — new secret, log re-encrypted into a new group with
    event ids preserved, a "closed" marker written into the old group so
    stragglers know to ask for the new invite. The only way to remove someone.
15. **Move a group to another server** — a "moved" event tells other members
    to follow; the log is re-encrypted and replayed to the new URL.
16. **Members** — add, rename, archive, unarchive (never delete; history stays).
17. **Leave** (local only, never touches the server) and a separate, confirmed
    **Delete server copy**.
18. **Self-heal** — if the server copy expired or was deleted, members re-push
    their full log automatically.

### Web
19. **Landing page** at `even.appalaya.com` — hosts the universal-link and
    App Links association files, opens the app when installed, otherwise shows
    store buttons and the invite as a copyable code.

## V1 — Out of Scope

- **Push notifications via APNs/FCM.** Background refresh only. The protocol
  reserves the endpoint; implementing it means the server stores device tokens.
- **Receipt photo storage.** Needs a blob endpoint and larger caps. v2 candidate.
- **Receipt scan** (photo → merchant, total, date prefilled). Strongest v1.1
  candidate: on-device text recognition (Apple Vision / ML Kit) plus
  heuristics in `packages/core`, photo discarded after parsing, nothing sent
  anywhere. No new event types, no protocol change.
- **Siri / App Intents** ("add 40 for parking to Banff"). v2: native intent
  over the same core function. No data-model change.
- **Statement import** (screenshot of a bank app, PDF, or photo → tick the
  rows to add). v2: on iOS the on-device model reads the screenshot directly
  and returns typed rows, cross-checked against OCR so no amount is invented;
  elsewhere OCR plus a line parser. A review list with checkboxes; only ticked
  rows become events; the statement never leaves the phone.
- **Currency conversion.** One currency (ISO 4217 code) per group, no rates.
  Expense events carry a currency code so per-currency balances can come
  later.
- **Multiple payers on one expense.** Enter two expenses.
- **Recurring expenses.** Not a trip thing.
- **Comments on expenses.** The note field is enough.
- **Edit lock** ("only the payer and the adder can edit"). Candidate group
  setting for v2; honest clients would enforce it, a modified one could not
  be stopped, so it is a convenience, not security.
- **Per-expense custom emoji.** Categories carry the emoji; totals need
  categories to add up.
- **Member photos.** Blobs, size, and privacy. Emoji and initials only.
- **Web client.** Landing page only.
- **App lock.** Secrets live in the OS keychain; the phone's lock is the lock.
- **Per-device signing / proof of authorship.** The event schema carries a
  device id so this can be added; trust is social in v1.
- **Undo delete.** Deletion is a tombstone.
- **Merging duplicate members.** Sharing is gated until the creator's first
  sync is acknowledged, which prevents the common cause; rename or archive
  covers the rest.
- **Passphrase-protected group file.** v1 ships the plain group file with the
  same warning as the invite.
- **Search and filters** beyond scrolling. Trips are small.
- **Themes and custom categories.** Elegance is fewer choices.

## Design Constraints

- iOS 27 and later only; Expo SDK 58 or later. No effort is spent on older
  iOS versions.
- No hosted backend that can read data. The server is a blind blob store.
- The invite is the only credential. No accounts, no email, no phone number.
- Local SQLite is the source of truth; the server is a transport.
- The core logic (events, reducer, balances, crypto) is a pure TypeScript
  package with zero React Native imports and its own tests.
- Every decrypted event is validated; invalid ones are skipped, counted, and
  shown, never fatal.
- All money is integer minor units per the currency's ISO 4217 exponent.
  Splits are stored resolved, never as a rule. Currencies are ISO codes only.
- No decrypted content is written to disk except each event's ordering
  timestamp and the group name. SQLite holds ciphertext; bodies live in
  memory. Device backups are therefore allowed; on iOS they also contain the
  keys, on Android they do not.
- Elegance budget: three primary screens, no tab bar, two required fields to
  add an expense, dark mode and dynamic type from day one.

## Key Decisions

| Decision | Rationale |
|---|---|
| Expo / React Native | Same stack as Stow; one codebase for both stores. |
| Event log, not a mutable table | Additive merges need no conflict resolution; history is the audit trail. |
| Client-side encryption with `@noble/ciphers` | Pure TypeScript runs identically in the app and in tests; audited; no native module. |
| Hybrid timestamp per event | Last-writer-wins that survives wrong phone clocks. |
| Random envelope ids, not ULIDs | The one field outside the ciphertext leaks no time. |
| Invite code alongside link | There is no deferred deep linking without a third party; a fresh install has nothing to open. |
| Fallback transport is a file, not a link | An encrypted log is far too large for a URL that chat apps will pass through. |
| Two devices may claim one name | Phone plus tablet is legitimate; the activity feed shows the device so the group can see it. |
| Members archived, never deleted | Balances must stay correct forever. |
| Currency immutable from creation | No event can change it; prevents relabeling history. |
| Anyone with the secret can delete the server copy | Every member holds the log and self-heals on the next sync, so deletion is a cache purge; it exists for takedown and cleanup, not for rotation. |
| Rotation closes the old group rather than deleting it | Members who missed the new invite see "ask for the new invite" instead of silently resurrecting the old copy. |
| Server epochs and self-heal | A deleted or expired server copy is rebuilt by the next member who syncs; nobody's cursor goes stale. |
| Per-server auth tokens | A server the group once used cannot touch the group on any other server. |
| Plaintext padded to 256-byte buckets | The server learns a size class, not the event type or member count. |
| Decrypt on open, never cache plaintext | Keeps decrypted content out of iCloud and Android backups. |
| Leave is local; delete server copy is separate | The server cannot know who is last; conflating the two could strand others. |
| Background refresh, not push | No device tokens on the server, no third-party push dependency. |
| Landing page only on the web | One UI to make elegant; Safari storage eviction never becomes our problem. |
| Explicit done and archive states | Settling was a hidden agreement; two visible states replace the group-chat question "is everyone done?" |
| Shares and adjustments folded into Equal mode | Five capabilities behind three segments; splits are stored resolved so the schema is untouched. |

## Four Lenses Findings (Kickoff)

Preserved so they inform implementation:

- **Complexity lives in `packages/core`**: ordering, rounding, validation. Build and test it first, before any screen.
- **Silent skips are the dangerous failure**: the count of unreadable events must be visible in the UI.
- **Protocol drift**: the app must recognise `unsupported_version` and say "this server needs updating" rather than retry.
- **Universal links are unreliable in practice**: the copy-the-code path must be first-class, not a fallback nobody polishes.
- **The invite is the key**: onboarding says it in one sentence; the group screen always shows the invite so it can be re-shared.
- **Splitwise users will look for** notifications, receipts, and multiple payers. The README and one empty-state line name what is missing.
- **Edit and delete are not optional** for v1 to feel complete.
- **Performance**: replaying a few thousand events is trivial, but the derived state must be memoised per group, not recomputed per render.

## Adversarial Review Findings (Kickoff)

An independent review of the first draft found 23 defects and 19 risks, all
folded into `design.md` and the server repo's protocol. The ones that changed
the design rather than a sentence:

- Sequence numbers restarted after a delete or expiry and stranded every
  cursor → server epochs plus client self-heal.
- Rotation's "first event" marker could never be first (hybrid timestamps put
  it last), members who missed the invite resurrected the old group, and
  re-encryption did not say whether ids survive → any-position marker, a
  "closed" event in the old group, ids preserved, pull-before-rotate.
- Moving servers moved one phone → `group.moved` event.
- Field-level last-writer-wins could leave a split that no longer summed to
  the amount → amount and split are one atomic field, and the reducer flags
  violations.
- Ciphertext length leaked event type and member count → padding.
- The landing page's own script was an unguarded path to the secret → strict
  CSP, no injected scripts.
- Decrypted bodies cached in SQLite reached OS backups → decrypt on open only.
- "Cents" was wrong for zero- and three-decimal currencies → minor units.
- Timestamp validity was relative to "now" → absolute range.
- A 401 was documented as "invite revoked", which stateless auth can never
  produce → reworded, epoch and closure cover the real cases.
