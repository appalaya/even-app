import { encodeInvite, inviteLink, makeInvite } from '@even/core';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { qrMatrix, qrPath, type QrMatrix } from './qr';

/** Paints the matrix as a scanner would see it: dark modules on white, a 4-module quiet zone, `scale` px a module. */
function toPixels(matrix: QrMatrix, scale = 4, quiet = 4) {
  const side = (matrix.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const at = (py * side + px) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    });
  });
  return { data, side };
}

function decode(matrix: QrMatrix) {
  const { data, side } = toPixels(matrix);
  return jsQR(data, side, side, { inversionAttempts: 'dontInvert' });
}

/**
 * The error-correction level from the matrix's own format bits (ISO 18004 §7.9, first copy beside the top-left
 * finder): 0 = M, 1 = L, 2 = H, 3 = Q.
 */
function eccBits(matrix: QrMatrix): number {
  const m = matrix.modules;
  const cells: boolean[] = [];
  for (let i = 0; i <= 5; i++) cells.push(m[i]![8]!);
  cells.push(m[7]![8]!, m[8]![8]!, m[8]![7]!);
  for (let i = 9; i < 15; i++) cells.push(m[8]![14 - i]!);
  const bits = cells.reduce((acc, dark, i) => acc | ((dark ? 1 : 0) << i), 0) ^ 0x5412;
  return bits >>> 13;
}

/** An invite link as `inviteFor` builds it: a 32-byte secret, the default server, a name and a currency. */
function sampleLink(): string {
  const secret = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
  const invite = makeInvite(secret, 'https://sync.even.appalaya.com', {
    g: 'Banff 2026',
    cur: 'CAD',
  });
  return inviteLink(encodeInvite(invite));
}

describe('invite QR encoder', () => {
  it('encodes a short text that a decoder reads back', () => {
    const matrix = qrMatrix('HELLO EVEN');
    expect(matrix.version).toBe(1);
    expect(matrix.size).toBe(21);
    expect(decode(matrix)?.data).toBe('HELLO EVEN');
  });

  it('encodes an invite link at error correction M, as the 57-module matrix the board draws', () => {
    const link = sampleLink();
    expect(link.length).toBeGreaterThan(190);
    expect(link.length).toBeLessThanOrEqual(213); // version 10-M holds 213 bytes
    const matrix = qrMatrix(link);
    expect(matrix.version).toBe(10);
    expect(matrix.size).toBe(57);
    expect(eccBits(matrix)).toBe(0); // M
    const read = decode(matrix);
    expect(read?.data).toBe(link);
    expect(read?.version).toBe(10);
  });

  it('carries non-ASCII text (a group name with accents) as UTF-8', () => {
    const text = 'Été à Zürich';
    expect(decode(qrMatrix(text))?.data).toBe(text);
  });

  it('draws each horizontal run of dark modules as one rectangle', () => {
    const matrix: QrMatrix = {
      version: 1,
      size: 3,
      modules: [
        [true, true, false],
        [false, false, false],
        [true, false, true],
      ],
    };
    expect(qrPath(matrix)).toBe('M0 0h2v1h-2zM0 2h1v1h-1zM2 2h1v1h-1z');
  });

  it("draws the finder pattern's top row as one seven-module run at each top corner", () => {
    const matrix = qrMatrix(sampleLink());
    const path = qrPath(matrix);
    expect(path.startsWith('M0 0h7v1h-7z')).toBe(true);
    expect(path).toContain(`M${matrix.size - 7} 0h7v1h-7z`);
  });
});
