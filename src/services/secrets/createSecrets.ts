/**
 * The `Secrets` contract (types.ts) over any string key-value store. `secureStore.ts` binds it to
 * expo-secure-store; `memorySecrets.ts` to a Map for tests and fakes. One implementation, so both behave the same.
 *
 * All operations on one instance run one at a time: the `even.groups` index is read-modify-write, and two
 * interleaved `setSecret` calls would otherwise each write an index missing the other's id. Keep one instance
 * per process (secureStore.ts exports it).
 *
 * The index is a JSON array of `{ localId, serverUrl }` (types.ts). The first format was a bare array of local ids;
 * such an index (or a mix) is read as pairs with `serverUrl: null`, and the next write stores the new format.
 */
import {
  b64urlDecode,
  b64urlEncode,
  canonicalOrigin,
  deriveLocal,
  isB64url,
  isId,
  LIMITS,
  newId,
} from '@even/core';

import type { IndexedGroup, SecretStoreKey, Secrets } from './types';

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

/** The server URL as `groups.server_url` holds it: already canonical (PROTOCOL.md §8.1). */
function checkServerUrl(serverUrl: unknown): string {
  let canonical: string | null = null;
  if (typeof serverUrl === 'string') {
    try {
      canonical = canonicalOrigin(serverUrl);
    } catch {
      canonical = null;
    }
  }
  if (canonical === null || canonical !== serverUrl) {
    throw new SecretsError('serverUrl must be a canonical https server URL');
  }
  return canonical;
}

const isLocalId = (value: unknown): value is string =>
  typeof value === 'string' && isB64url(value, LOCAL_ID_LENGTH);

/** One index entry: a bare local id (the first format, no URL) or a `{ localId, serverUrl }` pair. */
function parseEntry(entry: unknown): IndexedGroup | null {
  if (isLocalId(entry)) return { localId: entry, serverUrl: null };
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const { localId, serverUrl } = entry as Record<string, unknown>;
  if (!isLocalId(localId)) return null;
  if (serverUrl !== null && typeof serverUrl !== 'string') return null;
  return { localId, serverUrl };
}

function parseIndex(text: string | null): IndexedGroup[] {
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const entries = Array.isArray(parsed) ? parsed.map(parseEntry) : null;
  if (entries === null || entries.some((entry) => entry === null)) {
    throw new SecretsError(
      `${GROUPS_INDEX_KEY} is not a JSON array of { localId, serverUrl } (or of local ids)`,
    );
  }
  return entries as IndexedGroup[];
}

export function createSecrets(kv: SecretKeyValue): Secrets {
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn);
    queue = result.catch(() => undefined);
    return result;
  }

  const readIndex = async (): Promise<IndexedGroup[]> =>
    parseIndex(await kv.getItem(GROUPS_INDEX_KEY));
  const writeIndex = (index: readonly IndexedGroup[]): Promise<void> =>
    kv.setItem(
      GROUPS_INDEX_KEY,
      JSON.stringify(index.map(({ localId, serverUrl }) => ({ localId, serverUrl }))),
    );

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

    async setSecret(localId, secret, serverUrl) {
      checkLocalId(localId);
      if (!(secret instanceof Uint8Array) || secret.length !== LIMITS.secretLength) {
        throw new SecretsError(`secret must be ${LIMITS.secretLength} bytes`);
      }
      checkServerUrl(serverUrl);
      // Storing a secret under the wrong id would lose the group; one HKDF is cheap insurance.
      if (deriveLocal(secret).localId !== localId) {
        throw new SecretsError('localId does not match deriveLocal(secret)');
      }
      const text = b64urlEncode(secret);
      return serial(async () => {
        // Secret first, index second, so the index never names a missing secret.
        await kv.setItem(secretKey(localId), text);
        const index = await readIndex();
        const entry = index.find((e) => e.localId === localId);
        if (entry === undefined) await writeIndex([...index, { localId, serverUrl }]);
        else if (entry.serverUrl !== serverUrl) {
          await writeIndex(index.map((e) => (e.localId === localId ? { localId, serverUrl } : e)));
        }
      });
    },

    async setServerUrl(localId, serverUrl) {
      checkLocalId(localId);
      checkServerUrl(serverUrl);
      return serial(async () => {
        const index = await readIndex();
        const entry = index.find((e) => e.localId === localId);
        if (entry === undefined || entry.serverUrl === serverUrl) return;
        await writeIndex(index.map((e) => (e.localId === localId ? { localId, serverUrl } : e)));
      });
    },

    async deleteSecret(localId) {
      checkLocalId(localId);
      return serial(async () => {
        // Index first, secret second: a crash in between leaves an unlisted secret, never a listed missing one.
        const index = await readIndex();
        if (index.some((e) => e.localId === localId)) {
          await writeIndex(index.filter((e) => e.localId !== localId));
        }
        await kv.deleteItem(secretKey(localId));
      });
    },

    listLocalIds() {
      return serial(async () => (await readIndex()).map((e) => e.localId));
    },

    listGroups() {
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
