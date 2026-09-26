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
import { createMemorySecrets, MemoryKeyValue } from './memorySecrets';
import type { SecretStoreKey } from './types';

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
  it('stores the secret as base64url and indexes the local id', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret);
    expect(secrets.kv.items.get(`even.secret.${localId}`)).toBe(b64urlEncode(secret));
    expect(JSON.parse(secrets.kv.items.get('even.groups')!)).toEqual([localId]);
    expect(await secrets.getSecret(localId)).toEqual(secret);
    expect(await secrets.listLocalIds()).toEqual([localId]);
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
    await secrets.setSecret(a.localId, a.secret);
    await secrets.setSecret(b.localId, b.secret);
    await secrets.setSecret(a.localId, a.secret);
    expect(await secrets.listLocalIds()).toEqual([a.localId, b.localId]);
  });

  it('deletes the secret and its index entry; missing is a no-op', async () => {
    const secrets = createMemorySecrets();
    const a = newGroup();
    const b = newGroup();
    await secrets.setSecret(a.localId, a.secret);
    await secrets.setSecret(b.localId, b.secret);
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
    await secrets.setSecret(localId, secret);
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
    await expect(secrets.setSecret(localId, secret)).rejects.toThrow('keychain write failed');
    expect(await secrets.listLocalIds()).toEqual([]);
    // The queue keeps working after a failure.
    await secrets.setSecret(localId, secret);
    expect(await secrets.listLocalIds()).toEqual([localId]);
  });

  it('keeps every id when setSecret and deleteSecret run concurrently', async () => {
    const kv = new SlowKeyValue();
    const secrets = createSecrets(kv);
    const groups = Array.from({ length: 12 }, newGroup);
    await Promise.all(groups.map((grp) => secrets.setSecret(grp.localId, grp.secret)));
    expect((await secrets.listLocalIds()).sort()).toEqual(groups.map((grp) => grp.localId).sort());
    await Promise.all([
      ...groups.slice(0, 6).map((grp) => secrets.deleteSecret(grp.localId)),
      secrets.setSecret(groups[0]!.localId, groups[0]!.secret),
    ]);
    expect((await secrets.listLocalIds()).sort()).toEqual(
      [groups[0]!, ...groups.slice(6)].map((grp) => grp.localId).sort(),
    );
  });

  it('validates ids and secrets', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    const other = newGroup();
    await expect(secrets.setSecret(localId, secret.slice(0, 31))).rejects.toBeInstanceOf(
      SecretsError,
    );
    await expect(secrets.setSecret(localId, Array.from(secret) as never)).rejects.toBeInstanceOf(
      SecretsError,
    );
    await expect(secrets.setSecret(other.localId, secret)).rejects.toThrow(/deriveLocal/);
    for (const bad of [
      '',
      'short',
      `${localId}A`,
      `${localId.slice(0, 42)}=`,
      '../even.device'.padEnd(43, 'a'),
    ]) {
      await expect(secrets.setSecret(bad, secret)).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.getSecret(bad)).rejects.toBeInstanceOf(SecretsError);
      await expect(secrets.deleteSecret(bad)).rejects.toBeInstanceOf(SecretsError);
    }
    expect(secrets.kv.items.size).toBe(0);
  });

  it('refuses a corrupt stored secret or index instead of guessing', async () => {
    const secrets = createMemorySecrets();
    const { secret, localId } = newGroup();
    await secrets.setSecret(localId, secret);
    secrets.kv.items.set(secretKey(localId), 'too-short');
    await expect(secrets.getSecret(localId)).rejects.toBeInstanceOf(SecretsError);
    secrets.kv.items.set(GROUPS_INDEX_KEY, '{"not":"an array"}');
    await expect(secrets.listLocalIds()).rejects.toBeInstanceOf(SecretsError);
    await expect(secrets.setSecret(localId, secret)).rejects.toBeInstanceOf(SecretsError);
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
