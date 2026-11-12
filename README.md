# Space Calendar

A calendar for your Obsidian vault. Now, Day, Week (time Across or Down) and Month, with lanes so nothing overlaps, the now line, the "Now" strip, and Undo (Cmd+Z while the calendar has focus).

Open it with the calendar ribbon icon or the command **Space Calendar: Open calendar**. Keys inside the calendar: 1 to 4 switch views, left and right step, T goes to today, Esc closes a popover.

Works on its own: you do not need Space or anything else. Kanban cards need the [Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin's board format.

## Install

Not in the community plugin list yet. Either:

- With [BRAT](https://github.com/TfTHacker/obsidian42-brat): Add beta plugin, paste `MaryanPrydatko/obsidian-space-calendar`.
- By hand: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/MaryanPrydatko/obsidian-space-calendar/releases/latest) into `<vault>/.obsidian/plugins/space-calendar/`, then turn on Space Calendar in Settings, Community plugins.

Desktop, iPad and iPhone. Connecting Google works in the desktop app; ICS feeds, Kanban cards and daily notes work everywhere.

## What it shows

1. **Kanban cards with a date.** Every card `- [ ] text @{YYYY-MM-DD}` on every board (`kanban-plugin: board` in the frontmatter) shows on its day, coloured by board. Done cards (`- [x]`) show struck through. A card with `@@{HH:mm}`, or (setting "Read times written in cards", on by default) with a time in its text like `18:00` or `16:30 to 18:45`, sits on the hours in "My plan"; without one it waits at the top of its day. Cards in the archive section are ignored.
   - Click a card: its board opens in a new tab.
   - Drag a card to another day (Week, Month, the all-day strip): only that card's `@{date}` changes, on that exact line, through `app.vault.process`. The line must still read exactly as it did when the calendar read it (or be the only line on the board that reads so), and hold exactly one `@{date}`. Otherwise nothing is written and a notice says why. The time and the text are never rewritten. Undo puts the old date back with the same check.
   - On today's Day view, open cards with a date in the past wait under "Slipped", with a Today button that moves them to today.
2. **Daily notes** (`Daily/YYYY-MM-DD.md`, folder in settings) show as a dot on their day. Click it to open the note.
3. **ICS feeds**, read only. Paste one iCal address per line in settings. Timed, all-day and TZID times; DAILY, WEEKLY (BYDAY), MONTHLY and YEARLY repeats with INTERVAL, COUNT, UNTIL, EXDATE and moved single days. Feeds refresh every 15 minutes and with the command "Refresh calendar feeds".
4. **Google Calendar**, read and write, once an OAuth client ID is entered. Drag empty time to make an event (double-click for an hour), drag an event to move it, drag its edges to stretch it, Alt-drag to copy, click it for the editor (name, time, all day, colour, place, description, delete), arrow keys move the picked event, Delete twice deletes. A repeating event changes only the day you changed. Several Google accounts can be connected at once.

## For agents

The plugin exposes `app.plugins.plugins['space-calendar'].api` for scripts and agents, through the Obsidian CLI (`obsidian eval`, Obsidian 1.12 and later). It uses the Google accounts already connected here, so no token leaves Obsidian. JSON in and out; times are local, `YYYY-MM-DDTHH:mm`, days `YYYY-MM-DD`; an all-day event's end is its last day.

```sh
obsidian eval code="return JSON.stringify(await app.plugins.plugins['space-calendar'].api.events('2026-11-16', '2026-11-22'))"
```

| Call | Does |
|---|---|
| `status()` | Google state, connected accounts, number of boards |
| `calendars()` | every calendar: id, name, account, access, primary, `isDefault` (where new events go) |
| `events(from, to)` | every Google event in those days, read fresh, sorted |
| `cards(from?, to?)` | every dated card: board path, line, date, time, done, title, column, the raw line |
| `create({ title, start, end, allDay?, desc?, location?, colorId?, calendar? })` | a new event, in the default calendar unless `calendar` names one |
| `update(id, fields)` | changes only those fields; a new start keeps the length; a repeating event changes on that day only |
| `remove(id)` | deletes the event |
| `moveCard(board, line, date)` | changes only that card's `@{date}`, with the same check as dragging it |
| `tickCard(board, line, done = true)` | ticks or unticks that card, same check |

`update` and `remove` take an id from `events()` read in the same session.

## Privacy and sync

`data.json` (synced and committed with the vault) holds only: week start, the view a new tab opens in, the daily notes folder, and two toggles.

ICS addresses, the Google client ID and secret, the Google tokens, and the last view, direction and hour size are kept per device with `app.saveLocalStorage`. They never leave this device.

The code has no top-level Node imports, so it runs on mobile; the Google sign-in loads Node's `http` only on desktop, at the moment you connect.

## Connect Google Calendar

The quick way, read only: in Google Calendar on the web, open Settings, pick your calendar, **Integrate calendar**, copy **Secret address in iCal format**, and paste it under **Calendar feeds** in the plugin settings. Then **Save and read feeds**.

Read and write needs your own Google OAuth client (free, about 5 minutes, once):

1. In https://console.cloud.google.com create a project, then enable the **Google Calendar API** for it.
2. Open **Google Auth Platform**. Set it up as **External**, and under **Audience** add your Google account as a test user.
3. Under **Clients**, click **Create client**, application type **Desktop app**, any name, **Create**. Copy the **Client ID** and **Client secret**.
4. In Obsidian on desktop: Settings, Space Calendar, paste both under Google Calendar, click **Save and connect**.
5. The browser opens Google. Pick your account, click **Continue** on "Google hasn't verified this app", tick the calendar box, **Continue**. The tab says you can close it.

While the app is in Testing, Google ends the sign-in after 7 days. To stop that, click **Publish app** under Audience; for your own account you only see the "unverified" screen once. The plugin asks for the `calendar` scope.

## Build

```sh
npm install
npm test          # parsers: Kanban cards, the date rewrite, ICS
npm run build     # typecheck and bundle main.js
SPACE_CAL_DEST=<vault>/.obsidian/plugins/space-calendar npm run deploy   # build, then copy main.js, manifest.json, styles.css there
```

`deploy` copies files (never a symlink, which a sync tool would ship dangling).

## Layout

- `src/view.ts`: the pane, the bar, Now, Month, details, toast and Undo (Space's `calendar.js`)
- `src/time.ts`: Day and Week, Across and Down (Space's `cal-time.js`)
- `src/edit.ts`: card drags and Google editing (Space's `cal-edit.js`)
- `src/sources/`: Kanban, daily notes, ICS, Google
- `styles.css`: Space's calendar look, coloured from the Obsidian theme

## Licence

MIT.
