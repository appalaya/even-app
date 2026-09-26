# @even/core

Even's pure core. No React Native, no Expo, no I/O. Runs in Node under Vitest and in the app unchanged.

| Module | Owns |
|---|---|
| `types.ts` | The shared contract: records, events, envelopes, invites, derived state. Change here means change in `design.md`. |
| `constants.ts` | Limits and protocol strings. |
| `encoding.ts`, `ids.ts` | base64url, UTF-8, random ids. |
| `keys.ts` | Secret → keys and ids; canonical server origin. |
| `envelope.ts` | Pad, seal, open; structural envelope checks. |
| `invite.ts` | Invite codec with checksum. |
| `money.ts` | ISO 4217 exponents, formatting, split math in BigInt. |
| `categories.ts` | Fixed categories, emoji, keyword inference. |
| `schema.ts` | `parseEvent`: the validator. |
| `hlc.ts` | Hybrid timestamps. |
| `reduce.ts` | Log → `GroupState`. |
| `balances.ts` | Nets and greedy simplification. |
| `integration.test.ts` | Cross-module paths (keys → seal → open → parseEvent → reduce → balances) and the size budget. |

```bash
npm install      # at the repo root; core is an npm workspace (no lockfile of its own)
npm run check    # typecheck + tests, run here
```

Randomness comes from `globalThis.crypto.getRandomValues`; the app polyfills it at entry from `expo-crypto`.

## Verify on device

Node runs these tests on V8 with full ICU. Hermes (React Native) may differ, so check these on a real iOS and
Android build before relying on them:

- **`String.prototype.normalize('NFD')`** (`categories.ts`, diacritic folding in `inferCategory`). Hermes support depends
  on its version and build. If it is missing or throws, `inferCategory` skips folding instead of throwing, so
  "Café" no longer matches "cafe"; check that "Café au lait" infers `coffee` on device.
- **`Intl.NumberFormat.prototype.formatToParts`** (`money.ts`, `formatMinor` for amounts at or above 10¹⁵ minor
  units). If it is missing, `formatMinor` falls back to the nearest double (off by at most one minor unit, only above
  10¹⁵). Also check that `formatMinor(150, 'CAD')`, `formatMinor(1234, 'KWD')` and `formatMinor(-5, 'JPY')` render
  with the ISO exponent in the device locale, since the fraction digits come from `Intl`.
- **`currencyDisplay: 'narrowSymbol'`** (`money.ts`, `formatMinor`'s default display). An engine that rejects it gets
  the full symbol instead ("CA$1.50" where "$1.50" was meant); check that `formatMinor(150, 'CAD', 'en-US')` reads
  "$1.50" on device.

