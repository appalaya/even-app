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

```bash
npm install
npm run check    # typecheck + tests
```

Randomness comes from `globalThis.crypto.getRandomValues`; the app polyfills it at entry from `expo-crypto`.
