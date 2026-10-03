# Releasing Even on Android (Google Play)

The Android half of the release process, linked from `RELEASE.md`. Android release builds are made and uploaded
**only** by GitHub Actions (`.github/workflows/android.yml`) on free GitHub-hosted runners (the repository is
public). No EAS, no paid actions, no release builds from any local machine.

## How a release happens

| You do | The workflow uploads to | Testers get it |
|---|---|---|
| Push to `main` | Internal testing (`internal`), status `completed` | Within minutes, no review |
| Push a tag `beta/<version>-<iosBuild>`, the same tag that promotes the iOS build (`RELEASE.md`), e.g. `git tag beta/1.0.0-105 && git push origin beta/1.0.0-105` | Closed testing track `family-and-friends`, status `completed` | After Google's review (hours to days) |
| Actions → Android → Run workflow | Same as above for `main` or a `beta/*` tag; any other ref builds without uploading | |

Pushes to `main` that only touch `web/`, `docs/`, `ios/`, `fastlane/`, `TestFlight/`, Markdown files, or the
other workflows do not build. Tag pushes always build.

Every run keeps an artifact `even-android-<versionCode>` with the `.aab` and R8's `mapping.txt` (the workflow also
sends the mapping file to Play for readable crash reports). The repository is public, so any signed-in GitHub
user can download artifacts. The bundle holds nothing secret: the client is open source, and the upload key's
private half is never in it.

The "What's new" text is `TestFlight/WhatToTest.en-US.txt` (owned by the iOS pipeline), copied at build time into
`distribution/whatsnew/whatsnew-en-US` and cut to Play's 500-character limit. If that file is missing, the text is
"Build <versionCode>."

## Version numbers

- **Version code** = `github.run_number + 1000` of the Android workflow. The offset is
  `ANDROID_VERSION_CODE_OFFSET` at the top of `android.yml`. This is the same scheme as the iOS build number
  (run number + an offset, `IOS_BUILD_OFFSET` in `ios.yml`), with its own counter and offset; the two stores never
  compare numbers. Play needs a new version code for every upload, across all tracks, and each run has a new
  run number. Every run takes a number, including failed and non-uploading runs, so codes have gaps.
- **Re-running** a run whose upload already succeeded fails with "version code already used" (a re-run keeps its
  run number); start a new run instead.
- The offset may only ever be **raised**. If `android.yml` is renamed or recreated, its run number restarts at 1:
  raise the offset above the last version code Play shows first.
- **Version name** = `expo.version` in `app.json`, read by `android/app/build.gradle` at build time. Bump it
  there for a user-visible version change.
- A build without `EVEN_VERSION_CODE` gets version code 1. Only local smoke builds do that, and they are never
  uploaded.

## Secrets and variables

GitHub → `appalaya/even-app` → Settings → Secrets and variables → Actions.

| Secret | Value | Comes from |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_B64` | The upload keystore, base64 on one line | `scripts/release/android-keystore.sh` → `even-upload-secrets.txt` |
| `ANDROID_UPLOAD_STORE_PASSWORD` | Keystore password | Same file |
| `ANDROID_UPLOAD_KEY_ALIAS` | `even-upload` | Same file |
| `ANDROID_UPLOAD_KEY_PASSWORD` | Key password, the same as the store password (a PKCS12 keystore has one password) | Same file |
| `PLAY_SERVICE_ACCOUNT_JSON` | The whole JSON key file of the Play service account, pasted as text | Google Cloud, step 1 below |

| Variable | Value |
|---|---|
| `PLAY_RELEASE_STATUS` | Unset, which means `completed`. Set it to `draft` only until the app's first release is rolled out (step 5). |

The workflow decodes the keystore into the runner's temp folder and passes the rest to Gradle as
`EVEN_UPLOAD_STORE_FILE`, `EVEN_UPLOAD_STORE_PASSWORD`, `EVEN_UPLOAD_KEY_ALIAS` and `EVEN_UPLOAD_KEY_PASSWORD`. A
missing secret, or a password or alias that does not open the keystore, fails the run in the "Upload key" step,
before the build. Runners are discarded after each job.

The workflow runs only on pushes and manual runs, which need write access. It has no `pull_request` trigger, so
code from forks never runs with these secrets. Do not add `pull_request_target`.

## The upload key: made once

```bash
scripts/release/android-keystore.sh                 # writes ~/Desktop/even-upload/
scripts/release/android-keystore.sh ~/somewhere     # or another folder
```

It needs a JDK for `keytool` (`brew install openjdk@17`; the script finds Homebrew's keg-only JDK, `JAVA_HOME` or one on `PATH` by itself).
It generates `even-upload.keystore` (RSA 4096, alias `even-upload`, valid 100 years, random password) and
`even-upload-secrets.txt`, which lists each GitHub secret by name with its value, plus `gh secret set` commands.
It prints only the two file paths and refuses to overwrite an existing key. It never builds or uploads.

Then: add the four `ANDROID_UPLOAD_*` secrets, store **both files in the password manager**, and delete the
folder. With Play App Signing, Google holds the key that signs what users install; the upload key only proves an
upload came from us. If it is lost or leaks, request an upload key reset (Play Console → Even → Test and
release → App integrity → App signing → Request upload key reset). Uploads stop until Google approves it, which
takes days.

## One-time Play Console setup

The developer account is the organization account "Appalaya Inc". Organization accounts do not need the
12-tester, 14-day closed test that new personal accounts must run before production. The app record "Even"
(`com.appalaya.even`) exists with no uploads yet. Do these steps before the first run:

1. **Service account for the API.**
   1. [Google Cloud Console](https://console.cloud.google.com) → create or pick a project (e.g. `even-release`)
      → APIs & Services → Library → enable **Google Play Android Developer API**.
   2. IAM & Admin → Service accounts → Create service account (e.g. `even-play-upload`). It needs no Cloud roles.
      Open it → Keys → Add key → Create new key → JSON. Paste the downloaded file's entire contents into the
      `PLAY_SERVICE_ACCOUNT_JSON` secret, then keep the file only in the password manager. If key creation is
      blocked, the Cloud organization enforces `iam.disableServiceAccountKeyCreation` (the default for new
      organizations): an organization admin must allow it for this project.
   3. Play Console → Users and permissions → Invite new users → the service account's email
      (`…@….iam.gserviceaccount.com`) → App permissions → add **Even** with **Release to testing tracks** and
      **View app information (read only)** → Invite. It can take a few hours to start working; until then the
      upload fails with a permission error.
2. **App signing.** Play Console → Even → Test and release → App integrity → App signing. If it asks, choose
   **Use Google-generated key** (the default). Play App Signing is enrolled with the first upload either way.
3. **Internal testing testers.** Test and release → Testing → Internal testing → Testers → create an email list
   with the owner's Google account email and save. Open the opt-in link from that tab on the phone's Google
   account once.
4. **Closed testing track `family-and-friends`.** Test and release → Testing → Closed testing → Create track,
   named exactly `family-and-friends` (the workflow uses this name). Add its testers (an email list or a Google
   Group). It must exist before the first `beta/*` tag. Closed testing releases are reviewed, and Play asks for
   the store listing and every App content declaration first (see below).
5. **First release: the app is still a "draft app".** Until one release has been rolled out from the console,
   the Play API accepts only draft releases. It rejects the workflow's `completed` status with "Only releases with
   status draft may be created on draft app". So for the first run:
   1. Add the repository **variable** `PLAY_RELEASE_STATUS` = `draft`.
   2. Push to `main`, or run the workflow on `main`. The bundle lands as a draft release on internal testing.
   3. Play Console → Testing → Internal testing → the draft release → review it and **Start rollout to Internal
      testing**.
   4. Delete the `PLAY_RELEASE_STATUS` variable. From then on, every run publishes directly.

   **If the API upload still fails on that first run** (for example, before Play App Signing has been accepted),
   upload that run's bundle by hand, once. Actions → the failed run → Artifacts → `even-android-<versionCode>`,
   unzip, then Play Console → Internal testing → Create new release → upload `app-release.aab` → accept Play App
   Signing if prompted → roll out. After that, the API path works. This is the only manual upload, and its bundle
   always comes from a workflow run, never from a local build. Later runs have higher version codes, so the one
   used here is not reused.

## After the first upload: the App Links fingerprint

Android verifies `https://even.appalaya.com/i` links (the `autoVerify` intent filter from `app.json`) against
`web/.well-known/assetlinks.json`, which still holds a placeholder. Once Play App Signing is set up:

Play Console → Even → Test and release → App integrity → App signing → **App signing key certificate** →
**SHA-256 certificate fingerprint** → replace `PLACEHOLDER_PLAY_APP_SIGNING_SHA256_SEE_WEB_README` in
`web/.well-known/assetlinks.json` and deploy the site.

Use the **app signing** key's fingerprint, not the upload key's: users install builds that Google signed. The
upload certificate's SHA-256 is in `even-upload-secrets.txt`, and belongs in the file only as a second entry for
builds signed with the upload key itself. `web/README.md` has the commands to verify the result. This step
belongs to the web side; nothing in the Android pipeline changes.

## Data safety and App content: guidance for the owner to confirm

Play Console → Even → Policy and programs → App content. This is a proposal drawn from `design.md` and
`../even-server/THREAT-MODEL.md`. Check it against Play's current definitions before submitting.

- **Privacy policy**: `https://even.appalaya.com/privacy`.
- **Data safety → "Does your app collect or share any of the required user data types?"**: proposed **No**.
  - Everything a user enters (names, amounts, notes, group names) is encrypted on the phone with a key that only
    group members hold, in the invite. The sync server stores ciphertext it cannot read. Play's data safety
    help says that user data sent off the device but "unreadable by you or anyone other than the sender and
    recipient as a result of end-to-end encryption does not need to be disclosed."
  - There are no accounts, analytics, advertising or crash-reporting SDKs, and no third-party SDK that sends data.
  - The one judgment call is **IP addresses**. The server keeps them only in abuse rate-limit counters that
    expire within an hour, never logs them, and derives no location from them ("What we log" in the threat
    model). Cloudflare, as host, keeps its own access logs. Play says to disclose IP addresses "based on their
    particular usage" (for example, as approximate location when used to locate users). This use does not fit
    Play's narrow "ephemeral" definition (in memory, for a single request), so decide whether it needs a
    declaration.
  - Traffic is HTTPS (encrypted in transit), should the form ask.
- **Ads**: none. **App access**: every feature works without an account or login. Complete the content rating,
  target audience and any other declarations the console lists. All must be done before the first closed
  testing (and production) rollout.
- The manifest keeps the Expo template's `SYSTEM_ALERT_WINDOW` and (up to Android 12) storage permissions. No
  declaration form covers them, but they can be dropped with `android.blockedPermissions` in `app.json` if Play
  or reviewers flag them.

## The native project (`android/`)

- `android/` is generated by prebuild and **committed**. When `app.json`'s native config changes (`android.*`,
  `plugins`, name, icon, splash, scheme) or a native dependency is added, removed or upgraded (including an Expo
  SDK upgrade), rerun it **by hand** and commit the result. CI never runs prebuild.

  ```bash
  npx expo prebuild --platform android --no-clean
  git diff android        # only the change you expect
  ```

  **Always pass `--no-clean`.** In this Expo CLI, prebuild cleans by default: a plain `npx expo prebuild`
  deletes `android/` and regenerates it from the template, dropping the hand edits below. Plain prebuild with no
  platform flag does this to `ios/` too. If it happens, restore the file with
  `git checkout -- android/app/build.gradle`. The workflow also fails any bundle not signed with the upload key.
- The hand edits. In `android/app/build.gradle`: the "Even:" block (signing and version numbers from the
  environment), `signingConfigs.release`, `buildTypes.release` using it, and the two assignments after
  `defaultConfig`. With `--no-clean`, prebuild rewrites the first `versionCode` and `versionName` literals in the
  file (the ones in `defaultConfig`) from `app.json`, so leave those alone; the assignments after them win. In
  `MainActivity.kt`: `onConfigurationChanged`, which keeps the navigation bar's buttons on the app's light or dark
  after the phone's theme or App settings' Appearance changes. In `res/values/styles.xml`, AppTheme's
  `android:enforceNavigationBarContrast` (false, so three-button navigation shows the canvas instead of the
  system's translucent scrim) and `android:windowLightNavigationBar` (`@bool/even_light_navigation_bar`, from
  `res/values/even_system_bars.xml` and its `values-night` twin); and its `alertDialogTheme` and
  `android:windowTitleStyle`, which dress `Alert.alert`'s dialog in Even's surface, ink, accent, radius and Inter
  (`res/values/even_dialog.xml` and its `values-night` twin, `res/drawable/even_dialog_background.xml`,
  `res/font/even_inter.xml`; the colours mirror `src/theme/themes.ts`, so change them together). Prebuild with
  `--no-clean` keeps items it does not set in `styles.xml` and never touches the `even_*` files; run on a copy of
  the repository, it left `android/` unchanged.
- `modules/even-crypto` (the native XChaCha20-Poly1305, design.md "Crypto") depends on Google Tink,
  `com.google.crypto.tink:tink-android` from Maven Central, pinned with `version { strictly '1.23.0' }` in its
  `android/build.gradle` (a plain `'1.23.0'` is only a minimum to Gradle; with `strictly`, any other library asking
  for another Tink fails the build). `android/gradle/verification-metadata.xml` makes Gradle check the jar's sha256
  (`c656918451b01c45ce5b20c7b6d4c388f956f61b3a3528e769048c8944c42f9e`, Maven Central's published
  `tink-android-1.23.0.jar.sha256`) on every build, CI included, and fail on any other bytes; every other artifact is
  trusted as before. It is pure Java: no native library, so nothing per ABI and nothing to align for 16 KB pages. R8
  keeps the few Tink classes the module uses and drops the rest (gson included) with no keep rules. The module zeroes
  its own copies of the key and the plaintexts; Tink's internal copies are left to the garbage collector. `info()`
  reports Tink's own `Version.TINK_VERSION`, compiled in from the jar the build resolved.
- To move Tink: change `strictly` in the module's `build.gradle`, download the new jar and its `.sha256` from Maven
  Central and check they agree, put the new version and sha256 in `verification-metadata.xml`, build, and check the
  startup line in logcat (`[even] crypto: native tink <version>, self-test passed`). The module uses an internal Tink
  class, `InsecureNonceXChaCha20Poly1305`, so also check its constructor and its (nonce, data, aad) argument order;
  if they change, the self-test fails and the app keeps @noble (`[even] crypto: @noble, the native module failed its
  self-test (...)`), slower but correct.
- R8 is on (`android.enableMinifyInReleaseBuilds=true` in `android/gradle.properties`, the Expo SDK 58 default).
  If a release build misbehaves where a debug build does not, add keep rules to `android/app/proguard-rules.pro`.
  Every native change (anything under `android/`, a native dependency, `app.json`'s native config) gets a
  release-build launch check before it is pushed: `cd android && ./gradlew assembleRelease`, install
  `app/build/outputs/apk/release/app-release.apk` on the emulator and launch it, and it must reach Groups with no
  WorkManager error in `adb logcat`.
- Local smoke build, not a release path: `cd android && ./gradlew bundleRelease` needs JDK 17 and an Android SDK
  (`ANDROID_HOME`). Gradle installs missing SDK packages, including React Native's pinned NDK. Without the
  `EVEN_UPLOAD_*` variables it signs with the debug keystore and prints a warning; Play rejects that bundle.
  Delete `android/app/build/` afterwards.

## The runner

`ubuntu-latest`: JDK 17 (Temurin, via `actions/setup-java`), Node 24 with the npm cache (`actions/setup-node`),
and the image's preinstalled Android SDK (build-tools 37, platform 37; Gradle adds the NDK version React Native
pins). There is no `setup-android` action. The Gradle cache is `gradle/actions/setup-gradle` with
`cache-provider: basic`: the MIT-licensed provider over `actions/cache`, with no extra terms. The timeout is
45 minutes, and a newer push to the same ref cancels an older run; Play commits an upload in one step at the
end, so a cancelled run publishes nothing. GitHub has announced that `ubuntu-latest` moves to Ubuntu 26.04 in
November 2026; if the build breaks then, pin `runs-on: ubuntu-24.04`.
