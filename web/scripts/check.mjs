#!/usr/bin/env node
/**
 * Validates the landing site before a deploy. Exit code 1 on any failure; placeholders are listed as warnings.
 *
 *   node web/scripts/check.mjs
 *
 * - No page links or loads anything outside this site, except the two store links, the server repository and the
 *   abuse mailbox. No inline event handlers or style attributes (the CSPs allow neither), no frames, forms or <base>.
 * - Only the invite page has inline code: exactly one <script> and one <style>, whose hashes match the /i policy in
 *   _headers, and whose script has no way to send anything.
 * - _headers carries the site-wide headers, the AASA Content-Type, and the strict /i policy in the right order.
 * - Both association files parse as JSON and name the app.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { INVITE_PAGE, WEB, inviteCsp, splitHtml, strictPolicies } from './csp-hashes.mjs';

const APP_ID = '9S29T387N4.com.appalaya.even';
const PACKAGE = 'com.appalaya.even';

/** The only URLs outside this site that a page may reference. */
const ALLOWED_EXTERNAL = [
  /^https:\/\/apps\.apple\.com\/app\/id(?:PLACEHOLDER|\d+)$/,
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.appalaya\.even$/,
  /^https:\/\/github\.com\/appalaya\/even-server$/,
  /^mailto:abuse@appalaya\.com$/,
  /^mailto:support@appalaya\.com$/,
];

/** Attributes that take a URL. */
const URL_ATTRS = new Set([
  'src',
  'href',
  'srcset',
  'action',
  'formaction',
  'poster',
  'data',
  'background',
  'cite',
  'manifest',
  'ping',
  'xlink:href',
  'imagesrcset',
  'longdesc',
  'codebase',
  'archive',
  'profile',
  'usemap',
]);
const FORBIDDEN_TAGS = new Set([
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'base',
  'applet',
  'portal',
]);

/** Anything in the invite script that could send, store, or inject. */
const FORBIDDEN_IN_INVITE_SCRIPT = [
  /\bfetch\b/,
  /XMLHttpRequest/,
  /sendBeacon/,
  /WebSocket/,
  /EventSource/,
  /WebTransport/,
  /RTCPeerConnection/,
  /\bimport\s*\(/,
  /\bimportScripts\b/,
  /\bWorker\b/,
  /new\s+Image\b/,
  /\.src\s*=/,
  /\.action\s*=/,
  /innerHTML/,
  /outerHTML/,
  /insertAdjacentHTML/,
  /document\.write/,
  /createContextualFragment/,
  /DOMParser/,
  /\beval\s*\(/,
  /new\s+Function\b/,
  /setAttribute\s*\(\s*['"]on/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /document\.cookie/,
  /postMessage/,
  /window\.open\b/,
  /\.submit\s*\(/,
  /location\.(?:assign|replace)\s*\(/,
  /location\.href\s*=/,
  /location\.search/,
];

const failures = [];
const warnings = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path);
    return [path];
  });
}

const isExternal = (value) =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('\\\\');

function checkUrl(file, where, raw) {
  const value = raw.trim();
  if (value === '' || !isExternal(value)) return;
  if (!ALLOWED_EXTERNAL.some((pattern) => pattern.test(value)))
    fail(file, `external URL in ${where}: ${value}`);
}

function checkCss(file, css, where) {
  if (/@import\b/i.test(css)) fail(file, `@import in ${where}`);
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi))
    checkUrl(file, `${where} url()`, m[2]);
  if (/expression\s*\(/i.test(css)) fail(file, `CSS expression() in ${where}`);
}

function attributesOf(tagText) {
  const attrs = [];
  const re = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of tagText.matchAll(re))
    attrs.push({ name: m[1].toLowerCase(), value: m[2] ?? m[3] ?? m[4] ?? '' });
  return attrs;
}

function checkHtml(file, source) {
  const isInvite = file === INVITE_PAGE;
  let parsed;
  try {
    parsed = splitHtml(source);
  } catch (error) {
    fail(file, error.message);
    return;
  }
  const { markup, blocks } = parsed;

  for (const m of markup.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = attributesOf(m[2]);
    if (FORBIDDEN_TAGS.has(tag)) fail(file, `<${tag}> is not allowed`);
    for (const { name, value } of attrs) {
      if (name.startsWith('on')) fail(file, `inline event handler ${name}= on <${tag}>`);
      if (name === 'style') fail(file, `style="" attribute on <${tag}> (the CSP blocks it)`);
      if (URL_ATTRS.has(name)) {
        const values = name.endsWith('srcset')
          ? value.split(',').map((part) => part.trim().split(/\s+/)[0])
          : [value];
        for (const v of values) checkUrl(file, `<${tag} ${name}>`, v);
      }
    }
    const get = (n) => attrs.find((a) => a.name === n)?.value.toLowerCase();
    if (tag === 'meta' && get('http-equiv') === 'refresh')
      fail(file, 'meta refresh is not allowed');
    if (isInvite && tag === 'script' && get('src') !== undefined)
      fail(file, '<script src> on the invite page');
    if (isInvite && tag === 'link' && (get('rel') ?? '').split(/\s+/).includes('stylesheet')) {
      fail(
        file,
        'stylesheet <link> on the invite page (its CSP allows only the hashed inline style)',
      );
    }
  }

  for (const style of blocks.style) checkCss(file, style.body, '<style>');

  if (!isInvite) {
    if (blocks.script.some((s) => s.body.trim() !== ''))
      fail(file, 'inline <script> (only the invite page may have one)');
    if (blocks.style.length > 0)
      fail(file, 'inline <style> (only the invite page may have one; use /site.css)');
    return;
  }

  // The invite page.
  if (!/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i.test(markup))
    fail(file, 'missing <meta name="referrer" content="no-referrer">');
  if (!/<meta\s+name="robots"\s+content="noindex"\s*\/?>/i.test(markup))
    fail(file, 'missing <meta name="robots" content="noindex">');
  if (blocks.script.length !== 1)
    fail(file, `expected exactly one <script>, found ${blocks.script.length}`);
  if (blocks.style.length !== 1)
    fail(file, `expected exactly one <style>, found ${blocks.style.length}`);
  for (const script of blocks.script) {
    for (const pattern of FORBIDDEN_IN_INVITE_SCRIPT) {
      if (pattern.test(script.body))
        fail(file, `invite script matches forbidden pattern ${pattern}`);
    }
    if (!script.body.includes('location.hash'))
      fail(file, 'invite script does not read location.hash');
  }
}

function headerRules(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ path: line.trim(), lines: [] });
    else if (rules.length > 0) rules.at(-1).lines.push(line.trim());
  }
  return rules;
}

function checkHeaders(text, pages) {
  const file = '_headers';
  const rules = headerRules(text);
  const rule = (path) => rules.find((r) => r.path === path);
  const index = (path) => rules.findIndex((r) => r.path === path);
  const paths = rules.map((r) => r.path);
  if (new Set(paths).size !== paths.length) fail(file, 'a path appears in more than one rule');

  const all = rule('/*');
  const required = [
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: no-referrer',
    /^Permissions-Policy: .+/,
    /^Strict-Transport-Security: max-age=\d+/,
    /^Content-Security-Policy: default-src 'self';/,
  ];
  if (!all) fail(file, 'missing the /* rule');
  else {
    for (const want of required) {
      const ok = all.lines.some((l) => (typeof want === 'string' ? l === want : want.test(l)));
      if (!ok) fail(file, `/* is missing ${want}`);
    }
  }

  const aasa = rule('/.well-known/apple-app-site-association');
  if (!aasa?.lines.includes('Content-Type: application/json')) {
    fail(file, 'the AASA rule must set Content-Type: application/json');
  }

  let expected = null;
  try {
    expected = inviteCsp(pages.get(INVITE_PAGE));
  } catch (error) {
    fail(INVITE_PAGE, error.message);
  }
  for (const path of ['/i', '/i/*']) {
    const r = rule(path);
    if (!r) {
      fail(file, `missing the ${path} rule`);
      continue;
    }
    if (index(path) < index('/*'))
      fail(file, `${path} must come after /* so it replaces the site-wide CSP`);
    if (!r.lines.includes('! Content-Security-Policy'))
      fail(file, `${path} must detach the site-wide CSP first`);
    const csp = r.lines.filter((l) => l.startsWith('Content-Security-Policy:'));
    if (csp.length !== 1) fail(file, `${path} must set exactly one Content-Security-Policy`);
    else if (expected !== null && csp[0] !== `Content-Security-Policy: ${expected}`) {
      fail(file, `${path} CSP does not match ${INVITE_PAGE}; run node web/scripts/csp-hashes.mjs`);
    }
  }
  if (strictPolicies(text).length !== 2)
    fail(file, "expected exactly two strict (default-src 'none') policies");
}

function checkWellKnown(files) {
  const aasaFile = '.well-known/apple-app-site-association';
  const linksFile = '.well-known/assetlinks.json';
  try {
    const aasa = JSON.parse(files.get(aasaFile));
    const details = aasa?.applinks?.details;
    if (!Array.isArray(details)) throw new Error('applinks.details is not an array');
    const entry = details.find((d) => Array.isArray(d.appIDs) && d.appIDs.includes(APP_ID));
    if (!entry) throw new Error(`no applinks entry for ${APP_ID}`);
    const paths = (entry.components ?? []).map((c) => c['/']);
    for (const want of ['/i', '/i/*'])
      if (!paths.includes(want)) throw new Error(`components do not cover ${want}`);
  } catch (error) {
    fail(aasaFile, error.message);
  }
  try {
    const links = JSON.parse(files.get(linksFile));
    if (!Array.isArray(links)) throw new Error('not a JSON array');
    const entry = links.find(
      (l) => l?.target?.namespace === 'android_app' && l.target.package_name === PACKAGE,
    );
    if (!entry) throw new Error(`no android_app entry for ${PACKAGE}`);
    if (!entry.relation?.includes('delegate_permission/common.handle_all_urls'))
      throw new Error('missing handle_all_urls');
    const prints = entry.target.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || prints.length === 0)
      throw new Error('no sha256_cert_fingerprints');
    for (const print of prints) {
      if (!/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(print) && !print.includes('PLACEHOLDER')) {
        throw new Error(`not a SHA-256 fingerprint (AA:BB:... uppercase): ${print}`);
      }
    }
  } catch (error) {
    fail(linksFile, error.message);
  }
}

// Run.
const files = new Map();
for (const path of walk(WEB)) {
  const rel = relative(WEB, path).split('\\').join('/');
  if (rel.startsWith('scripts/') || rel === 'README.md') continue;
  if (/\.(?:html|css|svg|json)$|^_headers$|^_redirects$|apple-app-site-association$/.test(rel)) {
    files.set(rel, readFileSync(path, 'utf8'));
  }
}

const pages = new Map([...files].filter(([rel]) => rel.endsWith('.html')));
if (!pages.has(INVITE_PAGE)) fail(INVITE_PAGE, 'missing');
for (const [rel, source] of pages) checkHtml(rel, source);
for (const [rel, source] of files) if (rel.endsWith('.css')) checkCss(rel, source, 'stylesheet');
for (const [rel, source] of files) {
  if (
    rel.endsWith('.svg') &&
    /<script|\bon\w+\s*=|href\s*=\s*["']?(?:https?:)?\/\//i.test(source)
  ) {
    fail(rel, 'SVG with a script, event handler, or external reference');
  }
}
if (files.has('_headers') && pages.has(INVITE_PAGE)) checkHeaders(files.get('_headers'), pages);
else fail('_headers', 'missing');
checkWellKnown(files);

for (const [rel, source] of files) {
  source.split('\n').forEach((line, n) => {
    if (line.includes('PLACEHOLDER'))
      warnings.push(`${rel}:${n + 1}: ${line.trim().slice(0, 110)}`);
  });
}

console.log(
  `check: ${pages.size} pages, ${files.size} files under ${relative(process.cwd(), WEB) || '.'}`,
);
if (warnings.length > 0) {
  console.log(`\nplaceholders to fill before launch (${warnings.length}):`);
  for (const w of warnings) console.log(`  ${w}`);
}
if (failures.length > 0) {
  console.error(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\ncheck passed');
