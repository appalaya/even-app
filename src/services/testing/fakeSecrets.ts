/**
 * Minimal in-memory `Secrets` for the sync engine's tests. (The sibling `../secrets/memorySecrets.ts` mirrors
 * secure store exactly; this one only needs to hand the engine a secret.)
 */
import { deriveLocal, newId } from '@even/core';

import type { Secrets } from '../secrets/types';

export class FakeSecrets implements Secrets {
  readonly items = new Map<string, Uint8Array>();
  private device: string | null = null;

  /** Stores `secret` under its derived local id and returns that id. */
  add(secret: Uint8Array): string {
    const { localId } = deriveLocal(secret);
    this.items.set(localId, secret.slice());
    return localId;
  }

  async getSecret(localId: string): Promise<Uint8Array | null> {
    return this.items.get(localId)?.slice() ?? null;
  }

  async setSecret(localId: string, secret: Uint8Array): Promise<void> {
    this.items.set(localId, secret.slice());
  }

  async deleteSecret(localId: string): Promise<void> {
    this.items.delete(localId);
  }

  async listLocalIds(): Promise<string[]> {
    return [...this.items.keys()];
  }

  async deviceId(): Promise<string> {
    this.device ??= newId();
    return this.device;
  }
}
