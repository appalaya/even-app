// Asks App Store Connect whether the app is ready for an external TestFlight build, and prints only
// booleans and counts (the workflow's logs are public; never an address, a name or a key).
import { createPrivateKey, sign } from 'node:crypto';

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
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const filled = (value) => typeof value === 'string' && value.trim() !== '';
const yes = (b) => (b ? 'yes' : 'NO');

const localizations = await api(`/apps/${APP_ID}/betaAppLocalizations`);
const en = localizations.data.find((l) => l.attributes.locale?.startsWith('en')) ?? localizations.data[0];
const a = en?.attributes ?? {};
const review = (await api(`/apps/${APP_ID}/betaAppReviewDetail`)).data?.attributes ?? {};
const groups = (await api(`/apps/${APP_ID}/betaGroups?fields[betaGroups]=name,isInternalGroup&limit=50`)).data;

const lines = [
  '## TestFlight readiness',
  '',
  '| Item | Ready |',
  '|---|---|',
  `| Beta app description | ${yes(filled(a.description))} |`,
  `| Feedback email | ${yes(filled(a.feedbackEmail))} |`,
  `| Privacy policy URL | ${yes(filled(a.privacyPolicyUrl))} |`,
  `| Review contact (first name, last name, phone, email) | ${yes(filled(review.contactFirstName) && filled(review.contactLastName) && filled(review.contactPhone) && filled(review.contactEmail))} |`,
  `| Sign-in required | ${review.demoAccountRequired ? 'yes (a demo account is expected)' : 'no'} |`,
];
for (const g of groups) {
  const testers = await api(`/betaGroups/${g.id}/betaTesters?limit=200`);
  lines.push(`| Group "${g.attributes.name}" (${g.attributes.isInternalGroup ? 'internal' : 'external'}) testers | ${testers.data.length} |`);
}
const ready =
  filled(a.description) && filled(a.feedbackEmail) && filled(a.privacyPolicyUrl) &&
  filled(review.contactFirstName) && filled(review.contactLastName) && filled(review.contactPhone) && filled(review.contactEmail) &&
  groups.some((g) => !g.attributes.isInternalGroup && g.attributes.name === 'Family & Friends');
lines.push('', ready ? '**Ready for an external build.**' : '**Not ready: see the NO rows or the missing external group "Family & Friends".**');
const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
process.exit(ready ? 0 : 2);
