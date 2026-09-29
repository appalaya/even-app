# Android review against the canvas

The first run of Even on Android, screen by screen against the design canvas
(https://claude.ai/artifact/HqwMHUvww8bGQqPSLckPir), in light and dark. Every screen was opened from the dev seed
(`even://dev/seed?state=…`) in a Debug build with Metro, screenshotted with `adb exec-out screencap -p`, and set beside
its board rendered at the emulator's density. Screenshots of six screens in both modes are in
[`screenshots/android/`](screenshots/android/).

## The emulator

| | |
|---|---|
| Device profile | `pixel_10` (the SDK's Pixel 10 definition) |
| Screen | 1080 × 2424 px, 420 dpi (density 2.625), about 411 × 923 dp |
| System image | Android 17, `system-images;android-37.2;google_apis_ps16k;arm64-v8a` (API 37, 16 KB pages) |
| Emulator | 37.1.11, headless, SwiftShader GPU, 4 GB RAM |
| Navigation | gesture navigation; three-button navigation checked separately |
| Build | Debug, arm64-v8a only, JS from Metro (`10.0.2.2:8081`) |

The canvas is 402 × 874 pt with a 62 pt status bar. The emulator is 49 dp taller with a shorter status bar, so on
every screen the content starts higher, footers sit lower, and sheets sized to their content start lower. That is
the safe area doing its job and is not listed below.

Two things about the environment shaped what the screenshots show:

- The default server is live, and the seed assumed it was not. After the first Groups run pushed one seeded group
  ("Friday dinners", encrypted) to `sync.even.appalaya.com`, the emulator's DNS was blocked (Private DNS set to a
  host that does not resolve), so later screens show offline states ("waiting to sync", "Not synced since…").
  Seeds now sync with the dev server instead (`npm run dev:server`, reached from the emulator at `10.0.2.2:8787`;
  README "Development"), so a new pass needs neither the DNS block nor offline states.
- Offline, the seed for Group settings and Report sometimes fails with "GET /v1/info: no response" when the previous
  run left groups behind (it looks like the seed's primed `/v1/info` meets the app's own request for it, which fails
  offline). Starting from an empty store (`state=groups-empty`) first avoids it. This is the dev seed, not the app.

## Screens

"Matches" means the same layout, spacing, type, copy and colours as the board, allowing for the font and the safe
area. Differences that come from the seed's data or from shared code, and so would show on iOS too, are marked
"(not Android)".

| Screen (boards) | Light and dark | Result |
|---|---|---|
| Groups (Main, GroupsDark) | both | Matches. Tofino weekend shows no net where the board draws "settled": design.md's rule for a group with nothing in it (not Android). |
| Groups, empty (GroupsEmpty) | both | Matches at the rest frame. The seed sets a name, so the top right is "S", not the person glyph (not Android). |
| Group (Group, GroupDark) | both | Matches. **Bug fixed:** pull to refresh drew Android's default white disc with a black arc, in dark mode too; it now uses `surface` and `textMuted`. |
| Balances | both | Matches. On the taller screen the seeded scroll cannot push the header fully away, so the sticky control sits a little lower. |
| Activity | both | Matches. The seed's titles are longer than the board's ("Nathan's Sunshine Village lift tickets"), so lines wrap differently (not Android). |
| Add expense (AddExpense, AddExpenseStates) | both | Matches, keyboard state included: Save sits 12 above the keyboard. |
| Split | both | Matches. The board's check glyph is Chrome's HTML checkbox; the app draws its own (not Android). |
| Expense detail | both | Matches. "Delete this expense?" is Android's AppCompat dialog, themed since the owner's decision 2 (below): the surface colour, 28 dp corners, Inter, sentence-case Cancel and Delete in the accent. Delete is not red. No board draws this dialog. |
| Settle | both | Matches. |
| Category picker | both | Matches. Emoji are Android's (Noto), here and everywhere. |
| Date sheet (AddExpenseStates 6) | light | Matches; the app's own calendar, so no native date picker is involved. |
| Emoji picker | light | Matches. Searching shows its results above the keyboard. |
| Join with code (JoinCode, JoinCodePreview) | both | **Bug fixed:** the code field and its placeholder were in the sans face (Android has no `ui-monospace`); now monospace, wrapping as the board does. **Bug fixed:** "Canadian Dollar" is now "Canadian dollar". **Bug fixed:** the keyboard covered Join; the sheet now ends 12 above it. |
| Scan (JoinScan, JoinScanDenied) | light | Matches, including the denied panel; Open Settings opens Even's app info. **Deviates (brief):** Android's camera prompt appears over Groups before the Scan sheet has slid in (the slide pauses while the system dialog is in front); iOS shows its alert over the sheet. The camera shows the emulator's scene; a scan (injected) goes to "Invite found", buzzes, and hands the code to Join. |
| Create group (CreateGroup) | both | **Bug fixed:** "Canadian dollar". **Bug fixed:** the keyboard covered Create group; it now sits above the keyboard. |
| Group settings (GroupSettings) | both | **Bug fixed:** the invite link is monospace. **Bug fixed:** Rename group and Add member opened with the caret in the field but no keyboard; the keyboard now comes up. |
| Invite QR (InviteQR) | light | Matches. The screen goes to full brightness while it is open (window brightness override 1.0) and back when it closes; the QR decodes. |
| Share menu (GroupShareMenu) | light | Matches; back closes it. Share link opens Android's share sheet, which is the system's, not the ShareSheet board. **Deviates (brief):** the menu's fade-out waits behind the share sheet and finishes on return. |
| Report (ReportGroup) | both | Matches after the monospace fix (the group id). Continue to report was not pressed; it opens the same in-app browser as Help (below). |
| Name pick and no seat (SeatPick, SeatSameDevice, GroupNoSeat) | both | Matches. On SeatSameDevice the board darkens the screen behind both sheets more than the app does (one scrim, as `Sheet` documents) (not Android). |
| App settings (AppSettings) | both | Matches. **Bug fixed:** the Notifications switch sent people to the Settings app instead of asking; Android reports a never-asked permission as denied (see below). |
| About (AppAbout) | both | Matches. A local build reads "1.0 (1)". |
| Diagnostics (AppDiagnostics) | both | Android has no on-device model, so since the owner's decision 4 (below) it leaves out Category model and Check on this phone: the page opens on Sync, then This build (Android 17 and the device model, no Apple Intelligence row). No board draws Android. |
| In-app browser (ReportInBrowser) | both | A Chrome Custom Tab, accepted as it is (the owner's decision 3, below). Its bar takes `surface` in both modes; it closes with an ✕ (a "Done" text button is iOS only), Chrome adds minimise, share and menu buttons, and Chrome shows its own first-run screen the first time. Back returns to the app. |
| Splash | both | Matches: the mark on the canvas colour in each mode. |

### Across every screen

- **Font.** Inter everywhere on Android (Display from 24 pt), with tabular figures. It is a little wider than SF, so
  some lines wrap one word earlier. At 130 % font size everything holds (the back label truncates, as on iOS). At
  200 % the sheet header's "Cancel" ran into its centred title; since the owner's decision 6 (below) Cancel keeps its
  width and the title gives way.
- **Status bar.** Dark icons in light, light in dark, and over sheets and the camera prompt; they follow App
  settings' Appearance too.
- **Navigation bar.** Gesture navigation: transparent, content scrolls under it. Three-button navigation: the
  system drew its translucent contrast scrim, a band a shade off the canvas colour; since the owner's decision 1
  (below) the canvas shows through, with dark buttons in light and light in dark. **Bug fixed:** after the phone's
  theme or App settings' Appearance changed with Even open, that bar kept the old light or dark.
- **Back.** The back gesture and button close sheets and the share menu, close Create and Join, return from Split
  to Add expense and from Group to Groups.
- **Pressed states.** The app's own (`rowPressed`, `accentPressed`, opacity), as the States board draws; no ripple.
- **Haptics.** They fire (keypad taps, a found invite). The success buzz is sent with usage `UNKNOWN`, so turning off
  Android's touch feedback does not silence it; keypad taps (usage `TOUCH`) do respect it.
- **Notifications.** **Bug fixed:** Android 13 and later report a permission never asked for as `denied` with
  `canAskAgain`; the app read that as a refusal, so neither the switch nor the group screen's one-time ask ever
  showed the prompt, and notifications could only be turned on in the Settings app. With the fix the prompt shows, the
  switch turns on, and a posted activity notification reads "Banff 2026 / Maya added Dinner · $90.00" with the mark
  as its icon. It sat in expo-notifications' fallback channel, "Miscellaneous"; since the owner's decision 5
  (below) it is posted in "Group activity".
- **Debug builds only.** React Native's debug manifest asks for local network access on Android 17, so a Debug
  build shows a nearby-devices prompt at first launch. The release manifest does not declare it; nothing asks for
  a permission at launch there.

## Bugs fixed

Each is Android only and leaves iOS as it was.

1. The invite link, code field and group id drew in the sans face: `monoFamily` is `monospace` on Android.
2. Currency names read "Canadian Dollar": Hermes on Android names a currency with its display name, the same for any
   count; in English the CLDR table now wins when one and two get the same name.
3. The Notifications switch and the group screen's ask never showed the permission prompt: `denied` is read as a
   refusal only when the OS will not ask again.
4. Pull to refresh on Group drew a white disc in dark mode: it takes `surface` and `textMuted`.
5. The keyboard covered the foot of every sheet (Join, Create group, Rename): on Android a sheet follows React
   Native's keyboard events, since Reanimated's hook does not see a Modal's window.
6. Rename group and Add member opened without the keyboard: on Android the field is focused once the sheet is up.
7. The navigation bar kept its first light or dark: `MainActivity` sets it again on every configuration change (a
   hand edit that `prebuild --no-clean` keeps; RELEASE-android.md lists it).

The Inter change is a separate commit: the OFL release's Regular to Bold in both cuts under `assets/fonts` (with the
license), app.json's `expo-font` entry for Android, and `src/theme/typography.ts`. `npx expo prebuild --platform
android --no-clean` added `res/font` (the eight files and two family XMLs) and two lines registering them in
`MainApplication.kt`; run again after the `MainActivity.kt` edit, it changed nothing.

## The owner's decisions

These six questions went to the owner on 29 September 2026, who took every recommendation as it was. Each is built
and was checked on the Pixel 10 emulator, and where the change is shared with iOS, on the iPhone 17 simulator too.

1. **Three-button navigation: the canvas shows through.** Android put a translucent scrim behind the three buttons,
   a band a shade off the canvas under every footer and sheet (#FEFEFE over #F6F5F1 in light, #141619 over #0E100F in
   dark). AppTheme now sets `android:enforceNavigationBarContrast` to false (API 29 and later). With the scrim off
   React Native leaves the buttons to the app, so AppTheme also sets `android:windowLightNavigationBar` from
   `@bool/even_light_navigation_bar` (dark buttons in light, light in dark, from `values` and `values-night`), and
   `MainActivity.onConfigurationChanged` still follows a theme change with Even open. Sheets are dialogs whose theme
   is built on AppTheme, so they follow too. Checked with three-button navigation: under the buttons Group reads
   #F6F5F1 in light and #0E100F in dark, Add expense and Join with code read the sheet's surface, and the buttons
   stay readable with the phone dark and Appearance Light, the phone light and Appearance Dark, and on a cold start
   in each. Both are hand edits that `prebuild --no-clean` keeps (RELEASE-android.md).
2. **System dialogs: the AppCompat dialog, themed.** "Delete this expense?" and the error alerts stay Android's
   dialog, with no new board and no sheet, dressed in Even's theme (`res/values/even_dialog.xml` and its night twin):
   the `surface` colour with 28 dp corners (the sheets' radius), the title 20 sp Inter SemiBold in `text`, the
   message in `textSecondary`, and sentence-case buttons (no capitals) in the accent, #1F6B5A in light and #74C1AB
   in dark, Inter SemiBold 16 sp. React Native builds the title with the activity's theme, so AppTheme's
   `android:windowTitleStyle` carries it, over `res/font/even_inter.xml` (the family expo-font writes names its fonts
   for AppCompat only, and that title is a framework TextView). Checked in light and dark, from a cold start and
   after the phone's theme changed with Even open. **Not done exactly: Delete is not red.** React Native's
   `style: 'destructive'` is iOS only, and a theme can colour only the positive button, which is also the OK of
   every one-button alert; a red Delete needs a native module, so both buttons take the accent. The message style
   is set but was not seen: no seeded screen raises an alert with a message (only "Couldn't move to …" has one). An
   alert that is already open when the phone's theme changes keeps its colours until it closes; the next one
   follows. React Native's alerts are not closed by Back on Android (its `cancelable` defaults to false), as before.
3. **In-app browser: the Chrome Custom Tab, as it is.** No code change. Help and feedback, Privacy, Terms, Source
   code and Report open in a Custom Tab, which closes with an ✕ instead of Done, adds Chrome's minimise, share and ⋮
   menu, and shows Chrome's own first-run screen ("Stay signed out") the first time any Custom Tab opens on the
   phone; the app cannot skip it. It is the Android norm, keeps cookies, autofill and the contact page's Turnstile
   working, and Back returns to the app. design.md's In-app browser note records it.
4. **Diagnostics on Android: no model sections.** `diagnosticsSections(os, groupCount)` lists the page's sections:
   Category model and Check on this phone on iOS only, Sync with a group, This build always. On Android the page
   opens on Sync, 16 below the nav bar as the first section is on iOS, or on This build with no groups. iOS is
   unchanged: the simulator's page matched a screenshot from before the change pixel for pixel, apart from the
   clock and one live model timing. Tests cover both platforms' lists. **Left:** About's caption for the Diagnostics
   row still reads "What the app knows about its model and sync." on Android too; changing it needs Android copy,
   which the decision did not include.
5. **Notification channel: "Group activity".** At launch, and before the background task posts, the app creates
   one channel: id `group-activity`, name "Group activity", description "New expenses and payments in your
   groups." Every activity notification is posted in it (expo-notifications takes the channel on the trigger, as
   `{ channelId }`). It is delivered as "Miscellaneous" was: that fallback channel is importance high (read on the
   emulator: 4, with vibration and the badge on), which Settings shows as "Default" with "Pop on screen" on, so
   "Group activity" is created the same way. An app can lower a channel's importance later but never raise it.
   Creating a channel asks for no permission. Checked: a fresh install lists only "Group activity", with its
   description, in Settings › Apps › Even › Notifications, and the dev seed's notification ("Banff 2026 / Maya added
   Dinner · $90.00") was posted in it. Installed over an older build, "Miscellaneous" stays beside it: Android
   keeps a channel until the app deletes it or is uninstalled, so only a phone that ran an earlier build shows both.
6. **Largest text sizes: the title gives way.** In the shared sheet header the actions keep their full width and
   never truncate; the centred title takes the room between them on one line. `navTitlePlacement` keeps it centred
   in the sheet while it clears both actions by 8, moves it off centre only as far as it must, and ends it in an
   ellipsis when even that room is too narrow. At 200 % on Android, Join with code, New expense and Record a
   payment fit whole beside Cancel, and Split ends "Spl…" between "‹ New expense" and Done. At iOS's largest
   accessibility size, Cancel stays whole and the titles are cut ("Join…", "New…", "Reco…"). At the default sizes
   the titles sit where they did: Add expense's header matches this review's screenshot pixel for pixel, Join with
   code's title sits 1 px (0.4 dp) left from rounding, and on iOS the Join with code header matches an earlier
   screenshot exactly. **Left:** at iOS's largest size Split's back button ("‹ New expense") fills the row and
   pushes Done past the right edge. It did before this change too (the actions never shrank), and the rule the
   owner chose covers Cancel; letting the back label truncate, as the full-screen back button already does, would
   keep Done reachable. That is a question for the owner.

## Not verified

- **OEM skins cannot be emulated.** Samsung One UI, Xiaomi HyperOS, OnePlus and others change the navigation bar,
  font scaling steps, the emoji font, system dialogs, the default Custom Tabs browser, and how aggressively they stop
  background work. Only the stock Pixel system was checked.
- Scanning a real QR code with a real camera (the emulator shows a virtual scene; the scan was injected).
- Background refresh and notifications arriving from it; App Links (`even.appalaya.com/i`) verification; both need a
  real device and, for links, the published asset links.
- A release (R8) build on the device. Only its merged manifest was checked.
- Android 12 and earlier (a different notification permission model) and Android 8 and earlier (no 500 and 600
  weights before Android 9: Inter falls back to Regular or Bold).
- Tablets, foldables, TalkBack, the empty-state motion beyond its rest frame, and how the haptics feel.

## Setup that worked

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk
# Homebrew's sdkmanager needs --sdk_root; its avdmanager cannot see this SDK, so install the SDK's own.
yes | sdkmanager --sdk_root=$ANDROID_HOME "emulator" "cmdline-tools;latest" \
  "system-images;android-37.2;google_apis_ps16k;arm64-v8a"
echo no | $ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd -n even_pixel10_api37 \
  -k "system-images;android-37.2;google_apis_ps16k;arm64-v8a" -d pixel_10
# ~/.android/avd/even_pixel10_api37.avd/config.ini: hw.ramSize=4096, hw.gpu.enabled=yes,
# hw.gpu.mode=swiftshader_indirect
$ANDROID_HOME/emulator/emulator -avd even_pixel10_api37 -no-window -gpu swiftshader_indirect \
  -no-audio -no-boot-anim -no-snapshot-save &

(cd android && ./gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
npm run dev:server            # in its own shell: the seed's sync server, 127.0.0.1:8787 (10.0.2.2:8787 here)
npx expo start --port 8081
```

- adb 37.0.1's server aborts every few minutes on this macOS ("libunwind: stepWithCompactEncoding"), which also
  drops `adb reverse`. So the app reads Metro at `10.0.2.2:8081` (`debug_http_host` in its default shared
  preferences, written with `run-as`), and every adb call first restarts the server if it is gone.
- Debug builds only: `adb shell pm grant com.appalaya.even android.permission.ACCESS_LOCAL_NETWORK`.
- Before the first seed on an emulator that ran seeds before the dev server, open `even://dev/cleanup` once: the seed
  refuses to run while the emulator still holds groups on production, and that page deletes their copies there.
- Seed states: `adb shell am force-stop com.appalaya.even` then
  `adb shell am start -a android.intent.action.VIEW -d "even://dev/seed?state=<state>" com.appalaya.even`. A cold
  start each time; a warm deep link can leave an earlier sheet route under the new one.
- Light and dark: `adb shell cmd uimode night no|yes`. Three-button navigation:
  `adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton` (and
  `…navbar.gestural` to go back). Font size: `adb shell settings put system font_scale 2.0` (1.0 to go back).
- Status bar at 9:41: `adb shell settings put global sysui_demo_allowed 1`, then
  `adb shell am broadcast -a com.android.systemui.demo -e command enter` and `… -e command clock -e hhmm 0941`.
- An `Alert.alert` dialog is not closed by Back; tap its Cancel. A Back sent while it is open does nothing, so the
  dialog in the next screenshot is the same one.
