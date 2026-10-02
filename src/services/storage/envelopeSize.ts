/**
 * An `events.envelope` text's stored size as a server counts it (PROTOCOL.md §4: decoded `c` + 64), or null when the
 * text is not a structurally valid envelope of any version (junk a hostile server sent, kept as `undecryptable`),
 * which no server would accept and the usage meter does not count. Kept with each row (`events.size`, schema v4), so
 * the meter is one SQL sum instead of parsing every envelope (pre-launch review H3).
 */
import { envelopeShape, envelopeStoredSize, type Envelope } from '@even/core';

/** For an envelope already parsed: its stored size, or null when it is not one. */
export function storedSizeOf(value: unknown): number | null {
  // `envelopeStoredSize` reads only `c`, which every well-formed envelope has, whatever its `v`.
  return envelopeShape(value).ok ? envelopeStoredSize(value as Envelope) : null;
}

/** For stored text: its stored size, or null when it is not JSON or not an envelope. */
export function storedSizeOfText(text: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return storedSizeOf(value);
}
