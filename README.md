# Space Calendar

The calendar from Space, in Obsidian. Now, Day, Week (time Across or Down) and Month, with lanes so nothing overlaps, the now line, the "Now" strip, and Undo (Cmd+Z while the calendar has focus).

Open it with the calendar ribbon icon or the command **Space Calendar: Open calendar**. Keys inside the calendar: 1 to 4 switch views, left and right step, T goes to today, Esc closes a popover.

## What it shows

1. **Kanban cards with a date.** Every card `- [ ] text @{YYYY-MM-DD}` on every board (`kanban-plugin: board` in the frontmatter) shows on its day, coloured by board. Done cards (`- [x]`) show struck through. A card with `@@{HH:mm}`, or (setting "Read times written in cards", on by default) with a time in its text like `18:00` or `16:30 to 18:45`, sits on the hours in "My plan"; without one it waits at the top of its day. Cards in the archive section are ignored.
   - Click a card: its board opens in a new tab.
   - Drag a card to another day (Week, Month, the all-day strip): only that card's `@{date}` changes, on that exact line, through `app.vault.process`. The line must still read exactly as it did when the calendar read it (or be the only line on the board that reads so), and hold exactly one `@{date}`. Otherwise nothing is written and a notice says why. The time and the text are never rewritten. Undo puts the old date back with the same check.
   - On today's Day view, open cards with a date in the past wait under "Slipped", with a Today button that moves them to today.
2. **Daily notes** (`Daily/YYYY-MM-DD.md`, folder in settings) show as a dot on their day. Click it to open the note.
3. **ICS feeds**, read only. Paste one iCal address per line in settings. Timed, all-day and TZID times; DAILY, WEEKLY (BYDAY), MONTHLY and YEARLY repeats with INTERVAL, COUNT, UNTIL, EXDATE and moved single days. Feeds refresh every 15 minutes and with the command "Refresh calendar feeds".
4. **Google Calendar**, read and write, once an OAuth client ID is entered. Drag empty time to make an event (double-click for an hour), drag an event to move it, drag its edges to stretch it, Alt-drag to copy, click it for the editor (name, time, all day, colour, place, description, delete), arrow keys move the picked event, Delete twice deletes. A repeating event changes only the day you changed. **Not yet tested against Google**: no client ID existed when this was built.

## Privacy and sync

`data.json` (synced and committed with the vault) holds only: week start, the view a new tab opens in, the daily notes folder, and two toggles.

ICS addresses, the Google client ID and secret, the Google tokens, and the last view, direction and hour size are kept per device with `app.saveLocalStorage`. They never leave this device.

`manifest.json` sets `isDesktopOnly: true` for now. The code itself has no top-level Node imports; the Google sign-in loads Node's `http` only on desktop, at the moment you connect.

## Connect Google Calendar

The quick way, read only: in Google Calendar on the web, open Settings, pick your calendar, **Integrate calendar**, copy **Secret address in iCal format**, and paste it under **Calendar feeds** in the plugin settings. Then **Save and read feeds**.

Read and write, in the existing Google Cloud project `hub` (see Space's `docs/google-setup.md`; the Calendar API, consent screen, test user and calendar scope are already set up there):

1. Open https://console.cloud.google.com/auth/clients with `hub` selected and click **Create client**.
2. Application type **Desktop app**, name `Obsidian Space Calendar`, **Create**.
3. Copy the **Client ID** and **Client secret** from the box.
4. In Obsidian: Settings, Space Calendar, paste both under Google Calendar, click **Save and connect**.
5. The browser opens Google. Pick your account, click **Continue** on "Google hasn't verified this app", tick the calendar box, **Continue**. The tab says you can close it.

While the `hub` app is in Testing, Google ends the sign-in after 7 days; connect again then, or publish the app as described in `docs/google-setup.md`.

## Build

```sh
npm install
npm test          # parsers: Kanban cards, the date rewrite, ICS
npm run build     # typecheck and bundle main.js
npm run deploy    # build, then copy main.js, manifest.json, styles.css into ~/Obsidian/salamind/.obsidian/plugins/space-calendar/
```

`deploy` copies files (never a symlink, which Syncthing would ship dangling). Set `SPACE_CAL_DEST` to deploy elsewhere.

## Layout

- `src/view.ts`: the pane, the bar, Now, Month, details, toast and Undo (Space's `calendar.js`)
- `src/time.ts`: Day and Week, Across and Down (Space's `cal-time.js`)
- `src/edit.ts`: card drags and Google editing (Space's `cal-edit.js`)
- `src/sources/`: Kanban, daily notes, ICS, Google
- `styles.css`: Space's calendar look, coloured from the Obsidian theme
