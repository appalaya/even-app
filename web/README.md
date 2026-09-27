# web — even.appalaya.com

The static landing site: the universal-link and App Links association files, the invite page at `/i`, the
product page, and the privacy, terms and abuse pages. Plain HTML and CSS, one inline script on one page, no build
step, no framework, and no request to anything outside this site. Deployed on Cloudflare Pages.

| URL | File | Notes |
|---|---|---|
| `/` | `index.html` | Product page |
| `/i` | `i.html` | Invite page. Reads the invite from the URL fragment, never sends it. Strict CSP. |
| `/privacy`, `/terms`, `/abuse` | `privacy.html`, `terms.html`, `abuse.html` | The privacy page is `../even-server/THREAT-MODEL.md` in plain words; keep them in step. |
| any unknown path | `404.html` | Without it, Pages would serve `index.html` with 200 for every path. |
| `/.well-known/apple-app-site-association` | same | iOS universal links for `/i` and `/i/*` |
| `/.well-known/assetlinks.json` | same | Android App Links |
| | `site.css`, `favicon.svg` | Shared by every page except `/i`, which has its own inline style |
| | `_headers` | Response headers, including every CSP |

Colours are the app's `even` theme (`src/theme/themes.ts`) and the mark is `src/components/Mark.tsx`'s paths; change
them there first.

Everything in this folder is published, including this README and `scripts/`. They contain nothing private.

## Why `i.html` and not `i/index.html`

Pages serves `x.html` at `/x` with 200 and redirects `/x/` and `/x.html` to `/x` (308). A folder's `x/index.html` is
the other way round: 200 at `/x/`, with `/x` redirected. Invite links are `https://even.appalaya.com/i#<code>`, so
`i.html` answers them directly. `/i/#<code>` still works: browsers carry the fragment across a redirect whose
`Location` has none, and the AASA covers `/i/*` as well. No `_redirects` file is needed.

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
npx wrangler pages dev web --port 4173   # Cloudflare's own asset server: applies _headers and Pages routing
```

`npx serve web` also works for a quick look, but it ignores `_headers`, so it does not enforce the CSP.

## Deploy on Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → connect this repository.
   Production branch `main`, framework preset **None**, build command **empty**, build output directory **`web`**.
   (Or upload directly: `npx wrangler pages deploy web --project-name <project>`.)
2. Project → Custom domains → add `even.appalaya.com`.
3. Zone settings for `appalaya.com`: keep **off** everything that injects scripts or rewrites HTML, since it would
   either break the hashes or add a script the invite page must not run: Rocket Loader, Web Analytics (also the
   Pages project's own Web Analytics toggle), Zaraz, Email Address Obfuscation (the pages also wrap the address in
   `<!--email_off-->`), and Bot Fight Mode's JavaScript detections.

### DNS

| Name | Type | Target | |
|---|---|---|---|
| `even` | CNAME, proxied | `<project>.pages.dev` | Created for you when the custom domain is added in step 2 |
| `sync.even` | Worker custom domain | the even-server Worker | Set up from the even-server repository; out of scope here |

## Placeholders to fill before launch

`node web/scripts/check.mjs` prints each one with its file and line.

| What | Where | How |
|---|---|---|
| App Store id | `index.html`, `i.html` (`idPLACEHOLDER`) | App Store Connect → the app → App Information → Apple ID. The link becomes `https://apps.apple.com/app/id<number>`. |
| Store badge artwork | `index.html`, `i.html` | The badges are text stand-ins. Download Apple's "Download on the App Store" and Google's "Get it on Google Play" artwork, save it in this folder (for example `badges/`), and use `<img src="/badges/…" alt="…">`. Local images are allowed by every CSP here (`img-src 'self'`); a remote one is not. |
| Play App Signing SHA-256 | `.well-known/assetlinks.json` | Play Console → the app → Test and release → App integrity → App signing → **App signing key certificate** → SHA-256 fingerprint (uppercase, colon-separated). Use the app signing key, not the upload key. To also verify builds you sign yourself with the upload key, add its fingerprint as a second entry. |
| Abuse mailbox | `abuse.html`, `privacy.html` | Confirm `abuse@appalaya.com` exists and is read, or change it on both pages and in `scripts/check.mjs` (`ALLOWED_EXTERNAL`). |

The "Run your own server" link points at `https://github.com/appalaya/even-server`, which is private today; it
returns 404 to the public until the repository is opened.

## Verify after deploying

```bash
# 200, content-type application/json, and no redirect (Apple does not follow redirects for the AASA)
curl -I https://even.appalaya.com/.well-known/apple-app-site-association

# What Apple's CDN has cached; devices fetch from here, not from the site. It can lag the site by hours.
curl -s https://app-site-association.cdn-apple.com/a/v1/even.appalaya.com

# Android: Google's view of the statement, then the device's
curl -s 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://even.appalaya.com&relation=delegate_permission/common.handle_all_urls'
adb shell pm verify-app-links --re-verify com.appalaya.even && adb shell pm get-app-links com.appalaya.even

# The invite page's policy is the strict one, and only one
curl -sI https://even.appalaya.com/i | grep -i content-security-policy
```

For a development build on iOS, `applinks:even.appalaya.com?mode=developer` in the entitlements makes the device
fetch the AASA from the site directly instead of the CDN (Settings → Developer → Associated Domains Development).
Test universal links on a real device; the simulator is unreliable for them.
