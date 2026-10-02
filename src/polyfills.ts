/**
 * CSPRNG for @even/core. Imported first by the app's entry (index.js), ahead of anything that can call into core, and
 * first again by `src/app/_layout.tsx`.
 *
 * Core reads `globalThis.crypto.getRandomValues` at call time for ids, nonces, and group secrets
 * (packages/core/src/ids.ts). When the runtime already provides it, it is left alone; otherwise it is
 * installed from expo-crypto, which fills from the platform CSPRNG (SecRandomCopyBytes on iOS,
 * SecureRandom on Android). Nothing here falls back to Math.random.
 */
import { getRandomValues } from 'expo-crypto';

type GetRandomValues = <T extends ArrayBufferView | null>(array: T) => T;
type CryptoLike = { getRandomValues?: GetRandomValues };

/** Where `crypto.getRandomValues` came from; the startup self-check reports it. */
export type RngSource = 'runtime' | 'expo-crypto';

function installGetRandomValues(): RngSource {
  const scope = globalThis as unknown as { crypto?: CryptoLike };
  if (typeof scope.crypto?.getRandomValues === 'function') return 'runtime';

  const impl = getRandomValues as unknown as GetRandomValues;
  if (scope.crypto) {
    Object.defineProperty(scope.crypto, 'getRandomValues', {
      value: impl,
      configurable: true,
      writable: true,
    });
  } else {
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues: impl },
      configurable: true,
      writable: true,
    });
  }
  return 'expo-crypto';
}

export const rngSource: RngSource = installGetRandomValues();
