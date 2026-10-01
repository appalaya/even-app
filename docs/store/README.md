# Store screenshots

Raw captures of the dev seed (`src/dev/seed.ts`), taken on 30 September 2026 from main at `6ed8759`. They have no
frames or captions. This README covers `ios/` and `android/` only. The other files in this folder are listing assets,
and [`../store-listing.md`](../store-listing.md) describes them along with the screen order and captions.

| | iOS (`ios/`) | Android (`android/`) |
|---|---|---|
| Device | iPhone 18 Pro Max simulator, iOS 27, Debug build | Pixel 10 emulator `even_pixel10_api37`, Android 17 (API 37), Debug build |
| Size | **1320 × 2868** (App Store 6.9-inch) | **1080 × 1920** (`adb shell wm size 1080x1920`, `adb shell wm density 380`) |
| Format | PNG, 8-bit RGB, no alpha | PNG, 8-bit RGB, no alpha |

The Android set is not at the Pixel 10's native 1080 × 2424, because Play rejects a phone screenshot whose long side
is more than twice the short side (2424 / 1080 = 2.24). At the native 420 dpi, a 1080 × 1920 screen is 411 × 731 dp,
and the bottom keypad row of Add expense (". 0 ⌫") was cut off under the gesture bar. So all nine were taken at
density 380, which gives 455 × 808 dp.

## Files

Both folders use the same names. The seed state is the `state` in `even://dev/seed?state=<state>`.

| File | Screen | Seed state | Steps after the seed |
|---|---|---|---|
| `01-groups.png` | Groups: Banff 2026 (you owe $52.00), Oak Street house (you're owed $44.00), Friday dinners (you owe $12.00), Tofino weekend (nothing yet), Archived · 2 | `groups` | None |
| `02-group.png` | Group: Banff 2026, "You owe $52.00", the settle list, the Expenses tab | `group` | None |
| `03-add-expense.png` | Add expense with a title, an amount, and a category chip | iOS: `add-expense`. Android: `add-first` | iOS: none. The seed draws "Surly's brewing", $36.00, and the model's Drinks chip with its sparkle. Before using it, the simulator's on-device model was confirmed to be available and to answer `drinks` for that title. Android has no on-device model, so the chip there is the keyword table's: Title was set to "Lake Louise shuttle" and 3, 6 entered on the keypad, which gives Transit with no sparkle |
| `04-split.png` | Split, Equal: Maya ×2, Nathan +$12.00 | `split-equal` | None |
| `05-balances.png` | Balances tab: everyone's net, Settle up, spend by category | `balances` | iOS: the tab was chosen again, then the view scrolled to y = 276 pt. On the 6.9-inch screen the content is too short for the segment to stick, and where the scroll stopped, the done-adding row was half under the nav bar. Android: none, because the segment sticks under the nav bar |
| `06-settle.png` | Record a payment: You → Maya, $44.00 | `settle` | None |
| `07-activity.png` | Activity tab | `activity` | None |
| `08-invite.png` | The share arrow's menu: Share link · Show QR code | `group` | The share arrow was pressed. The QR sheet ("Scan to join") was also captured but not kept, because its code is a working invite whose payload carries the seed's server, 127.0.0.1:8787, and Join shows that server to anyone who scans it |
| `09-group-dark.png` | Group in dark mode | `group` | System appearance set to dark: `xcrun simctl ui <udid> appearance dark` and `adb shell cmd uimode night yes` |

None of these screens shows the sync server's host. Group settings, Join, Move server, and recovery were left out for
that reason.

## How they were made

- `npm run dev:server` started with an empty database. Metro was run as `CI=1 npx expo start --port 8081`; CI mode
  turns reloads off, so no "Refreshing" banner can appear. The seeds synced only with 127.0.0.1:8787 (iOS) and
  10.0.2.2:8787 (Android).
- Every state started from a cold start. On iOS: `xcrun simctl terminate`, then `launch`, then
  `router.push('/dev/seed?state=<state>')` through Metro's debugger. `simctl openurl` raises an "Open in "Even"?"
  prompt that a script cannot answer. On Android: `am force-stop`, then
  `am start -a android.intent.action.VIEW -d "even://dev/seed?state=<state>"`, as in
  [`../android-review.md`](../android-review.md).
- Presses and field entries went through a small Chrome DevTools Protocol script connected to Metro's inspector
  (`http://localhost:8081/json/list`). It calls the rendered element's `onPress`, `onChangeText`, `onKey`, or
  `onChange`, as a tap would, and clears LogBox. No UI scripting was used, and the keyboard stays down.
- Status bar, iOS: `xcrun simctl status_bar <udid> override --time 9:41 --batteryLevel 100 --batteryState charged
  --cellularBars 4 --wifiBars 3`.
- Status bar, Android: SystemUI demo mode (`settings put global sysui_demo_allowed 1`, then `am broadcast -a
  com.android.systemui.demo` with `enter`, `clock -e hhmm 0941`, `battery -e level 100 -e plugged false`,
  `network -e wifi show -e level 4 -e fully true`, `network -e mobile hide`, and `notifications -e visible false`).
  The mobile icon is hidden because its demo version drew a "3G" label.
- On Android, Private DNS was set to a host that does not resolve (`private_dns_mode hostname`,
  `private_dns_specifier dns-blocked.invalid`), so nothing could reach sync.even.appalaya.com. That block posts two
  "Private DNS server cannot be accessed" notifications. Both were snoozed (`cmd notification snooze`) to keep their
  icon out of the status bar.
- Captured with `xcrun simctl io <udid> screenshot` and `adb shell screencap -p`, then flattened from RGBA to RGB with
  Pillow. Every capture's alpha was 255 everywhere, so no pixel changed.

## iPad

Not needed. `app.json` has `"supportsTablet": false`, and the Xcode project builds with `TARGETED_DEVICE_FAMILY = 1`
(iPhone only), so App Store Connect asks only for iPhone screenshots.
