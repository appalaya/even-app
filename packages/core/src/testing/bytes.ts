/** Hex and a seeded byte source for the AEAD checks: test data only, never for keys or nonces the app uses. */

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new RangeError('not hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function bytesEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * sfc32, seeded: the same seed gives the same cases on every platform, so a failure seen on a phone can be replayed
 * in Node. Not a CSPRNG and not used for anything but test data.
 */
export function seededBytes(seed: number): { bytes: (length: number) => Uint8Array; int: (below: number) => number } {
  let a = 0x9e3779b9 ^ seed;
  let b = 0x243f6a88;
  let c = 0xb7e15162 ^ (seed >>> 1);
  let d = 1;
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    bytes(length) {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 4) {
        const word = next();
        for (let k = 0; k < 4 && i + k < length; k++) out[i + k] = (word >>> (8 * k)) & 0xff;
      }
      return out;
    },
    int(below) {
      return next() % below;
    },
  };
}
