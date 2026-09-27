/**
 * The invite QR (InviteQR): the module matrix for a text, and the SVG path the sheet fills with `qrModule`. Pure.
 *
 * The matrix comes from `uqr`, a dependency-free TypeScript port of Nayuki's QR Code generator (byte, alphanumeric
 * and numeric segments, all 40 versions, automatic mask choice). Error correction is M (15 % recovery), not boosted,
 * so a ~210-character invite link is version 10: the 57 × 57 matrix the board draws. The matrix carries no quiet
 * zone; the sheet's 20 pt tile padding is it (over four modules at 264 pt).
 */
import { encode } from 'uqr';

export interface QrMatrix {
  /** QR version, 1–40. */
  version: number;
  /** Modules per side (17 + 4 × version). */
  size: number;
  /** `modules[y][x]`: true for a dark module. */
  modules: readonly (readonly boolean[])[];
}

/** Encodes `text` (UTF-8, byte mode where needed) at error correction M, without a quiet zone. */
export function qrMatrix(text: string): QrMatrix {
  const result = encode(text, { ecc: 'M', boostEcc: false, border: 0 });
  return { version: result.version, size: result.size, modules: result.data };
}

/**
 * The dark modules as one SVG path in module units, a rectangle per horizontal run ("M0 0h7v1h-7z…"), the shape the
 * board's SVG uses. Draw it as one path in a `0 0 size size` viewBox: one path, so abutting runs share their edges
 * without anti-aliased seams between them.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== true) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === true) x += 1;
      const run = x - start;
      parts.push(`M${start} ${y}h${run}v1h-${run}z`);
    }
  });
  return parts.join('');
}
