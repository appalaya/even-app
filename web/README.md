# web — even.appalaya.com

The static landing site: the universal-link and App Links association files, the invite page at `/i`, the
product page, and the privacy, terms and abuse pages. Plain HTML and CSS, one inline script on one page, no build
step, no framework, and no request to anything outside this site. Deployed to Cloudflare by GitHub Actions, as a
Worker with static assets plus a small Worker script that answers only the contact form's API under `/api/` (see
[Deploying](#deploying) and [Contact form](#contact-form)).

| URL | File | Notes |
|---|---|---|
| `/` | `index.html` | Product page |
| `/i` | `i.html` | Invite page. Reads the invite from the URL fragment, never sends it. Strict CSP. |
| `/privacy`, `/terms`, `/abuse` | `privacy.html`, `terms.html`, `abuse.html` | The privacy page is [`even-server/THREAT-MODEL.md`](https://github.com/appalaya/even-server/blob/main/THREAT-MODEL.md) in plain words; keep them in step. |
| any unknown path | `404.html` | Served with status 404 (`not_found_handling: "404-page"` in `wrangler.jsonc`). |
| `/api/contact`, `/api/contact/config` | `worker/` | The contact form's API, the only code that runs on Cloudflare. See [Contact form](#contact-form). |
| `/.well-known/apple-app-site-association` | same | iOS universal links for `/i` and `/i/*` |
| `/.well-known/assetlinks.json` | same | Android App Links |
| | `site.css`, `favicon.svg` | Shared by every page except `/i`, which has its own inline style |
| | `_headers` | Response headers, including every CSP. Read by Cloudflare as configuration, not served. |
| | `wrangler.jsonc`, `.assetsignore` | Deploy configuration and the list of files kept out of the upload. Not served. |
| | `worker/` | The Worker script's TypeScript source and its tests. Bundled into the script, not served. |

Colours are the app's `even` theme (`src/theme/themes.ts`) and the mark is `src/components/Mark.tsx`'s paths; change
them there first.

Everything in this folder is published except what `.assetsignore` lists: this README, `scripts/`, `worker/` and
`wrangler.jsonc`. They contain nothing private; the repository is public anyway. No email address or key is in any
of them: those are Worker secrets and variables set by the deploy (see [Contact form](#contact-form)).

## Why `i.html` and not `i/index.html`

Cloudflare's asset server (`html_handling: "auto-trailing-slash"`) serves `x.html` at `/x` with 200 and redirects
`/x/` and `/x.html` to `/x` (307). A folder's `x/index.html` is the other way round: 200 at `/x/`, with `/x`
redirected. Invite links are `https://even.appalaya.com/i#<code>`, so `i.html` answers them directly. `/i/#<code>`
still works: browsers carry the fragment across a redirect whose `Location` has none, and the AASA covers `/i/*` as
well. No `_redirects` file is needed.

## Changing the invite page

The invite page's CSP allows its one inline `<script>` and one inline `<style>` by SHA-256 hash, and nothing else.
The hash covers every byte between the tags, so **after any edit to `i.html`**, whitespace included:

```bash
node web/scripts/csp-hashes.mjs   # rewrites the two strict CSP lines in _headers and prints the policy
node web/scripts/check.mjs        # must pass before deploying
```

Rules the check enforces, because the CSP would silently break the page otherwise: no `on*=` or `style=""`
attributes anywhere (hashes cover neither), no second script or style, no external stylesheet on `/i`, and nothing in
the script that can send, store or inject (`fetch`, `sendBeacon`, `innerHTML`, storage, and so on). The group name is
inserted with `textContent` only.

`check.mjs` also fails on any external URL in any page other than the two store links, the server repository link and
the abuse mailbox; on inline code in any other page; on a `_headers` file missing a required header or with the `/i`
rules before `/*`; and on either association file not parsing or not naming the app. It lists every placeholder left.

## Local preview

```bash
# Cloudflare's asset server and the Worker script, locally: _headers, /i, 404, /api/*
npx wrangler@4 dev --config web/wrangler.jsonc --port 4173 --persist-to .wrangler/state
```

It needs no Cloudflare account and deploys nothing. `--persist-to` keeps Wrangler's local state out of `web/`:
Wrangler watches the whole assets folder, and state written inside it restarts the server in a loop. Without the
contact form's variables (see [Trying the form locally](#trying-the-form-locally)) Wrangler warns that the required
secrets are missing and `/api/contact` answers 503; the pages are unaffected. `npx serve web` also works for a quick
look, but it ignores `_headers`, so it does not enforce the CSP, and it has no `/api/`.

## Deploying

`.github/workflows/web.yml` is the only way the site is deployed; nothing is deployed from a local machine. On every
push to main that changes `web/` or the workflow, it runs `node web/scripts/check.mjs`, the Worker script's
typecheck, lint and tests, and then `wrangler deploy` with `web/wrangler.jsonc`. That uploads this folder as the
static assets of a Worker named `even-web`, on the free Workers plan, together with the script bundled from
`worker/index.ts` and the contact form's secrets. Cloudflare's asset server applies `_headers`, serves `i.html` at
`/i`, and answers unknown paths with `404.html`; those requests are free and unlimited. The script runs only for
`/api/*` (`run_worker_first`), and for one case the platform imposes on any Worker with a script: a request for a
path with no file that is not a browser navigation (a bot, `curl`, `fetch`) goes to the script, which hands it
straight back to the asset server for the same `404.html`. Both count as Worker requests (free plan: 100,000 a day);
browsers see no difference. "Run workflow" on main deploys the same way; on any other branch it runs the same checks
and a dry run only. Pull requests never run it; `ci.yml` runs the site check and the script's typecheck, lint and
tests on them.

The deploy never creates or changes DNS records, routes or domains. `wrangler.jsonc` has no `routes`, and
`workers_dev` and `preview_urls` are off, so the Worker has no public URL until the Custom Domain below is attached
once by hand; later deploys leave that domain in place.

### Secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account details → Account ID |
| `CLOUDFLARE_API_TOKEN` | An account API token with the permission below |
| `CONTACT_TO_REPORT`, `CONTACT_TO_HELP`, `CONTACT_TO_FEEDBACK`, `CONTACT_FROM`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` | The contact form; see [Contact form](#contact-form), "Secrets and variables" |

Until the first two exist, a deploy run fails at the Deploy step with a message naming them; until the contact
form's six exist, it fails there with a message naming the missing ones.

### API token permissions

| Permission | What the deploy uses it for |
|---|---|
| Account → **Workers Scripts** → Write (called Edit in some Cloudflare screens and docs) | Create the `even-web` Worker on the first run, upload the assets, deploy each version with its script and secrets, and keep its `workers.dev` and Preview URLs off |

That is the whole list. The deploy needs no zone, DNS, Workers Routes, KV or Account Settings permission: the
account ID comes from the secret, and nothing is routed or attached by the deploy. The email and rate-limit
bindings and the secrets need nothing more either: Cloudflare's Workers permissions docs say deploying a Worker's
bindings and managing its secrets need only edit access to that Worker. A token that also has Workers KV Storage
Write, Account Settings Read and Workers Routes Write (all zones) works; those permissions go unused here.

Cloudflare's newer Workers roles describe creating a Worker as needing Workers Admin, while the legacy Workers
Scripts permission above still creates Workers (it is what the "Edit Cloudflare Workers" token template uses). If
the first run fails with an authorization error while creating `even-web`, that permission is the place to look.

### Once, after the first successful deploy: the domain

1. Cloudflare dashboard → Workers & Pages → `even-web` → Settings → Domains & Routes → Add → Custom Domain.
2. Enter `even.appalaya.com` and add it.

A Workers Custom Domain creates its own proxied DNS record and certificate; add no DNS record by hand (a Custom Domain
cannot be created on a hostname that already has a CNAME record). The zone `appalaya.com` is already on Cloudflare,
which a Custom Domain requires.

### Zone settings

For `appalaya.com`, keep **off** everything that injects scripts or rewrites HTML, since it would either break the
hashes or add a script the invite page must not run: Rocket Loader, Web Analytics (including its automatic setup for
proxied hostnames), Zaraz, Email Address Obfuscation (the pages also wrap the address in `<!--email_off-->`), and Bot
Fight Mode's JavaScript detections.

### DNS

| Name | Type | Target | |
|---|---|---|---|
| `even` | Worker Custom Domain | the `even-web` Worker | Created by the one-time step above; no manual record |
| `sync.even` | Worker Custom Domain | the even-server Worker | Set up from the even-server repository; out of scope here |
| `cf-bounce` (MX ×3, TXT SPF), `cf-bounce._domainkey` (TXT DKIM) | Email Sending | Cloudflare's bounce servers and keys | Added and locked by Email Sending onboarding ([Contact form](#once-email-service-for-appalayacom)) |
| `@` (MX, TXT SPF), `_dmarc` (TXT) | Zoho Mail | Zoho | Existing mail for the domain. Keep; see the warnings in the Email Service steps |

### Check after the first deploy

```bash
# The invite page's policy is the strict one, and only one
curl -sI https://even.appalaya.com/i | grep -i content-security-policy

# 200, content-type: application/json, the JSON itself, and no redirect (Apple does not follow redirects for the AASA)
curl -si https://even.appalaya.com/.well-known/apple-app-site-association

# Android App Links: 200, application/json, the statement list
curl -si https://even.appalaya.com/.well-known/assetlinks.json

# The tooling is not published: 404 for each
for f in README.md wrangler.jsonc scripts/check.mjs worker/index.ts; do curl -s -o /dev/null -w "%{http_code} /$f\n" "https://even.appalaya.com/$f"; done

# The contact form: its config (200, the site key), and a request from another origin refused (403 forbidden)
curl -s https://even.appalaya.com/api/contact/config
curl -s -X POST https://even.appalaya.com/api/contact -H 'Origin: https://example.com' \
  -H 'Content-Type: application/json' -d '{}'

# What Apple's CDN has cached; devices fetch from here, not from the site. It can lag the site by hours.
curl -s https://app-site-association.cdn-apple.com/a/v1/even.appalaya.com

# Android: Google's view of the statement, then the device's
curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://even.appalaya.com&relation=delegate_permission/common.handle_all_urls'
adb shell pm verify-app-links --re-verify com.appalaya.even && adb shell pm get-app-links com.appalaya.even
```

For a development build on iOS, `applinks:even.appalaya.com?mode=developer` in the entitlements makes the device
fetch the AASA from the site directly instead of the CDN (Settings → Developer → Associated Domains Development).
Test universal links on a real device; the simulator is unreliable for them.

## Contact form

The contact page (built separately) posts to the Worker script in `worker/`. For each submission the script checks
the request, verifies the Turnstile token with Cloudflare, applies a per-IP limit, and sends one plain-text email to
the mailbox for the form's purpose. Nothing is stored. Its log lines carry the route, the purpose and the outcome,
never the message, an address, a group id, a token or an IP (even-server `THREAT-MODEL.md`, "What we log", applies
here too), and Cloudflare's invocation logs, traces and Logpush are off in `wrangler.jsonc`.

| File | |
|---|---|
| `worker/index.ts` | Entry point: `/api/contact`, `/api/contact/config`, 404 for other `/api/` paths, everything else to the assets |
| `worker/contact.ts` | The two routes: origin, size, Turnstile, rate limit, send |
| `worker/validate.ts` | The request body's rules |
| `worker/message.ts` | The email |
| `worker/env.ts`, `worker/http.ts` | Bindings and secrets; JSON responses, logging, the rate-limit key |
| `worker/*.test.ts` | Vitest, run from the repository root (`npx vitest run web/worker`) with every binding stubbed; `config.test.ts` also checks that `wrangler.jsonc`, the workflow and the code agree and hold no address or key |

### API for the page

Both routes answer JSON with `Cache-Control: no-store` and no CORS headers: only pages on `https://even.appalaya.com`
can use them.

**`GET /api/contact/config`**, once when the page loads:

```json
{ "turnstileSiteKey": "…", "turnstileAction": "contact", "maxMessageLength": 4000 }
```

`503 {"ok":false,"error":"unavailable"}` if the Worker was deployed without a site key.

**`POST /api/contact`**, with `fetch` from the page itself, `Content-Type: application/json`, and a body of at most
16 KB. The browser's own headers must show a same-origin request: `Sec-Fetch-Site: same-origin` where the browser
sends it, and `Origin: https://even.appalaya.com` (or `Origin: null`, which a browser may send on a same-origin POST
under the site's `Referrer-Policy: no-referrer`, accepted only together with `Sec-Fetch-Site: same-origin`). A plain
`fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })` does this.

| Field | Rule |
|---|---|
| `purpose` | Required. `"report"`, `"help"` or `"feedback"`. |
| `message` | Required. 1 to 4000 characters as JavaScript counts them (`length`, the same unit as `maxlength`), not only whitespace. Tabs and newlines are fine; other control characters are not. |
| `email` | Optional reply address, at most 254 characters, a plain ASCII address (`name@example.com`). **Omit the key** when the field is empty: `""` and `null` are rejected. |
| `groupId` | For `report`, required: the 43-character base64url group id (below). For `help` and `feedback`, must be absent. |
| `server` | For `report`, required: the server's https origin exactly as in the invite, host only (`https://sync.even.appalaya.com`): lowercase, no path, no trailing slash, a port only if it is not 443. For `help` and `feedback`, must be absent. |
| `turnstileToken` | Required. The widget's token, at most 2048 characters. |

Any other key is rejected.

| Status | Body | What the page does |
|---|---|---|
| 202 | `{"ok":true}` | Show that the message was sent. |
| 400 | `{"ok":false,"error":"invalid","field":"<name>"}` | `field` is one of the keys above, or `body` for malformed JSON or an unknown key. The page's own checks should make this unreachable. |
| 403 | `{"ok":false,"error":"turnstile_failed"}` | The token was rejected, expired or already used: reset the widget and let the visitor send again. |
| 403 | `{"ok":false,"error":"forbidden"}` | Not a same-origin request (a page bug). |
| 405, 413, 415 | `method_not_allowed`, `too_large`, `unsupported_media_type` | Page bugs. |
| 429 | `{"ok":false,"error":"rate_limited"}`, header `Retry-After: 60` | One message a minute per IP: ask the visitor to wait a minute. |
| 502 | `{"ok":false,"error":"send_failed"}` | The email could not be sent; try again later. |
| 503 | `{"ok":false,"error":"unavailable"}` | Turnstile could not be reached or the Worker is misconfigured; try again later. |
| 500 | `{"ok":false,"error":"internal"}` | Unexpected; try again later. |

Turnstile: render the widget with the `turnstileSiteKey` and `turnstileAction` from the config route (explicit
rendering, `turnstile.render(element, { sitekey, action })`); the Worker rejects a token whose action is not
`contact` or whose hostname is not `even.appalaya.com`. A token is valid once and for five minutes, so reset the
widget (`turnstile.reset(widgetId)`) after every POST, whatever the answer. The limit is counted only after a token
passes, so a failed or expired challenge never costs the visitor their one message a minute.

The page's CSP and `scripts/check.mjs` need changes that belong with the page: Turnstile needs
`script-src https://challenges.cloudflare.com` and `frame-src https://challenges.cloudflare.com`, and the POST needs
`connect-src 'self'` (the site-wide `default-src 'self'` already allows it). `check.mjs` today rejects any external
URL outside its allow-list, inline code on any page but `/i`, and every `<form>` element, so the page either submits
with `fetch` from a script file without a `<form>` or the check is changed with it.

**The group id for a report** is derived in the browser from the invite, so the group's secret never leaves the
page (even-server `PROTOCOL.md` §2 and §8): with `secret` the invite's `k` decoded from base64url (32 bytes) and
`server` its `s`,

```text
authToken = HKDF-SHA256(ikm = secret, salt = "even/v1", info = "auth|" + server, length = 32 bytes)
groupId   = base64url(SHA-256(authToken)), without padding: 43 characters
```

In WebCrypto: `importKey('raw', secret, 'HKDF', false, ['deriveBits'])`, then
`deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: utf8('even/v1'), info: utf8('auth|' + server) }, key, 256)`, then
`digest('SHA-256', bits)`. Send `server` as the invite has it. An invite for a self-hosted server whose URL has a path
(`PROTOCOL.md` §8.1 allows `https://host/even`) cannot be reported through this form: the API takes an origin only.

The email for a report has the subject `Even report: <groupId>` and the group id and the server each on a line of
its own, ready for the takedown in even-server `worker/README.md`, "Takedown (blocklist)". Help and feedback arrive
as `Even support` and `Even feedback`. When the visitor gave an address it is the email's Reply-To.

### Where the site key comes from

The Worker serves it: `GET /api/contact/config` returns the `TURNSTILE_SITE_KEY` variable that the deploy passes to
the Worker. The page fetches it on load and renders the widget with it. The alternative, writing the key into the
page at deploy time, would make the published page differ from the repository, and this site has no build step and
checks its pages (and hashes the invite page's code) exactly as they are in git. The cost is one Worker request per
view of the contact page.

### Secrets and variables

None of these values is in the repository. The deploy workflow reads each from the GitHub Actions secret of the same
name (repository → Settings → Secrets and variables → Actions) and fails, naming what is missing, if any is empty.

| Name | On the Worker | Value |
|---|---|---|
| `CONTACT_TO_REPORT` | Secret | The abuse mailbox: where reports go |
| `CONTACT_TO_HELP` | Secret | The support mailbox: where help requests go |
| `CONTACT_TO_FEEDBACK` | Secret | Where feedback goes (the support mailbox again is fine) |
| `CONTACT_FROM` | Secret | The sender, an address on a domain onboarded to Email Service (below), for example a no-reply address on appalaya.com. It need not be a mailbox; replies go to the visitor. |
| `TURNSTILE_SECRET_KEY` | Secret | The Turnstile widget's secret key |
| `TURNSTILE_SITE_KEY` | Variable (plain text, visible in the dashboard) | The Turnstile widget's site key. Public by nature, so it may be a repository **variable** (Variables tab) instead of a secret. |
| `SITE_ORIGIN` | Variable | `https://even.appalaya.com`, in `wrangler.jsonc` |

The workflow writes the five secrets to a JSON file only its job can read and passes it to
`wrangler deploy --secrets-file`, so they are uploaded with the version they belong to; the site key goes in with
`--var`. `wrangler.jsonc` lists the five under `secrets.required`, so no version can be deployed without them. The
deploy refuses Cloudflare's published Turnstile test keys. To change a value, change the GitHub secret and run the
workflow on main. A deploy never deletes a secret; one no longer used is removed in the dashboard (`even-web` →
Settings → Variables and Secrets).

### Once: Email Service for appalaya.com

Before the form can deliver anything. Until then submissions answer `502 send_failed` and the Worker logs Email
Service's error code (for example `E_SENDER_NOT_VERIFIED`).

1. Cloudflare dashboard → **Compute** → **Email Service** → **Email Sending** → **Onboard Domain** → choose
   `appalaya.com` → review the records → **Done**. Cloudflare adds and locks:

   | Name | Type | Value |
   |---|---|---|
   | `cf-bounce.appalaya.com` | MX ×3 | `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` |
   | `cf-bounce.appalaya.com` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
   | `cf-bounce._domainkey.appalaya.com` | TXT | `v=DKIM1; h=sha256; k=rsa; p=…` (its key) |
   | `_dmarc.appalaya.com` | TXT | `v=DMARC1; p=reject;` |

2. **SPF: merge, never replace.** Zoho's record at `appalaya.com` itself, `v=spf1 include:zoho.com ~all`, must stay
   exactly one record. Email Sending does not touch it: its SPF record is on `cf-bounce.appalaya.com`, a name with
   no record today. If anything ever offers to write an SPF record at `appalaya.com` (Email Routing does), edit
   Zoho's record to `v=spf1 include:zoho.com include:_spf.mx.cloudflare.net ~all` instead of adding a second one;
   two `v=spf1` records make SPF fail for all mail from the domain.
3. **DMARC: keep one.** `appalaya.com` already has `_dmarc` = `v=DMARC1; p=quarantine`, and a domain may have only
   one DMARC record. After onboarding, open **DNS** → **Records** and search `_dmarc`. If there are two TXT records,
   delete Cloudflare's `p=reject` one. If the dashboard shows it as locked, delete the older `p=quarantine` one
   instead, but only after confirming in Zoho Mail's admin console that Zoho signs appalaya.com's mail with DKIM:
   `p=reject` applies to mail sent through Zoho too, and receivers reject any of it that fails alignment.
4. **Do not onboard `appalaya.com` to Email Routing.** Routing replaces the domain's MX records, and Zoho would stop
   receiving mail.
5. **Verify the three mailboxes.** **Email Service** → **Email Routing** → **Destination Addresses**: add each
   address you put in a `CONTACT_TO_*` secret, then open the verification email Cloudflare sends to it and select
   **Verify email address** (the mailboxes accept mail from anyone, so it arrives). Sends to verified destination
   addresses are free on every plan and count toward no quota. If the dashboard insists on onboarding a domain to
   Email Routing first, stop: see step 4.
6. Check: **Email Sending** → `appalaya.com` → **Settings** → **DNS records**; each shows Locked or Unlocked, and
   both mean configured.

What the docs say about plans (Email Service pricing and limits pages, read 2026-09-27):

- **Workers Free:** Email Sending to arbitrary recipients is not available. Sends to verified destination addresses
  are free on all plans and do not count toward the monthly quota or the daily sending limits. This form only ever
  sends to its three verified mailboxes, which is why step 5 matters. The docs do not say whether a Workers Free
  account can onboard a sending domain (step 1); if the dashboard does not allow it, the form needs Workers Paid.
- **Workers Paid:** 3,000 emails a month included, then $0.35 per 1,000.
- Daily sending limit: new accounts start with a conservative quota that grows automatically; no number is
  published.
- Per message: 50 recipients, a 998-character subject, 5 MiB in total (25 MiB to verified destination addresses),
  16 KB of custom headers. Per account: 200 destination addresses. Per zone: 30 domains across Email Routing and
  Email Sending.
- Workers Free itself: 100,000 Worker requests a day for the account, 10 ms of CPU and 50 subrequests per request.
  Past the daily limit, `/api/*` answers with Cloudflare's 429 page until the next day; static pages keep working.
- Turnstile Free: 20 widgets, 10 hostnames per widget, unlimited challenges and verifications.

### Once: the Turnstile widget

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. **Widget name**: `Even contact form`. **Hostname management**: add `even.appalaya.com` only (local testing uses
   Cloudflare's test keys, so neither `localhost` nor `127.0.0.1` belongs here). **Widget mode**: Managed.
   **Pre-clearance**: leave off.
3. **Create**, then copy both keys into GitHub (repository → Settings → Secrets and variables → Actions):
   - **Site Key** → Variables tab → New repository variable `TURNSTILE_SITE_KEY` (a secret of that name works too).
   - **Secret Key** → Secrets tab → New repository secret `TURNSTILE_SECRET_KEY`.
4. Run the workflow on main (or push). Neither key goes in any file; the page gets the site key from
   `/api/contact/config`.

### Trying the form locally

```bash
npx wrangler@4 dev --config web/wrangler.jsonc --port 4173 --persist-to .wrangler/state \
  --var SITE_ORIGIN:http://localhost:4173 \
  --var TURNSTILE_SITE_KEY:1x00000000000000000000AA \
  --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA \
  --var CONTACT_TO_REPORT:report@example.com --var CONTACT_TO_HELP:help@example.com \
  --var CONTACT_TO_FEEDBACK:feedback@example.com --var CONTACT_FROM:form@example.com
```

Open `http://localhost:4173` (not `127.0.0.1`: the page's `Origin` must equal `SITE_ORIGIN`). The two Turnstile
values are Cloudflare's published always-pass test keys; the Worker accepts a test key's answer only when
`SITE_ORIGIN` is a loopback address, and the deploy refuses them. Nothing is emailed: Wrangler simulates the email
binding, prints the sender, recipient and subject, and writes the text under `web/.wrangler/tmp/email/` (ignored by
git and by the upload). The rate limiter is simulated too, so a second message within a minute gets 429.

## Placeholders to fill before launch

`node web/scripts/check.mjs` prints each one with its file and line.

| What | Where | How |
|---|---|---|
| Store badge artwork | `index.html`, `i.html` | The badges are text stand-ins. Download Apple's "Download on the App Store" and Google's "Get it on Google Play" artwork, save it in this folder (for example `badges/`), and use `<img src="/badges/…" alt="…">`. Local images are allowed by every CSP here (`img-src 'self'`); a remote one is not. |
| Abuse and support mailboxes | `abuse.html`, `privacy.html`, `index.html` | Done: the abuse and support mailboxes are Zoho distribution lists that accept mail from anyone. |

The "Run your own server" link points at `https://github.com/appalaya/even-server`, which is private today; it
returns 404 to the public until the repository is opened.
