Hotkey-summoned to-do overlay. Press **Ctrl+Shift+Space** (Windows) or **⌘+Shift+Space** (Mac) from anywhere, type a task, Enter, Esc. Break tasks into steps, add notes, set them to repeat daily or on chosen weekdays, push things to Later, tick them off. Press `?` inside the panel for all shortcuts.

## Downloads

| File | For |
|---|---|
| `QuickTasks-windows-x64.zip` | Windows. Unzip anywhere, run `QuickTasks.exe`. |
| `Quick.Tasks-mac.zip` | Any Mac, Apple Silicon or Intel (one universal app). Unzip, drag `Quick Tasks.app` to Applications. |

## First launch (once per machine)

**Windows:** SmartScreen says "Windows protected your PC". Click **More info**, then **Run anyway**.

**Mac:** macOS says it "could not verify" the app. Click **Done**, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, then confirm. If you instead see "damaged", run this in Terminal once and open the app again:

```
xattr -cr "/Applications/Quick Tasks.app"
```

After that first launch it opens like any other app. Nothing shows on launch: a small checkbox icon appears in the tray (Windows) or menu bar (Mac). Click it for appearance, start-at-login and Quit.

Your tasks stay on your own machine: `%APPDATA%\Quick Tasks\` on Windows, `~/Library/Application Support/Quick Tasks/` on Mac.
