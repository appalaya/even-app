#!/usr/bin/env node
/**
 * Hashes the invite page's one inline <script> and one inline <style> and writes the strict Content-Security-Policy
 * for /i into ../_headers (the lines that start with "default-src 'none'"). The browser hashes the exact text between
 * the tags, whitespace included, so run this after ANY edit to i.html:
 *
 *   node web/scripts/csp-hashes.mjs && node web/scripts/check.mjs
 *
 * No dependencies; Node 20 or later.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INVITE_PAGE = 'i.html';

/** The lines in _headers this script owns: the strict policy for /i and /i/*. */
const STRICT_LINE = /^([ \t]+Content-Security-Policy: )default-src 'none';.*$/gm;
const STRICT_LINES_EXPECTED = 2;

/**
 * Splits an HTML document into its markup and its raw-text blocks. Returns `markup` (the document with comments and
 * the bodies of <script> and <style> removed, so attribute scans never see code or CSS) and the inline blocks of each
 * tag, in order, with their attribute text and exact body. Line endings are normalised to LF first, as the HTML
 * parser does before a browser hashes a block.
 */
export function splitHtml(source) {
  const html = source.replace(/\r\n?/g, '\n');
  const lower = html.toLowerCase();
  const blocks = { script: [], style: [] };
  let markup = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      markup += html.slice(i);
      break;
    }
    markup += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('unclosed HTML comment');
      i = end + 3;
      continue;
    }
    const open = /^<(script|style)\b([^>]*)>/i.exec(html.slice(lt, lt + 4096));
    if (open) {
      const tag = open[1].toLowerCase();
      const start = lt + open[0].length;
      const end = lower.indexOf(`</${tag}`, start);
      if (end === -1) throw new Error(`unclosed <${tag}>`);
      blocks[tag].push({ attrs: open[2].trim(), body: html.slice(start, end) });
      markup += `${open[0]}</${tag}>`;
      i = html.indexOf('>', end) + 1;
      continue;
    }
    markup += '<';
    i = lt + 1;
  }
  return { markup, blocks };
}

/** A CSP hash source for a block's exact text. */
export function hashSource(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** The invite page's policy, exactly as design.md states it, with the hashes of its one script and one style. */
export function inviteCsp(source) {
  const { blocks } = splitHtml(source);
  for (const tag of ['script', 'style']) {
    const found = blocks[tag];
    if (found.length !== 1 || found[0].attrs !== '') {
      throw new Error(
        `${INVITE_PAGE} must have exactly one inline <${tag}> with no attributes; found ${found.length}`,
      );
    }
  }
  return [
    "default-src 'none'",
    `script-src ${hashSource(blocks.script[0].body)}`,
    `style-src ${hashSource(blocks.style[0].body)}`,
    "img-src 'self'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Every strict policy line in a _headers text. */
export function strictPolicies(headers) {
  return [...headers.matchAll(STRICT_LINE)].map((m) => m[0].slice(m[1].length));
}

function main() {
  const csp = inviteCsp(readFileSync(join(WEB, INVITE_PAGE), 'utf8'));
  const path = join(WEB, '_headers');
  const before = readFileSync(path, 'utf8');
  let count = 0;
  const after = before.replace(STRICT_LINE, (_line, prefix) => {
    count += 1;
    return prefix + csp;
  });
  if (count !== STRICT_LINES_EXPECTED) {
    throw new Error(
      `expected ${STRICT_LINES_EXPECTED} strict CSP lines in _headers (/i and /i/*), found ${count}`,
    );
  }
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? 'unchanged' : 'updated'}: _headers (/i and /i/*)`);
  console.log(`Content-Security-Policy: ${csp}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`csp-hashes: ${error.message}`);
    process.exit(1);
  }
}
