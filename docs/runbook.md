# Even operations runbook

What to do when a report, a support message, a server problem or a bad build arrives, written to be followed from a
phone. Each step gives the exact command or console path. Where the repositories don't record a console's menu
names, the step says "look under …". The reasons behind each procedure are in the documents it cites; this page is
only the procedure. Checked against both repositories on 2 October 2026.

**Rules that always hold**

- **Nothing is ever read or decrypted.** The server holds ciphertext and never has a key; there is nothing to read.
  Never ask anyone for an invite link, an invite code or a group file: each one is the group's key. If one arrives
  anyway, don't open it, delete the message, and tell the sender to regenerate the invite (2.3).
- **Nothing is built, uploaded or deployed from a laptop.** GitHub Actions does all of that: the iOS and Android
  builds, the website and the sync server. A SQL statement run against D1 (a takedown) is not a deploy. Run it from
  the dashboard or from Wrangler.
- **Appalaya Inc is the only name anyone sees.** Reply from a company mailbox and sign as Appalaya. Never reply from a
  personal address or under a personal name.
- **Mailboxes:** `abuse@appalaya.com`, `support@appalaya.com` and `info@appalaya.com` (Zoho Mail). Beyond internal
  pages like this one, they go only into console fields that require an email address. They never appear in the app
  or on the site ([store-listing.md](store-listing.md), "Mailboxes"). People reach them only through the contact form
  at `https://even.appalaya.com/contact`.

## 0. Where everything is

| What | Where |
|---|---|
| Sync server | `https://sync.even.appalaya.com`: Worker `even-sync`, from `appalaya/even-server` `worker/`, deployed by Actions → **Deploy** |
| Its database | D1 database `even`. Tables: `groups`, `events`, `blocked` (takedowns), `counters` (daily budget), `limits` |
| Website and contact form | `https://even.appalaya.com`: Worker `even-web`, from `appalaya/even-app` `web/`, deployed by Actions → **Web** |
| iOS builds | `appalaya/even-app` Actions → **iOS**. TestFlight groups **Alpha** (internal, automatic) and **Family & Friends** (external, by tag) |
| Android builds | `appalaya/even-app` Actions → **Android**. Play tracks `internal` and the closed track `family-and-friends` |
| Report a group | `CONTACT_TO_REPORT` → abuse@ |
| Get help | `CONTACT_TO_HELP` → support@ |
| Send feedback | `CONTACT_TO_FEEDBACK` → support@ or info@. The secret holds the address; the repositories don't record which |
| Cloudflare | dash.cloudflare.com, zone `appalaya.com`. Both Workers and D1 are on the Workers Free plan |

A healthy server answers `https://sync.even.appalaya.com/v1/info` (open it in any browser) with this, as of
2 October 2026:

```json
{"protocol":[1],"limits":{"max_event_bytes":8192,"max_group_bytes":2097152,"max_group_events":10000,"max_batch":25,
"max_page":500,"daily_write_budget":6500,"rate":{"requests_per_minute":120,"writes_per_minute":60,
"group_creates_per_minute":3,"reads_per_minute":25}},"retention_days":365,"push":false}
```

| You see | Go to |
|---|---|
| An email `Even report: <groupId>` | 1 |
| An email `Even support` or `Even feedback` | 2 |
| Users stuck on "Not synced since …", errors in the dashboard, a Cloudflare alert | 3 |
| A build that crashes or corrupts something | 4 |
| A key or token that may have leaked | 5 |

## 1. A report arrives

The contact form sends it to abuse@ with the subject `Even report: <groupId>`. The body has a line `Purpose: report
(abuse)`, the group id and the server on lines of their own, `Reply to:` (an address, or "none given"), and
`Message:` (the reason the reporter picked and what they saw). The reporter's invite is never sent: the page works
out the id in their browser.

### 1.1 Check it is ours

1. The line under `Server:` must read exactly `https://sync.even.appalaya.com`. If it reads anything else, the group
   isn't on our server and we can't act on it, so don't block anything. If there's a reply address, answer that only
   that server's operator can act. Its operator and terms, if it publishes them, are the `operator` and `terms`
   fields of `https://<that server>/v1/info`. Stop here.
2. The id must be 43 characters, all letters, digits, `-` or `_`. The form refuses anything else, so an id of any
   other shape didn't come from the form. Stop.
3. Judge the report from its own words: what was seen, where and when. We can't look inside the group to check it,
   and we don't try ([abuse page](../web/abuse.html): "We act on the report and the id").

### 1.2 Block the group

From the phone: Cloudflare dashboard → **D1** (look under Storage & databases) → `even` → **Console**. Paste the id
in and run:

```sql
INSERT OR IGNORE INTO blocked (group_id, blocked_at) VALUES ('<groupId>', unixepoch() * 1000);
```

Check that it took:

```sql
SELECT group_id, blocked_at FROM blocked WHERE group_id = '<groupId>';
```

From a laptop already logged in to the account (`npx wrangler@4.141.0 login`), inside `even-server/worker`:

```sh
npx wrangler@4.141.0 d1 execute even --remote --command \
  "INSERT OR IGNORE INTO blocked (group_id, blocked_at) VALUES ('<groupId>', unixepoch() * 1000)"
```

The block applies from the next request, with no deploy. You can block an id that has no stored group (expired or
never created); the group can then never be created on our server. There is no CLI for the Worker. The
`even-server block <groupId> [--purge]` command belongs to the Python reference, for self-hosters, and doesn't
touch our server.

### 1.3 Purge what is stored (optional)

If you don't purge, the ciphertext stays until expiry deletes it. That happens 365 days after the group's last
write, and a blocked group never writes again. To delete it now:

1. **Block first** (1.2). A delete without a block is undone by the next member who syncs.
2. Check the group's size. This reads metadata only:
   `SELECT events, bytes FROM groups WHERE id = '<groupId>';`
3. Check the cost. A delete writes up to 3 D1 rows per event, plus 3 for the group, out of the free plan's 100,000
   rows written a day. A full group of 10,000 events can take 30,003. If D1 → `even` → **Metrics** shows a busy day,
   purge after 00:00 UTC.
4. Run each statement on its own:

   ```sql
   DELETE FROM events WHERE group_id = '<groupId>';
   DELETE FROM groups WHERE id = '<groupId>';
   ```

   With Wrangler, both statements in one command:

   ```sh
   npx wrangler@4.141.0 d1 execute even --remote --command \
     "DELETE FROM events WHERE group_id = '<groupId>'; DELETE FROM groups WHERE id = '<groupId>'"
   ```

### 1.4 What the group's members see

- The next time a member's phone syncs with our server, it gets `410 group_blocked`. It marks the group blocked and
  never syncs it with our server again (PROTOCOL.md §7 and §10). The group's status line reads **"This group is
  blocked on its server."**
- Every phone keeps the group with its full history, and it still works offline. We can't reach those copies.
- Anyone who opens the old invite is told **"This group is blocked on its server, so you can't join it."**
- A member can still move the group to another server, or regenerate its invite, which gives it a new id. A block
  covers one id on our server. If the same group comes back under a new id, it takes a new report naming that id,
  because we can't connect the two.
- Once a blocked group's requests pass the per-address rate limit, they get `429` instead of `410`. That does no
  harm.

### 1.5 Answer the reporter

If they gave an address, reply from a company mailbox, signed Appalaya. Say that the group is blocked on our server,
and that we can't see what is in it or who is in it. Promise nothing more.

### 1.6 If the block was wrong: unblock

```sql
DELETE FROM blocked WHERE group_id = '<groupId>';
```

```sh
npx wrangler@4.141.0 d1 execute even --remote --command "DELETE FROM blocked WHERE group_id = '<groupId>'"
```

Unblocking doesn't fully undo the block:

- Phones that already saw the block stay stopped for our server. The app never retries a blocked group there, and
  opening the same invite again just opens the group on the phone. To sync on our server again, a member regenerates
  the invite (Group settings → **Regenerate invite link**). That moves the whole history to a new id, and everyone
  then needs the new link.
- Phones that haven't synced since the block, and anyone joining with the old link, work again straight away.
- If the group was purged, the first member to sync uploads the whole group again. That counts against the day's
  write budget.

### 1.7 If anyone asks what we hold

For each group, we hold its id (a hash), its epoch, its event count and total bytes, when it was created and last
written, and each event's ciphertext, size and arrival time. We hold no names, accounts, IP addresses or keys, and
the logs hold no URLs ([THREAT-MODEL.md], "What the server sees" and "What we log"). Cloudflare keeps its own access
logs under its own policy. If a report alleges a crime, or an authority asks for data, block first and get legal
advice; the repositories set no policy for this.

## 2. Support or feedback arrives

### 2.1 What the form sends

The subject is `Even support` (Get help, to support@) or `Even feedback` (Send feedback, to the feedback mailbox).
The body has `Purpose:`, then `Reply to:` (the visitor's address, which is also the email's Reply-To, or "none
given; this sender cannot be answered"), then `Message:`. The site keeps no copy. People open the form from App
settings → **Help and feedback**, or from the website. Only a report carries a group id; help and feedback never
do.

### 2.2 How to answer

1. With no reply address, there's nothing to do but read it.
2. Reply from a company mailbox, signed Appalaya.
3. Never ask for an invite link, an invite code or a group file. If one is in the message, see the rules at the top.
4. For a bug, ask for a screenshot of App settings → About → **Diagnostics**, and the time it happened. Diagnostics
   shows the version and build, the system, the device, and each group's last sync and last error. It's designed to
   be screenshotted, and they can crop out group names.

**The privacy promise** (state it plainly whenever it helps): there are no accounts, so there is nothing to look up,
reset or recover. We can't see any group, who is in it, or what it holds. We can't add, remove or restore anyone.
The one thing we can do on the server is block a group id after a report.

### 2.3 Standard answers

**"I lost my phone."**

- If anyone else in the group still has it, they share the invite (Group settings → **Share link** or **Copy
  code**). Join on the new phone and the history syncs back.
- iPhone: restoring an iCloud or computer backup brings the groups and their keys back. Reinstalling on the same
  iPhone recovers them too, because the keychain survives a reinstall.
- Android: a backup holds nothing from Even, so they need the invite again.
- A group file exported earlier also restores the group (App settings → **Import group file**).
- If none of those exists, the group is gone. We can't recover it, because we never had its key.
- If the lost phone could be unlocked in someone else's hands, that person can open Even on it. A member should
  regenerate the invite (next answer), which shuts the old phone out of everything added from then on.

**"My invite link leaked."** Group settings → **Regenerate invite link** → **Regenerate**, then share the new link
privately. The old link then opens only a closed copy that nothing new is written to. This protects what comes next,
not what was already there.

**"A member is abusive."** We can't remove anyone, because we don't know who anyone is. Any member can do it: Group
settings → **Regenerate invite link** → under "Remove someone? (optional)" pick that person → **Regenerate** → share
the new link with everyone else. The person stays in past expenses, and keeps a read-only copy of the history up to
that point. If the whole group is being used for abuse, rather than one member misbehaving, it's a report (1).

**"The server says the group is blocked."** "This group is blocked on its server." means the group's server refuses
its id. On `sync.even.appalaya.com` that is our takedown after a report (1), and the copy on their phone is intact.
If they say it's a mistake, ask them to report it from the group itself: Group settings → **Report this group** →
**Continue to report**, reason "Something else", saying it's a mistake. That gets us the exact id. Review it; if the
block was wrong, unblock (1.6) and explain that a member needs to regenerate the invite to sync again. If the group
is on another server, only that server's operator can act.

**"It says Not synced since …"** This is usually temporary: a rate limit, the daily budget, or a server error. The
app retries by itself, and nothing on the phone is lost. If several people write in on the same day, check section 3.

## 3. The server misbehaves

**Check first, in this order:**

1. Open `https://sync.even.appalaya.com/v1/info` in a browser.
   - The JSON in section 0: the Worker and D1 are both answering.
   - `{"error":"server_error",…}`: D1 or the limits table is the problem (3.4, 3.6).
   - Cloudflare's "Just a moment…" page: a challenge is in the way (3.5).
   - A Cloudflare error 1027 page: the account's daily request cap is spent (3.3).
   - No answer at all: probably a Cloudflare incident (3.7).
2. Check `https://www.cloudflarestatus.com` for Workers and D1.
3. Read the logs (3.1).
4. Check whether a deploy has just run: `appalaya/even-server` → Actions → **Deploy** (3.8).

### 3.1 Logs and metrics

Cloudflare → **Workers & Pages** → `even-sync` → **Observability**. The Free plan keeps logs for 3 days. Each
request writes one line with the route pattern only, never a URL, group id, token or IP:

```
{"method":"POST","route":"/v1/groups/{groupId}/events","status":503,"ms":…,"limited":false}
```

| Search for | Means |
|---|---|
| `"status":503` | The daily write budget has tripped (3.2) |
| `"limited":true` | 429s (3.3) |
| `unhandled_exception` | 500s. If there are many, check D1's daily limits (3.4) |
| `limits_missing` | Rows are missing from the `limits` table, so every request gets 500 (3.6) |
| `limits_table_differs_from_vars` | A var changed without a re-seed. Run Deploy (3.8) |
| `ratelimit_binding_missing`, `ratelimit_binding_failed` | A rate limiter isn't working, so requests are being allowed through |
| `expiry` | The daily expiry at 03:17 UTC. `"complete":false` means the backlog carries on tomorrow |
| `expiry_skipped` | The `retention_days` row is missing, so nothing expired |

Metrics: `even-sync` → **Metrics** shows requests and errors. **D1** → `even` → **Metrics** shows rows read and
written per day, against the Free plan's 5,000,000 and 100,000.

**Don't:** turn on invocation logs, traces, Logpush or Workers Issues, or turn on log export or IP analytics for
`sync.even.appalaya.com`. Don't run `wrangler tail` either. Each of these records full URLs, which contain group
ids, or IP addresses. That breaks the threat model and the "no data collected" answers given to both stores
([store-listing.md](store-listing.md), "Decided" 3). If you ever have to run `tail`, never save its output.

### 3.2 A 503 `over_budget` day

**What it looks like:** appends answer `"status":503`. In D1 → `even` → **Console**,
`SELECT day, writes FROM counters ORDER BY day DESC` shows today at or just under `6500`. A tripped day never goes
higher, because the database refuses any count past the budget. Phones pause their pushes until 00:00 UTC and keep
pulling, so nothing is lost: unsent entries wait on the phones. The status line reads "Not synced since …".

**What to do:** nothing. The budget resets at 00:00 UTC, which is 7 p.m. at UTC−5.

**Raising it:** edit `EVEN_DAILY_WRITE_BUDGET` in even-server `worker/wrangler.jsonc` and merge to main. The Deploy
run seeds the `limits` table again and checks that `/v1/info` publishes the new `daily_write_budget`. Size the
budget in events, at 8 rows written per event in the worst case. 6,500 already takes 52% of the Free plan's 100,000
rows a day, and the rest is reserved for deletes and expiry (worker README, "The daily write budget"). On Free, hold
off and raise it once the account is on Workers Paid. Phones that already got the 503 hold their pushes until
00:00 UTC anyway (or until the app restarts), so a raise mostly helps phones that haven't hit the limit yet.

**Don't** edit the `limits` table by hand. The next deploy overwrites it, and until then the Worker logs a mismatch.

### 3.3 429 floods and the request cap

The limits per address are per minute; IPv6 addresses are counted by /64:

- 120 requests
- 60 appends
- 3 new groups
- 25 read units. A unit is 100 D1 rows: a quiet poll costs 1, a full page costs 6.

A `429` carries `Retry-After: 60`, and phones wait and then carry on. A refused request reads nothing from D1.

- **Carrier NAT or a household.** Phones behind one IPv4 address share one allowance. If each phone syncs six
  groups, about four phones can open the app in the same minute before the fifth waits a minute. Usually there's
  nothing to do. If support mail shows a real pattern, raise the rate. Edit the var and the matching rate-limiter
  binding's `simple.limit` together in `worker/wrangler.jsonc` (the seed refuses to run while they differ), then
  merge. On Free, keep reads at 34 or lower, so that one address can't spend D1's daily reads.
- **A flood from one address or many.** The per-address limits don't protect the account's 100,000 Workers requests
  a day, which `even-web`'s contact form also uses. Past that cap, Cloudflare answers error 1027 for both Workers
  until 00:00 UTC, the Worker logs nothing, and the static pages keep working. Watch `even-sync` → **Metrics**.
  During a flood, add a rate limiting rule for the host `sync.even.appalaya.com`. It's in the `appalaya.com` zone,
  under **Security → WAF → Rate limiting rules** according to the worker README. Set its action to **Block**, never
  a challenge (3.5). For the lasting fix, see 6.

### 3.4 D1's daily limit is spent

Every query fails until 00:00 UTC, reads included. Every request that touches D1 answers `500` and logs
`unhandled_exception`, and D1 → `even` → **Metrics** shows 5,000,000 rows read or 100,000 rows written for the
day. Phones back off and retry, showing "Not synced since …"; nothing is lost.

**What to do:** wait for 00:00 UTC, or move the account to Workers Paid, which is the only way to raise D1's limits.
The repositories don't record whether upgrading lifts a limit already hit that day. Expect the D1 console to fail
too, so any takedown waits for the reset. Don't purge large groups on a busy day (1.3).

### 3.5 "Just a moment…" (a Cloudflare challenge)

If `/v1/info` shows Cloudflare's "Just a moment…" page instead of JSON, a security setting on the zone is
challenging traffic. `curl -sI https://sync.even.appalaya.com/v1/info | grep -i cf-mitigated` prints
`cf-mitigated: challenge` when that is the case. Phones can't solve a challenge. They treat it as a server error and
stop syncing ("Not synced since …"), and the contact form's `/api/` fails the same way.

**What to do:** in the `appalaya.com` zone, look under **Security** for whatever issues the challenge: "I'm Under
Attack" mode or the security level, Bot Fight Mode, or a WAF custom rule or rate limiting rule whose action is a
challenge. Turn it off for `sync.even.appalaya.com` and `even.appalaya.com/api/*`. Any rule on those hosts must
block, not challenge. The web README, "Zone settings", also asks for Bot Fight Mode's JavaScript detections to stay
off.

### 3.6 500s while D1 is fine

If the logs show `limits_missing`, the `limits` table has lost rows. Run `appalaya/even-server` → Actions →
**Deploy** → **Run workflow** on main. It seeds the table again.

### 3.7 Cloudflare incidents

On the Free plan, no Cloudflare notification watches a Worker's errors or D1's rows. The one alert worth having is
Cloudflare's own incidents. If it isn't set up yet, go to Cloudflare → **Notifications** → **Add** → **Incident
Alerts**, name it `Even sync: Cloudflare incidents`, pick the **Workers** and **D1** components, keep every impact
level, and enter the address (worker README, "Alerts"). When it fires, or when cloudflarestatus.com shows trouble,
there is nothing to fix on our side. The app works offline and phones retry with backoff. Don't redeploy to try to
fix a Cloudflare outage.

### 3.8 Redeploy and roll back

**Redeploy:** push to even-server main with a change under `worker/**` or to the workflow, or go to Actions →
**Deploy** → **Run workflow** (it deploys main only). A run does this, in order:

1. Tests, then the seed check, then a dry run. A failure here stops the run before Cloudflare is touched.
2. Finds D1 `even` and applies `schema.sql` and `seed-limits.sql`.
3. Deploys `even-sync`.
4. Checks `/v1/info` against the seeded limits and prints it in the run summary.

A running deploy always finishes; the next one waits for it. Any change under `worker/` deploys, even one to the
README, which does no harm.

**Roll back:**

```sh
cd even-server
git revert <bad commit>
git push origin main
```

Then watch Actions → **Deploy** finish green and read `/v1/info` in its summary.

- A revert doesn't roll back data. Anything `schema.sql` added (a table, an index or a trigger) stays, because the
  schema only creates what's missing. A reverted var is seeded again, so it goes back to being published and
  enforced.
- **Don't** roll back from the dashboard (look under `even-sync` → Deployments). That swaps the code only: the
  `limits` table keeps what was seeded, and the next push redeploys main anyway.
- On 2 October 2026 neither repository protects main, so the push goes straight in.

The website works the same way: revert in even-app and push. **Web** deploys `even-web` on any change under `web/`.

### 3.9 The contact form is down

`curl -s https://even.appalaya.com/api/contact/config` should answer `200` with a `turnstileSiteKey`. The logs are
in `even-web` → **Observability**: route, purpose and outcome only, for example `resend_403,validation_error`.

| Cause | Fix |
|---|---|
| Resend's quota is spent (100 a day and 3,000 a month, shared with the company site's form) | Wait for the reset. Until then the form answers `502 send_failed` |
| A wrong secret | Fix the GitHub secret, then run Actions → **Web** on main |
| Turnstile error 110200 | `even.appalaya.com` is missing from the shared widget's Hostname management |
| The account's daily request cap | See 3.3 |

## 4. A bad app build

### 4.1 What each push does

| You push | Workflow | What happens |
|---|---|---|
| even-app main, unless the change is only in `web/`, `docs/`, `android/`, Markdown or the other workflows | iOS | Build *N* = run number + 100 goes to TestFlight. **Alpha** gets it through automatic distribution, 5 to 30 minutes after upload |
| even-app main, unless the change is only in `web/`, `docs/`, `ios/`, `fastlane/`, `TestFlight/`, Markdown or the other workflows | Android | Version code = run number + 1000, uploaded to Play `internal` with status `PLAY_RELEASE_STATUS`, or `completed` when that is unset |
| even-app main, touching `web/**` | Web | Site check, typecheck, lint and tests, then `wrangler deploy` of `even-web` with the contact form's secrets |
| even-app, any pull request or push to main | CI | Typecheck, lint, app and core tests, the site check, and the What to Test size check. Holds no secrets |
| even-app tag `beta/<version>-<build>` | iOS and Android | iOS gives the already uploaded build *build* to **Family & Friends**, with nothing rebuilt. Android builds the tagged commit fresh and sends it to `family-and-friends` |
| even-server main, touching `worker/**` | Deploy | See 3.8 |

### 4.2 iOS (TestFlight)

1. **Stop installs:** App Store Connect → Apps → **Even - Split Expenses** → **TestFlight** → the build → **Expire
   Build** (look on the build's page). Testers can no longer install the build, and an expired build can't be brought
   back. Alpha gets every build automatically, so expiring is the only way to stop it for Alpha.
2. **Take it from Family & Friends only:** TestFlight → **Family & Friends** → its builds. Look under the group's
   build list for the option to remove the build.
3. **Fix it:** revert on main and push. iOS uploads a new build to Alpha; test it, then promote it with its tag.
4. **Or give Family & Friends a known-good build again:** tag that build's commit with its build number. The run
   summary for that build names the exact tag.

   ```sh
   git tag beta/1.0.0-105 <commit>
   git push origin beta/1.0.0-105
   ```

**How the tag works:** the version must be `expo.version` in `app.json` at that commit, written exactly (`1.0.0`,
not `1.0`). The build must come from a successful main run of the same commit. The workflow refuses the tag
otherwise, and its error says why. The first build of each version goes through Beta App Review, which takes about a
day. Before pushing a tag, run Actions → **TestFlight readiness**. To run a tag again, delete it and push it again:
`git push origin :refs/tags/<tag>`, then `git push origin <tag>`. Pushing a tag also builds Android from that commit
(4.3).

### 4.3 Android (Play)

**Right now** `PLAY_RELEASE_STATUS` is `draft` (set on 1 October 2026), so every upload lands as a draft release and
reaches nobody until someone starts the rollout in Play Console. If a build is bad, don't roll it out and discard the
draft: Play Console → **Even** → **Test and release** → **Testing** → **Internal testing** or **Closed testing** →
the draft release.

**Once the variable is deleted** (6), main reaches the internal testers within minutes, and a tag reaches
`family-and-friends` after Google's review.

1. **Stop it:** open the track's releases and halt the release, if Play offers that (look under the release's own
   menu). Halting stops new installs and updates, but phones that have already updated keep the build.
2. **Going back to the previous version code:** Android never installs a lower version code over a higher one, so
   releasing an older bundle again only reaches phones that haven't updated yet. The fix that reaches everyone is a
   new, higher version code built from good code:
   - internal: revert on main;
   - `family-and-friends`: tag the last good commit (4.2 step 4), or run Actions → **Android** → **Run workflow** on
     an existing `beta/*` tag. Every run takes a new version code.
3. Play uploads wait in a single queue (the `android-play` concurrency group), so a tag run waits for a main run
   instead of racing it. Step 3 of [store-listing.md](store-listing.md), "Closed testing", predates this.
4. Running a run again after its upload succeeded fails ("version code already used"). Start a new run instead.

### 4.4 Also true

- **Never build or upload from a laptop.** The only exception ever allowed was a first manual Android upload of a
  workflow run's own artifact ([RELEASE-android.md](../RELEASE-android.md)).
- **A bad build can't take back what it wrote.** Groups are append-only logs. Other phones skip events that fail
  validation; those are counted and never crash the app. A body version older builds don't know is kept unread until
  they update.
- **App Store and Play production aren't live yet.** This page has no production rollback until they are.

## 5. Secrets and keys

`appalaya/even-app` → **Settings** → **Secrets and variables** → **Actions**:

- Secrets:
  - iOS: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `IOS_DEV_CERT_P12`, `IOS_DEV_CERT_PASSWORD`.
  - Android: `ANDROID_UPLOAD_KEYSTORE_B64`, `ANDROID_UPLOAD_STORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
    `ANDROID_UPLOAD_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.
  - Website: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CONTACT_TO_REPORT`, `CONTACT_TO_HELP`,
    `CONTACT_TO_FEEDBACK`, `CONTACT_FROM`, `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`.
- Variables: `PLAY_RELEASE_STATUS` (`draft`) and `TURNSTILE_SITE_KEY` (public).

`appalaya/even-server`, same place: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

`even-web` holds its six secrets in Cloudflare too. Each deploy uploads them (`even-web` → Settings → Variables and
Secrets). `even-sync` has none. The upload keystore with its secrets file, and the Play JSON key, are kept in the
password manager. The App Store Connect `.p8` is kept somewhere safe outside any repository (RELEASE.md).

**`CLOUDFLARE_API_TOKEN`** (both repositories)
- **Scopes:** the deploys need Account · Workers Scripts · Edit, and for even-server also Account · D1 · Edit. The
  documented token also carries Workers KV Storage Edit, Account Settings Read and Workers Routes Edit on all zones,
  which nothing uses. The repositories don't record whether both secrets hold the same token; treat them as one.
- **Rotate:** roll it in Cloudflare (look under My Profile → API Tokens, or the account's API Tokens). Run
  `gh secret set CLOUDFLARE_API_TOKEN -R appalaya/even-server` and the same with `-R appalaya/even-app`. Then run
  **Deploy** and **Web** by hand to prove the new token works.
- **If it leaks:** it can deploy any code as `even-web`, including an invite page that steals invite fragments, and
  so group keys. That's the worst case on this page. It can also deploy as `even-sync`, read, change or delete D1
  (ciphertext, blocks, limits), and route other `appalaya.com` hostnames. Roll the token at once, then run **Web**
  and **Deploy** to put our own code back.

**`CLOUDFLARE_ACCOUNT_ID`** is an identifier, not a credential.

**`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`**
- **What it is:** the App Store Connect API key, with the **Admin** role.
- **Rotate:** App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → Generate API
  Key (Admin). Set the secrets, run **TestFlight readiness** to check them, then revoke the old key.
- **If it leaks:** it is Admin for the whole team, so it can sign and upload builds and distribute them to testers.
  Revoke it first, then make a new one.

**`IOS_DEV_CERT_P12`, `IOS_DEV_CERT_PASSWORD`**
- **What it is:** an Apple Development certificate with its key (optional).
- **Rotate:** revoke it in Certificates, Identifiers & Profiles. Export a new `.p12` (RELEASE.md, "Signing") and set
  both secrets.
- **If it leaks:** it can sign development builds for the team's registered devices. Revoke it.

**`ANDROID_UPLOAD_*` (four)**
- **What it is:** the upload keystore and its passwords. Both files are in the password manager.
- **Rotate:** make a new key with `scripts/release/android-keystore.sh`. Then go to Play Console → Even → Test and
  release → App integrity → App signing → **Request upload key reset** (look there for what it asks for). Set the four
  secrets once Google approves. Uploads stop until then, which takes days.
- **If it leaks:** with the service account, it can push builds to testing tracks. Users install builds that Google
  re-signs with its own key, which stays safe.

**`PLAY_SERVICE_ACCOUNT_JSON`**
- **What it is:** the key file of `even-play-upload`, which has Release to testing tracks and View app information.
  The file is in the password manager.
- **Rotate:** Google Cloud Console → IAM & Admin → Service accounts → that account → Keys. Add a new JSON key, run
  `gh secret set PLAY_SERVICE_ACCOUNT_JSON < key.json`, then delete the old key.
- **If it leaks:** it can upload to testing tracks, but only bundles signed with the upload key. Delete the key, or
  remove the user in Play Console → Users and permissions.

**`RESEND_API_KEY`**
- **What it is:** a Resend key with Sending access for `send.appalaya.com`. It may be the company site's own key.
- **Rotate:** Resend → API Keys → create a new key, `gh secret set RESEND_API_KEY`, run **Web** on main, then delete
  the old key. If the key is shared, the company site's form needs the new one too.
- **If it leaks:** anyone can send mail from `send.appalaya.com` in our name, and spend the quota both sites' forms
  share.

**`TURNSTILE_SECRET_KEY`**
- **What it is:** the secret of the company site's Turnstile widget, which `even.appalaya.com` shares.
- **Rotate:** Cloudflare → Turnstile → the widget → Settings (look there for the secret key rotation). Set the
  secret and run **Web**. The company site needs the new secret too.
- **If it leaks:** the impact is low. The secret verifies tokens; it can't make them.

**`CONTACT_TO_*`, `CONTACT_FROM`**
- **What they are:** mailbox and sender addresses, kept as secrets only to keep them out of the public repository.
- **Change:** `gh secret set <name>`, then run **Web** on main.

**On 2 October 2026 neither repository protects main or `beta/*` tags.** GitHub reports `protected: false` and no
rulesets. Anyone who can push can change a workflow and use every secret above, including the Admin App Store key.
RELEASE.md asks for main to accept pull requests only and for `beta/*` tags to be protected.

## 6. Before production (the gates)

1. **Business address first; Even is never published with the home address** ([store-listing.md](store-listing.md),
   "Before production"). Both developer accounts show the home address as the company's registered office. Play
   prints it on the public listing from the first production release. Apple prints it on EU product pages once the
   Digital Services Act trader declaration is made. The order:
   1. Get an address that can be published: a commercial registered agent, or a virtual street address. No PO box.
   2. Update the D-U-N-S record.
   3. Edit the organisation details in Play Console and verify them again.
   4. Make Apple's DSA trader declaration.
   5. Add the EU countries back on the App Store.

   **Play production waits for this.** Closed testing carries on in the meantime.
2. **App Store first, without the EU.** In App Store Connect → Pricing and Availability, leave out the 27 EU
   countries (as well as China mainland) and leave the DSA declaration undone until step 1 is complete.
3. **Workers Paid** for the Cloudflare account. On Free, one client or a busy day can spend the day's requests or D1
   rows for everyone ([review-2026-10-01.md](review-2026-10-01.md), H4: not done as of 2 October).
4. **The WAF rate rule** on `sync.even.appalaya.com` and `even.appalaya.com/api/*` (**Security → WAF → Rate limiting
   rules**). Set its action to block, never challenge (3.5). Not done as of 2 October.
5. **Remove `PLAY_RELEASE_STATUS` after Google's first approval.** Once Google approves the first closed-testing
   release and the app is no longer a draft, delete the variable so uploads complete on their own:
   `gh variable delete PLAY_RELEASE_STATUS -R appalaya/even-app`, or Settings → Secrets and variables → Actions →
   Variables.

One open item that no document lists as a gate: `EVEN_OPERATOR` and `EVEN_TERMS_URL` are empty in
`worker/wrangler.jsonc`. PROTOCOL.md §9 requires platform access logs that can't be turned off to be disclosed in
`terms`, and the worker README says to set both for the public server.

## 7. Weekly glance

1. **Cloudflare usage:** `even-sync` → **Metrics** (requests, errors), `even-web` → **Metrics**, and the account's
   daily Workers requests against 100,000 (look under Workers & Pages). Check **D1** → `even` → **Metrics** for rows
   read and written per day against 5,000,000 and 100,000, and the database size against 500 MB.
2. **Budget days:** in D1 → `even` → **Console**, run `SELECT day, writes FROM counters ORDER BY day DESC`. It keeps
   a week, and a day at `6500` tripped. To see how much is stored, as totals only, run
   `SELECT COUNT(*) AS groups, SUM(events) AS events, SUM(bytes) AS bytes FROM groups`.
3. **Logs:** in `even-sync` → **Observability**, look for `unhandled_exception` and `"status":5`, and check that
   each day has an `expiry` line.
4. **GitHub Actions:** look for failed runs of Deploy (even-server) and of iOS, Android, Web and CI (even-app).
5. **TestFlight crash reports:** App Store Connect → the app → **TestFlight** (look under its feedback section for
   crashes).
6. **Play vitals:** Play Console → Even → Android vitals (look under Monitor and improve). Each Android run uploads
   R8's mapping file, so stack traces are readable.
7. **The mailboxes:** abuse@, support@ and info@. Check Resend's dashboard for failed sends and how much of the daily
   100 is left.

[THREAT-MODEL.md]: https://github.com/appalaya/even-server/blob/main/THREAT-MODEL.md
