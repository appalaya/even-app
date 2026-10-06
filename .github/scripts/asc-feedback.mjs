// Lists the app's TestFlight feedback (crash and screenshot submissions) and saves each one, with its crash
// log, under FEEDBACK_DIR for the workflow to upload as a short-lived artifact. The log line per submission
// carries only the device, OS, build, time and uptime: these logs are public. The tester's address is dropped.
import { createPrivateKey, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const APP_ID = '6816425117';
const keyId = process.env.ASC_KEY_ID ?? '';
const issuer = process.env.ASC_ISSUER_ID ?? '';
let p8 = process.env.ASC_KEY_P8 ?? '';
if (!keyId || !issuer || !p8) {
  console.error('ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8 are required');
  process.exit(1);
}
if (!p8.includes('-----BEGIN')) p8 = Buffer.from(p8.replace(/\s+/g, ''), 'base64').toString('utf8');

const b64url = (input) => Buffer.from(input).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
  key: createPrivateKey(p8),
  dsaEncoding: 'ieee-p1363',
});
const token = `${header}.${payload}.${signature.toString('base64url')}`;

async function api(path) {
  const response = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}
async function tryApi(path) {
  try {
    return await api(path);
  } catch (error) {
    return { error: String(error.message), data: [] };
  }
}

const dir = process.env.FEEDBACK_DIR ?? 'asc-feedback';
mkdirSync(dir, { recursive: true });
const lines = ['## TestFlight feedback', ''];

const crashes = await tryApi(
  `/apps/${APP_ID}/betaFeedbackCrashSubmissions?sort=-createdDate&limit=20&include=build&fields[builds]=version`,
);
lines.push('| Crash | When (UTC) | Build | Device | OS | App uptime | Comment |', '|---|---|---|---|---|---|---|');
if (crashes.error) lines.push(`| unavailable | ${crashes.error} | | | | | |`);
for (const c of crashes.data) {
  const { email: _dropped, ...a } = c.attributes ?? {};
  const buildId = c.relationships?.build?.data?.id;
  const build = crashes.included?.find((r) => r.type === 'builds' && r.id === buildId)?.attributes?.version ?? '?';
  const log = await tryApi(`/betaFeedbackCrashSubmissions/${c.id}/crashLog`);
  const uptime = a.appUptimeInMilliseconds == null ? '?' : `${Math.round(a.appUptimeInMilliseconds / 1000)} s`;
  lines.push(
    `| ${c.id.slice(0, 8)}… | ${a.createdDate ?? '?'} | ${build} | ${a.deviceModel ?? '?'} | ${a.osVersion ?? '?'} | ${uptime} | ${a.comment ? 'yes' : 'no'} |`,
  );
  writeFileSync(`${dir}/crash-${c.id}.json`, JSON.stringify({ id: c.id, build, attributes: a, crashLog: log }, null, 2));
}

const shots = await tryApi(
  `/apps/${APP_ID}/betaFeedbackScreenshotSubmissions?sort=-createdDate&limit=20&include=build&fields[builds]=version`,
);
lines.push('', `Screenshot feedback submissions: ${shots.error ? `unavailable (${shots.error})` : shots.data.length}`);
for (const s of shots.data) {
  const { email: _dropped, ...a } = s.attributes ?? {};
  writeFileSync(`${dir}/screenshot-${s.id}.json`, JSON.stringify({ id: s.id, attributes: a, relationships: s.relationships }, null, 2));
}

const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
