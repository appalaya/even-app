/**
 * i.html's inline script, the invite page: `parse(code)` must read a pasted invite the way
 * decodeInvite (packages/core/src/invite.ts) does for `g` — including dropping a `g` that holds a
 * bidirectional-control character (U+202A-U+202E, U+2066-U+2069) rather than showing it, since a
 * right-to-left override or an isolate there would reorder the text around it wherever this page
 * renders it (review L4, app commit 0b878de).
 *
 * The page has no module to import (CSP allows exactly one inline <script>, hashed; web/README.md),
 * so this extracts the pure, DOM-free `parse` and its `has` helper from the page's own markup with
 * csp-hashes.mjs's splitHtml (the same extraction the CSP hasher uses) and evaluates them, so a
 * change to the real shipped script is what this test runs. Characters are built from code points
 * (String.fromCodePoint) rather than written as literal source characters, so none of them land in
 * this file as an invisible byte.
 *
 *   npx vitest run --config web/vitest.config.mts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { splitHtml } from './scripts/csp-hashes.mjs';

const WEB = dirname(fileURLToPath(import.meta.url));

/** From the first `{` at or after `marker`, the balanced-brace block (inclusive), by counting braces. */
function extractBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`marker not found in i.html's script: ${marker}`);
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerIndex, i + 1);
    }
  }
  throw new Error(`unbalanced braces for marker: ${marker}`);
}

type Parsed = { g: string; cur: string } | null;

/** Evaluates i.html's own `parse` (and the `has` helper it calls), exactly as shipped. */
function loadParse(): (code: string) => Parsed {
  const html = readFileSync(join(WEB, 'i.html'), 'utf8');
  const { blocks } = splitHtml(html);
  if (blocks.script.length !== 1) throw new Error('expected exactly one inline <script> in i.html');
  const script = blocks.script[0].body;
  const hasBlock = extractBlock(script, 'var has = function');
  const bidiLine = script.split('\n').find((line) => line.trim().startsWith('var BIDI_CONTROL_RE'));
  if (bidiLine === undefined) throw new Error("BIDI_CONTROL_RE not found in i.html's script");
  const parseBlock = extractBlock(script, 'function parse(code)');

  const factory = new Function(`${hasBlock};\n${bidiLine};\n${parseBlock}\nreturn parse;`);
  return factory() as (code: string) => Parsed;
}

/** base64url(JSON payload), as the invite's fragment (PROTOCOL.md section 8.2). */
function encode(payload: Record<string, unknown>): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Bidirectional-control code points (packages/core/src/schema.ts, BIDI_CONTROL_RE): the five explicit
// embedding/override controls, then the four isolates.
const BIDI_CONTROL_CODE_POINTS = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];
// Direction marks that stay allowed (packages/core/src/schema.ts): left-to-right mark, right-to-left
// mark, Arabic letter mark.
const ALLOWED_MARK_CODE_POINTS = [0x200e, 0x200f, 0x061c];

describe('i.html parse(): bidirectional-control characters in g (review L4)', () => {
  const parse = loadParse();
  const base = { v: 1, s: 'https://sync.even.appalaya.com', k: 'A'.repeat(43), h: 'B'.repeat(6) };
  const CONTROLS = BIDI_CONTROL_CODE_POINTS.map((cp) => String.fromCodePoint(cp));

  it('drops a g holding a bidirectional-control character and keeps the rest of the invite', () => {
    const crafted = `Banff${String.fromCodePoint(0x202e)}6202`;
    const result = parse(encode({ ...base, g: crafted }));
    expect(result).not.toBeNull();
    expect(result?.g).toBe('');
  });

  it.each(CONTROLS.map((c) => [`U+${c.codePointAt(0)?.toString(16).toUpperCase()}`, c]))(
    'drops %s at the start, inside, and at the end of g',
    (_label, c) => {
      for (const g of [`${c}Banff`, `Ba${c}nff`, `Banff${c}`]) {
        expect(parse(encode({ ...base, g }))?.g).toBe('');
      }
    },
  );

  it('still shows a plain g', () => {
    expect(parse(encode({ ...base, g: 'Banff' }))?.g).toBe('Banff');
  });

  it.each(
    ALLOWED_MARK_CODE_POINTS.map((cp) => [
      `U+${cp.toString(16).toUpperCase()}`,
      String.fromCodePoint(cp),
    ]),
  )('still shows a g with the allowed direction mark %s', (_label, mark) => {
    expect(parse(encode({ ...base, g: `Banff${mark}` }))?.g).toBe(`Banff${mark}`);
  });

  it('is absent, not an empty string shown, for an invite with no g at all', () => {
    expect(parse(encode(base))?.g).toBe('');
  });
});
