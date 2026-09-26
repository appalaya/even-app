/**
 * In-memory `Secrets` for tests and for the sync engine's fakes: the same logic as the app (createSecrets.ts)
 * over a Map, so the index (its `{ localId, serverUrl }` pairs and the migration of a first-format index of bare
 * local ids) and the device-id behaviour match secure store exactly. `kv.items` holds the raw strings, so a test
 * can seed an old-format index or inspect what was written.
 */
import { createSecrets, GROUPS_INDEX_KEY, type SecretKeyValue } from './createSecrets';
import type { SecretStoreKey, Secrets } from './types';

/** Keys accepted by expo-secure-store; the memory store refuses others so tests catch bad keys too. */
const SECURE_STORE_KEY = /^[\w.-]+$/;

export class MemoryKeyValue implements SecretKeyValue {
  /** Raw contents, for assertions. */
  readonly items = new Map<string, string>();

  async getItem(key: SecretStoreKey): Promise<string | null> {
    this.checkKey(key);
    return this.items.get(key) ?? null;
  }

  async setItem(key: SecretStoreKey, value: string): Promise<void> {
    this.checkKey(key);
    if (typeof value !== 'string') throw new TypeError('secure store values must be strings');
    this.items.set(key, value);
  }

  async deleteItem(key: SecretStoreKey): Promise<void> {
    this.checkKey(key);
    this.items.delete(key);
  }

  private checkKey(key: string): void {
    if (!SECURE_STORE_KEY.test(key))
      throw new Error(`invalid secure store key ${JSON.stringify(key)}`);
  }
}

export interface MemorySecrets extends Secrets {
  readonly kv: MemoryKeyValue;
}

/** The raw `even.groups` value, parsed (null when absent): what secure store would hold, for assertions. */
export function rawIndex(kv: MemoryKeyValue): unknown {
  const text = kv.items.get(GROUPS_INDEX_KEY);
  return text === undefined ? null : (JSON.parse(text) as unknown);
}

export function createMemorySecrets(kv: MemoryKeyValue = new MemoryKeyValue()): MemorySecrets {
  return Object.assign(createSecrets(kv), { kv });
}
