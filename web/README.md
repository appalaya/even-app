# web — even.appalaya.com

The static landing site: the universal-link and App Links association files, the invite page at `/i`, the
product page, and the privacy, terms and abuse pages. Plain HTML and CSS, one inline script on one page, no build
step, no framework, and no request to anything outside this site. Deployed to Cloudflare by GitHub Actions, as a
Worker with static assets and no Worker script (see [Deploying](#deploying)).

| URL | File | Notes |
|---|---|---|
| `/` | `index.html` | Product page |
| `/i` | `i.html` | Invite page. Reads the invite from the URL fragment, never sends it. Strict CSP. |
| `/privacy`, `/terms`, `/abuse` | `privacy.html`, `terms.html`, `abuse.html` | The privacy page is [`even-server/THREAT-MODEL.md`](https://github.com/appalaya/even-server/blob/main/THREAT-MODEL.md) in plain words; keep them in step. |
| any unknown path | `404.html` | Served with status 404 (`not_found_handling: "404-page"` in `wrangler.jsonc`). |
| `/.well-known/apple-app-site-association` | same | iOS universal links for `/i` and `/i/*` |
| `/.well-known/assetlinks.json` | same | Android App Links |
| | `site.css`, `favicon.svg` | Shared by every page except `/i`, which has its own inline style |
| | `_headers` | Response headers, including every CSP. Read by Cloudflare as configuration, not served. |
| | `wrangler.jsonc`, `.assetsignore` | Deploy configuration and the list of files kept out of the upload. Not served. |

Colours are the app's `even` theme (`src/theme/themes.ts`) and the mark is `src/components/Mark.tsx`'s paths; change
them there first.

Everything in this folder is published except what `.assetsignore` lists: this README, `scripts/` and
`wrangler.jsonc`. They contain nothing private; the repository is public anyway.

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
npx wrangler@4 dev --config web/wrangler.jsonc --port 4173   # Cloudflare's asset server, locally: _headers, /i, 404
```

It needs no Cloudflare account and deploys nothing. `npx serve web` also works for a quick look, but it ignores
`_headers`, so it does not enforce the CSP.

## Deploying

`.github/workflows/web.yml` is the only way the site is deployed; nothing is deployed from a local machine. On every
push to main that changes `web/` or the workflow, it runs `node web/scripts/check.mjs` and then `wrangler deploy`
with `web/wrangler.jsonc`. That uploads this folder as the static assets of a Worker named `even-web`, on the free
Workers plan. There is no Worker script, so every request is a static-asset request, which is free and unlimited,
and Cloudflare's asset server applies `_headers`, serves `i.html` at `/i`, and answers unknown paths with `404.html`.
"Run workflow" on main deploys the same way; on any other branch it checks the site and does a dry run only. Pull
requests never run it.

The deploy never creates or changes DNS records, routes or domains. `wrangler.jsonc` has no `routes`, and
`workers_dev` and `preview_urls` are off, so the Worker has no public URL until the Custom Domain below is attached
once by hand; later deploys leave that domain in place.

### Secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account details → Account ID |
| `CLOUDFLARE_API_TOKEN` | An account API token with the permission below |

Until both exist, a deploy run fails at the Deploy step with a message naming them.

### API token permissions

| Permission | What the deploy uses it for |
|---|---|
| Account → **Workers Scripts** → Write (called Edit in some Cloudflare screens and docs) | Create the `even-web` Worker on the first run, upload the assets, deploy each version, and keep its `workers.dev` and Preview URLs off |

That is the whole list. The deploy needs no zone, DNS, Workers Routes, KV or Account Settings permission: the
account ID comes from the secret, and nothing is routed or attached by the deploy. A token that also has Workers KV
Storage Write, Account Settings Read and Workers Routes Write (all zones) works; those permissions go unused here.

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

### Check after the first deploy

```bash
# The invite page's policy is the strict one, and only one
curl -sI https://even.appalaya.com/i | grep -i content-security-policy

# 200, content-type: application/json, the JSON itself, and no redirect (Apple does not follow redirects for the AASA)
curl -si https://even.appalaya.com/.well-known/apple-app-site-association

# Android App Links: 200, application/json, the statement list
curl -si https://even.appalaya.com/.well-known/assetlinks.json

# The tooling is not published: 404 for each
for f in README.md wrangler.jsonc scripts/check.mjs; do curl -s -o /dev/null -w "%{http_code} /$f\n" "https://even.appalaya.com/$f"; done

# What Apple's CDN has cached; devices fetch from here, not from the site. It can lag the site by hours.
curl -s https://app-site-association.cdn-apple.com/a/v1/even.appalaya.com

# Android: Google's view of the statement, then the device's
curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://even.appalaya.com&relation=delegate_permission/common.handle_all_urls'
adb shell pm verify-app-links --re-verify com.appalaya.even && adb shell pm get-app-links com.appalaya.even
```

For a development build on iOS, `applinks:even.appalaya.com?mode=developer` in the entitlements makes the device
fetch the AASA from the site directly instead of the CDN (Settings → Developer → Associated Domains Development).
Test universal links on a real device; the simulator is unreliable for them.

## Placeholders to fill before launch

`node web/scripts/check.mjs` prints each one with its file and line.

| What | Where | How |
|---|---|---|
| Store badge artwork | `index.html`, `i.html` | The badges are text stand-ins. Download Apple's "Download on the App Store" and Google's "Get it on Google Play" artwork, save it in this folder (for example `badges/`), and use `<img src="/badges/…" alt="…">`. Local images are allowed by every CSP here (`img-src 'self'`); a remote one is not. |
| Play App Signing SHA-256 | `.well-known/assetlinks.json` | Play Console → the app → Test and release → App integrity → App signing → **App signing key certificate** → SHA-256 fingerprint (uppercase, colon-separated). Use the app signing key, not the upload key. To also verify builds you sign yourself with the upload key, add its fingerprint as a second entry. |
| Abuse and support mailboxes | `abuse.html`, `privacy.html`, `index.html` | Done: `abuse@appalaya.com` and `support@appalaya.com` are Zoho distribution lists that accept mail from anyone. |

The "Run your own server" link points at `https://github.com/appalaya/even-server`, which is private today; it
returns 404 to the public until the repository is opened.
