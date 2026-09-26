/**
 * Minimal in-memory `Secrets` for the sync engine's tests. (The sibling `../secrets/memorySecrets.ts` mirrors
 * secure store exactly; this one only needs to hand the engine a secret.)
 */
import { deriveLocal, newId } from '@even/core';

import type { IndexedGroup, Secrets } from '../secrets/types';

export class FakeSecrets implements Secrets {
  readonly items = new Map<string, Uint8Array>();
  /** The index's server URL per local id (null: not recorded). */
  readonly servers = new Map<string, string | null>();
  private device: string | null = null;

  /** Stores `secret` under its derived local id (with `serverUrl` in the index, if given) and returns that id. */
  add(secret: Uint8Array, serverUrl: string | null = null): string {
    const { localId } = deriveLocal(secret);
    this.items.set(localId, secret.slice());
    this.servers.set(localId, serverUrl);
    return localId;
  }

  async getSecret(localId: string): Promise<Uint8Array | null> {
    return this.items.get(localId)?.slice() ?? null;
  }

  async setSecret(localId: string, secret: Uint8Array, serverUrl: string): Promise<void> {
    this.items.set(localId, secret.slice());
    this.servers.set(localId, serverUrl);
  }

  async setServerUrl(localId: string, serverUrl: string): Promise<void> {
    if (this.items.has(localId)) this.servers.set(localId, serverUrl);
  }

  async deleteSecret(localId: string): Promise<void> {
    this.items.delete(localId);
    this.servers.delete(localId);
  }

  async listLocalIds(): Promise<string[]> {
    return [...this.items.keys()];
  }

  async listGroups(): Promise<IndexedGroup[]> {
    return [...this.items.keys()].map((localId) => ({
      localId,
      serverUrl: this.servers.get(localId) ?? null,
    }));
  }

  async deviceId(): Promise<string> {
    this.device ??= newId();
    return this.device;
  }
}
