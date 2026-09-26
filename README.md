# Even — Split Expenses

*Pay whoever. End even.*

Even is a free, ad-free, account-free app for splitting expenses with friends
on a trip, in a house, or over a dinner. Create a group, share a link, add what
you paid, see who owes whom, settle up. That is all it does, and it does it
without ever seeing your data.

## Why another one

- **No ads, no daily limits, no upsell.** Free for everyone, forever.
- **No accounts.** A group is a link. Anyone with it is in.
- **Private by construction.** Everything is encrypted on your phone. The sync
  server, ours or one you run, stores ciphertext it cannot read.
- **Works offline.** Every phone holds the whole history. Add expenses on the
  trail; they sync when you have signal.
- **Outlives us.** The client is open source, the protocol is public, and the
  server is small enough to host on anything. If our free server disappears,
  point your group at another one.

## What it does not do

Push notifications in real time (it checks in the background, best effort),
receipt photos, currency conversion, multiple payers on one expense. These are
deliberate for v1; see `scope.md`.

## How it works, in one paragraph

Each group is an append-only log of events: "Maya added Dinner, 90.00, split
three ways." Every phone in the group keeps the full log and replays it to
compute balances. Events are encrypted on the phone with a key derived from
the group's secret, which lives only in the invite and in each member's
keychain; decrypted content stays in memory. A sync server stores and
hands back encrypted events in arrival order and knows nothing else. If the
server copy disappears, the next member to sync rebuilds it. See `design.md` for the details and
[`even-server/PROTOCOL.md`](../even-server/PROTOCOL.md) for the contract.

## Tech Stack

- React Native + Expo SDK 58 (Expo Router), TypeScript strict; iOS 27 and later
- SQLite via expo-sqlite for the local log
- `@noble/ciphers` and `@noble/hashes` for XChaCha20-Poly1305 and HKDF
- expo-secure-store for group secrets
- Vitest for the pure core package

## Setup

```bash
npm install
npx expo start            # dev server
npx expo run:ios          # iOS simulator
npx expo run:android      # Android emulator
npm test                  # core package tests (no simulator needed)
```

## Project Structure

```
scope.md              — what's in and out for v1
design.md             — architecture, data model, event schema, sync, screens
working-principles.md — how we work
packages/core/        — pure TypeScript: events, crypto, reducer, balances, money (no React Native)
src/                  — the Expo app
web/                  — landing page: universal-link files, invite page, terms, privacy
```

## Store listing

- iOS: **Even - Split Expenses**, bundle `com.appalaya.even`
- Subtitle: *No ads. No accounts. Private.*
- Android: package `com.appalaya.even`

## License

MIT. See `LICENSE`.
