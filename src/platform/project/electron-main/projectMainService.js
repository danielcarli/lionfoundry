/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Opens, saves and exports font projects for the UI. Only three kinds of folder are ever read:
//  • the example typefaces shipped with the app;
//  • a folder the person picked in the native dialog;
//  • a folder picked before (the "recent projects" list, kept in the user data folder).
// And only two kinds of place are ever written: a project the person picked (never an example), and
// a file or folder the person has just chosen in a "save" dialog. The UI cannot make this service
// read or write any other path.
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { readUfo, isUfo, summarize } = require('../node/ufoReader');
const { writeUfo, copyUfo } = require('../node/ufoWriter');
const { readTtf } = require('../node/ttfReader');
const { ttfToWoff2 } = require('../node/woff2');
const { t } = require('../../nls/common/nls');

const MAX_RECENT = 12;

class ProjectMainService {
  constructor(appRoot) {
    this.examplesDir = path.join(appRoot, 'examples');
    this.recentFile = path.join(app.getPath('userData'), 'recent-projects.json');
    this.recent = this.#loadRecent();
    /** Projects already backed up in this session (one backup, made before the first save). */
    this.backedUp = new Set();
    /** Files exported in this session (they can be shown in the file manager). */
    this.exported = new Set();
  }

  registerChannels(ipc) {
    ipc.handle('project:examples', () => this.examples());
    ipc.handle('project:recent', () => this.recent.filter((p) => isUfo(p)));
    ipc.handle('project:pick', (e) => this.pick(BrowserWindow.fromWebContents(e.sender)));
    ipc.handle('project:open', (_e, target) => this.open(target));
    ipc.handle('project:forget', (_e, target) => this.forget(target));
    ipc.handle('project:save', (_e, font, changed) => this.save(font, changed));
    ipc.handle('project:saveAs', (e, font) => this.saveAs(BrowserWindow.fromWebContents(e.sender), font));
    ipc.handle('project:import', (e) => this.importFont(BrowserWindow.fromWebContents(e.sender)));
    ipc.handle('project:export', (e, request) => this.exportFile(BrowserWindow.fromWebContents(e.sender), request || {}));
    ipc.handle('project:exportFamily', (e, request) => this.exportFamily(BrowserWindow.fromWebContents(e.sender), request || {}));
  }

  /** The example typefaces: [{ id, path, familyName, styleName, glyphs }]. */
  examples() {
    let names = [];
    try { names = fs.readdirSync(this.examplesDir).filter((n) => n.endsWith('.ufo')).sort(); } catch { /* no examples folder */ }
    const out = [];
    for (const name of names) {
      const dir = path.join(this.examplesDir, name);
      try {
        const s = summarize(readUfo(dir));
        // a project with several weights is listed with all of them
        out.push({ id: name, path: dir, familyName: s.familyName, styleName: s.weights.length > 1 ? s.weights.join(' · ') : s.styleName, glyphs: s.glyphs });
      } catch { /* a broken example is simply not listed */ }
    }
    return out;
  }

  async pick(win) {
    const res = await dialog.showOpenDialog(win, {
      title: t('main.dialog.openProject.title'),
      buttonLabel: t('main.dialog.openProject.button'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    if (!isUfo(dir)) return { error: 'notUfo', path: dir };
    this.#remember(dir);
    return { path: dir };
  }

  /** Reads a project. `target` must be an example or a folder the person has picked. */
  open(target) {
    const dir = path.resolve(String(target || ''));
    const isExample = path.dirname(dir) === this.examplesDir;
    if (!isExample && !this.recent.includes(dir)) return { error: 'notAllowed' };
    try {
      const font = readUfo(dir);
      font.example = isExample;
      if (!isExample) this.#remember(dir);
      return { font };
    } catch (err) {
      return { error: 'unreadable', detail: err.message };
    }
  }

  /**
   * Saves over the project the font was opened from. The first save of a session copies the project
   * to "<name>.ufo.backup" beside it, so the state it had when it was opened can always be recovered.
   * @param {object} font the font model
   * @param {string[]|'all'} changed names of the glyphs that changed
   */
  save(font, changed) {
    const dir = path.resolve(String((font && font.path) || ''));
    if (!font || !font.path || path.dirname(dir) === this.examplesDir || !this.recent.includes(dir) || !isUfo(dir)) return { error: 'needsSaveAs' };
    try {
      if (readUfo(dir).format !== 'ufo3') return { error: 'needsSaveAs' };
      let backup = null;
      if (!this.backedUp.has(dir)) {
        backup = `${dir}.backup`;
        copyUfo(dir, backup);
        this.backedUp.add(dir);
      }
      const res = writeUfo(dir, font, { glyphs: changed === 'all' || !Array.isArray(changed) ? 'all' : changed });
      return { path: dir, backup, ...res };
    } catch (err) {
      return { error: 'writeFailed', detail: err.message };
    }
  }

  /** Saves the font as a new project, in a folder chosen in the native dialog (nothing is ever overwritten). */
  async saveAs(win, font) {
    if (!font || !font.glyphs) return { error: 'writeFailed', detail: 'no font' };
    const base = String(font.name || 'Untitled.ufo').replace(/\.ufo$/i, '');
    const res = await dialog.showSaveDialog(win, {
      title: t('main.dialog.saveProject.title'),
      buttonLabel: t('main.dialog.saveProject.button'),
      defaultPath: `${font.path && path.dirname(font.path) !== this.examplesDir ? path.join(path.dirname(font.path), base) : base}.ufo`,
      filters: [{ name: 'Unified Font Object', extensions: ['ufo'] }],
    });
    if (res.canceled || !res.filePath) return null;
    let target = path.resolve(res.filePath);
    if (!/\.ufo$/i.test(target)) target += '.ufo';
    if (path.dirname(target) === this.examplesDir || target.startsWith(this.examplesDir + path.sep)) return { error: 'notAllowed' };
    if (fs.existsSync(target)) return { error: 'targetExists', path: target };
    try {
      const source = font.path ? path.resolve(font.path) : null;
      // other layers, images and data of the original project come along
      if (source && isUfo(source) && (path.dirname(source) === this.examplesDir || this.recent.includes(source))) copyUfo(source, target);
      writeUfo(target, font, { glyphs: 'all' });
      this.#remember(target);
      this.backedUp.add(target); // a project created now needs no backup of its own first state
      return { path: target, name: path.basename(target) };
    } catch (err) {
      return { error: 'writeFailed', detail: err.message };
    }
  }

  /** Reads a font file chosen in the native dialog as a new, unsaved project. The file is not changed. */
  async importFont(win) {
    const res = await dialog.showOpenDialog(win, {
      title: t('main.dialog.importFont.title'),
      buttonLabel: t('main.dialog.importFont.button'),
      properties: ['openFile'],
      filters: [{ name: 'TrueType', extensions: ['ttf'] }],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    try {
      const stat = fs.statSync(file);
      if (stat.size > 64 * 1024 * 1024) return { error: 'unreadable', detail: 'file too large' };
      return { font: readTtf(fs.readFileSync(file), path.basename(file)) };
    } catch (err) {
      return { error: /^unsupported/.test(err.message) ? err.message : 'unreadable', detail: err.message };
    }
  }

  /**
   * Writes an exported file where the person chooses.
   * @param {{kind: 'ttf'|'woff2'|'pdf'|'text', name: string, extension?: string, data?: Uint8Array|string}} request
   */
  async exportFile(win, { kind, name, extension, data }) {
    const kinds = {
      ttf: { ext: 'ttf', label: 'TrueType font' }, woff2: { ext: 'woff2', label: 'Web font (WOFF2)' },
      pdf: { ext: 'pdf', label: 'PDF' }, text: { ext: /^[a-z0-9]{1,12}$/.test(String(extension)) ? extension : 'txt', label: 'Text' },
    };
    const k = kinds[kind];
    if (!k) return { error: 'writeFailed', detail: 'unknown kind' };
    const res = await dialog.showSaveDialog(win, {
      title: t('main.dialog.export.title'),
      buttonLabel: t('main.dialog.export.button'),
      defaultPath: `${String(name || 'Untitled').replace(/[\\/:*?"<>|]/g, '_')}.${k.ext}`,
      filters: [{ name: k.label, extensions: [k.ext] }],
    });
    if (res.canceled || !res.filePath) return null;
    let target = path.resolve(res.filePath);
    if (path.extname(target).toLowerCase() !== `.${k.ext}`) target += `.${k.ext}`;
    if (target.startsWith(this.examplesDir + path.sep)) return { error: 'notAllowed' };
    try {
      let bytes;
      if (kind === 'pdf') bytes = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' }, preferCSSPageSize: true });
      else if (kind === 'woff2') bytes = ttfToWoff2(Uint8Array.from(data));
      else if (kind === 'ttf') bytes = Buffer.from(Uint8Array.from(data));
      else bytes = Buffer.from(String(data), 'utf8');
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, target);
      this.exported.add(target);
      return { path: target, size: bytes.length };
    } catch (err) {
      return { error: 'writeFailed', detail: err.message };
    }
  }

  /**
   * Writes the fonts of a whole family. The person picks where; the files always go into a NEW folder
   * created there (`<name>`, `<name> 2`, …), so nothing that exists is ever replaced.
   * @param {{ name: string, files: Array<{ name: string, kind: 'ttf'|'woff2'|'text', data: any }> }} request
   */
  async exportFamily(win, { name, files }) {
    if (!Array.isArray(files) || !files.length || files.length > 400) return { error: 'writeFailed', detail: 'nothing to write' };
    const res = await dialog.showOpenDialog(win, {
      title: t('main.dialog.exportFamily.title'),
      buttonLabel: t('main.dialog.exportFamily.button'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const parent = path.resolve(res.filePaths[0]);
    const within = (dir, root) => dir === root || dir.startsWith(root + path.sep);
    if (within(parent, this.examplesDir) || /\.ufo(\.backup)?$/i.test(parent) || parent.split(path.sep).some((part) => /\.ufo(\.backup)?$/i.test(part))) return { error: 'notAllowed' };
    const safe = (v) => String(v || 'Untitled').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim() || 'Untitled';
    const base = path.join(parent, safe(name));
    let dir = base;
    for (let i = 2; fs.existsSync(dir); i++) dir = `${base} ${i}`;
    try {
      fs.mkdirSync(dir);
      const written = [];
      for (const f of files) {
        const ext = f.kind === 'ttf' ? 'ttf' : f.kind === 'woff2' ? 'woff2' : (/\.([a-z0-9]{1,12})$/i.exec(String(f.name)) || [0, 'txt'])[1];
        const stem = safe(String(f.name).replace(/\.[a-z0-9]{1,12}$/i, ''));
        // fonts go in a folder per format; anything else (a style sheet, a list) stays beside them
        const folder = f.kind === 'text' ? dir : path.join(dir, ext);
        fs.mkdirSync(folder, { recursive: true });
        const target = path.join(folder, `${stem}.${ext}`);
        if (fs.existsSync(target)) continue; // two styles with the same name: the first one stays
        const bytes = f.kind === 'woff2' ? ttfToWoff2(Uint8Array.from(f.data)) : f.kind === 'ttf' ? Buffer.from(Uint8Array.from(f.data)) : Buffer.from(String(f.data), 'utf8');
        fs.writeFileSync(target, bytes);
        this.exported.add(target);
        written.push({ path: target, size: bytes.length });
      }
      return { path: dir, files: written };
    } catch (err) {
      return { error: 'writeFailed', detail: err.message };
    }
  }

  forget(target) {
    const dir = path.resolve(String(target || ''));
    this.recent = this.recent.filter((p) => p !== dir);
    this.#saveRecent();
    return true;
  }

  #remember(dir) {
    this.recent = [dir, ...this.recent.filter((p) => p !== dir)].slice(0, MAX_RECENT);
    this.#saveRecent();
  }

  #loadRecent() {
    try {
      const list = JSON.parse(fs.readFileSync(this.recentFile, 'utf8'));
      return Array.isArray(list) ? list.filter((p) => typeof p === 'string').slice(0, MAX_RECENT) : [];
    } catch { return []; }
  }

  #saveRecent() {
    try { fs.writeFileSync(this.recentFile, JSON.stringify(this.recent, null, 2)); } catch { /* best effort */ }
  }
}

module.exports = { ProjectMainService };
