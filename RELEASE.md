# Releasing Even for iOS

iOS builds are made by GitHub Actions and nowhere else
(`.github/workflows/ios.yml`). Nobody archives or uploads from a Mac. The flow
mirrors Flowcast's: every merge to main becomes a TestFlight build for the
internal group **Alpha**; a build that holds up in Alpha is promoted, unchanged,
to the external group **Family & Friends** by pushing a tag. Android has its
own guide, `RELEASE-android.md`.

## How a release moves

1. **Merge to main.** The PR carries its changelog entry and What to Test text
   (see "Changelog discipline" below).
2. **The workflow builds it.** `ios.yml` archives the committed Xcode project,
   signs it, and uploads build *N* to TestFlight with the What to Test text from
   `TestFlight/WhatToTest.en-US.txt`. Alpha gets it through App Store Connect's
   automatic distribution once Apple finishes processing, usually 5 to 30
   minutes. The run's summary names the build ("Even 1.0.0 (105) from
   abc1234") and gives the exact tag to promote it.
   Commits that only touch `web/`, `android/`, Markdown files, or the other
   workflows do not make a build; run the workflow by hand (Actions → iOS →
   Run workflow, on main) if you need one anyway.
3. **Test in Alpha.**
4. **Promote to Family & Friends** by tagging the commit that build came from:

   ```bash
   git tag beta/1.0.0-105 abc1234
   git push origin beta/1.0.0-105
   ```

   The tag is `beta/<version>-<build>`, where `<version>` is `expo.version` in
   `app.json`, written exactly (`1.0.0`, not `1.0`). The workflow checks that the
   version matches `app.json` at that commit and that build 105 was uploaded by
   a successful run on that same commit, then adds build 105 to Family & Friends
   with the What to Test text from that commit. Nothing is rebuilt: external
   testers get the exact binary Alpha tested. The first build of each version
   goes through Beta App Review (typically about a day); later builds of the
   same version are usually available at once.
5. **Bookkeeping** in `CHANGELOG.md` (below).

## Changelog discipline

Every PR to main carries its changeset, as its final commit:

1. **`CHANGELOG.md` → `[Unreleased]`** gets the PR's user-facing changes under
   **New** (a capability the user did not have), **Fixed** (a defect the user
   could notice, reported or not) and **Other** (everything else, rolled into
   "minor fixes and enhancements" style lines).
2. **`TestFlight/WhatToTest.en-US.txt`** is regenerated from `[Unreleased]` as
   instructions for testers: `NEW IN THIS BUILD`, one bullet per thing to try,
   and a closing line asking for reports with the time. Plain text, under 1 KB
   (TestFlight truncates longer text; CI fails the PR at 1 KB).
3. **Voice:** App Store voice only. What changed for the person using the
   app, benefit first. No file names, API names, jargon or internal codenames.
   Developer detail belongs in commit messages. Concise enough to paste into
   the App Store's "What's New" unedited.
4. **Bookkeeping:** when a build is promoted to Family & Friends, move
   `[Unreleased]` into a section headed `## Build <n> — <date> — version <v>`,
   with an italic line naming the Alpha builds it covers, the run and commit,
   the promotion date and the tag, for example
   `_Alpha Builds 103–105 (iOS run #5 on abc1234), promoted to Family & Friends 2026-10-02, tag beta/1.0.0-105_`.
   When an App Store version ships, roll the builds since the last version
   into `## [x.y.z] — <date>` (distil if long); that section is the release's
   "What's New" text.

## Build numbers

The build number (`CFBundleVersion`) is `github.run_number + 100`. The offset is
`IOS_BUILD_OFFSET` at the top of `ios.yml`.

- Run #5 uploads build 105, so a build number always points back to its run
  (the workflow relies on this to check promotion tags).
- The offset keeps 1 to 100 free for anything uploaded before this workflow
  existed. It may only ever be raised. If the workflow file is ever renamed or
  recreated, its run numbers restart at 1: raise the offset above the last
  uploaded build first.
- Every run of `ios.yml` takes a number, including tag runs and failed runs,
  so build numbers have gaps. That is fine; they only need to increase.
- Re-running a run reuses its number. If that run had already uploaded, App
  Store Connect refuses the duplicate: start a new run instead.
- The version (`CFBundleShortVersionString`) is `expo.version` in `app.json`.
  Bump it there, with a prebuild (below), to start a new version.

## Secrets

Repository secrets (Settings → Secrets and variables → Actions). Only
`ios.yml` reads them, only on main and `beta/*` tags; `ci.yml` and pull
requests never see them.

| Secret | What it is |
|---|---|
| `ASC_KEY_ID` | The API key's Key ID (10 characters) |
| `ASC_ISSUER_ID` | The Issuer ID (a UUID) shown above the key list |
| `ASC_KEY_P8` | The downloaded `AuthKey_<KEY_ID>.p8`: its text pasted as is, or base64-encoded; the workflow accepts either |
| `IOS_DEV_CERT_P12` | Optional, see "Signing": an Apple Development certificate with its private key, exported as `.p12`, base64-encoded |
| `IOS_DEV_CERT_PASSWORD` | Optional: the password set when exporting that `.p12` |

Create the key in App Store Connect → Users and Access → Integrations → App
Store Connect API → Team Keys → Generate API Key. Name it "GitHub Actions" and
give it the **Admin** role. App Manager is not enough: signing for the App
Store through an API key uses cloud-managed distribution certificates, and
Apple grants those to API keys only with Admin access (with App Manager, export
fails with "Cloud signing permission error"). Download the `.p8` straight away;
Apple offers it once. Then:

```bash
gh secret set ASC_KEY_ID --body 'XXXXXXXXXX'
gh secret set ASC_ISSUER_ID --body 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
gh secret set ASC_KEY_P8 < AuthKey_XXXXXXXXXX.p8
```

Keep the `.p8` somewhere safe outside the repository (`*.p8` is gitignored).
This is an Admin credential for the whole team, and anyone who can push a
workflow change to main can use it, so keep main and `beta/*` tags protected
(push by pull request only). If it leaks, revoke it on the same page and
generate a new one.

## Signing

Signing is automatic and needs no certificates or profiles in the repository.
The archive is signed with an Apple Development certificate and the
development profile Xcode creates; the export step re-signs it for App Store
Connect with a cloud-managed Apple Distribution certificate. Both steps use
the API key through `xcodebuild -allowProvisioningUpdates`; export options are
in `fastlane/ExportOptions.plist`. On its first run Xcode registers the App ID
and turns on the capabilities the entitlements ask for (associated domains for
`even.appalaya.com`, push notifications for `expo-notifications`).

A fresh runner has no development certificate, so Xcode may request a new one
from Apple on every run. If runs fail at the archive step with "…already has
an Apple Development signing certificate for this machine, but its private key
is not installed…", or Certificates, Identifiers & Profiles fills with
certificates "Created via API", add the two optional secrets: in Keychain
Access, export one Apple Development certificate for team 9S29T387N4 together
with its private key as a `.p12` with a password, then

```bash
base64 -i development.p12 | gh secret set IOS_DEV_CERT_P12
gh secret set IOS_DEV_CERT_PASSWORD --body '…'
```

The workflow then imports it into a temporary keychain and Xcode uses it. The
team also needs at least one registered device, since development profiles
list devices.

## One-time setup in App Store Connect

Do these before the first run; the upload fails without the app record.

1. **Agreements.** Accept any pending agreement in App Store Connect →
   Business (and on developer.apple.com).
2. **App ID.** In Certificates, Identifiers & Profiles → Identifiers, register
   the explicit App ID `com.appalaya.even` if it is not there, with Associated
   Domains and Push Notifications. (Xcode would register it on the first run,
   but the app record in step 3 needs it first.)
3. **App record.** Apps → + → New App: platform iOS, name
   "Even - Split Expenses", primary language English (U.S.), bundle ID
   `com.appalaya.even`, a SKU such as `even-ios`, full access.
4. **App Store id for the landing page.** App Information → Apple ID (a
   number). Replace `idPLACEHOLDER` in `web/index.html` and `web/i.html` with
   `id<number>` (web/README.md, "Placeholders to fill before launch").
5. **TestFlight groups.**
   - Internal group **Alpha**, with *Enable automatic distribution* on (this
     is how every build reaches it; the workflow does not add builds to it),
     and the team members who test every merge.
   - External group **Family & Friends**, spelled exactly so (the workflow
     looks it up by name), with its testers or a public link.
6. **Test Information** (TestFlight → Test Information), needed for Beta App
   Review: beta app description, feedback email (`support@appalaya.com`),
   privacy policy URL `https://even.appalaya.com/privacy`, and Beta App Review
   contact details. Sign-in required: no (Even has no accounts).
7. **Encryption**: nothing to file while the source stays public; see below.

## Export compliance (encryption)

Even encrypts group content end to end with XChaCha20-Poly1305 (via
`@noble/ciphers`), keyed with HKDF-SHA-256, in its own code rather than only
through Apple's system encryption. Its source code is public
(github.com/appalaya/even-app), and US export rules treat encryption whose
source code is publicly available as not subject to the EAR once a one-time
notification has been sent (15 CFR 742.15(b) and 734.7). Appalaya Inc. sent
that notification to crypt@bis.doc.gov and enc@nsa.gov on 2026-09-27 from
info@appalaya.com, naming this repository. Apple lists this case among its
exemptions, so `app.json` sets `ios.infoPlist.ITSAppUsesNonExemptEncryption`
to `false`: builds upload without a compliance code and never wait at
Missing Compliance. None of this is legal advice; the owner confirmed the
classification before filing.

Keep it that way only while the source stays public. If the repository ever
goes private, or the app gains encryption whose source is not published, set
the key back to `true` and, in the same change, file App Encryption
Documentation in App Store Connect (the app → App Information → App
Encryption Documentation) and put the code it issues in `app.json` as
`ios.infoPlist.ITSEncryptionExportComplianceCode`. With `true` and no matching
code, App Store Connect rejects the upload outright ("Invalid Export
Compliance Code", 90592); the questionnaire alone, answered as "standard
algorithms, not available in France", issues no code. Google Play has no
equivalent declaration.

## The native project

`ios/` is committed. It is generated by `npx expo prebuild --platform ios`,
and the workflow builds exactly what is committed: CI never runs prebuild.
Only `ios/Pods/`, `ios/build/` and user state are ignored; `ios/Podfile.lock`
is committed.

Rerun prebuild by hand, and commit the result with the change that caused it,
whenever native configuration in `app.json` changes (anything under `ios`,
`plugins`, the name, version, icon, splash or scheme) or a native dependency
is added, removed or upgraded (including an Expo SDK upgrade):

```bash
npx expo prebuild --platform ios --no-clean
(cd ios && pod install)
git add app.json ios
```

That pair is idempotent: with nothing changed in `app.json` it leaves no diff.
On SDK 58, plain `npx expo prebuild` cleans by default: it deletes `ios/` and
generates it afresh, and CocoaPods then gives the project new random object
ids, so `project.pbxproj` shows a large but harmless diff. Use the clean form
when removing a plugin or native dependency or upgrading the SDK, since
`--no-clean` can leave stale settings behind, and read the diff.

Never edit files in `ios/` by hand; the next clean prebuild discards them. Put
native settings in `app.json` or a config plugin.

The workflow sets `CFBundleShortVersionString` and `CFBundleVersion` in its own
checkout just before archiving (prebuild writes literal values into
`Info.plist`, so build settings alone would not reach the app).

## Runner image

Both jobs run on the GitHub-hosted image labelled **`xcode-27`**: macOS 27,
arm64, free for this public repository. It is a public preview
([actions/runner-images#14404](https://github.com/actions/runner-images/issues/14404),
since 2026-07-16). Do not use `xcode-27-xlarge`; it is a paid larger runner.

What the image has, from its
[readme](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)
at version 20260921.0210.1:

- Xcode 27.0 (27A266a), the default, at `/Applications/Xcode_27.app`, also
  linked as `/Applications/Xcode_27.0.app` and `/Applications/Xcode.app`;
  Xcode 27.1 (27A9269) and 27.2 beta (27B5019j) alongside.
- fastlane 2.240.1, CocoaPods 1.17.0, Node.js 24.21.0 with npm 11.19.0, Ruby
  3.4.10, xcbeautify 3.2.1, jq 1.8.2, GitHub CLI 2.101.0.

`XCODE_APP` in `ios.yml` pins Xcode 27.0, the build the project was verified
with locally. To move:

1. Read the image readme for what is installed now.
2. Build locally with the Xcode you are moving to, then set `XCODE_APP` to its
   path on the image (`/Applications/Xcode_27.1.app`, say).
3. When GitHub publishes a generally available macOS 27 label (or points
   `macos-latest` at macOS 27), switch `runs-on` in both jobs to it and update
   this section, and remove the label from `.github/actionlint.yaml`, which
   tells `actionlint` about it until it is in the label list actionlint ships.

Uploads use fastlane (`fastlane/Fastfile`), which the image already has. It
sends the build with `xcrun altool --upload-app` (still in Xcode 27), sets the
What to Test text, and does the Family & Friends distribution through the App
Store Connect API.

## When a run fails

The failed run keeps its raw `xcodebuild` logs as an artifact
(`xcodebuild-logs-<build>`), including Xcode's distribution logs when the
export step fails. Common first-run causes:

- *Cloud signing permission error*: the API key is not Admin.
- *No profiles for 'com.appalaya.even'*, *No Account for Team*, *401*: a
  secret is wrong or the key was revoked.
- *…Apple Development signing certificate for this machine…*: add the
  optional development certificate secrets (Signing).
- The upload says the app cannot be found: the app record does not exist
  (One-time setup, step 3).
- The upload says the build number was already used: a re-run of a run that
  had uploaded; start a new run.
- A promotion tag fails its check: the tag names a different commit or
  version than the build; the error says which.
