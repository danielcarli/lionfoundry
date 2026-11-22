/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Secure bridge between the UI (no Node access) and the main process.
// Runs sandboxed: exposes only these functions, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  platform: process.platform,
  pathSep: process.platform === 'win32' ? '\\' : '/',
  setTheme: (id) => ipcRenderer.send('window:setTheme', String(id)),
  setLocale: (locale) => ipcRenderer.send('nls:setLocale', locale),
  reloadWindow: () => ipcRenderer.send('window:reload'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  // font projects (the main process only reads the examples and folders the person picked)
  project: {
    examples: () => ipcRenderer.invoke('project:examples'),
    recent: () => ipcRenderer.invoke('project:recent'),
    pick: () => ipcRenderer.invoke('project:pick'),
    open: (target) => ipcRenderer.invoke('project:open', target),
    forget: (target) => ipcRenderer.invoke('project:forget', target),
    // writing: over a project the person picked, or where a "save" dialog says
    save: (font, changed) => ipcRenderer.invoke('project:save', font, changed),
    saveAs: (font) => ipcRenderer.invoke('project:saveAs', font),
    importFont: () => ipcRenderer.invoke('project:import'),
    exportFile: (request) => ipcRenderer.invoke('project:export', request),
    exportFamily: (request) => ipcRenderer.invoke('project:exportFamily', request),
  },

  // the person's own scripts, run on a copy of the font (the result comes back to be applied or not)
  runScript: (request) => ipcRenderer.invoke('script:run', request),
  // lets the window ask before closing with changes that were not saved
  setDirty: (dirty) => ipcRenderer.send('window:setDirty', !!dirty),

  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  copyText: (text) => ipcRenderer.invoke('shell:copyText', text),

  // new versions (the app's only network access, and only when asked)
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    openReleasePage: () => ipcRenderer.invoke('update:openReleasePage'),
  },
});
