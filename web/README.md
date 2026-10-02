# web — even.appalaya.com

The static landing site: the universal-link and App Links association files, the invite page at `/i`, the
product page, the contact page, and the privacy, terms and abuse pages. Plain HTML and CSS, one inline script on one
page (`/i`), two script files on another (`/contact`), no build step and no framework. Nothing is loaded from outside
this site except Cloudflare Turnstile's bot check, on the contact page only. Deployed to Cloudflare by GitHub
Actions, as a Worker with static assets plus a small Worker script that answers only the contact form's API under
`/api/` (see [Deploying](#deploying), [Contact page](#contact-page) and [Contact form](#contact-form)).

| URL | File | Notes |
|---|---|---|
| `/` | `index.html` | Product page |
| `/i` | `i.html` | Invite page. Reads the invite from the URL fragment, never sends it. Strict CSP. |
| `/contact` | `contact.html`, `contact.js`, `contact-lib.js` | Report a group, get help, send feedback. The only form, the only script files, and the only page that loads Turnstile. See [Contact page](#contact-page). |
| `/privacy`, `/terms`, `/abuse` | `privacy.html`, `terms.html`, `abuse.html` | The privacy page is [`even-server/THREAT-MODEL.md`](https://github.com/appalaya/even-server/blob/main/THREAT-MODEL.md) in plain words; keep them in step. |
| any unknown path | `404.html` | Served with status 404 (`not_found_handling: "404-page"` in `wrangler.jsonc`). |
| `/api/contact`, `/api/contact/config` | `worker/` | The contact form's API, the only code that runs on Cloudflare. See [Contact form](#contact-form). |
| `/.well-known/apple-app-site-association` | same | iOS universal links for `/i` and `/i/*` |
| `/.well-known/assetlinks.json` | same | Android App Links |
| | `site.css`, `favicon.svg` | Shared by every page except `/i`, which has its own inline style |
| | `badges/` | Apple's and Google's store badges, unmodified. See [Store badges](#store-badges). |
| | `_headers` | Response headers, including every CSP. Read by Cloudflare as configuration, not served. |
| | `wrangler.jsonc`, `.assetsignore` | Deploy configuration and the list of files kept out of the upload. Not served. |
| | `worker/` | The Worker script's TypeScript source and its tests. Bundled into the script, not served. |
| | `contact-lib.test.ts`, `vitest.config.mts` | The contact page's test and its Vitest config. Not served. |

Colours are the app's `even` theme (`src/theme/themes.ts`) and the mark is `src/components/Mark.tsx`'s paths; change
them there first.

Everything in this folder is published except what `.assetsignore` lists: this README, `scripts/`, `worker/`,
`wrangler.jsonc`, `vitest.config.mts` and the `*.test.ts` files. They contain nothing private; the repository is public anyway. No email address or key is in any
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

`check.mjs` also fails on any external URL in any page other than the two store links, the repository and threat-model
links, appalaya.com, and the Stripe tip link (Turnstile's script is in no page's markup: `contact.js` adds it, the one script file allowed to); on any mail address or `mailto:` in any published file; on inline
code in any other page; on a `<form>`, a `<script src>` or a script file anywhere but the contact page (see
[Contact page](#contact-page)); on a `_headers` file missing a required header, with the `/i`, `/badges/*` or
`/contact` rules before `/*`, or with a policy that differs from what `csp-hashes.mjs` generates; and on either
association file not parsing or not naming the app. It lists every `PLACEHOLDER` left.

## Local preview

```bash
# Cloudflare's asset server and the Worker script, locally: _headers, /i, 404, /api/*
npx wrangler@4.146.0 dev --config web/wrangler.jsonc --port 4173 --persist-to .wrangler/state
```

It needs no Cloudflare account and deploys nothing. `--persist-to` keeps Wrangler's local state out of `web/`:
Wrangler watches the whole assets folder, and state written inside it restarts the server in a loop. Without the
contact form's variables (see [Trying the form locally](#trying-the-form-locally)) Wrangler warns that the required
secrets are missing and `/api/contact` answers 503; the pages are unaffected. `npx serve web` also works for a quick
look, but it ignores `_headers`, so it does not enforce the CSP, and it has no `/api/`.

## Deploying

`.github/workflows/web.yml` is the only way the site is deployed; nothing is deployed from a local machine. On every
push to main that changes `web/` or the workflow, it runs `node web/scripts/check.mjs`, the Worker script's
typecheck, lint and tests, and then `wrangler deploy` with `web/wrangler.jsonc`, at the exact Wrangler version the
workflow names (its actions are pinned by commit too; `worker/config.test.ts` fails on a range or a tag). That
uploads this folder as the
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
| `CONTACT_TO_REPORT`, `CONTACT_TO_HELP`, `CONTACT_TO_FEEDBACK`, `CONTACT_FROM`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` | The contact form; see [Contact form](#contact-form), "Secrets and variables" |

Until the first two exist, a deploy run fails at the Deploy step with a message naming them; until the contact
form's seven exist, it fails there with a message naming the missing ones.

### API token permissions

| Permission | What the deploy uses it for |
|---|---|
| Account → **Workers Scripts** → Write (called Edit in some Cloudflare screens and docs) | Create the `even-web` Worker on the first run, upload the assets, deploy each version with its script and secrets, and keep its `workers.dev` and Preview URLs off |

That is the whole list. The deploy needs no zone, DNS, Workers Routes, KV or Account Settings permission: the
account ID comes from the secret, and nothing is routed or attached by the deploy. The rate-limit binding and the
secrets need nothing more either: Cloudflare's Workers permissions docs say deploying a Worker's bindings and
managing its secrets need only edit access to that Worker. A token that also has Workers KV Storage
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
proxied hostnames), Zaraz, Email Address Obfuscation (no page names an address, but it still rewrites HTML), and Bot
Fight Mode's JavaScript detections.

### DNS

| Name | Type | Target | |
|---|---|---|---|
| `even` | Worker Custom Domain | the `even-web` Worker | Created by the one-time step above; no manual record |
| `sync.even` | Worker Custom Domain | the even-server Worker | Set up from the even-server repository; out of scope here |
| `bounces.send` (MX, TXT SPF), `resend._domainkey.send` (TXT DKIM) | Resend | Resend's return path and key for `send.appalaya.com` | Set up for the company site's contact form, which Even's shares ([Contact form](#once-resend-and-turnstile)); leave as they are |
| `@` (MX, TXT SPF), `_dmarc` (TXT) | Zoho Mail | Zoho | Mail for appalaya.com itself. The form does not touch them |

### Check after the first deploy

```bash
# The invite page's policy is the strict one, and only one
curl -sI https://even.appalaya.com/i | grep -i content-security-policy

# 200, content-type: application/json, the JSON itself, and no redirect (Apple does not follow redirects for the AASA)
curl -si https://even.appalaya.com/.well-known/apple-app-site-association

# Android App Links: 200, application/json, the statement list
curl -si https://even.appalaya.com/.well-known/assetlinks.json

# The tooling is not published: 404 for each
for f in README.md wrangler.jsonc scripts/check.mjs worker/index.ts contact-lib.test.ts vitest.config.mts; do curl -s -o /dev/null -w "%{http_code} /$f\n" "https://even.appalaya.com/$f"; done

# The contact page: its own policy (Turnstile allowed), and only one
curl -sI https://even.appalaya.com/contact | grep -i content-security-policy

# Every page: Cross-Origin-Opener-Policy: same-origin
curl -sI https://even.appalaya.com/ | grep -i cross-origin-opener-policy

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

The contact page ([Contact page](#contact-page)) posts to the Worker script in `worker/`. For each submission the script checks
the request, verifies the Turnstile token with Cloudflare, applies a per-IP limit, and sends one plain-text email to
the mailbox for the form's purpose through Resend's HTTP API, from the same verified sending domain and with the
same Turnstile widget as the company site's contact form (appalaya.com). Nothing is stored. Its log lines carry the
route, the purpose and the outcome, never the message, an address, a group id, a token or an IP (even-server
`THREAT-MODEL.md`, "What we log", applies here too), and Cloudflare's invocation logs, traces and Logpush are off in
`wrangler.jsonc`.

| File | |
|---|---|
| `worker/index.ts` | Entry point: `/api/contact`, `/api/contact/config`, 404 for other `/api/` paths, everything else to the assets |
| `worker/contact.ts` | The two routes: origin, size, Turnstile, rate limit, send |
| `worker/validate.ts` | The request body's rules |
| `worker/message.ts`, `worker/resend.ts` | The email, and sending it through Resend |
| `worker/env.ts`, `worker/http.ts` | Bindings and secrets; JSON responses, logging, the rate-limit key |
| `worker/*.test.ts` | Vitest, run from the repository root (`npx vitest run web/worker`) with the bindings, siteverify and Resend stubbed; `config.test.ts` also checks that `wrangler.jsonc`, the workflow and the code agree and hold no address or key |

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

The page's CSP (`script-src` and `frame-src` for `https://challenges.cloudflare.com`, `connect-src 'self'`) and the
matching rules in `scripts/check.mjs` are described under [Contact page](#contact-page).

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
| `CONTACT_FROM` | Secret | The sender: the same address on `send.appalaya.com` the company site sends from, already verified in Resend. A bare address; the Worker sends as `Even <address>`. It need not be a mailbox; replies go to the visitor. |
| `RESEND_API_KEY` | Secret | A Resend API key that may send (below) |
| `TURNSTILE_SECRET_KEY` | Secret | The shared Turnstile widget's secret key |
| `TURNSTILE_SITE_KEY` | Variable (plain text, visible in the dashboard) | The shared Turnstile widget's site key. Public by nature, so it may be a repository **variable** (Variables tab) instead of a secret. |
| `SITE_ORIGIN` | Variable | `https://even.appalaya.com`, in `wrangler.jsonc` |

The workflow writes the six secrets to a JSON file only its job can read and passes it to
`wrangler deploy --secrets-file`, so they are uploaded with the version they belong to; the site key goes in with
`--var`. `wrangler.jsonc` lists the six under `secrets.required`, so no version can be deployed without them. The
deploy refuses Cloudflare's published Turnstile test keys. To change a value, change the GitHub secret and run the
workflow on main. A deploy never deletes a secret; one no longer used is removed in the dashboard (`even-web` →
Settings → Variables and Secrets).

### Once: Resend and Turnstile

Even sends the way the company site's contact form already does, so nothing new is set up at Resend or in DNS. The
Resend sending domain is `send.appalaya.com`: its records (MX and SPF on `bounces.send.appalaya.com`, DKIM at
`resend._domainkey.send.appalaya.com`) all sit under the `send` subdomain, so the Zoho mail for appalaya.com itself
is untouched (the company site's repository, README, "One-time Cloudflare setup", item 3). Until the secrets below
exist the deploy stops; if one is wrong, submissions answer `502 send_failed` and the Worker logs Resend's status
and error name (for example `resend_403,validation_error`).

1. **Sender.** Set `CONTACT_FROM` to the address the company site sends from, on `send.appalaya.com`. Its exact
   value is in the owner's secrets, never in this repository.
2. **Resend API key.** Use the company site's existing key, or create one for Even: Resend → **API Keys** →
   **Create API Key**, permission **Sending access**, domain `send.appalaya.com`. Store it as the repository secret
   `RESEND_API_KEY`. A separate key can be revoked without touching the company site.
3. **Mailboxes.** Set `CONTACT_TO_REPORT`, `CONTACT_TO_HELP` and `CONTACT_TO_FEEDBACK` to the abuse, support and
   feedback mailboxes. Resend needs nothing for recipients.
4. **Turnstile.** Reuse the company site's widget; it only needs this hostname. Cloudflare dashboard →
   **Turnstile** → the company site's widget → **Settings** → **Hostname management** → add `even.appalaya.com` →
   **Save**. Then copy its keys into this repository (Settings → Secrets and variables → Actions): the **Site Key**
   as the repository variable `TURNSTILE_SITE_KEY` (Variables tab; a secret of that name works too) and the **Secret
   Key** as the repository secret `TURNSTILE_SECRET_KEY`. The Worker still requires the action `contact` and the
   hostname `even.appalaya.com`: siteverify reports the action the page rendered the widget with and the hostname it
   was served on, so sharing the widget with the company site does not let its tokens through here.
5. Run the workflow on main (or push). No address or key goes in any file; the page gets the site key from
   `/api/contact/config`.

Plan limits (read 2026-09-27):

- **Resend Free** (resend.com/pricing): 3,000 emails a month and 100 a day, 3 domains, 30 days of data retention,
  no overage. The quota is shared with the company site's contact form, since both send from the same Resend
  account. Past it, Resend answers `429 daily_quota_exceeded` or `monthly_quota_exceeded` and the form answers
  `502 send_failed` until the quota resets. The API allows 10 requests a second per team (Resend API reference).
  Resend Pro is $20 a month for 50,000 emails.
- **Workers Free:** 100,000 Worker requests a day for the account, 10 ms of CPU and 50 subrequests per request (this
  script makes two: siteverify and Resend). Past the daily limit, `/api/*` answers with Cloudflare's 429 page until
  the next day; static pages keep working.
- **Turnstile Free:** 20 widgets, 10 hostnames per widget (the shared widget gains one), unlimited challenges and
  verifications.

### Trying the form locally

```bash
npx wrangler@4.146.0 dev --config web/wrangler.jsonc --port 4173 --persist-to .wrangler/state \
  --var SITE_ORIGIN:http://localhost:4173 \
  --var TURNSTILE_SITE_KEY:1x00000000000000000000AA \
  --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA \
  --var CONTACT_TO_REPORT:report@example.com --var CONTACT_TO_HELP:help@example.com \
  --var CONTACT_TO_FEEDBACK:feedback@example.com --var CONTACT_FROM:form@example.com \
  --var RESEND_API_KEY:placeholder
```

Open `http://localhost:4173` (not `127.0.0.1`: the page's `Origin` must equal `SITE_ORIGIN`). The two Turnstile
values are Cloudflare's published always-pass test keys; the Worker accepts a test key's answer only when
`SITE_ORIGIN` is a loopback address, and the deploy refuses them. The placeholder Resend key makes a valid message
go through every step and then reach Resend, which refuses it: the answer is `502 send_failed` and Wrangler's
output shows `"detail":"resend_401,validation_error"`. Nothing is emailed. To send for real from your machine, use a
real key and your own mailbox as `CONTACT_TO_*`, typed in with `read -rs RESEND_API_KEY` and passed as
`--var "RESEND_API_KEY:$RESEND_API_KEY"` so the key stays out of shell history. The rate limiter is simulated
locally, so a second message within a minute gets 429.

## Contact page

`/contact` (`contact.html`) is drawn on the design canvas as "Website: contact page" (`ContactWeb`, `ContactWebDark`,
`ContactWebDesktop`, `ContactWebDesktopDark`), its link field and bot check states (`ContactStates`,
`ContactStatesDark`) and, as opened from the app, `ReportInBrowser`. Three topics: **Report a
group** (an invite link, a reason, optional details), **Get help** and **Send feedback** (a message), each with an
optional email, Cloudflare Turnstile, and a Send button. It replaces every mailbox the site used to name: no page
carries an address, and `check.mjs` fails on one. Without JavaScript the page says it needs it; the form is hidden.

| File | |
|---|---|
| `contact.html` | The markup. No inline code and one script, `<script type="module" src="/contact.js">`. Styles are in `site.css`. |
| `contact.js` | The page: topics, the pasted link, the fragment, Turnstile (it adds `api.js?render=explicit` from the exact URL Cloudflare requires, and only then), the POST, the sent and failed states. Inserts text with `textContent` only. |
| `contact-lib.js` | No DOM, no dependencies: reads an invite exactly as `@even/core`'s `decodeInvite` does (a port of its base64url, `canonicalOrigin` and checksum), derives the group id with WebCrypto, reads the fragment, builds the request body and maps the API's answer. |
| `contact-lib.test.ts` | Vitest: the id against `@even/core`'s known answers and its `deriveServer`/`groupIdForToken` for random secrets and servers, `canonicalOrigin` and invite reading against core on fixed and generated inputs, and every body against the Worker's `validateContact`. |

**The report never sends the invite.** The page takes the pasted link out of the field the moment it is pasted
(`takeInvite` empties the field before anything is awaited), derives
`groupId = base64url(SHA-256(HKDF-SHA256(secret, "even/v1", "auth|" + server)))` (even-server `PROTOCOL.md` §2) and
keeps and sends only that id and the server. The line under the field says so: "We'll receive the group id ab12…u7Qx on
sync.even.appalaya.com, never its key or contents." For a group on another server it reads "This group is on
<host>. We can't act on it, but we'll read your report." A server URL with a path (`https://host/even`) cannot be
reported through the form, because the API takes an origin only; the page says so and does not send.

**Turnstile loads only once no invite can be on the page.** Its `api.js` runs in the page with the page's own
access, so `contact.js` adds it only when a report names a group it can send (from the app's fragment, or from a
pasted link already read and cleared), or when a help or feedback message is typed or sent. From then on the link
field is disabled, empty, in `--fill` with `--muted` text (`site.css`, `.input:disabled`), and its hint reads "To use a
different link, reload this page."; a send without a group says the same.
Before that point nothing from Cloudflare is on the page. even-server `THREAT-MODEL.md` names Turnstile as a trusted
component.

**The app opens the page with a fragment**, which a browser never sends: `#purpose=help`, `#purpose=feedback`, or
`#purpose=report&id=<groupId>&server=<canonical server URL>` (percent-encoded, as `URLSearchParams` reads it). A
report fragment preselects Report a group and shows the id and server read-only ("Filled in by the Even app") in
place of the link field. With no fragment, Report a group is selected, as on the desktop board.

**What each answer shows.** 202: "Report sent" or "Message sent". 403 `turnstile_failed`, or no token yet: "The bot
check didn't finish. Try it again." 429: "Couldn't send. Try again in a minute." Any other answer (503, 502, 500, a
page bug): "Couldn't send. The form isn't available right now; try again later." No answer: "Couldn't send. Check
your connection and try again." Everything typed stays, and the widget is reset after every POST. A pasted link
that the app would not accept reads "That link isn't complete. Copy it again." ("This invite needs a newer Even."
for a newer invite version), as the app words a bad code.

**CSP.** `_headers` gives `/contact` its own policy, written by `scripts/csp-hashes.mjs` from `contact.html` (which
refuses to write it if inline code appears; put code in `contact.js`):

```text
default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com;
connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`form-action 'none'` means the form can never submit natively; `contact.js` sends it with `fetch`. `check.mjs`
allows a `<form>` and a `<script src>` on `contact.html` and nowhere else, requires exactly the one script above,
allows no other `.js` file in the site, and checks both script files: they import only each other, `fetch` only
`/api/contact` and `/api/contact/config`, and contain nothing that could inject, store, log, open a window or run
text as code. The one exception is Turnstile: `contact.js` may create one `<script>`, whose only `src` is its
`TURNSTILE_URL` constant, which must be Cloudflare's exact URL. It also loads `contact-lib.js` and checks it against `@even/core`'s known-answer group
ids (`packages/core/src/keys.test.ts`), so CI checks the derivation even though the root Vitest config does not
include this folder's test.

```bash
node web/scripts/csp-hashes.mjs                     # after editing contact.html or i.html
node web/scripts/check.mjs                          # must pass
npx vitest run --config web/vitest.config.mts       # contact-lib.js against @even/core and the Worker's rules
```

**Try it locally** with [Trying the form locally](#trying-the-form-locally) and open
`http://localhost:4173/contact`. Cloudflare's test site key renders a widget marked "For testing only" that always
passes. With the placeholder Resend key, a send goes through validation, Turnstile and the rate limit and then gets
`502 send_failed` from Resend, which the page shows as "Couldn't send. The form isn't available right now; try again
later."; a second send within a minute gets 429. The sent state needs a real key.

The site-wide `Referrer-Policy: no-referrer` applies to `/contact` too. Turnstile's documentation lists only
`script-src` and `frame-src` for the embedding page, and the test key does not check hostnames, so the first real
deploy is where a hostname problem would show: if the widget reports error 110200 ("domain not authorized") while
`even.appalaya.com` is in the widget's Hostname management, try `Referrer-Policy: strict-origin` on `/contact` (add
`! Referrer-Policy` and the new value to its rule; only the site's origin would be sent, to Cloudflare, which serves
the site anyway).

## Store badges

`badges/app-store.svg` and `badges/google-play.svg` are the official artwork, byte for byte, used on `/` and `/i`
with the alt text "Download on the App Store" and "Get it on Google Play".

- **Apple**: the black "Download on the App Store" badge, US English, from Apple's badge service
  (`https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us`, the source behind the
  App Store Marketing Tools at `https://toolbox.marketingtools.apple.com/app-store/`), under the App Store Marketing
  Guidelines (`https://developer.apple.com/app-store/marketing/guidelines/`): at least 40 px tall on screen, clear
  space of a quarter of the badge's height, never modified, the black badge whenever another store's badge is shown,
  and the App Store badge first. Apple's badges are for apps available on the App Store (the pre-order badge is for
  an app in pre-order), so **do not publicise the site before Even is live on the App Store**. The guidelines ask for
  Apple's credit line wherever legal information is given; it is at the end of `terms.html`.
- **Google**: "Get it on Google Play", English, the SVG from the badge package on Google's Partner Marketing Hub
  (`https://partnermarketinghub.withgoogle.com/brands/google-play/google-play/lockups-icons-badges/`, where
  `https://play.google.com/intl/en_us/badges/` now redirects; the package's
  `Get it on Google Play Badges/Digital/svg/GetItOnGooglePlay_Badge_Web_color_English.svg`). Its guidelines: at least
  28 px tall, clear space of a quarter of its height, never modified, and the same size as or larger than the other
  stores' badges.

Both files are the badge edge to edge, with no padding of their own (the older 646 × 250 Google PNG had padding
built in; this artwork does not), so the same CSS height gives boxes of the same height: 48 px, 12 px apart,
aligned at the top. The SVGs colour themselves with an inline `<style>` and `style` attributes, so `/badges/*` has
its own policy in `_headers`, `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`: WebKit
refuses those styles under the site-wide policy when a badge is opened directly. Replace a badge only with a newer
download from the same place, unmodified.

## Placeholders

`node web/scripts/check.mjs` prints any `PLACEHOLDER` left in the site with its file and line. There are none now.

The "Run your own server" link points at `https://github.com/appalaya/even-server`, which is private today; it
returns 404 to the public until the repository is opened.
