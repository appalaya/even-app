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
// ---- App Store status: states, booleans and counts only (the logs are public) ----
async function tryApi(path) {
  try {
    return await api(path);
  } catch (error) {
    return { error: String(error.message), data: [] };
  }
}
const included = (doc, type, id) => doc.included?.find((r) => r.type === type && r.id === id);
const rel = (resource, name) => resource?.relationships?.[name]?.data;

lines.push('', '## App Store status', '');

const builds = await tryApi(
  `/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=6` +
    '&include=buildBetaDetail,betaAppReviewSubmission' +
    '&fields[builds]=version,uploadedDate,processingState,expired,buildBetaDetail,betaAppReviewSubmission' +
    '&fields[buildBetaDetails]=externalBuildState,internalBuildState&fields[betaAppReviewSubmissions]=betaReviewState',
);
lines.push('| Build | Uploaded | Processing | External (TestFlight) state | Beta App Review |', '|---|---|---|---|---|');
if (builds.error) lines.push(`| unavailable | ${builds.error} | | | |`);
for (const b of builds.data) {
  const detail = included(builds, 'buildBetaDetails', rel(b, 'buildBetaDetail')?.id);
  const sub = included(builds, 'betaAppReviewSubmissions', rel(b, 'betaAppReviewSubmission')?.id);
  lines.push(
    `| ${b.attributes.version}${b.attributes.expired ? ' (expired)' : ''} | ${(b.attributes.uploadedDate ?? '').slice(0, 10)} | ${b.attributes.processingState} | ${detail?.attributes.externalBuildState ?? '—'} | ${sub?.attributes.betaReviewState ?? 'never submitted'} |`,
  );
}

const app = await tryApi(`/apps/${APP_ID}?fields[apps]=contentRightsDeclaration,primaryLocale`);
const infos = await tryApi(`/apps/${APP_ID}/appInfos?fields[appInfos]=state,primaryCategory&include=primaryCategory&fields[appCategories]=platforms`);
lines.push('', '| App information | Value |', '|---|---|');
lines.push(`| Content rights declaration | ${app.data?.attributes?.contentRightsDeclaration ?? 'not set'} |`);
for (const info of infos.data) {
  lines.push(`| App info state | ${info.attributes.state} |`);
  lines.push(`| Primary category | ${rel(info, 'primaryCategory')?.id ?? 'not set'} |`);
  const age = await tryApi(`/appInfos/${info.id}/ageRatingDeclaration`);
  const answered = Object.values(age.data?.attributes ?? {}).some((v) => v !== null && v !== undefined);
  lines.push(`| Age rating questionnaire answered | ${yes(answered)} |`);
}

const versions = await tryApi(
  `/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=5&include=build` +
    '&fields[appStoreVersions]=versionString,appVersionState,releaseType,createdDate,build&fields[builds]=version',
);
lines.push('', '| Version | State | Release | Build attached |', '|---|---|---|---|');
if (versions.error) lines.push(`| unavailable | ${versions.error} | | |`);
for (const v of versions.data) {
  const build = included(versions, 'builds', rel(v, 'build')?.id);
  lines.push(`| ${v.attributes.versionString} | ${v.attributes.appVersionState} | ${v.attributes.releaseType} | ${build?.attributes.version ?? 'none'} |`);
}

for (const v of versions.data ?? []) {
  const locs = await tryApi(
    `/appStoreVersions/${v.id}/appStoreVersionLocalizations` +
      '?fields[appStoreVersionLocalizations]=locale,description,keywords,promotionalText,supportUrl,marketingUrl,whatsNew',
  );
  const detail = (await tryApi(`/appStoreVersions/${v.id}/appStoreReviewDetail`)).data?.attributes ?? {};
  lines.push('', `| Version ${v.attributes.versionString} listing | Ready |`, '|---|---|');
  for (const loc of locs.data ?? []) {
    const l = loc.attributes;
    lines.push(`| ${l.locale}: description | ${yes(filled(l.description))} |`);
    lines.push(`| ${l.locale}: keywords | ${yes(filled(l.keywords))} |`);
    lines.push(`| ${l.locale}: promotional text | ${filled(l.promotionalText) ? 'yes' : 'no (optional)'} |`);
    lines.push(`| ${l.locale}: support URL | ${yes(filled(l.supportUrl))} |`);
    lines.push(`| ${l.locale}: marketing URL | ${filled(l.marketingUrl) ? 'yes' : 'no (optional)'} |`);
    const sets = await tryApi(
      `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots` +
        '&fields[appScreenshotSets]=screenshotDisplayType,appScreenshots&fields[appScreenshots]=assetDeliveryState',
    );
    for (const set of sets.data ?? []) {
      const shots = (rel(set, 'appScreenshots') ?? []).map((s) => included(sets, 'appScreenshots', s.id));
      const complete = shots.filter((s) => s?.attributes.assetDeliveryState?.state === 'COMPLETE').length;
      lines.push(`| ${l.locale}: screenshots ${set.attributes.screenshotDisplayType} | ${shots.length} (${complete} complete) |`);
    }
  }
  lines.push(`| Review contact (first name, last name, phone, email) | ${yes(filled(detail.contactFirstName) && filled(detail.contactLastName) && filled(detail.contactPhone) && filled(detail.contactEmail))} |`);
  lines.push(`| Review notes | ${yes(filled(detail.notes))} |`);
  lines.push(`| Sign-in required | ${detail.demoAccountRequired ? 'yes (a demo account is expected)' : 'no'} |`);
}

const submissions = await tryApi(`/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS&limit=5&fields[reviewSubmissions]=state,submittedDate,platform`);
lines.push('', '| App Review submission | State | Submitted |', '|---|---|---|');
if (submissions.error) lines.push(`| unavailable | ${submissions.error} | |`);
if (!submissions.error && submissions.data.length === 0) lines.push('| none yet | — | — |');
for (const s of submissions.data) lines.push(`| ${s.id.slice(0, 8)}… | ${s.attributes.state} | ${(s.attributes.submittedDate ?? 'not submitted').slice(0, 10)} |`);

const out = lines.join('\n');
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n');
process.exit(ready ? 0 : 2);
