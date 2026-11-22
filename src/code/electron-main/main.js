/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Main process entry point (equivalent to VS Code's src/vs/code/electron-main).
// Creates the window, registers the app:// protocol that serves the UI and instantiates the services.
const { app, BrowserWindow, protocol, ipcMain, dialog, Menu } = require('electron');

app.setName('LionFoundry');
if (process.platform === 'win32') app.setAppUserModelId('br.dmdc.lionfoundry');
const path = require('path');
const fs = require('fs');

const { ProjectMainService } = require('../../platform/project/electron-main/projectMainService');
const { ShellMainService } = require('../../platform/shell/electron-main/shellMainService');
const { UpdateMainService } = require('../../platform/update/electron-main/updateMainService');
const { ScriptMainService } = require('../../platform/script/electron-main/scriptMainService');
const { setLocale, t } = require('../../platform/nls/common/nls');

const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEME = 'app';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
].join('; ');

// Only files inside these folders may be served to the UI.
const SERVABLE = [path.join(APP_ROOT, 'src')];

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const filePath = path.normalize(path.join(APP_ROOT, decodeURIComponent(url.pathname)));
    if (!SERVABLE.some((dir) => filePath.startsWith(dir + path.sep))) {
      return new Response('Forbidden', { status: 403 });
    }
    try {
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        headers: {
          'content-type': MIME[path.extname(filePath)] || 'application/octet-stream',
          'content-security-policy': CSP,
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// The themes of the app (see workbench.css): the window frame follows the one in use.
const TITLEBAR_HEIGHT = 36;
const THEMES = {
  daca: { background: '#394042', overlay: { color: '#24292b', symbolColor: '#cdc2c2', height: TITLEBAR_HEIGHT } },
  amsterdam: { background: '#fceee6', overlay: { color: '#f3cdb9', symbolColor: '#272d3f', height: TITLEBAR_HEIGHT } },
  dark: { background: '#1e1e1e', overlay: { color: '#181818', symbolColor: '#c5c5c5', height: TITLEBAR_HEIGHT } },
  light: { background: '#ffffff', overlay: { color: '#ececec', symbolColor: '#4a4a4a', height: TITLEBAR_HEIGHT } },
};

function createWindow() {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'LionFoundry',
    icon: path.join(APP_ROOT, 'src', 'workbench', 'browser', 'media', 'icon.png'),
    backgroundColor: THEMES.daca.background,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 12, y: 11 } } : { titleBarOverlay: THEMES.daca.overlay }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron-sandbox', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External links never open inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Shown right away (with the theme's background and then the loading screen of the page), so the person
  // sees the app opening instead of clicking its icon again.
  win.show();
  win.loadURL(`${SCHEME}://bundle/src/workbench/browser/workbench.html`);
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  // Closing with unsaved changes asks first (the UI reports whether there are any).
  win.on('close', (e) => {
    if (!win.unsavedChanges || win.closingAnyway) return;
    e.preventDefault();
    dialog.showMessageBox(win, {
      type: 'warning',
      message: t('main.dialog.unsaved.message'),
      detail: t('main.dialog.unsaved.detail'),
      buttons: [t('main.dialog.unsaved.cancel'), t('main.dialog.unsaved.discard')],
      defaultId: 0,
      cancelId: 0,
    }).then((res) => { if (res.response === 1) { win.closingAnyway = true; win.close(); } });
  });
  return win;
}

// ---- one instance only: opening the app again brings the window that is already open to the front
let mainWindow = null;
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = mainWindow || BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

if (gotTheLock) app.whenReady().then(() => {
  // OS locale until the UI reports the language it is using.
  setLocale(app.getLocale());
  ipcMain.on('nls:setLocale', (_e, locale) => setLocale(String(locale)));
  // Read the version from package.json so it is right however the app is launched (e.g. by the test tools).
  ipcMain.handle('app:info', () => ({ version: require(path.join(APP_ROOT, 'package.json')).version, electron: process.versions.electron }));
  registerAppProtocol();

  // The window first, so it appears at once; the services below are ready long before the page asks them
  // anything (its requests are handled after this function returns).
  createWindow();

  const projects = new ProjectMainService(APP_ROOT);
  const shell = new ShellMainService(projects);
  // Electron's default menu would take Ctrl+Z, Ctrl+0, Ctrl+plus and Ctrl+R for itself (undo of text,
  // page zoom, reload) before the interface sees them. The interface handles its own shortcuts, so on
  // Windows and Linux there is no menu; macOS keeps the minimum the system expects.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { role: 'windowMenu' },
  ]) : null);

  const update = new UpdateMainService(APP_ROOT);
  const scripts = new ScriptMainService();
  [projects, shell, update, scripts].forEach((s) => s.registerChannels(ipcMain));
  ipcMain.on('window:setDirty', (event, dirty) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.unsavedChanges = !!dirty;
  });

  // Reload asked by the UI (e.g. after changing the language). Done here because the window blocks every
  // navigation started by the page (will-navigate), and recent Electron versions treat location.reload() as one.
  ipcMain.on('window:reload', (event) => event.sender.reload());

  // The UI reports the chosen theme so the window buttons match.
  ipcMain.on('window:setTheme', (event, id) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const theme = THEMES[id] || THEMES.daca;
    if (!win) return;
    win.setBackgroundColor(theme.background);
    if (process.platform !== 'darwin') {
      try { win.setTitleBarOverlay(theme.overlay); } catch { /* platform without overlay */ }
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
