/**
 * The `Secrets` contract (types.ts) over any string key-value store. `secureStore.ts` binds it to
 * expo-secure-store; `memorySecrets.ts` to a Map for tests and fakes. One implementation, so both behave the same.
 *
 * All operations on one instance run one at a time: the `even.groups` index is read-modify-write, and two
 * interleaved `setSecret` calls would otherwise each write an index missing the other's id. Keep one instance
 * per process (secureStore.ts exports it).
 */
import { b64urlDecode, b64urlEncode, deriveLocal, isB64url, isId, LIMITS, newId } from '@even/core';

import type { SecretStoreKey, Secrets } from './types';

/** The minimal async key-value surface this module needs. Keys are always `SecretStoreKey`s. */
export interface SecretKeyValue {
  getItem(key: SecretStoreKey): Promise<string | null>;
  setItem(key: SecretStoreKey, value: string): Promise<void>;
  deleteItem(key: SecretStoreKey): Promise<void>;
}

export const GROUPS_INDEX_KEY = 'even.groups' satisfies SecretStoreKey;
export const DEVICE_KEY = 'even.device' satisfies SecretStoreKey;
export const LOCAL_ID_LENGTH = 43;
/** base64url of 32 bytes. */
const SECRET_TEXT_LENGTH = 43;

export function secretKey(localId: string): SecretStoreKey {
  return `even.secret.${localId}`;
}

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

function checkLocalId(localId: unknown): string {
  if (typeof localId !== 'string' || !isB64url(localId, LOCAL_ID_LENGTH)) {
    throw new SecretsError(`localId must be ${LOCAL_ID_LENGTH} base64url characters`);
  }
  return localId;
}

function parseIndex(text: string | null): string[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((id) => typeof id === 'string' && isB64url(id, LOCAL_ID_LENGTH))
  ) {
    throw new SecretsError(`${GROUPS_INDEX_KEY} is not a JSON array of local ids`);
  }
  return parsed as string[];
}

export function createSecrets(kv: SecretKeyValue): Secrets {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn);
    queue = result.catch(() => undefined);
    return result;
  }

  const readIndex = async (): Promise<string[]> => parseIndex(await kv.getItem(GROUPS_INDEX_KEY));

  return {
    async getSecret(localId) {
      checkLocalId(localId);
      return serial(async () => {
        const text = await kv.getItem(secretKey(localId));
        if (text === null) return null;
        if (!isB64url(text, SECRET_TEXT_LENGTH)) {
          throw new SecretsError(
            `the stored secret for ${localId} is not ${SECRET_TEXT_LENGTH} base64url characters`,
          );
        }
        return b64urlDecode(text);
      });
    },

    async setSecret(localId, secret) {
      checkLocalId(localId);
      if (!(secret instanceof Uint8Array) || secret.length !== LIMITS.secretLength) {
        throw new SecretsError(`secret must be ${LIMITS.secretLength} bytes`);
      }
      // Storing a secret under the wrong id would lose the group; one HKDF is cheap insurance.
      if (deriveLocal(secret).localId !== localId) {
        throw new SecretsError('localId does not match deriveLocal(secret)');
      }
      const text = b64urlEncode(secret);
      return serial(async () => {
        // Secret first, index second, so the index never names a missing secret.
        await kv.setItem(secretKey(localId), text);
        const index = await readIndex();
        if (!index.includes(localId)) {
          await kv.setItem(GROUPS_INDEX_KEY, JSON.stringify([...index, localId]));
        }
      });
    },

    async deleteSecret(localId) {
      checkLocalId(localId);
      return serial(async () => {
        // Index first, secret second: a crash in between leaves an unlisted secret, never a listed missing one.
        const index = await readIndex();
        if (index.includes(localId)) {
          await kv.setItem(GROUPS_INDEX_KEY, JSON.stringify(index.filter((id) => id !== localId)));
        }
        await kv.deleteItem(secretKey(localId));
      });
    },

    listLocalIds() {
      return serial(readIndex);
    },

    deviceId() {
      return serial(async () => {
        const stored = await kv.getItem(DEVICE_KEY);
        if (stored !== null) {
          if (!isId(stored)) throw new SecretsError(`${DEVICE_KEY} is not a 22-character id`);
          return stored;
        }
        const id = newId();
        await kv.setItem(DEVICE_KEY, id);
        return id;
      });
    },
  };
}
