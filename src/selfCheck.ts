/**
 * Development self-check, run once at startup. Seals and opens one envelope through @even/core and logs a
 * single line, so a missing CSPRNG, a broken workspace resolution of @even/core, or a Hermes gap in an API
 * core relies on (TextEncoder/TextDecoder, BigInt, Intl) shows up in the Metro console on first launch.
 */
import {
  deriveLocal,
  deriveServer,
  newId,
  newSecret,
  open,
  parseEvent,
  PROTOCOL,
  seal,
  type Event,
} from '@even/core';

import { rngSource } from './polyfills';

export function runStartupSelfCheck(): void {
  const started = performance.now();
  try {
    const secret = newSecret();
    const { encryptionKey } = deriveLocal(secret);
    const { groupId } = deriveServer(secret, PROTOCOL.defaultServer);
    const now = Date.now();
    const body: Event = {
      sv: 1,
      ts: now,
      at: now,
      by: newId(),
      dev: newId(),
      type: 'group.created',
      name: 'Self-check',
      currency: 'EUR',
    };
    const envelope = seal({ key: encryptionKey, groupId, body });
    const opened = parseEvent(open({ key: encryptionKey, groupId, envelope }));
    if (opened?.type !== 'group.created' || opened.name !== body.name || opened.ts !== body.ts) {
      throw new Error('opened body does not match the sealed one');
    }
    const ms = (performance.now() - started).toFixed(1);
    console.log(
      `[even] self-check ok: rng=${rngSource}, sealed+opened envelope ${envelope.id} (${envelope.c.length} chars) in ${ms} ms`,
    );
  } catch (error) {
    console.error(`[even] self-check FAILED (rng=${rngSource}):`, error);
  }
}
