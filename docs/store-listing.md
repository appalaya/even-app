# Store listing and console declarations

What to type into App Store Connect and Play Console for Even 1.0, field by field. Each field carries the
console's own name, its limit, and the length of the text given here, measured on 30 September 2026. Text
in a box is ready to paste exactly as it stands. It uses straight apostrophes, as the app does.

The wording follows the landing page (`web/index.html`) and the app's voice (design.md, "Copy"): short and
plain, with no "please", no exclamation marks and no claims the app can't back. The privacy answers follow
`web/privacy.html` and `../even-server/THREAT-MODEL.md`. If either of those changes, revisit this page.

**Mailboxes.** `support@appalaya.com`, `abuse@appalaya.com` and `info@appalaya.com` go into console fields
that require an email address, and nowhere else: never in the app, the site or the repository. Users are
pointed at the contact form at `https://even.appalaya.com/contact`. Each field below that needs an email
says so.

## Decided

All nine were settled with the owner on 1 October 2026; everything below follows from them.

1. **Subtitle (App Store):** "Pay whoever. End even.", the website's tagline. The pillars ("No ads. No accounts.
   Private.") stay one line down, in the promotional text and the short description.
2. **Secondary category (App Store):** Lifestyle. See [Category](#category).
3. **IP addresses (App Privacy and Data safety):** declare nothing on either store. See
   [IP addresses](#ip-addresses-the-judgment-call). This holds only while nobody at Appalaya can see client
   addresses; if log export or IP-level analytics is ever turned on for `sync.even.appalaya.com`, switch to the
   strict answer there.
4. **The contact page (App Privacy and Data safety):** declare nothing. See [The contact page](#the-contact-page).
5. **Target age (Play):** 13 and over. See [Target audience and content](#target-audience-and-content).
6. **"Users interact" (Play content rating):** Yes. See [Content rating](#content-rating).
7. **Captions:** plain screenshots for v1. See [Screenshots](#screenshots).
8. **Public contact email (Play):** support@appalaya.com, a console field.
9. **Where the iPhone app is offered (App Store):** Apple silicon Macs and Apple Vision Pro unticked until they are
   tested; China mainland off. See [Pricing and Availability](#pricing-and-availability).

---

## App Store Connect (iOS)

The app record already exists: "Even - Split Expenses", bundle `com.appalaya.even`, Apple ID `6816425117`
(the number already in `web/index.html`).

### App Information

**Name** · limit 30 · 21. Already reserved.

```text
Even - Split Expenses
```

**Subtitle** · limit 30 · 22. The website's tagline (`web/index.html`, README.md), decided on 1 October 2026.
The App Store record still carries "No ads. No accounts. Private." from when the name was reserved; replace it.

```text
Pay whoever. End even.
```

The pillars are not lost: the promotional text opens with "No ads, no accounts", and the description has a
paragraph for each.

#### Category

- **Primary Category:** Finance.
- **Secondary Category:** recommended **Lifestyle**. Even is for shared houses, trips and dinners with
  friends, which is what Lifestyle browses. Utilities is crowded with calculators, scanners and flashlights,
  and Even would sit unnoticed there. Travel is the third candidate if you would rather lean on trips.

**Content Rights:** "Does your app contain, show, or access third-party content?" No.

**Age Rating:** see [Age rating questionnaire](#age-rating-questionnaire).

**License Agreement:** keep Apple's standard license agreement. `web/terms.html` covers the server, the
website and tips, not the app's license (the code is MIT).

### Version 1.0

**Promotional Text** · limit 170 · 140. It can be changed at any time without a new build. It sits above the
description, so it doesn't repeat the description's opening.

```text
No ads, no accounts, nothing to unlock. Everything in a group is encrypted on your phone, so the server that syncs it has no way to read it.
```

**Description** · limit 4000 · 899

```text
Split costs with friends on a trip, in a house, or over dinner. Add what you paid, split it equally, by amount or by percent, see who owes whom, and settle up.

No accounts. No sign-up, no email, no password. A group is a link: share it, or show its QR code, and anyone who has it is in.

Private by construction. Amounts, titles, notes, names and the group's name are encrypted on your phone before anything is sent, with a key that exists only in the invite and on the phones in the group. The sync server passes them between phones and has no way to read them.

Works offline. Every phone keeps the whole history, so you can add expenses with no signal and they sync later.

Run your own server. The sync protocol is public and the server is small. Point a group at a server you run, and nothing about it goes through ours.

Free and open source, made by Appalaya Inc. No ads, and nothing to buy.
```

**Keywords** · limit 100 · 100. Comma-separated with no spaces. It leaves out words that are already in the
name or subtitle (Even, split, expenses, ads, accounts, private), "app", and competitors' names, which Apple
rejects. Apple combines keywords with words in the name, so "bill" here also matches "split bill".

```text
bill,trip,travel,roommates,friends,group,rent,iou,owe,settle,share,dinner,splitter,privacy,encrypted
```

The subtitle adds no search words, so the keywords carry them all; the name carries "split" and "expenses".

**Support URL**

```text
https://even.appalaya.com/contact
```

**Marketing URL**

```text
https://even.appalaya.com
```

**Copyright.** Apple's format is the year and then the owner, with no © sign.

```text
2026 Appalaya Inc.
```

**What's New in This Version:** not shown for a first version.

**App Icon:** none to upload. The App Store takes it from the build's asset catalog (`assets/icon.png`).

**Screenshots:** see [Screenshots](#screenshots) for what to capture. The requirement:

- **iPhone 6.9-inch display: required.** 1 to 10 images at 1320 × 2868 (also accepted: 1290 × 2796 and
  1260 × 2736), PNG or JPEG, no alpha channel. Capture them on an iPhone 17 Pro Max simulator, which shows
  at 1320 × 2868. The captures in `docs/screenshots/` are 1206 × 2622 (iPhone 17 Pro), and Apple doesn't
  accept that size in this slot. Smaller iPhone sizes are scaled from this set, and the 6.5-inch set is
  needed only when the 6.9-inch one is missing.
- **iPad 13-inch: not required.** `app.json` sets `ios.supportsTablet: false`, so the build is iPhone-only.
  Apple asks for the 13-inch iPad set (2064 × 2752) only for apps that run on iPad natively.
- **App Preview video:** none for v1.

**App Review Information**

- **Sign-in required:** unticked. Even has no accounts.
- **Contact Information:** first name, last name and phone of whoever answers App Review. Apple doesn't
  publish them. **Email:** `support@appalaya.com`. This is a console field, so the mailbox is allowed here.
- **Notes** · limit 4000 · 1905

```text
Even has no accounts and no sign-in. Nothing needs to be set up before review.

On one device:
1. Tap Create group. Enter a name, pick a currency, add one or two people under "People (optional)", enter your own name under "You in this group", and tap Create group.
2. Tap Add expense, enter an amount and a title, and tap Save. It splits equally among everyone; tap the split row to split by exact amounts or percentages instead.
3. The top of the group shows your balance and who pays whom. Tap one of those rows to record a payment.

On two devices:
1. On device A, open a group, tap the share button at the top right, then Show QR code (or Share link).
2. On device B, tap Join with code, scan the code or paste the link, tap Join, and pick a name.
3. Expenses added on either device appear on the other when it syncs. Pull down on the group to sync at once.

Sync goes through our server at sync.even.appalaya.com. Everything in a group is encrypted on the device before it is sent, and the server stores data it cannot read. Any group can be deleted from the server: open the group, tap the settings button, tap Leave group, and keep "Also delete this group's copy on sync.even.appalaya.com" ticked. Members still in the group would upload it again on their next sync.

A group's content is shared only among people who hold its invite. "Report this group", at the bottom of a group's settings, opens our contact page with the group's id filled in, and we block reported groups on our server. "Regenerate invite link" moves a group to a new invite, which is how someone is removed.

The camera is used only to scan invite QR codes. Notifications are local, from background refresh; there is no push server. Encryption: the source code is public, so the app uses the open-source exemption (ITSAppUsesNonExemptEncryption is false).

Questions: support@appalaya.com, or https://even.appalaya.com/contact
```

The labels in the notes match the app: "Create group", "People (optional)", "You in this group", "Save",
"Join with code", "Share link", "Show QR code", "Leave group", the Leave sheet's checkbox (ticked by
default), "Report this group" and "Regenerate invite link". The notes put a mailbox in a console field,
which is allowed. The paragraph on reporting is there because reviewers ask apps with shared content how
abuse is reported and how someone is removed (App Review Guideline 1.2).

**Version Release:** "Manually release this version", so 1.0 goes out when you choose.

### Age rating questionnaire

Answer None or No throughout. The result should be **4+**. Apple's current questionnaire, with the social
media questions it added in July 2026:

| Section | Question | Answer |
|---|---|---|
| In-app controls | Parental Controls · Age Assurance | No · No |
| Capabilities | **Unrestricted Web Access** | **No**. The in-app browser opens five fixed pages: the contact page (Help and feedback, Report this group), Privacy, Terms, and the source code on GitHub. It has no address bar and offers no general browsing. A Yes puts the app in the top age band. |
| | User-Generated Content | No. Apple's definition is "broad distribution of content created by users". A group's entries reach only the people who hold its invite. |
| | Social Media · Social Media Disabled for Users Under 13 | No · (not asked when Social Media is No) |
| | Messaging and Chat | No. Even has no chat or messages. A note on an expense belongs to that expense's record. |
| | Advertising | No |
| Mature themes | Profanity or Crude Humor · Horror/Fear · Alcohol, Tobacco, or Drug Use | None · None · None. The Drinks category (🍻) labels an expense and doesn't depict use. |
| Medical or wellness | Medical or Treatment Information · Health or Wellness Topics | None · None. The Health category (💊) is an expense label. |
| Sexuality or nudity | all three | None |
| Violence | all four | None |
| Chance-based | **Gambling** | **No**. Even records money that friends owe each other. Nobody bets or wagers anything, and there's no real or in-app currency. |
| | Simulated Gambling | No |
| | **Contests** | **None**. "Done adding" and balances are not a competition, ranking or reward. |
| | Loot Boxes | No |

Leave "Made for Kids" off.

### App Privacy

**Privacy Policy URL**

```text
https://even.appalaya.com/privacy
```

**User Privacy Choices URL:** leave empty.

**Data Collection:** "Do you or your third-party partners collect data from this app?" Proposed answer:
**No, we do not collect data from this app.** The App Store then shows **Data Not Collected**.

Apple's definition: *"'Collect' refers to transmitting data off the device in a way that allows you and/or
your third-party partners to access it for a period longer than what is necessary to service the transmitted
request in real time."* What leaves an Even phone, measured against that:

- **What people type** (amounts, titles, notes, names, the group's name) leaves the phone only as
  XChaCha20-Poly1305 ciphertext. The key never reaches any server, because the app has no code path that
  sends it (threat model, "What the server cannot see"). Neither Appalaya nor Cloudflare can read it.
  Apple's page has no explicit rule for end-to-end encryption, so this answer rests on the definition: data
  nobody but the group can open is not data Appalaya can access. Play's form does state the rule outright
  (see Data safety).
- **No identifiers.** There are no accounts, emails or phone numbers. The device id is inside the
  ciphertext. The group id the server sees is a hash of 256 random bits, different on every server. The
  access token yields only that group id.
- **No analytics, advertising or crash reporting,** and no third-party SDK that sends anything.
- **What the server can infer** (entry sizes in 256-byte steps, arrival times, entry counts) is metadata about
  an encrypted group and isn't linked to anyone (`web/privacy.html`, "What our server can see").
- **IP addresses** are the one judgment call. See the next section.

#### IP addresses: the judgment call

What happens. The public server is a Cloudflare Worker. It hands each request's address (an IPv6 address
trimmed to its /64) to Cloudflare's rate limiter. The limiter counts requests, writes and new groups per
minute, in 60-second windows (`even-server/worker/wrangler.jsonc`, `worker/src/ratelimit.ts`). Addresses
are never logged and never written to the database, and nobody at Appalaya can read the counters. The
threat model and privacy page promise that the counters expire within an hour. Cloudflare, as host, keeps
its own logs under its own policy, and the privacy page says so.

What Apple says: *"You collect and store IP address from your users. Declare the relevant data types based
on how you use IP address, such as precise location, coarse location, device ID, or diagnostics."*

What Play says: *"You should disclose your collection, use and sharing of IP addresses based on their
particular usage and practices. For example, where developers use IP addresses as a means to determine
location, then that data type should be declared."* Play's "ephemeral" exemption covers data "only stored
in memory and retained for no longer than necessary to service the specific request in real-time". A counter
that lasts a minute is longer than that.

- **Recommended: declare nothing** ("Data Not Collected" on the App Store, "No" on Play). Appalaya doesn't
  store addresses anywhere it can read them. The host's limiter holds a count per address for the minute it
  is counting. The address isn't used for location, identity, diagnostics or anything else. The privacy page
  already says all of this in plain words. This holds only while nobody at Appalaya can see client
  addresses. If log export, IP-level analytics or anything similar is ever turned on for
  `sync.even.appalaya.com`, switch to the strict answer below.
- **Strict reading:** the counters outlast the request, so declare them.
  - **App Store:** Yes → **Other Data** → purpose App Functionality (Apple's App Functionality explicitly
    includes "prevent fraud, implement security measures") → not linked to the user → not used for
    tracking. The label then reads "Data Not Linked to You: Other Data".
  - **Play:** Yes → **Device or other IDs** → collected, not shared, not ephemeral, required → purpose
    "Fraud prevention, security, and compliance".

#### The contact page

Help and feedback (App settings) and Report this group (Group settings) open
`https://even.appalaya.com/contact` in the system browser sheet: Safari View Controller on iOS, a Chrome
Custom Tab on Android. What someone types there goes to Appalaya's mailboxes: a message, an email address
if they give one, and for a report the group's id and server. Apple: *"Data collected via web traffic must be
declared, unless you are enabling the user to navigate the open web."* Play asks for data collected through
WebViews whose code the app controls.

- **Recommended: declare nothing.** It is the public website, opened in the system browser, which the app
  can't see into. The same form serves desktop visitors. The app hands the page nothing but a fragment
  naming the purpose and, for a report, the group's id and server. The privacy page's "This website" section
  describes what the form sends and to whom.
- **Strict reading:** App Store → Contact Info › Email Address and User Content › Customer Support, both
  linked to the user, purpose App Functionality. Play → Personal info › Email address (optional) and App
  activity › Other user-generated content, purpose App functionality. Either one takes away "Data Not
  Collected".

### Export compliance

Already handled; nothing to file. `app.json` sets `ITSAppUsesNonExemptEncryption` to `false` under the
open-source exemption. The source is public, and the notification went to BIS and NSA on 2026-09-27
(`RELEASE.md`, "Export compliance"). Builds upload without a compliance question. If the repository ever goes
private, that section says what changes.

### Pricing and Availability

- **Price:** Free (USD 0.00). There are no in-app purchases. Tips happen on the website only, and the app
  links to no tip page.
- **Availability:** all countries and regions except **China mainland**, which needs an ICP filing number in
  App Store Connect before an app can be offered there.
- **iPhone and iPad Apps on Apple Silicon Macs** and **Apple Vision Pro:** recommended **unticked** for 1.0.
  Both are on by default for an iPhone app. Background refresh, the camera scan, universal links and the
  keychain have been tested only on iPhones.

### Account-level items you may meet

- **EU Digital Services Act trader status** (Business, account-wide). Appalaya Inc. is a company, so it most
  likely declares itself a trader, if that isn't already done for the team. Apple then publishes the
  address, phone and email on EU product pages. Email: `support@appalaya.com` (a console field).
- **Accessibility Nutrition Labels** (optional for now). Claim a feature only after checking that the
  common tasks work with it. Dark Interface, Larger Text and Reduced Motion are designed in from the first
  commit (design.md, "Elegance constraints"). Leave VoiceOver and Voice Control unclaimed until someone has
  added, split and settled an expense with them.

---

## Play Console (Android)

The app record "Even" (`com.appalaya.even`) exists, and internal testing already gets every merge to main.

### Main store listing

**App name** · limit 30 · 21

```text
Even - Split Expenses
```

**Short description** · limit 80 · 69. The tagline first, as on the website, then the pillars. It leaves out
"free", which Play's metadata policy is strict about in prominent fields.

```text
Pay whoever. End even. No ads, no accounts, encrypted on your phone.
```

**Full description** · limit 4000 · 899. It's the App Store description unchanged. Play accepts plain
paragraphs, so no formatting is needed.

```text
Split costs with friends on a trip, in a house, or over dinner. Add what you paid, split it equally, by amount or by percent, see who owes whom, and settle up.

No accounts. No sign-up, no email, no password. A group is a link: share it, or show its QR code, and anyone who has it is in.

Private by construction. Amounts, titles, notes, names and the group's name are encrypted on your phone before anything is sent, with a key that exists only in the invite and on the phones in the group. The sync server passes them between phones and has no way to read them.

Works offline. Every phone keeps the whole history, so you can add expenses with no signal and they sync later.

Run your own server. The sync protocol is public and the server is small. Point a group at a server you run, and nothing about it goes through ours.

Free and open source, made by Appalaya Inc. No ads, and nothing to buy.
```

**Graphics**

| Asset | Play's rule | File |
|---|---|---|
| App icon | 512 × 512, 32-bit PNG with alpha, up to 1024 KB. Upload it as a full square; Play rounds the corners itself. | `docs/store/play-icon-512.png` (RGBA, 14 KB). `assets/icon.png` scaled by sips; the pixels are unchanged apart from the added alpha channel, which is fully opaque. |
| Feature graphic | 1024 × 500, JPEG or 24-bit PNG, no alpha | `docs/store/feature-graphic.png` (RGB), from `feature-graphic.html`. See [Feature graphic](#feature-graphic). |
| Phone screenshots | 2 to 8, JPEG or 24-bit PNG with no alpha, each side 320 to 3840 px, and the long side **no more than twice** the short side. For promotion, at least 4 at 9:16 and at least 1080 × 1920. | To capture. See [Screenshots](#screenshots). The existing Android captures are 1080 × 2424 (2.24 : 1), which **Play rejects**. |
| 7-inch and 10-inch tablet screenshots | Optional. At least 4 each if added, 1080 to 7680 px. | None for v1. Even is a portrait phone layout (`orientation: portrait`), and tablets aren't targeted. |
| Video | Optional | None |

### Store settings

- **App category:** Application type App · Category **Finance**.
- **Tags:** up to five from Play's fixed list for the category. Pick the ones closest to splitting and
  tracking shared costs, such as a bill-splitting tag and an expense-tracking tag if offered, and a travel tag
  if Finance offers one. Avoid budgeting, banking, payments, loans and investing tags: Even does none of
  those, and the wrong peer group skews Play's comparisons. I couldn't see the live list from here.
- **Store listing contact details**
  - **Email** (required, **shown publicly** on the listing): `support@appalaya.com`. This is a console field.
    The address is open to everyone and is what Play users will write to.
  - **Phone:** leave empty.
  - **Website:** `https://even.appalaya.com`
- **External marketing:** leave as is.

### App content (Policy and programs → App content)

Each item below is one declaration. The Dashboard's "Set up your app" list ticks off as they're done. If
App content lists a declaration that isn't covered here, stop and check before answering.

- **Privacy policy:** `https://even.appalaya.com/privacy`
- **Ads:** "No, my app does not contain ads."
- **App access:** "All functionality in my app is available without any access restrictions." There's no
  login. Joining a group needs an invite, but anyone can create a group and use every feature alone.
- **Advertising ID:** "Does your app use advertising ID?" **No.** The merged manifest has no `AD_ID`
  permission (checked in the debug build's merged manifest of 29 September). If Play ever says the release
  bundle declares it, a new dependency has added it: look there first.

#### Content rating

- **Email address** for the IARC certificate: `info@appalaya.com`. This is a console field and isn't
  published.
- **Category:** "Utility, Productivity, Communication, or Other". Play's own description of this category
  lists banking and financial apps.
- **Answers:** No to violence, fear, sexuality, language, controlled substances (the Drinks category is an
  expense label), crude humour and gambling. In the miscellaneous questions: shares the user's location with
  other users, No; purchase of digital goods, No; is a web browser or search engine, No; Nazi symbols (asked
  for Germany), No; primarily news or educational, No.
- **"Does the app natively allow users to interact or exchange content with other users through voice
  communication, text, or sharing images or audio?"** Recommended **Yes**, which departs from "all no".
  The members of a group see each other's free text: expense titles, notes and names. IARC's wording is
  "exchange content … through text", which covers that, even though Even has no chat. A Yes adds the
  "Users Interact" notice to the rating. Interactive elements are notices shown alongside the rating and
  don't raise the age. A No is arguable only if you read the question as being about chat features alone.
- **Expected result:** the lowest band in every system (ESRB Everyone, PEGI 3, and the equivalents).

#### Target audience and content

- **Recommended: 13 and over.** Tick 13–15, 16–17 and 18 and over, and no group under 13. Nothing in Even
  is unsuitable for teenagers (school trips, team kit, shared houses), and the App Store questionnaire comes
  out at 4+. Teen age groups add no obligations, because Play's Families policy starts with groups that
  include children under 13. Even isn't designed for children.
- **18 and over** is the smaller claim, if you would rather say nothing about teenagers.
- If asked whether the store listing could unintentionally appeal to children, answer No: plain screenshots
  on a neutral canvas, with no characters or cartoon art.

#### The remaining declarations

- **News apps:** "Is your app a news app?" No.
- **COVID-19 contact tracing and status apps:** "My app is not a publicly available COVID-19 contact tracing
  or status app."
- **Data safety:** see below.
- **Government apps:** No.
- **Financial features:** **"My app doesn't provide any financial features."** Even records who paid what
  among friends and works out balances. It holds no money, moves no money, connects to no bank or card, and
  offers no loans, credit, payments, wallets, trading, insurance or advice. "Settle up" records a payment
  people made some other way. None of Play's listed features applies, and "Other" is meant for financial
  services, which Even doesn't provide.
- **Health apps:** "My app does not have any health features."

#### Data safety

This is the proposal from `RELEASE-android.md` ("Data safety and App content"), with the two judgment calls
settled as recommended above.

- **"Does your app collect or share any of the required user data types?"** **No.**
  - Content: Play says user data *"that is unreadable by you or anyone other than the sender and recipient
    as a result of end-to-end encryption does not need to be disclosed."* That describes everything a person
    types into Even.
  - No accounts, analytics, advertising or crash reporting, and no third-party SDK that sends data.
  - IP addresses: [the judgment call](#ip-addresses-the-judgment-call). Recommended: not declared.
  - The contact page: [declare nothing](#the-contact-page), as recommended.
- If the form goes on to ask about security practices: all traffic is HTTPS, so data is encrypted in transit.
  No account-deletion URL applies, because Even has no accounts.
- The listing then shows "No data collected" and "No data shared with third parties".

### Closed testing: what has to happen, in order

The tag run for `beta/1.0.0-122` failed on 29 September with "This edit has expired, please create a new
Edit". The logs point to a second cause besides the missing listing. A push to main had started an Android
run 90 seconds before the tag, and both reached Play at the same moment. The tag run opened its edit at
13:59:02, and the main run opened its own at 13:59:16. The tag run's edit then expired at 13:59:56, before
main committed its edit at 14:00:21. Play allows one open edit per app, and the workflow's concurrency group is per
ref, so a main run and a tag run don't wait for each other. Both conditions below must hold.

1. **Store listing complete:** name, both descriptions, icon, feature graphic, at least two phone screenshots
   (four at 1080 × 1920 is recommended), category, tags, contact email and website.
2. **Every App content declaration done:** privacy policy, ads, app access, advertising ID, content rating,
   target audience, news, COVID-19, data safety, government apps, financial features and health. The
   Dashboard's setup list should show nothing outstanding, and Publishing overview should show nothing
   blocked.
3. **Make sure no Android run is uploading:** Actions → Android, with no run in progress on main. Don't push
   the tag within about 25 minutes of a merge to main. Since 265c7c9 the Android workflow queues every Play
   upload in one concurrency group, so a tag run waits for a main run instead of colliding with it; the
   check is belt and braces.
4. **Run the closed track again for the tag.** Re-push it:

   ```bash
   git push origin :refs/tags/beta/1.0.0-122   # delete it on GitHub
   git push origin beta/1.0.0-122              # push it again; android.yml and ios.yml both run
   ```

   You can do the same for Android alone, without re-running the iOS promotion: Actions → Android → Run
   workflow → "Use workflow from" → Tags → `beta/1.0.0-122`. The workflow treats a manual run on a `beta/*`
   tag the same as a tag push. Either way the run takes a new version code.

   `beta/1.0.0-122` is the commit from 29 September (`69d3256`). If Family & Friends should get today's
   build instead, promote a newer iOS build with its own tag (`RELEASE.md`, step 4). That one push builds
   both platforms, and steps 1 to 3 still apply.
5. **Review.** Closed testing releases are reviewed, and the first can take several days. Testers on the
   `family-and-friends` list get the build through the track's opt-in link once Play approves it.

---

## Before production: the address

Decided on 1 October 2026 while entering the listings. Both developer accounts carry the owner's home address as the
company's registered-office address (the owner is the registered agent). Nothing in closed testing or TestFlight
shows it, but:

- **Play** prints an organisation account's address under "Developer contact" on the public listing, in every
  country, from the first production release.
- **Apple** shows the trader's address, phone and email on EU product pages once the Digital Services Act trader
  declaration is made. For 1.0 the declaration is left undone and the 27 EU countries are removed from
  availability, so the App Store listing carries no address.

Gate for the production release, in this order: get a business address that can be published (a commercial
registered agent that allows its address as the business address, which also takes the home address off the
Secretary of State record, or a virtual street address; PO boxes are refused by Dun & Bradstreet and Google);
update the D-U-N-S record; edit the organisation details in Play Console and re-verify; then make Apple's DSA
trader declaration and add the EU countries back. Or the owner explicitly decides to publish the home address.
Decided on 2 October 2026: **Even launches on the App Store first**, with the EU excluded and the DSA declaration left
undone, so no address shows. **Play's production release waits until the organisation address is a business address;**
closed testing continues for Android testers meanwhile. Even is never published with the home address.

Also before production: once Google approves the first closed-testing release and the app leaves draft, delete the
`PLAY_RELEASE_STATUS` repository variable (set to `draft` on 1 October 2026 so the tag run could upload to a draft
app) so uploads complete on their own again.

## Screenshots

### Plain or captioned

- **Recommended for v1: plain screenshots.** These are the app exactly as it looks, with nothing added. The
  app's look is the pitch, and there is no caption copy to keep in step with the app.
- **Optional: one caption line above each.** One short line on the canvas colour, then the plain capture
  below it, with no device frame, badge or second line. `docs/store/screenshot-caption.html` is the
  template. `docs/store/caption-example.png` shows it at App Store size. That example uses an older capture
  with the gear where the avatar now is, so it shows the layout only and isn't for upload.

### Which screens, in this order

The same eight for both stores (Apple allows ten, Play eight). On iOS the first three show in search
results, so they carry the app. All screens are light appearance. The state column is the dev seed
(`even://dev/seed?state=…`, design.md "Development"), which fills the app with the canvas's data.

| # | Screen | Seed state | Caption, if used |
|---|---|---|---|
| 1 | Group, Expenses tab: the balance, who pays whom, the list | `group` | See who owes whom |
| 2 | Add expense, filled in | `add-chosen` | Add what you paid |
| 3 | Scan to join (the QR sheet) | `share`, then Show QR code | A group is a link |
| 4 | Groups | `groups` | No accounts. No ads. |
| 5 | Group, Balances tab: per-member nets and spend by category | `balances` | Nobody but your group can read it |
| 6 | Split, Equal | `split-equal` | Equal, exact or percent |
| 7 | Settle | `settle` | Pay whoever. End even. |
| 8 | Expense detail with its history | `expense-detail` | Every change, and who made it |

The captions reuse the landing page's words ("A group is a link", "No ads", "No accounts", "nobody but your
group can read it") and the tagline. Each is under 35 characters, so it fits one line.

### Capturing them

- **Avoid any screen that shows the server's host.** Seed groups sync with the Mac's dev server, so Group
  settings' server card, Move server and the Leave sheet would show its address. None of the eight does.
- **The QR in shot 3 is a live invite** to a seed group on the dev server. Scanning it from the store page
  leads to a group that can't be reached. That's harmless, but if you would rather not ship it, use the
  Join preview (`join-preview`) in its place, captioned the same.
- **iOS:** an iPhone 17 Pro Max simulator (1320 × 2868). Clean the status bar first:
  `xcrun simctl status_bar booted override --time 9:41 --dataNetwork wifi --wifiBars 3 --batteryState charged --batteryLevel 100`.
- **Android:** an emulator whose screen is **1080 × 1920** (the Pixel 2 hardware profile, or a custom
  1080 × 1920 profile at 420 dpi). That gives exactly 9:16, so the shots qualify for promotion with no
  cropping. If a layout feels cramped there, 1080 × 2160 (2 : 1) is the tallest size Play accepts. Clean the
  status bar with demo mode:

  ```bash
  adb shell settings put global sysui_demo_allowed 1
  adb shell am broadcast -a com.android.systemui.demo -e command enter
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
  adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
  adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile hide
  adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
  ```

- **No alpha, on both stores.** Check with `sips -g hasAlpha shot.png`. Android's `screencap` writes RGBA. To
  flatten without changing a pixel: `node docs/store/render.mjs flatten in.png out.png`. JPEG also works on
  both stores.
- **With captions:**
  `node docs/store/render.mjs caption --shot <capture> --caption "<line>" --size ios|play --font system|inter --out <png>`.
  Use `--font system` for the App Store (SF, as in the iOS app) and `--font inter` for Play (Inter, as in
  the Android app).

## Feature graphic

`docs/store/feature-graphic.png` (1024 × 500, RGB, no alpha) is the lockup on the canvas colour with the
tagline "Pay whoever. End even.", and nothing else. The mark is the landing page's, in the accent `#1F6B5A`. "Even" is set in Inter
Display Bold, the Android app's typeface, at the lockup's proportions (typography.ts `wordmarkLockup`)
scaled 2.5 times. The tagline is in `textSecondary` `#595B56` on `background` `#F6F5F1`, the `even` light
tokens from `src/theme/themes.ts`. The source is `feature-graphic.html` next to it. To re-render with another
line:

```bash
node docs/store/render.mjs feature --subtitle "Pay whoever. End even."
```

`render.mjs` uses the Google Chrome installed in /Applications through Playwright from the npx cache, and
loads only files from this repository. `node docs/store/render.mjs icon` rebuilds the Play icon from
`assets/icon.png`.

## Sources checked on 30 September 2026

- Apple: [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) (the definition
  of collect, IP addresses, web traffic),
  [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
  [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions),
  [DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/).
- Google Play: [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
  (end-to-end encryption, IP addresses, ephemeral, WebViews),
  [Preview assets](https://support.google.com/googleplay/android-developer/answer/9866151),
  [Financial features declaration](https://support.google.com/googleplay/android-developer/answer/13849271),
  [Target audience and content](https://support.google.com/googleplay/android-developer/answer/9867159),
  [Content rating categories](https://support.google.com/googleplay/android-developer/answer/6159978).
