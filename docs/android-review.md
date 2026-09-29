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
| Expense detail | both | Matches. **Deviates:** "Delete this expense?" is Android's AppCompat dialog (square corners, CANCEL and DELETE in capitals, AppCompat's teal, Delete not red). No board draws this dialog; see the questions. |
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
| Diagnostics (AppDiagnostics) | both | **Deviates:** Android has no on-device model, so Status reads "Unavailable: this device can't run it", Model "—" and Check the model is off; This build reads Android 17 and the device model, with no Apple Intelligence row. No board draws Android; see the questions. |
| In-app browser (ReportInBrowser) | both | **Deviates:** a Chrome Custom Tab. Its bar takes `surface` in both modes, but it closes with an ✕ (a "Done" text button is iOS only) and Chrome adds minimise, share and menu buttons. Back returns to the app. |
| Splash | both | Matches: the mark on the canvas colour in each mode. |

### Across every screen

- **Font.** Inter everywhere on Android (Display from 24 pt), with tabular figures. It is a little wider than SF, so
  some lines wrap one word earlier. At 130 % font size everything holds (the back label truncates, as on iOS); at
  200 % the sheet header's "Cancel" runs into its centred title (see the questions).
- **Status bar.** Dark icons in light, light in dark, and over sheets and the camera prompt; they follow App
  settings' Appearance too.
- **Navigation bar.** Gesture navigation: transparent, content scrolls under it. Three-button navigation: the
  system draws its translucent contrast scrim, a band a shade off the canvas colour (see the questions). **Bug
  fixed:** after the phone's theme or App settings' Appearance changed with Even open, that bar kept the old light or
  dark.
- **Back.** The back gesture and button close sheets and the share menu, close Create and Join, return from Split
  to Add expense and from Group to Groups.
- **Pressed states.** The app's own (`rowPressed`, `accentPressed`, opacity), as the States board draws; no ripple.
- **Haptics.** They fire (keypad taps, a found invite). The success buzz is sent with usage `UNKNOWN`, so turning off
  Android's touch feedback does not silence it; keypad taps (usage `TOUCH`) do respect it.
- **Notifications.** **Bug fixed:** Android 13 and later report a permission never asked for as `denied` with
  `canAskAgain`; the app read that as a refusal, so neither the switch nor the group screen's one-time ask ever
  showed the prompt, and notifications could only be turned on in the Settings app. With the fix the prompt shows, the
  switch turns on, and a posted activity notification reads "Banff 2026 / Maya added Dinner · $90.00" with the mark
  as its icon. It sits in Android's "Miscellaneous" channel (see the questions).
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

## Questions for the owner

1. **Three-button navigation.** Android puts a translucent scrim behind the three buttons, a band slightly off the
   canvas colour under every footer and sheet. Keep the system's scrim, or draw the canvas colour through it? The
   second needs a native theme setting (`enforceNavigationBarContrast` off) and the app then owns the buttons'
   contrast.
2. **System dialogs.** "Delete this expense?" and the error alerts are Android's AppCompat dialog, not drawn
   anywhere on the canvas. Leave them as the platform's, theme them with the accent, or draw a confirm sheet?
3. **In-app browser.** A Custom Tab cannot show "Done"; it has an ✕, and Chrome's minimise, share and menu. Is that
   acceptable for Help, Privacy, Terms, Source code and Report?
4. **Diagnostics on Android.** The category model and "Check on this phone" describe an iOS-only feature. On Android
   they read "Unavailable: this device can't run it" with the button off. Hide those sections on Android, or write
   Android copy for them?
5. **Notification channel.** Android files Even's notifications under "Miscellaneous", the library's fallback
   channel, which people see in system settings. Should the app create a named channel, and what is it called?
6. **Largest text sizes.** At 200 % on Android, a sheet's "Cancel" runs into its centred title ("CancelNew
   expens…"). The layout is shared, so iOS's accessibility sizes likely do the same. Which gives way?

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
  `adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton`.
