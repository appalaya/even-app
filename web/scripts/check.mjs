#!/usr/bin/env node
/**
 * Validates the landing site before a deploy. Exit code 1 on any failure; placeholders are listed as warnings.
 *
 *   node web/scripts/check.mjs
 *
 * - No page links or loads anything outside this site, except the two store links and the server repository. No mail
 *   address anywhere. No inline event handlers or style attributes (the CSPs allow neither), no frames or <base>,
 *   and no form except the contact page's one.
 * - Only the invite page has inline code: exactly one <script> and one <style>, whose hashes match the /i policy in
 *   _headers, and whose script has no way to send anything.
 * - Only the contact page loads a script: /contact.js. The site's script files (contact.js, contact-lib.js) import
 *   nothing else, fetch only the contact API, and cannot inject, store or open anything, except that contact.js adds
 *   one script element, for Turnstile's api.js at Cloudflare's exact URL (it does so only once no invite can be on
 *   the page; README.md, "Contact page"). contact-lib.js still derives the known-answer group ids of @even/core
 *   (packages/core/src/keys.test.ts).
 * - _headers carries the site-wide headers (Cross-Origin-Opener-Policy included), the AASA Content-Type, and the /i
 *   and /contact policies in the right order, each exactly as csp-hashes.mjs generates it.
 * - Both association files parse as JSON and name the app.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  CONTACT_PAGE,
  CONTACT_PATH,
  INVITE_PAGE,
  TURNSTILE_ORIGIN,
  WEB,
  contactCsp,
  inviteCsp,
  splitHtml,
  strictPolicies,
} from './csp-hashes.mjs';

const APP_ID = '9S29T387N4.com.appalaya.even';
const PACKAGE = 'com.appalaya.even';

/** The only URLs outside this site that a page may reference. */
const ALLOWED_EXTERNAL = [
  /^https:\/\/apps\.apple\.com\/app\/id(?:PLACEHOLDER|\d+)$/,
  /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.appalaya\.even$/,
  /^https:\/\/github\.com\/appalaya\/even-server$/,
  /^https:\/\/github\.com\/appalaya\/even-server\/blob\/main\/THREAT-MODEL\.md$/,
  /^https:\/\/github\.com\/appalaya\/even-app$/,
  /^https:\/\/appalaya\.com$/,
  /^https:\/\/buy\.stripe\.com\/6oUcMY7m3enX4Krgb5fjG00$/,
];

/** Turnstile's api.js, from the exact URL Cloudflare requires (never proxied or cached). Added by contact.js only. */
const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** The contact page's one script. Turnstile is not here: contact.js adds it once no invite can be on the page. */
const CONTACT_SCRIPTS = [{ src: '/contact.js', attrs: ['type=module'] }];

/** The site's script files and what each may import. Any other .js file in the site fails the check. */
const SCRIPT_FILES = new Map([
  ['contact.js', ['./contact-lib.js']],
  ['contact-lib.js', []],
]);

/** The elements each script file may create. contact.js: the id's <code>, and the one <script> for Turnstile. */
const CREATED_ELEMENTS = new Map([
  ['contact.js', ['code', 'script']],
  ['contact-lib.js', []],
]);

/** The one script file that may add a script, and the constant that must hold its URL. */
const TURNSTILE_LOADER = 'contact.js';
const TURNSTILE_CONSTANT = `const TURNSTILE_URL = '${TURNSTILE_SCRIPT}';`;

/** The only requests the contact page's scripts may make. */
const CONTACT_API = { CONFIG_URL: '/api/contact/config', CONTACT_URL: '/api/contact' };

/** Store badge artwork (README.md, "Store badges"): SVGs styled inline by their makers, so inline style only. */
const BADGES_PATH = '/badges/*';
const BADGES_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

/** An address in any published file: the site names no mailbox (README.md, "Contact page"). */
const MAIL_ADDRESS =
  /[A-Za-z0-9._%+'-]+@(?!(?:[A-Za-z0-9-]+\.)*example\.(?:com|net|org)\b)(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/;

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
const FORBIDDEN_TAGS = new Set(['iframe', 'frame', 'object', 'embed', 'base', 'applet', 'portal']);

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

/** Anything in the site's script files that could send elsewhere, store, inject, or run text as code. */
const FORBIDDEN_IN_SCRIPT_FILES = FORBIDDEN_IN_INVITE_SCRIPT.filter(
  (pattern) =>
    !['/\\bfetch\\b/', '/location\\.search/', '/\\bWorker\\b/', '/\\.src\\s*=/'].includes(
      String(pattern),
    ),
).concat([
  /\bnew\s+(?:Shared)?Worker\b/,
  /\bsetAttribute\s*\(\s*['"](?:src|href)['"]/,
  /\bconsole\./,
  /\bnavigator\.clipboard/,
  /\blocation\.hash\s*=/,
]);

const failures = [];
const warnings = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return ['node_modules', '.wrangler'].includes(entry.name) ? [] : walk(path);
    return [path];
  });
}

const isExternal = (value) =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('\\\\');

function checkUrl(file, where, raw) {
  const value = raw.trim();
  if (value === '' || !isExternal(value)) return;
  if (ALLOWED_EXTERNAL.some((pattern) => pattern.test(value))) return;
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
  const isContact = file === CONTACT_PAGE;
  let parsed;
  try {
    parsed = splitHtml(source);
  } catch (error) {
    fail(file, error.message);
    return;
  }
  const { markup, blocks } = parsed;
  const scripts = [];
  let forms = 0;

  for (const m of markup.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const attrs = attributesOf(m[2]);
    if (FORBIDDEN_TAGS.has(tag)) fail(file, `<${tag}> is not allowed`);
    if (tag === 'form') {
      forms += 1;
      if (!isContact) fail(file, `<form> is not allowed (only ${CONTACT_PAGE} has one)`);
      for (const { name } of attrs) {
        if (['action', 'method', 'target', 'enctype'].includes(name))
          fail(file, `<form ${name}>: the form is sent by contact.js, never natively`);
      }
    }
    if (tag === 'script' && attrs.some((a) => a.name === 'src')) scripts.push(attrs);
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

  if (isContact) {
    if (forms !== 1) fail(file, `expected exactly one <form>, found ${forms}`);
    const found = scripts.map((attrs) => ({
      src: attrs.find((a) => a.name === 'src')?.value,
      attrs: attrs
        .filter((a) => a.name !== 'src')
        .map((a) => (a.value === '' ? a.name : `${a.name}=${a.value}`)),
    }));
    if (JSON.stringify(found) !== JSON.stringify(CONTACT_SCRIPTS)) {
      fail(
        file,
        `scripts must be exactly ${JSON.stringify(CONTACT_SCRIPTS)}, found ${JSON.stringify(found)}`,
      );
    }
  } else if (!isInvite && scripts.length > 0) {
    fail(file, `<script src> (only ${CONTACT_PAGE} loads scripts)`);
  }

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
    'Cross-Origin-Opener-Policy: same-origin',
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
    fail(file, "expected exactly two strict (hashed default-src 'none') policies, for /i and /i/*");

  let contact = null;
  try {
    contact = contactCsp(pages.get(CONTACT_PAGE));
  } catch (error) {
    fail(CONTACT_PAGE, error.message);
  }
  const r = rule(CONTACT_PATH);
  if (!r) fail(file, `missing the ${CONTACT_PATH} rule`);
  else {
    if (index(CONTACT_PATH) < index('/*'))
      fail(file, `${CONTACT_PATH} must come after /* so it replaces the site-wide CSP`);
    if (!r.lines.includes('! Content-Security-Policy'))
      fail(file, `${CONTACT_PATH} must detach the site-wide CSP first`);
    const csp = r.lines.filter((l) => l.startsWith('Content-Security-Policy:'));
    if (csp.length !== 1)
      fail(file, `${CONTACT_PATH} must set exactly one Content-Security-Policy`);
    else if (contact !== null && csp[0] !== `Content-Security-Policy: ${contact}`) {
      fail(
        file,
        `${CONTACT_PATH} CSP does not match ${CONTACT_PAGE}; run node web/scripts/csp-hashes.mjs`,
      );
    }
  }
  // The store badges: their own inline style and nothing else.
  const badges = rule(BADGES_PATH);
  if (!badges) fail(file, `missing the ${BADGES_PATH} rule`);
  else {
    if (index(BADGES_PATH) < index('/*')) fail(file, `${BADGES_PATH} must come after /*`);
    const lines = badges.lines.filter((l) => l.startsWith('Content-Security-Policy:'));
    if (
      !badges.lines.includes('! Content-Security-Policy') ||
      lines.length !== 1 ||
      lines[0] !== `Content-Security-Policy: ${BADGES_CSP}`
    )
      fail(file, `${BADGES_PATH} must replace the site-wide CSP with exactly: ${BADGES_CSP}`);
  }

  // Turnstile is allowed on the contact page's policy and no other.
  for (const other of rules) {
    if (other.path === CONTACT_PATH) continue;
    if (other.lines.some((l) => l.includes(TURNSTILE_ORIGIN)))
      fail(file, `${other.path} names ${TURNSTILE_ORIGIN} (only ${CONTACT_PATH} may)`);
  }
}

/** The site's script files: known files only, importing only each other, fetching only the contact API. */
function checkScriptFile(file, source) {
  const imports = SCRIPT_FILES.get(file);
  if (imports === undefined) {
    fail(file, 'a script file the check does not know; add it to SCRIPT_FILES with what it may do');
    return;
  }
  for (const pattern of FORBIDDEN_IN_SCRIPT_FILES) {
    if (pattern.test(source)) fail(file, `script matches forbidden pattern ${pattern}`);
  }
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm),
  ].map((m) => m[1]);
  for (const specifier of specifiers) {
    if (!imports.includes(specifier))
      fail(file, `imports ${specifier} (allowed: ${imports.join(', ') || 'none'})`);
  }
  if (/^\s*import\s*['"]/m.test(source)) fail(file, 'side-effect import');
  for (const m of source.matchAll(/\bfetch\s*\(\s*([^,)]*)/g)) {
    const arg = m[1].trim();
    if (!Object.hasOwn(CONTACT_API, arg))
      fail(file, `fetch(${arg}): only ${Object.keys(CONTACT_API).join(' and ')}`);
  }
  for (const [name, url] of Object.entries(CONTACT_API)) {
    if (
      new RegExp(`\\bfetch\\s*\\(\\s*${name}\\b`).test(source) &&
      !source.includes(`const ${name} = '${url}';`)
    )
      fail(file, `${name} must be the constant '${url}'`);
  }
  for (const m of source.matchAll(/\bhttps?:\/\/[A-Za-z0-9.-]+/g)) {
    if (m[0] === 'https://sync.even.appalaya.com') continue;
    if (file === TURNSTILE_LOADER && m[0] === TURNSTILE_ORIGIN) continue;
    fail(file, `URL in a script file: ${m[0]}`);
  }

  // Elements: only those listed, and a script only as Turnstile's api.js from its one constant.
  const allowed = CREATED_ELEMENTS.get(file) ?? [];
  const created = [...source.matchAll(/\bcreateElement(?:NS)?\s*\(([^)]*)\)/g)].map((m) =>
    m[1].trim(),
  );
  for (const arg of created) {
    const tag = /^['"]([a-z]+)['"]$/.exec(arg)?.[1];
    if (tag === undefined || !allowed.includes(tag))
      fail(file, `createElement(${arg}) (allowed: ${allowed.join(', ') || 'none'})`);
  }
  const scripts = created.filter((arg) => /^['"]script['"]$/.test(arg)).length;
  const srcs = [...source.matchAll(/\.src\s*=\s*([^;\n]*)/g)].map((m) => m[1].trim());
  if (file === TURNSTILE_LOADER) {
    if (scripts !== 1)
      fail(file, `expected one createElement('script'), for Turnstile; found ${scripts}`);
    if (!source.includes(TURNSTILE_CONSTANT)) fail(file, `missing ${TURNSTILE_CONSTANT}`);
    if (source.split(TURNSTILE_ORIGIN).length - 1 !== 1)
      fail(file, `${TURNSTILE_ORIGIN} may appear once, in TURNSTILE_URL`);
    if (srcs.length !== 1 || srcs[0] !== 'TURNSTILE_URL')
      fail(
        file,
        `the only .src assignment must be .src = TURNSTILE_URL; found ${JSON.stringify(srcs)}`,
      );
  } else if (srcs.length > 0) {
    fail(file, `.src assignment (only ${TURNSTILE_LOADER} adds a script)`);
  }
}

/**
 * contact-lib.js, loaded as the browser loads it (an ES module; as a data: URL so Node needs no package type), gives
 * @even/core's known-answer group ids (packages/core/src/keys.test.ts, VECTORS) and reads a link to the same id.
 * contact-lib.test.ts compares it with @even/core itself; this keeps the answers checked wherever check.mjs runs.
 */
async function checkDerivation(source) {
  const file = 'contact-lib.js';
  const secret = Uint8Array.from({ length: 32 }, (_, i) => i);
  const vectors = {
    'https://sync.even.appalaya.com': '5440R1lj0RAH5z7UZJ48_Fbl2cbrEBrp4DFswxKPwTI',
    'https://home.example.net:8443/even': 'ohV9w_-dFphsCPCXCv7OQnwDcxnuhBeGmQNKiJkI8z4',
  };
  // makeInvite(secret, 'https://sync.even.appalaya.com'), encoded: {"v":1,"s":…,"k":…,"h":"Yw3NKQ"}.
  const code = Buffer.from(
    JSON.stringify({
      v: 1,
      s: 'https://sync.even.appalaya.com',
      k: Buffer.from(secret).toString('base64url'),
      h: 'Yw3NKQ',
    }),
  ).toString('base64url');
  try {
    const lib = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    );
    for (const [server, groupId] of Object.entries(vectors)) {
      const got = await lib.groupIdFor(secret, server);
      if (got !== groupId) fail(file, `group id for ${server} is ${got}, expected ${groupId}`);
    }
    const target = await lib.targetFromInvite(`https://even.appalaya.com/i#${code}`);
    if (
      target.groupId !== vectors['https://sync.even.appalaya.com'] ||
      !target.reportable ||
      !target.appalaya
    )
      fail(file, `an invite link reads as ${JSON.stringify(target)}`);
  } catch (error) {
    fail(file, `known answers: ${error.message}`);
  }
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
  if (/\.(?:html|css|svg|json|js)$|^_headers$|^_redirects$|apple-app-site-association$/.test(rel)) {
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
if (!pages.has(CONTACT_PAGE)) fail(CONTACT_PAGE, 'missing');
if (files.has('_headers') && pages.has(INVITE_PAGE) && pages.has(CONTACT_PAGE))
  checkHeaders(files.get('_headers'), pages);
else fail('_headers', 'missing');
checkWellKnown(files);
for (const [rel, source] of files) {
  if (rel.endsWith('.js')) checkScriptFile(rel, source);
  if (MAIL_ADDRESS.test(source) || /mailto:/i.test(source))
    fail(rel, 'a mail address; the site names none');
}
if (files.has('contact-lib.js')) await checkDerivation(files.get('contact-lib.js'));
else fail('contact-lib.js', 'missing');

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
