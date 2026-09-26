import { b64urlEncode, deriveLocal, isId, newSecret } from '@even/core';
import { describe, expect, it } from 'vitest';

import {
  createSecrets,
  DEVICE_KEY,
  GROUPS_INDEX_KEY,
  secretKey,
  SecretsError,
  type SecretKeyValue,
} from './createSecrets';
import { createMemorySecrets, MemoryKeyValue, rawIndex } from './memorySecrets';
import type { SecretStoreKey } from './types';

const SERVER = 'https://sync.test';
const OTHER = 'https://other.test';

function newGroup() {
  const secret = newSecret();
  return { secret, localId: deriveLocal(secret).localId };
}

/** A key-value store with random latency and an operation log, like the native module. */
class SlowKeyValue implements SecretKeyValue {
  readonly inner = new MemoryKeyValue();
  readonly log: string[] = [];
  failNext: SecretStoreKey | null = null;

  private async tick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
  }

  async getItem(key: SecretStoreKey) {
    await this.tick();
    this.log.push(`get ${key}`);
    return this.inner.getItem(key);
  }

  async setItem(key: SecretStoreKey, value: string) {
    await this.tick();
    if (this.failNext === key) {
      this.failNext = null;
      throw new Error(`keychain write failed for ${key}`);
    }
    this.log.push(`set ${key}`);
    return this.inner.setItem(key, value);
  }

  async deleteItem(key: SecretStoreKey) {
    await this.tick();
    this.log.push(`delete ${key}`);
    return this.inner.deleteItem(key);
  }
}

describe('group secrets', () => {
  it('stores the secret as base64url and indexes the local id with its server URL', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret, SERVER);
    expect(secrets.kv.items.get(`even.secret.${localId}`)).toBe(b64urlEncode(secret));
    expect(rawIndex(secrets.kv)).toEqual([{ localId, serverUrl: SERVER }]);
    expect(await secrets.getSecret(localId)).toEqual(secret);
    expect(await secrets.listLocalIds()).toEqual([localId]);
    expect(await secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
  });

  it('returns null for a group without a secret', async () => {
    const secrets = createMemorySecrets();
    expect(await secrets.getSecret(newGroup().localId)).toBeNull();
    expect(await secrets.listLocalIds()).toEqual([]);
  });

  it('overwrites idempotently without duplicating the index entry', async () => {
    const secrets = createMemorySecrets();
    const a = newGroup();
    const b = newGroup();
    await secrets.setSecret(a.localId, a.secret, SERVER);
    await secrets.setSecret(b.localId, b.secret, SERVER);
    await secrets.setSecret(a.localId, a.secret, SERVER);
    expect(await secrets.listLocalIds()).toEqual([a.localId, b.localId]);
    // Overwriting with another server updates the entry in place.
    await secrets.setSecret(a.localId, a.secret, OTHER);
    expect(await secrets.listGroups()).toEqual([
      { localId: a.localId, serverUrl: OTHER },
      { localId: b.localId, serverUrl: SERVER },
    ]);
  });

  it('deletes the secret and its index entry; missing is a no-op', async () => {
    const secrets = createMemorySecrets();
    const a = newGroup();
    const b = newGroup();
    await secrets.setSecret(a.localId, a.secret, SERVER);
    await secrets.setSecret(b.localId, b.secret, SERVER);
    await secrets.deleteSecret(a.localId);
    expect(await secrets.getSecret(a.localId)).toBeNull();
    expect(await secrets.listLocalIds()).toEqual([b.localId]);
    await secrets.deleteSecret(a.localId);
    await secrets.deleteSecret(newGroup().localId);
    expect(await secrets.listLocalIds()).toEqual([b.localId]);
  });

  it('writes the secret before the index, and removes the index entry before the secret', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret, SERVER);
    expect(kv.log.filter((l) => l.startsWith('set') || l.startsWith('delete'))).toEqual([
      `set ${secretKey(localId)}`,
      `set ${GROUPS_INDEX_KEY}`,
    ]);
    kv.log.length = 0;
    await secrets.deleteSecret(localId);
    expect(kv.log.filter((l) => l.startsWith('set') || l.startsWith('delete'))).toEqual([
      `set ${GROUPS_INDEX_KEY}`,
      `delete ${secretKey(localId)}`,
    ]);
  });

  it('a failed secret write leaves the index untouched', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const { secret, localId } = newGroup();
    kv.failNext = secretKey(localId);
    await expect(secrets.setSecret(localId, secret, SERVER)).rejects.toThrow(
      'keychain write failed',
    );
    expect(await secrets.listLocalIds()).toEqual([]);
    // The queue keeps working after a failure.
    await secrets.setSecret(localId, secret, SERVER);
    expect(await secrets.listLocalIds()).toEqual([localId]);
  });

  it('keeps every id when setSecret and deleteSecret run concurrently', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const groups = Array.from({ length: 12 }, newGroup);
    await Promise.all(groups.map((grp) => secrets.setSecret(grp.localId, grp.secret, SERVER)));
    expect((await secrets.listLocalIds()).sort()).toEqual(groups.map((grp) => grp.localId).sort());
    await Promise.all([
      ...groups.slice(0, 6).map((grp) => secrets.deleteSecret(grp.localId)),
      secrets.setSecret(groups[0]!.localId, groups[0]!.secret, SERVER),
    ]);
    expect((await secrets.listLocalIds()).sort()).toEqual(
      [groups[0]!, ...groups.slice(6)].map((grp) => grp.localId).sort(),
    );
  });

  it('validates ids and secrets', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    const other = newGroup();
    await expect(secrets.setSecret(localId, secret.slice(0, 31), SERVER)).rejects.toBeInstanceOf(
      SecretsError,
    );
    await expect(
      secrets.setSecret(localId, Array.from(secret) as never, SERVER),
    ).rejects.toBeInstanceOf(SecretsError);
    await expect(secrets.setSecret(other.localId, secret, SERVER)).rejects.toThrow(/deriveLocal/);
    for (const bad of [
      '',
      'short',
      `${localId}A`,
      `${localId.slice(0, 42)}=`,
      '../even.device'.padEnd(43, 'a'),
    ]) {
      await expect(secrets.setSecret(bad, secret, SERVER)).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.getSecret(bad)).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.deleteSecret(bad)).rejects.toBeInstanceOf(SecretsError);
    }
    expect(secrets.kv.items.size).toBe(0);
  });

  it('refuses a corrupt stored secret or index instead of guessing', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret, SERVER);
    secrets.kv.items.set(secretKey(localId), 'too-short');
    await expect(secrets.getSecret(localId)).rejects.toBeInstanceOf(SecretsError);
    for (const corrupt of [
      '{"not":"an array"}',
      'not json',
      '[1]',
      '["short"]',
      JSON.stringify([{ localId: 'short', serverUrl: SERVER }]),
      JSON.stringify([{ localId, serverUrl: 42 }]),
      JSON.stringify([{ serverUrl: SERVER }]),
      JSON.stringify([[localId, SERVER]]),
    ]) {
      secrets.kv.items.set(GROUPS_INDEX_KEY, corrupt);
      await expect(secrets.listLocalIds()).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.listGroups()).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.setSecret(localId, secret, SERVER)).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.setServerUrl(localId, SERVER)).rejects.toBeInstanceOf(SecretsError);
    }
  });

  it('refuses a server URL that is not canonical https, before writing anything', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    for (const bad of [
      '',
      'http://sync.test',
      'HTTPS://Sync.test',
      'https://sync.test/',
      ' https://sync.test',
      'nope',
      null,
      42,
    ]) {
      await expect(secrets.setSecret(localId, secret, bad as string)).rejects.toBeInstanceOf(
        SecretsError,
      );
    }
    expect(secrets.kv.items.size).toBe(0);
    await secrets.setSecret(localId, secret, SERVER);
    await expect(secrets.setServerUrl(localId, 'http://other.test')).rejects.toBeInstanceOf(
      SecretsError,
    );
    await expect(secrets.setServerUrl('short', OTHER)).rejects.toBeInstanceOf(SecretsError);
    expect(await secrets.listGroups()).toEqual([{ localId, serverUrl: SERVER }]);
  });
});

describe('the index carries each group’s server URL', () => {
  it('setServerUrl records a move; an unindexed id is a no-op; the secret is untouched', async () => {
    const secrets = createMemorySecrets();
    const a = newGroup();
    const b = newGroup();
    await secrets.setSecret(a.localId, a.secret, SERVER);
    await secrets.setSecret(b.localId, b.secret, SERVER);
    const before = secrets.kv.items.get(secretKey(a.localId));
    await secrets.setServerUrl(a.localId, OTHER);
    expect(await secrets.listGroups()).toEqual([
      { localId: a.localId, serverUrl: OTHER },
      { localId: b.localId, serverUrl: SERVER },
    ]);
    expect(secrets.kv.items.get(secretKey(a.localId))).toBe(before);
    const stranger = newGroup();
    await secrets.setServerUrl(stranger.localId, OTHER);
    expect(await secrets.listLocalIds()).toEqual([a.localId, b.localId]);
  });

  it('setServerUrl writes nothing when the URL is unchanged', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret, SERVER);
    kv.log.length = 0;
    await secrets.setServerUrl(localId, SERVER);
    await secrets.setSecret(localId, secret, SERVER);
    expect(kv.log.filter((l) => l === `set ${GROUPS_INDEX_KEY}`)).toEqual([]);
  });

  it('reads an old-format index (bare local ids) as pairs without a URL, and rewrites it on the next write', async () => {
    const kv = new MemoryKeyValue();
    const a = newGroup();
    const b = newGroup();
    const c = newGroup();
    kv.items.set(secretKey(a.localId), b64urlEncode(a.secret));
    kv.items.set(secretKey(b.localId), b64urlEncode(b.secret));
    kv.items.set(GROUPS_INDEX_KEY, JSON.stringify([a.localId, b.localId]));
    const secrets = createMemorySecrets(kv);

    expect(await secrets.listLocalIds()).toEqual([a.localId, b.localId]);
    expect(await secrets.listGroups()).toEqual([
      { localId: a.localId, serverUrl: null },
      { localId: b.localId, serverUrl: null },
    ]);
    expect(await secrets.getSecret(a.localId)).toEqual(a.secret);
    // Reading does not write.
    expect(rawIndex(kv)).toEqual([a.localId, b.localId]);

    await secrets.setServerUrl(b.localId, OTHER);
    expect(rawIndex(kv)).toEqual([
      { localId: a.localId, serverUrl: null },
      { localId: b.localId, serverUrl: OTHER },
    ]);
    await secrets.setSecret(c.localId, c.secret, SERVER);
    await secrets.deleteSecret(a.localId);
    expect(await secrets.listGroups()).toEqual([
      { localId: b.localId, serverUrl: OTHER },
      { localId: c.localId, serverUrl: SERVER },
    ]);
  });

  it('reads a mixed index and ignores unknown fields on an entry', async () => {
    const kv = new MemoryKeyValue();
    const a = newGroup();
    const b = newGroup();
    kv.items.set(
      GROUPS_INDEX_KEY,
      JSON.stringify([a.localId, { localId: b.localId, serverUrl: SERVER, later: true }]),
    );
    const secrets = createMemorySecrets(kv);
    expect(await secrets.listGroups()).toEqual([
      { localId: a.localId, serverUrl: null },
      { localId: b.localId, serverUrl: SERVER },
    ]);
    await secrets.setSecret(a.localId, a.secret, OTHER);
    expect(rawIndex(kv)).toEqual([
      { localId: a.localId, serverUrl: OTHER },
      { localId: b.localId, serverUrl: SERVER },
    ]);
  });

  it('keeps every URL when setSecret and setServerUrl run concurrently', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const groups = Array.from({ length: 8 }, newGroup);
    await Promise.all(groups.map((grp) => secrets.setSecret(grp.localId, grp.secret, SERVER)));
    await Promise.all(groups.slice(0, 4).map((grp) => secrets.setServerUrl(grp.localId, OTHER)));
    const byId = new Map((await secrets.listGroups()).map((e) => [e.localId, e.serverUrl]));
    expect(groups.map((grp) => byId.get(grp.localId))).toEqual([
      ...Array.from({ length: 4 }, () => OTHER),
      ...Array.from({ length: 4 }, () => SERVER),
    ]);
  });
});

describe('device id', () => {
  it('creates a 22-character id once and keeps it', async () => {
    const kv = new MemoryKeyValue();
    const first = await createSecrets(kv).deviceId();
    expect(isId(first)).toBe(true);
    expect(kv.items.get(DEVICE_KEY)).toBe(first);
    expect(await createSecrets(kv).deviceId()).toBe(first); // a relaunch reads the stored one
  });

  it('hands concurrent first calls the same id', async () => {
    const secrets = createSecrets(new SlowKeyValue());
    const ids = await Promise.all(Array.from({ length: 5 }, () => secrets.deviceId()));
    expect(new Set(ids).size).toBe(1);
  });

  it('refuses a corrupt stored device id', async () => {
    const kv = new MemoryKeyValue();
    kv.items.set(DEVICE_KEY, 'nope');
    await expect(createSecrets(kv).deviceId()).rejects.toBeInstanceOf(SecretsError);
  });
});

describe('MemoryKeyValue', () => {
  it('accepts only keys secure store accepts', async () => {
    const kv = new MemoryKeyValue();
    await expect(kv.setItem('even.secret.a/b' as SecretStoreKey, 'x')).rejects.toThrow(
      /invalid secure store key/,
    );
  });
});
