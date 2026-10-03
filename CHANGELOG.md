# Changelog

All notable, user-facing changes to Even, newest first. Entries are written in
App Store voice: what someone using the app notices, never how it was built
(see RELEASE.md, "Changelog discipline"). Each merge to main adds to
`[Unreleased]`; when a TestFlight build is promoted it gets its own section
annotated with the build number, and when an App Store version ships, the
builds since the last version roll up into a versioned section whose text
becomes the "What's New" notes.

## [Unreleased]

### New
- Split costs with friends with no accounts and no ads: create a group, share
  a link or a code, add what you paid, and see who owes whom
- Settle up in the fewest payments, even after time offline
- Everything is encrypted on your phone before it leaves it; the server that
  keeps your group in sync cannot read it
- Invite by QR code: show one from the invite card or Group settings, and
  scan one from Join with code
- Report a group, or ask for help and send feedback, from inside the app
- After a reinstall, a group you were in gets your name back on its own; a
  phone that never picked a name is asked
- Even names the category for you as you type the title, on your phone, with
  nothing sent anywhere (iPhones with Apple Intelligence turned on)
- An About page with a Diagnostics screen that shows what the app knows about
  its model and sync; nothing leaves your phone
- A screen that fails to draw shows a message instead of closing the app
- An unknown link shows "Even can't open this link"
- When a group is regenerated, you're asked before your entries move into the
  new one
- On Android, group activity notifications have their own channel, named
  "Group activity"

### Changed
- Large groups open much faster: you see the first rows right away, and
  nothing freezes while the rest loads
- The first launch of this build re-reads every group from the server, so
  your first sync may take a minute
- Opened from the app, Privacy, Terms, and Contact no longer lead back to the
  website's home page
- On Android, the delete confirmation and the three-button navigation bar
  match Even's own look, not the system's

### Fixed
- Tapping an invite link opens Join even when Even is already open
- An invite for a group you're already in says so, and opens it
- The extra chip on Split shows the whole amount, not just a plus sign
- The keyboard goes away once a pasted invite code is complete
- The back-swipe gesture in dark mode no longer shows a light edge behind the
  screen
- On short phones, the keypad and Save stay on screen in Add expense and
  Settle
- On Android, dismissing the notification prompt no longer counts as a
  permanent no; Even can ask again
- The largest text sizes keep Cancel and Done whole
- An entry dated far in the future, whether from a wrong clock or someone
  trying to cause trouble, can no longer lock in a group's name, its archived
  state, or an expense's edits
- A duplicate "group created" record can no longer switch a group's currency
