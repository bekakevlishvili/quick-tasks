# Quick Tasks

**Downloads for Windows and Mac:** https://github.com/bekakevlishvili/quick-tasks/releases

A small always-on-top overlay. Press a hotkey from anywhere, type what you just heard, press Enter, hit Esc. Later, open a task to add notes and break it into steps, and tick things off as you go. Tasks you do every day can repeat on their own.

Everything is stored in plain JSON files on your machine. No account, no server, no cost.

## Set up (once)

You need Node.js installed. Then, in this folder:

```bash
npm install      # downloads Electron, ~1–2 min the first time
npm start
```

A small coral checkbox appears in your system tray (Windows) or menu bar (Mac). Nothing else opens until you press the hotkey.

**Windows shortcut:** double-click `Quick Tasks.vbs` to start it without a terminal window. To have it start with Windows, right-click the tray icon and tick **Start at login**.

## Using it

**Summon / dismiss:** `Ctrl+Shift+Space` (Windows) or `⌘+Shift+Space` (Mac). Esc hides it too, and so does clicking anywhere else.

### Capture box (where the cursor lands)

| Key | Result |
|---|---|
| `Enter` | Add the task, cursor stays ready for the next one |
| `Shift+Enter` | Add the task and jump straight into breaking it down |
| `↓` or `Tab` | Move into the list |
| `Esc` | Hide |

### In the list

| Key | Result |
|---|---|
| `↑` `↓` | Move between tasks (`↑` from the top returns to the capture box) |
| `Space` | Mark done / not done. Done tasks drop below the line, struck through |
| `Enter` | Open the task and start adding steps |
| `→` `←` | Open / close a task's details |
| `E` or `F2` | Edit the title in place |
| `N` | Open the task and edit its notes |
| `L` / `T` | Push the task to **Later** / bring it back to **Today** |
| `R` | Cycle repeat: daily → weekdays → off |
| `Delete` | Delete the task (an Undo toast appears) |
| `Alt+↑` `Alt+↓` | Reorder |
| `Ctrl+Z` | Undo the last delete, clear or completion |
| `Home` `End` | First / last task |

### Inside a task's details

| Key | Result |
|---|---|
| Type in **Add a step**, `Enter` | Add a step; keep pressing Enter to add more |
| `Ctrl+Enter` in notes | Finish editing notes |
| `Esc` | Back to the list, with that task selected |

Under the steps you'll find **When** (Today / Later) and **Repeat** (a row of weekday circles, plus Daily and Weekdays shortcuts).

Mouse works everywhere too: click a circle to tick it, click a title to edit it, click the chevron to open details, hover a row for the × to delete. Click a section header to collapse it. **Clear done** in the footer removes finished one-off tasks (undoable). The `?` in the footer, or `F1`, shows the shortcut sheet.

## Keeping the list short

The list has three sections, so the part you look at stays small even when a lot piles up:

- **Today** is what's in front of you: everything you capture lands here, plus repeating tasks that are due today.
- **Later** is for things you've pushed back (`L`) and repeating tasks whose day hasn't come. It's collapsed by default; click the header or press `↓` past Today to browse it.
- **Done** is what you've ticked off. Finished one-off tasks older than a week move out to `archive.json` automatically, so this never grows forever. Change the number of days (or set `0` to keep everything) in settings.

If Today is still long, the panel scrolls, capped at about three quarters of your screen.

## Repeating tasks

Open a task and pick days under **Repeat** (or press `R` on it). A repeating task:

- shows up in Today on its days, with a small ↻ badge saying how often;
- when you tick it off, it sits under Done for the rest of the day, then comes back at midnight with its steps unticked;
- waits in Later on days it isn't due, with a badge for the next day it's on;
- is never removed by Clear done or the archive. Delete it if you no longer need it;
- keeps a streak, shown in its details once you've done it two or more times in a row.

## Settings

Right-click the tray icon for the everyday ones:

- **Appearance:** match system, dark, or light
- **Hide when I click elsewhere:** turn off if you'd rather it stay open while you work
- **Start at login** (Windows, and Mac once packaged)
- **Open data folder:** where `tasks.json`, `archive.json` and `settings.json` live

Edit `settings.json` in that folder for the rest:

```json
{
  "hotkey": "CommandOrControl+Shift+Space",
  "hideOnBlur": true,
  "width": 500,
  "theme": "system",
  "archiveDoneAfterDays": 7
}
```

`hotkey` uses Electron's accelerator format, e.g. `"Alt+Space"`, `"CommandOrControl+Alt+T"`: https://www.electronjs.org/docs/latest/api/accelerator. Restart the app after changing it. If your hotkey is taken by another app, Quick Tasks falls back to `Ctrl+Alt+Space` and tells you.

## Where your data lives, and what happens on a crash

- Windows: `%APPDATA%\Quick Tasks\` (paste that into the Explorer address bar, or use **Open data folder** in the tray menu)
- Mac: `~/Library/Application Support/Quick Tasks/`

Every change is written to `tasks.json` within about 150 ms, and each save writes a temporary file first and then swaps it in, so a crash or power cut mid-save can't corrupt what was already there. The most you could lose is a keystroke typed in the last fraction of a second. It's plain JSON, so you can back it up, sync it, or read it into a Sheet if you ever want to.

## Sharing it with your team

Three ready-to-send zips live in `dist/` after building:

| File | For |
|---|---|
| `QuickTasks-windows-x64.zip` | Windows. Unzip anywhere, run `QuickTasks.exe`. |
| `Quick Tasks-mac-apple-silicon.zip` | Macs with an M-series chip (2020 and later). |
| `Quick Tasks-mac-intel.zip` | Older Intel Macs. |

Each Mac zip contains a `Read me first.txt` with the steps below, so you can just send the zip.

**Windows first launch.** SmartScreen will say "Windows protected your PC" because the exe isn't signed. Click **More info**, then **Run anyway**. Once.

**Mac first launch.** The app isn't signed with an Apple developer certificate, so macOS refuses it the first time. Either double-click it, dismiss the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway**; or, if macOS calls the app "damaged", run this in Terminal once and then open it normally:

```bash
xattr -cr "/Applications/Quick Tasks.app"
```

If the team grows or this becomes a hassle, the proper fix is to build and sign on a Mac (or in CI) with an Apple Developer ID and notarize it. Then it opens like any other app.

### Releases on GitHub (the easy way)

Pushing a version tag makes GitHub build everything on real Windows and macOS machines and publish a Release with the downloads attached:

```bash
git tag v2.2.0
git push origin v2.2.0
```

A few minutes later the **Releases** page has `QuickTasks-windows-x64.zip` and `Quick Tasks-mac.zip` (one universal app for both Apple Silicon and Intel). The workflow is in `.github/workflows/release.yml`; you can also run it by hand from the Actions tab.

**Signing the Mac build** (removes the "Open Anyway" step for everyone): add these repository secrets under Settings → Secrets and variables → Actions, and the next release is signed and notarized automatically.

| Secret | What it is |
|---|---|
| `MAC_CERT_P12` | A "Developer ID Application" certificate exported from Keychain Access as `.p12`, then base64-encoded (`base64 -i cert.p12 | pbcopy`) |
| `MAC_CERT_PASSWORD` | The password you gave that `.p12` |
| `APPLE_ID` | The Apple Developer account email |
| `APPLE_APP_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | The 10-character team id from developer.apple.com |

This needs an Apple Developer Program membership (99 USD/year, the company may already have one).

### Building the downloads locally

```bash
npm run dist    # Windows: dist/QuickTasks-win32-x64/  (zip that folder to share it)
npm run mac     # macOS: both zips above, built right here on Windows
```

`npm run mac` downloads the official Electron macOS build once (about 130 MB per architecture, cached in `dist/.cache/`) and rewrites it into `Quick Tasks.app`, keeping the Unix permissions and symlinks a Mac needs. No Mac required, but the result is unsigned; prefer the GitHub build above when you can.

**Updating a build you're already running:** quit Quick Tasks from the tray first. Windows won't let the packager replace files that a running app has open, and a half-replaced folder won't start. Your tasks are safe either way, they live in the data folder, not next to the exe.

## Changing the look

Colours, fonts and spacing are all in the `<style>` block at the top of `index.html`. The two palettes (light and dark) are the CSS variables at the very top. `scripts/make-icons.js` regenerates the tray and app icons (`npm run icons`).

## Quitting

Right-click the tray icon (Windows) or click the menu-bar icon (Mac), then **Quit Quick Tasks**.
