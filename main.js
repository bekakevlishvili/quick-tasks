// Quick Tasks — a hotkey-summoned overlay for capturing to-dos.
//
// Settings live in settings.json next to your tasks (see "Open data folder" in the tray menu):
//   hotkey       Accelerator string, e.g. "Ctrl+Shift+Space", "Alt+Space", "Ctrl+Alt+T"
//                format: https://www.electronjs.org/docs/latest/api/accelerator
//   hideOnBlur   true = hide when you click into another app (default), false = stay open
//   width        panel width in pixels (default 500)
//   theme        "system" | "dark" | "light"
//   archiveDoneAfterDays   finished (non-repeating) tasks older than this move to archive.json; 0 = never (default 7)

const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, nativeTheme, dialog, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

// Lets tests and screenshots run against a throwaway data folder.
if (process.env.QT_USER_DATA) app.setPath('userData', process.env.QT_USER_DATA);

// Only ever run one copy. A second launch just pops the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const DEFAULT_SETTINGS = {
  hotkey: 'CommandOrControl+Shift+Space',
  hideOnBlur: true,
  width: 500,
  theme: 'system',
  archiveDoneAfterDays: 7,
};
const FALLBACK_HOTKEYS = ['CommandOrControl+Alt+Space', 'Alt+Shift+Space', 'CommandOrControl+Alt+T'];
const SHADOW = 28; // transparent margin around the panel, room for the drop shadow

let win = null;
let tray = null;
let quitting = false;
let settings = { ...DEFAULT_SETTINGS };
let activeHotkey = null;

// ---------- storage: plain JSON files in the OS user-data folder ----------

const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');
const archiveFile = () => path.join(app.getPath('userData'), 'archive.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// write-then-rename so a crash mid-write can't corrupt the file
function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadTasks() {
  const data = readJSON(dataFile(), null);
  return data && Array.isArray(data.tasks) ? data : { tasks: [] };
}

function loadSettings() {
  const raw = readJSON(settingsFile(), null);
  settings = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['system', 'dark', 'light'].includes(settings.theme)) settings.theme = 'system';
  settings.width = Math.max(380, Math.min(900, Number(settings.width) || DEFAULT_SETTINGS.width));
  settings.archiveDoneAfterDays = Math.max(0, Number(settings.archiveDoneAfterDays) || 0);
  if (!raw) writeJSON(settingsFile(), settings); // so there's a file to edit
}

// Finished tasks the renderer decided are old enough get appended here, so tasks.json stays small but nothing is lost.
function archiveTasks(tasks) {
  const archive = readJSON(archiveFile(), null);
  const list = archive && Array.isArray(archive.tasks) ? archive.tasks : [];
  list.push(...tasks.map((t) => ({ ...t, archivedAt: Date.now() })));
  writeJSON(archiveFile(), { tasks: list });
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  try { writeJSON(settingsFile(), settings); } catch (err) { console.error('Could not save settings:', err); }
}

function applyTheme() {
  nativeTheme.themeSource = settings.theme;
}

// ---------- window ----------

const windowWidth = () => settings.width + SHADOW * 2;

function createWindow() {
  win = new BrowserWindow({
    width: windowWidth(),
    height: 260,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('blur', () => {
    if (settings.hideOnBlur && !win.webContents.isDevToolsFocused() && !process.env.QT_SCREENSHOT) hideWindow();
  });

  // Alt+F4 / Cmd+W should hide, not kill the app
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hideWindow();
    }
  });
}

// Top-centre of whichever screen the mouse is on (Spotlight / Raycast style)
function positionWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const [w] = win.getSize();
  const x = Math.round(wa.x + (wa.width - w) / 2);
  const y = Math.round(wa.y + wa.height * 0.1) - SHADOW;
  win.setPosition(x, y, false);
}

function showWindow() {
  if (!win) return;
  positionWindow();
  if (process.platform === 'darwin') app.show();
  win.show();
  win.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.webContents.send('window:shown');
}

let lastHide = 0;
function hideWindow() {
  if (!win || !win.isVisible()) return;
  lastHide = Date.now();
  win.hide();
  if (process.platform === 'darwin') app.hide(); // hands focus back to the app you were in
}

function toggleWindow() {
  if (win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

// The renderer tells us how tall its content is; we grow/shrink to fit, capped to the screen
function resizeToContent(contentHeight) {
  if (!win) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const maxH = Math.round(display.workArea.height * 0.78);
  const h = Math.max(140, Math.min(maxH, Math.round(contentHeight) + SHADOW * 2));
  const [, current] = win.getContentSize();
  if (process.env.QT_DEBUG) console.log(`resize: content ${Math.round(contentHeight)} -> window ${h} (was ${current}, max ${maxH})`);
  if (Math.abs(h - current) <= 1) return; // DPI scaling can round the reported size by a pixel; don't churn over that
  win.setContentSize(windowWidth(), h, false);
}

// ---------- hotkey ----------

function prettyHotkey(accel = activeHotkey || settings.hotkey) {
  const mac = process.platform === 'darwin';
  return accel
    .replace(/CommandOrControl|CmdOrCtrl/g, mac ? '⌘' : 'Ctrl')
    .replace(/Command|Cmd/g, '⌘')
    .replace(/Control/g, 'Ctrl')
    .replace(/Super/g, mac ? '⌘' : 'Win')
    .replace(/Alt/g, mac ? '⌥' : 'Alt')
    .replace(/Shift/g, mac ? '⇧' : 'Shift');
}

function registerHotkey() {
  const candidates = [settings.hotkey, ...FALLBACK_HOTKEYS.filter((k) => k !== settings.hotkey)];
  for (const accel of candidates) {
    try {
      if (globalShortcut.register(accel, toggleWindow)) {
        activeHotkey = accel;
        if (accel !== settings.hotkey) {
          dialog.showMessageBox({
            type: 'warning',
            title: 'Hotkey in use',
            message: `${prettyHotkey(settings.hotkey)} is taken by another app.`,
            detail: `Quick Tasks is using ${prettyHotkey(accel)} instead. Change "hotkey" in settings.json to pick your own.`,
          });
        }
        return;
      }
    } catch { /* invalid accelerator string, try the next one */ }
  }
  dialog.showErrorBox('Hotkey not available', 'Quick Tasks could not register any hotkey. Click the tray icon to open it.');
}

// ---------- tray ----------

function createTray() {
  const iconFile = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', iconFile));
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  tray = new Tray(icon);
  // Windows/Linux: left-click toggles, right-click opens the menu. Clicking the tray while the panel is open
  // blurs it (hiding it) a moment before the click lands, so don't immediately pop it back up.
  tray.on('click', () => { if (Date.now() - lastHide > 400) toggleWindow(); });
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Quick Tasks  ·  ${prettyHotkey()}`);

  // Login items need a real app path. Unpackaged macOS would register the bare Electron binary, so skip it there.
  const canAutostart = process.platform === 'win32' || (process.platform === 'darwin' && app.isPackaged);

  const themeItem = (label, value) => ({
    label, type: 'radio', checked: settings.theme === value,
    click: () => { saveSettings({ theme: value }); applyTheme(); refreshTray(); },
  });

  const template = [
    { label: `Show tasks\t${prettyHotkey()}`, click: showWindow },
    { type: 'separator' },
    { label: 'Appearance', submenu: [themeItem('Match system', 'system'), themeItem('Dark', 'dark'), themeItem('Light', 'light')] },
    {
      label: 'Hide when I click elsewhere', type: 'checkbox', checked: settings.hideOnBlur,
      click: (item) => saveSettings({ hideOnBlur: item.checked }),
    },
  ];
  if (canAutostart) {
    template.push({
      label: 'Start at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({
        openAtLogin: item.checked,
        path: process.execPath,
        args: app.isPackaged ? [] : [app.getAppPath()],
      }),
    });
  }
  template.push(
    { type: 'separator' },
    { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: 'Quit Quick Tasks', click: () => { quitting = true; app.quit(); } },
  );

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------

ipcMain.handle('tasks:load', () => loadTasks());
ipcMain.handle('app:info', () => ({
  hotkey: prettyHotkey(),
  platform: process.platform,
  width: settings.width,
  shadow: SHADOW,
  archiveDoneAfterDays: settings.archiveDoneAfterDays,
}));
ipcMain.on('tasks:save', (_e, data) => {
  try { writeJSON(dataFile(), data); } catch (err) { console.error('Could not save tasks:', err); }
});
ipcMain.on('tasks:archive', (_e, tasks) => {
  if (!Array.isArray(tasks) || !tasks.length) return;
  try { archiveTasks(tasks); } catch (err) { console.error('Could not archive tasks:', err); }
});
ipcMain.on('window:hide', () => hideWindow());
ipcMain.on('window:resize', (_e, h) => resizeToContent(h));

// ---------- dev: QT_SCREENSHOT=out.png renders the panel to a file and quits ----------

async function screenshotAndQuit() {
  showWindow();
  await new Promise((r) => setTimeout(r, 900));
  if (process.env.QT_SCREENSHOT_JS) {              // optional: drive the UI first, print whatever the script returns
    const result = await win.webContents.executeJavaScript(process.env.QT_SCREENSHOT_JS, true);
    if (result !== undefined) console.log(JSON.stringify(result));
    await new Promise((r) => setTimeout(r, 900));
  }
  const img = await win.webContents.capturePage();
  fs.writeFileSync(process.env.QT_SCREENSHOT, img.toPNG());
  quitting = true;
  app.quit();
}

// ---------- lifecycle ----------

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide(); // menu-bar-only app, no dock icon
  loadSettings();
  applyTheme();
  createWindow();
  createTray();
  if (process.env.QT_SCREENSHOT) win.webContents.once('did-finish-load', screenshotAndQuit);
  else registerHotkey(); // a screenshot run must not steal the hotkey from a copy that's really in use
});

app.on('second-instance', showWindow);
app.on('window-all-closed', () => { /* keep running in the tray */ });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
