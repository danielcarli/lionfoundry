/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// The font open in the workbench: its model, the selected glyph, the glyph filter, and derived data the
// views share (outline of each glyph, character map, categories, layout plan).
// Every change to the font goes through edit() / begin()…commit(), which is what makes it undoable
// and what tells the views to redraw. Nothing touches the disk until the person saves.
import { Emitter } from '../../../../base/common/event.js';
import { glyphCommands, commandsToSvg, commandsBounds, createKerner } from '../../../../base/common/glyphPath.js';
import { clone, newGlyph, skewing, transformGlyph } from '../../../../base/common/fontModel.js';
import { buildLayout, generateFeatureCode } from '../../../../base/common/features.js';
import { designspaceXml } from '../../../../base/common/interpolate.js';
import * as weights from '../../../../base/common/weights.js';
import { compileTtf, postscriptName } from '../../../../base/common/ttfWriter.js';
import { t, tn } from '../../../../base/common/nls.js';
import { baseName } from '../../../../base/common/format.js';
import { confirmDialog } from '../../../browser/dialogs.js';

const LAST_KEY = 'lionfoundry.lastProject';
const MAX_UNDO = 100;
const SECTIONS = ['glyphOrder', 'groups', 'kerning', 'info', 'lib', 'features', 'weights'];

export const CATEGORIES = ['uppercase', 'lowercase', 'figures', 'punctuation', 'marks', 'other'];

const IS_UPPER = /\p{Lu}/u;
const IS_LOWER = /\p{Ll}|\p{Lo}|\p{Lm}/u;
const IS_NUMBER = /\p{N}/u;
const IS_MARK = /\p{M}|\p{Sk}/u;
const IS_PUNCT = /\p{P}|\p{S}/u;

function categoryOf(glyph) {
  const code = glyph.unicodes[0];
  if (code === undefined) return 'other';
  const ch = String.fromCodePoint(code);
  if (IS_UPPER.test(ch)) return 'uppercase';
  if (IS_LOWER.test(ch)) return 'lowercase';
  if (IS_NUMBER.test(ch)) return 'figures';
  if (IS_MARK.test(ch)) return 'marks';
  if (IS_PUNCT.test(ch)) return 'punctuation';
  return 'other';
}

export class FontService {
  #onDidChangeFont = new Emitter();
  #onDidChangeSelection = new Emitter();
  #onDidChangeFilter = new Emitter();
  #onDidChangeLists = new Emitter();
  #onDidEdit = new Emitter();
  #onDidChangeState = new Emitter();
  #onDidChangeWeight = new Emitter();
  /** A font was opened, closed or replaced. */
  onDidChangeFont = this.#onDidChangeFont.event;
  onDidChangeSelection = this.#onDidChangeSelection.event;
  onDidChangeFilter = this.#onDidChangeFilter.event;
  onDidChangeLists = this.#onDidChangeLists.event;
  /** The open font was changed: { glyphs: string[]|null (null = anything), sections: string[], label }. */
  onDidEdit = this.#onDidEdit.event;
  /** "Unsaved changes", undo and redo availability changed. */
  onDidChangeState = this.#onDidChangeState.event;
  /** Another weight of the typeface became the one being worked on. */
  onDidChangeWeight = this.#onDidChangeWeight.event;

  /** @type {object|null} the font model */
  font = null;
  selected = null;
  filter = { category: 'all', query: '' };
  examples = [];
  recent = [];
  busy = false;
  dirty = false;

  #shapes = new Map();
  #cmap = new Map();
  #categories = new Map();
  #kerner = () => 0;
  #plan = null;
  #undo = [];
  #redo = [];
  #pending = null;
  #changed = new Set(); // glyphs to write on the next save
  #changedAll = false;

  constructor({ host, notifications }) {
    this.host = host;
    this.notifications = notifications;
  }

  get hasFont() { return !!this.font; }
  get lastProject() { try { return localStorage.getItem(LAST_KEY); } catch { return null; } }
  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }
  get undoLabel() { return this.#undo.length ? this.#undo[this.#undo.length - 1].label : ''; }
  get redoLabel() { return this.#redo.length ? this.#redo[this.#redo.length - 1].label : ''; }
  /** True when "save" can write over the project (examples and imported fonts need "save as"). */
  get canSaveInPlace() { return !!this.font && !!this.font.path && !this.font.example && this.font.format === 'ufo3'; }

  async refreshLists() {
    [this.examples, this.recent] = await Promise.all([
      this.host.project.examples().catch(() => []),
      this.host.project.recent().catch(() => []),
    ]);
    this.#onDidChangeLists.fire();
  }

  // ---------------------------------------------------------------- opening and closing
  /** Asks before throwing away unsaved changes. */
  async #mayDiscard() {
    if (!this.dirty) return true;
    return confirmDialog({ title: t('project.unsaved.title'), message: t('project.unsaved.message', { name: this.familyName }), confirmLabel: t('project.unsaved.discard'), danger: true });
  }

  /** Native dialog, then opens the chosen project. */
  async openDialog() {
    if (!(await this.#mayDiscard())) return false;
    const res = await this.host.project.pick();
    if (!res) return false;
    if (res.error) { this.notifications.warn(t('project.error.notUfo')); return false; }
    return this.open(res.path, { force: true });
  }

  /** @param {string} target path of an example or of a project picked before */
  async open(target, { quiet = false, force = false } = {}) {
    if (!force && !(await this.#mayDiscard())) return false;
    this.busy = true;
    let res;
    try { res = await this.host.project.open(target); } catch (err) { res = { error: 'unreadable', detail: String(err && err.message) }; }
    this.busy = false;
    if (!res || res.error) {
      if (!quiet) this.notifications.warn(res && res.error === 'unreadable' ? t('project.error.unreadable', { detail: res.detail || '' }) : t('project.error.notAllowed'));
      return false;
    }
    this.#setFont(res.font);
    try { localStorage.setItem(LAST_KEY, res.font.path); } catch { /* storage unavailable */ }
    this.refreshLists();
    if (res.font.warnings.length && !quiet) this.notifications.warn(t('project.warnings', { count: res.font.warnings.length }));
    return true;
  }

  /** Reads a master of the family without opening it (used by the Family view). */
  async readProject(target) {
    const res = await this.host.project.open(target).catch(() => null);
    return res && res.font ? res.font : null;
  }

  async pickProject() {
    const res = await this.host.project.pick();
    if (!res || res.error) { if (res) this.notifications.warn(t('project.error.notUfo')); return null; }
    this.refreshLists();
    return res.path;
  }

  async close() {
    if (!(await this.#mayDiscard())) return;
    this.#setFont(null);
    try { localStorage.removeItem(LAST_KEY); } catch { /* storage unavailable */ }
  }

  /** A new, empty project: .notdef, space and the basic Latin letters and figures, ready to be drawn. */
  async newFont({ familyName, styleName = 'Regular', unitsPerEm = 1000 }) {
    if (!(await this.#mayDiscard())) return false;
    const upm = unitsPerEm;
    const font = {
      format: 'new', path: null, name: `${familyName.replace(/[^A-Za-z0-9]+/g, '') || 'Untitled'}-${styleName.replace(/[^A-Za-z0-9]+/g, '') || 'Regular'}.ufo`,
      info: { familyName, styleName, versionMajor: 1, versionMinor: 0, unitsPerEm: upm, ascender: Math.round(upm * 0.75), descender: -Math.round(upm * 0.25),
        xHeight: Math.round(upm * 0.5), capHeight: Math.round(upm * 0.7), other: {} },
      glyphOrder: [], glyphs: {}, groups: {}, kerning: {}, features: '', lib: {}, layers: ['public.default'], warnings: [],
    };
    const add = (name, unicodes, width) => { font.glyphs[name] = newGlyph(name, unicodes, width); font.glyphOrder.push(name); };
    const s = Math.round(upm / 20); const w = Math.round(upm / 2); const hgt = Math.round(upm * 0.7);
    add('.notdef', [], w);
    font.glyphs['.notdef'].contours = [[[s, 0, 'line'], [w - s, 0, 'line'], [w - s, hgt, 'line'], [s, hgt, 'line']], [[s * 2, s, 'line'], [s * 2, hgt - s, 'line'], [w - s * 2, hgt - s, 'line'], [w - s * 2, s, 'line']]];
    add('space', [0x20], Math.round(upm / 4));
    const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    for (let c = 0x41; c <= 0x5A; c++) add(String.fromCharCode(c), [c], Math.round(upm * 0.6));
    for (let c = 0x61; c <= 0x7A; c++) add(String.fromCharCode(c), [c], Math.round(upm * 0.5));
    digits.forEach((name, i) => add(name, [0x30 + i], Math.round(upm * 0.55)));
    this.#setFont(font);
    this.#changedAll = true;
    this.#setDirty(true);
    return true;
  }

  /** Imports a font file as a new, unsaved project. */
  async importFont() {
    if (!(await this.#mayDiscard())) return false;
    const res = await this.host.project.importFont();
    if (!res) return false;
    if (res.error) {
      const known = ['unsupportedCff', 'unsupportedWoff', 'unsupportedCollection'];
      this.notifications.warn(known.includes(res.error) ? t('project.error.' + res.error) : t('project.error.unreadable', { detail: res.detail || '' }));
      return false;
    }
    this.#setFont(res.font);
    this.#changedAll = true;
    this.#setDirty(true);
    const left = res.font.warnings.filter((w) => /NotImported$/.test(w.code)).map((w) => t('project.import.' + w.code));
    this.notifications.info(t('project.import.done', { count: res.font.glyphOrder.length }) + (left.length ? ' ' + t('project.import.left', { list: left.join(', ') }) : ''), 9000);
    return true;
  }

  #setFont(font) {
    this.font = font;
    if (font) font.lib ||= {};
    this.#undo = []; this.#redo = []; this.#pending = null;
    this.#changed.clear(); this.#changedAll = false;
    this.filter = { category: 'all', query: '' };
    this.selected = null;
    this.#reindex();
    // start on a letter rather than on .notdef
    if (font) this.selected = this.#cmap.get(0x61) || this.#cmap.get(0x41) || font.glyphOrder[0] || null;
    this.#setDirty(false, true);
    this.#onDidChangeFont.fire(font);
    this.#onDidChangeSelection.fire(this.selected);
  }

  #reindex() {
    this.#shapes.clear();
    this.#cmap.clear();
    this.#categories.clear();
    this.#plan = null;
    const font = this.font;
    if (!font) { this.#kerner = () => 0; return; }
    for (const name of font.glyphOrder) {
      const glyph = font.glyphs[name];
      for (const code of glyph.unicodes) if (!this.#cmap.has(code)) this.#cmap.set(code, name);
      this.#categories.set(name, categoryOf(glyph));
    }
    this.#kerner = createKerner(font);
  }

  #setDirty(dirty, force = false) {
    if (dirty === this.dirty && !force) { this.#onDidChangeState.fire(); return; }
    this.dirty = dirty;
    this.host.setDirty(dirty);
    this.#onDidChangeState.fire();
  }

  // ---------------------------------------------------------------- editing
  #capture(scope) {
    const font = this.font;
    const state = { glyphs: {}, sections: {} };
    const names = scope.all ? Object.keys(font.glyphs) : scope.glyphs || [];
    for (const name of names) state.glyphs[name] = font.glyphs[name] ? clone(font.glyphs[name]) : null;
    const sections = new Set(scope.all ? SECTIONS : scope.sections || []);
    // a change to which glyphs exist reaches every weight, so the other weights are part of the step
    if (sections.has('glyphOrder') && weights.hasWeights(font)) sections.add('weights');
    for (const key of sections) state.sections[key] = clone(font[key]);
    return state;
  }

  #apply(state) {
    const font = this.font;
    for (const [name, glyph] of Object.entries(state.glyphs)) {
      if (glyph) font.glyphs[name] = clone(glyph); else delete font.glyphs[name];
    }
    for (const [key, value] of Object.entries(state.sections)) font[key] = clone(value);
  }

  /**
   * Starts a change. Name what it may touch: glyphs by name and/or sections of the font
   * ('glyphOrder', 'groups', 'kerning', 'info', 'lib', 'features'), or `all` for anything.
   * The font can then be modified freely until commit() (or cancel(), which puts everything back).
   */
  begin(label, scope = {}) {
    if (!this.font) return;
    if (this.#pending) this.commit();
    this.#pending = { label, scope, before: this.#capture(scope), weight: this.font.weight };
  }

  commit() {
    const p = this.#pending;
    if (!p) return false;
    this.#pending = null;
    if (weights.hasWeights(this.font) && (p.scope.all || (p.scope.sections || []).includes('glyphOrder'))) weights.reconcileWeights(this.font);
    const scope = p.scope.all ? { all: true, glyphs: [...new Set([...Object.keys(p.before.glyphs), ...Object.keys(this.font.glyphs)])] } : p.scope;
    const after = this.#capture(scope.all ? { glyphs: scope.glyphs, sections: SECTIONS } : scope);
    if (scope.all) for (const name of scope.glyphs) if (!(name in p.before.glyphs)) p.before.glyphs[name] = null;
    // keep only what really changed
    let any = false;
    for (const name of Object.keys(after.glyphs)) {
      if (JSON.stringify(after.glyphs[name]) === JSON.stringify(p.before.glyphs[name])) { delete after.glyphs[name]; delete p.before.glyphs[name]; } else any = true;
    }
    for (const key of Object.keys(after.sections)) {
      if (JSON.stringify(after.sections[key]) === JSON.stringify(p.before.sections[key])) { delete after.sections[key]; delete p.before.sections[key]; } else any = true;
    }
    if (!any) return false;
    this.#undo.push({ label: p.label, before: p.before, after, weight: p.weight });
    if (this.#undo.length > MAX_UNDO) this.#undo.shift();
    this.#redo = [];
    this.#didChange(after, p.label);
    return true;
  }

  cancel() {
    const p = this.#pending;
    if (!p) return;
    this.#pending = null;
    this.#apply(p.before);
    this.#reindex();
  }

  /** One undoable change: edit('Move points', { glyphs: ['A'] }, (font) => { … }). */
  edit(label, scope, fn) {
    if (!this.font) return false;
    this.begin(label, scope);
    try { fn(this.font); } catch (err) { this.cancel(); throw err; }
    return this.commit();
  }

  /** A step is undone in the weight it was made in. */
  #enter(entry) {
    if (entry.weight && entry.weight !== this.font.weight && weights.switchWeight(this.font, entry.weight)) this.#onDidChangeWeight.fire(this.font.weight);
  }

  undo() {
    const entry = this.#undo.pop();
    if (!entry) return;
    this.#enter(entry);
    this.#apply(entry.before);
    this.#redo.push(entry);
    this.#didChange(entry.before, entry.label);
  }

  redo() {
    const entry = this.#redo.pop();
    if (!entry) return;
    this.#enter(entry);
    this.#apply(entry.after);
    this.#undo.push(entry);
    this.#didChange(entry.after, entry.label);
  }

  #didChange(state, label) {
    const glyphs = Object.keys(state.glyphs);
    const sections = Object.keys(state.sections);
    for (const name of glyphs) this.#changed.add(name);
    this.#reindex();
    if (this.selected && !this.font.glyphs[this.selected]) {
      this.selected = this.font.glyphOrder[0] || null;
      this.#onDidChangeSelection.fire(this.selected);
    }
    this.#setDirty(true);
    this.#onDidEdit.fire({ glyphs, sections, label });
  }

  // ---------------------------------------------------------------- saving and exporting
  /** Plain data of the font, as the main process and the exporters want it. */
  #payload() {
    const f = this.font;
    return { path: f.path, name: f.name, format: f.format, info: f.info, glyphOrder: f.glyphOrder, glyphs: f.glyphs, groups: f.groups, kerning: f.kerning, features: f.features, lib: f.lib,
      layers: f.layers, weights: f.weights, weight: f.weight };
  }

  async save() {
    if (!this.font) return false;
    if (this.#pending) this.commit();
    if (!this.canSaveInPlace) return this.saveAs();
    // with several weights every layer is compared with what is on disk (only what differs is rewritten)
    const res = await this.host.project.save(this.#payload(), this.#changedAll || weights.hasWeights(this.font) ? 'all' : [...this.#changed]).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) }));
    if (!res || res.error) {
      if (res && res.error === 'needsSaveAs') return this.saveAs();
      this.notifications.warn(t('project.error.writeFailed', { detail: (res && res.detail) || '' }));
      return false;
    }
    this.#changed.clear(); this.#changedAll = false;
    this.#setDirty(false);
    this.notifications.info(res.backup ? t('project.saved.backup', { name: baseName(res.backup) }) : t('project.saved'), res.backup ? 7000 : 2500);
    return true;
  }

  async saveAs() {
    if (!this.font) return false;
    if (this.#pending) this.commit();
    const res = await this.host.project.saveAs(this.#payload()).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) }));
    if (!res) return false;
    if (res.error) {
      this.notifications.warn(res.error === 'targetExists' ? t('project.error.targetExists', { name: baseName(res.path) })
        : res.error === 'notAllowed' ? t('project.error.notAllowed') : t('project.error.writeFailed', { detail: res.detail || '' }));
      return false;
    }
    Object.assign(this.font, { path: res.path, name: res.name, format: 'ufo3', example: false });
    try { localStorage.setItem(LAST_KEY, res.path); } catch { /* storage unavailable */ }
    this.#changed.clear(); this.#changedAll = false;
    this.#setDirty(false);
    this.refreshLists();
    this.#onDidEdit.fire({ glyphs: [], sections: ['info'], label: '' });
    this.notifications.info(t('project.savedAs', { name: res.name }));
    return true;
  }

  /** The weight being worked on as a font of its own (the font itself when it has a single weight). */
  get exportable() { return weights.hasWeights(this.font) ? weights.weightFont(this.font) : this.font; }

  /** Compiles the weight being worked on (or the given font) to TrueType bytes. */
  compile(font = this.exportable) {
    return compileTtf(font);
  }

  /** @param {'ttf'|'woff2'} format */
  async exportFont(format, font = this.exportable) {
    if (!font) return false;
    let result;
    try { result = this.compile(font); } catch (err) { this.notifications.warn(t('export.error', { detail: String(err && err.message) })); return false; }
    const res = await this.host.project.exportFile({ kind: format, name: postscriptName(font.info), data: result.bytes }).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) }));
    return this.#reportExport(res, result.warnings.length ? tn('export.warnings', result.warnings.length) : '');
  }

  /**
   * Exports every style of the family — the weights that are drawn and the instances calculated
   * between them — into a new folder: one font per style and format, and a style sheet for the web.
   * @param {{ ttf?: boolean, woff2?: boolean }} formats
   */
  async exportFamily(formats = { ttf: true, woff2: true }, onlyActive = false) {
    if (!this.font) return false;
    if (this.#pending) this.commit();
    const all = weights.familyStyles(this.font);
    const styles = onlyActive ? all.filter((x) => x.kind === 'weight' && (x.id === null || x.id === this.font.weight)) : all;
    const files = []; const css = [];
    let warned = 0; let skipped = 0;
    const family = this.familyName;
    for (const style of styles) {
      let result;
      try { result = compileTtf(style.font); } catch (err) { this.notifications.warn(t('export.error', { detail: `${style.name}: ${String(err && err.message)}` })); return false; }
      warned += result.warnings.length; skipped += style.skipped.length;
      const name = postscriptName(style.font.info);
      if (formats.ttf) files.push({ name, kind: 'ttf', data: result.bytes });
      if (formats.woff2) {
        files.push({ name, kind: 'woff2', data: result.bytes });
        css.push(`@font-face {\n  font-family: "${family.replace(/"/g, '')}";\n  src: url("woff2/${name}.woff2") format("woff2");\n  font-weight: ${weights.weightClass(style.location)};\n  font-style: ${style.italic ? 'italic' : 'normal'};\n  font-display: swap;\n}\n`);
      }
    }
    if (!files.length) return false;
    if (css.length) files.push({ name: `${family.replace(/[^A-Za-z0-9]/g, '') || 'family'}.css`, kind: 'text', data: `/* ${family} — ${styles.map((x) => x.name).join(', ')} */\n${css.join('\n')}` });
    const res = await this.host.project.exportFamily({ name: `${family} fonts`, files }).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) }));
    if (!res) return false;
    if (res.error) { this.notifications.warn(t('export.error', { detail: res.error === 'notAllowed' ? t('export.notAllowed') : res.detail || res.error })); return false; }
    const notes = [tn('family.exported', styles.length, { name: baseName(res.path) }), skipped ? tn('family.skipped', skipped) : '', warned ? tn('export.warnings', warned) : ''].filter(Boolean).join(' ');
    this.notifications.info(notes, 9000, { label: t('sidebar.reveal'), run: () => this.host.reveal(res.path) });
    return true;
  }

  /** The feature code the font is compiled with: what LionFoundry generates, then the project's own code. */
  exportFeatureCode() {
    const own = this.font.features ? `\n# ---- project feature code\n${this.font.features}` : '';
    return this.exportText(generateFeatureCode(this.font) + own, `${this.familyName}-features`, 'fea');
  }

  /** A .designspace for other tools: the masters of the group (uprights or italics) being edited, and its instances. */
  exportDesignspace() {
    const font = this.font;
    if (!weights.hasWeights(font)) return false;
    const italic = weights.isItalic(weights.activeWeight(font));
    const masters = font.weights.map((w, i) => ({ italic: weights.isItalic(w), filename: font.name, layer: i ? w.layer || w.name : undefined, familyName: this.familyName, styleName: w.name, location: w.location }))
      .filter((m) => m.italic === italic);
    const instances = [...masters.map((m) => ({ styleName: m.styleName, location: m.location })), ...weights.instances(font).filter((i) => i.italic === italic).map((i) => ({ styleName: i.name, location: i.location }))]
      .sort((a, b) => a.location - b.location);
    return this.exportText(designspaceXml({ axis: 'Weight', tag: 'wght', masters, instances }), `${this.familyName.replace(/\s+/g, '')}${italic ? '-Italic' : ''}`, 'designspace');
  }

  async exportText(text, name, extension) {
    return this.#reportExport(await this.host.project.exportFile({ kind: 'text', name, extension, data: text }).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) })));
  }

  async exportPdf(name) {
    return this.#reportExport(await this.host.project.exportFile({ kind: 'pdf', name }).catch((err) => ({ error: 'writeFailed', detail: String(err && err.message) })));
  }

  #reportExport(res, extra = '') {
    if (!res) return false;
    if (res.error) { this.notifications.warn(t('export.error', { detail: res.detail || res.error })); return false; }
    this.notifications.info(`${t('export.done', { name: baseName(res.path) })} ${extra}`.trim(), 7000, { label: t('sidebar.reveal'), run: () => this.host.reveal(res.path) });
    return true;
  }

  // ---------------------------------------------------------------- derived data
  get unitsPerEm() { return this.font?.info.unitsPerEm || 1000; }
  get familyName() { return this.font ? (this.font.info.familyName || this.font.name) : ''; }
  /** Style of what is being worked on: the name of the active weight when the project has several. */
  get styleName() { return this.font ? (weights.hasWeights(this.font) ? weights.activeWeight(this.font).name : this.font.info.styleName || '') : ''; }

  // ---------------------------------------------------------------- weights
  /** The weights of the typeface: [{ id, name, location, active }] (one entry for a font with a single weight). */
  get weights() {
    const f = this.font;
    if (!f) return [];
    if (!Array.isArray(f.weights) || !f.weights.length) return [{ id: null, name: f.info.styleName || 'Regular', location: 400, active: true }];
    return f.weights.map((w) => ({ id: w.id, name: w.name, location: w.location, italic: !!w.italic, angle: w.angle, active: w.id === f.weight }));
  }

  get hasWeights() { return weights.hasWeights(this.font); }

  /** Makes another weight the one every view shows and edits. */
  setWeight(id) {
    if (!this.font) return;
    if (this.#pending) this.commit();
    if (!weights.switchWeight(this.font, id)) return;
    this.#reindex();
    this.#onDidChangeWeight.fire(id);
    this.#onDidEdit.fire({ glyphs: [], sections: ['weights'], label: '' });
    this.#onDidChangeState.fire();
  }

  /** Adds a weight that starts as a copy of the one being worked on. */
  addWeight(name, location) {
    let id = null;
    this.edit(t('undo.weight'), { sections: ['weights'] }, (font) => {
      const current = weights.activeWeight(font);
      id = weights.addWeight(font, { name, location, italic: weights.isItalic(current), angle: current && current.angle });
    });
    return id;
  }

  /**
   * Adds an italic that starts as the weight being worked on, slanted by `degrees` (to the right):
   * an oblique to redraw into a true italic. Its kerning starts as a copy too.
   */
  addItalic(name, degrees) {
    let id = null;
    this.edit(t('undo.weight'), { sections: ['weights'] }, (font) => {
      const current = weights.activeWeight(font);
      const glyphs = JSON.parse(JSON.stringify(font.glyphs));
      const matrix = skewing(degrees);
      for (const g of Object.values(glyphs)) transformGlyph(g, matrix, { scaleComponents: false });
      id = weights.addWeight(font, { name, location: current ? current.location : 400, glyphs, italic: true, angle: -Math.abs(degrees) });
    });
    return id;
  }

  // ---------------------------------------------------------------- clipboard
  // Kept inside the app: a drawing can be taken from one glyph to another, to another weight or to
  // another project opened afterwards. { whole?, width?, contours, components, anchors }
  clipboard = null;

  copy(data) {
    const strip = (c) => c.map((p) => (p[3] ? [p[0], p[1], p[2], p[3]] : [p[0], p[1], p[2]])); // identifiers must stay unique
    this.clipboard = clone({ whole: !!data.whole, width: data.width, contours: (data.contours || []).map(strip),
      components: (data.components || []).map((c) => ({ base: c.base, transform: c.transform })), anchors: (data.anchors || []).map((x) => ({ name: x.name, x: x.x, y: x.y })) });
    return this.clipboard.contours.length + this.clipboard.components.length + this.clipboard.anchors.length;
  }

  copyGlyph(name) {
    const g = this.glyph(name);
    return g ? this.copy({ whole: true, width: g.width, contours: g.contours, components: g.components, anchors: g.anchors }) : 0;
  }

  /**
   * Adds what was copied to a glyph (an empty glyph also takes the width of a glyph copied whole).
   * @returns {{ from: number, count: number } | null} where the pasted contours are
   */
  pasteInto(name) {
    const clip = this.clipboard;
    if (!clip || !this.glyph(name)) return null;
    let range = null;
    this.edit(t('undo.paste'), { glyphs: [name] }, (font) => {
      const g = font.glyphs[name];
      const empty = !g.contours.length && !g.components.length;
      range = { from: g.contours.length, count: clip.contours.length };
      g.contours.push(...clone(clip.contours));
      for (const c of clone(clip.components)) if (c.base !== name && font.glyphs[c.base]) g.components.push(c);
      for (const x of clone(clip.anchors)) if (!g.anchors.some((y) => y.name === x.name)) g.anchors.push(x);
      if (clip.whole && empty && typeof clip.width === 'number') g.width = clip.width;
    });
    return range;
  }

  /** The calculated styles (instances) of the family: [{ name, location, italic }]. */
  get instances() { return this.font ? weights.instances(this.font) : []; }

  setInstances(list) {
    return this.edit(t('undo.instances'), { sections: ['lib'] }, (font) => {
      if (list.length) font.lib[weights.INSTANCES_KEY] = list.map((i) => ({ name: i.name, location: i.location, ...(i.italic ? { italic: true } : {}) }));
      else delete font.lib[weights.INSTANCES_KEY];
    });
  }

  /** Adds the drawing of another project as a weight of this one. */
  async importWeight(name, location) {
    const path = await this.pickProject();
    if (!path) return null;
    if (path === this.font.path) { this.notifications.warn(t('family.sameProject')); return null; }
    const other = await this.readProject(path);
    if (!other) { this.notifications.warn(t('family.unreadable', { name: baseName(path) })); return null; }
    let res = null;
    this.edit(t('undo.weight'), { sections: ['weights'] }, (font) => {
      res = weights.importWeight(font, other, { name: name || other.info.styleName || baseName(path).replace(/\.ufo$/i, ''), location: location ?? (other.info.other && other.info.other.openTypeOS2WeightClass) ?? 700 });
    });
    if (res && res.missing.length) this.notifications.info(tn('family.importMissing', res.missing.length), 8000);
    return res ? res.id : null;
  }

  removeWeight(id) {
    return this.edit(t('undo.weight'), { sections: ['weights'] }, (font) => { weights.removeWeight(font, id); });
  }

  updateWeight(id, patch) {
    return this.edit(t('undo.weight'), { sections: ['weights'] }, (font) => {
      const w = weights.weightEntry(font, id);
      if (!w) return;
      if (typeof patch.name === 'string' && patch.name.trim()) w.name = patch.name.trim();
      if (typeof patch.location === 'number' && Number.isFinite(patch.location)) w.location = patch.location;
      if (typeof patch.angle === 'number' && Number.isFinite(patch.angle) && w.italic) w.angle = -Math.abs(patch.angle);
    });
  }
  glyph(name) { return this.font?.glyphs[name] || null; }
  glyphForChar(code) { return this.#cmap.get(code) || null; }
  category(name) { return this.#categories.get(name) || 'other'; }
  kern(left, right) { return this.#kerner(left, right); }
  /** What the font does with glyph sequences (features.js). Cached until the font changes. */
  get plan() { return (this.#plan ||= buildLayout(this.font)); }

  /** Outline of a glyph, components resolved: { commands, d, bounds }. Cached until the font changes. */
  shape(name) {
    let s = this.#shapes.get(name);
    if (!s) {
      const commands = this.font ? glyphCommands(this.font, name) : [];
      s = { commands, d: commandsToSvg(commands), bounds: commandsBounds(commands) };
      this.#shapes.set(name, s);
    }
    return s;
  }

  /** Vertical metrics with sensible fallbacks, in font units. */
  get metrics() {
    const i = this.font?.info || {};
    const upm = this.unitsPerEm;
    return {
      ascender: i.ascender ?? Math.round(upm * 0.8),
      descender: i.descender ?? -Math.round(upm * 0.2),
      xHeight: i.xHeight ?? null,
      capHeight: i.capHeight ?? null,
    };
  }

  categoryCounts() {
    const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
    for (const c of this.#categories.values()) counts[c]++;
    return counts;
  }

  /** Glyph names that pass the current filter, in font order. */
  visibleGlyphs() {
    if (!this.font) return [];
    const { category, query } = this.filter;
    const q = query.trim().toLowerCase();
    // a single character typed in the search finds its glyph; "U+00E1" or "00e1" finds a code point
    const single = [...query.trim()].length === 1 ? query.trim().codePointAt(0) : null;
    const hex = /^(u\+)?[0-9a-f]{4,6}$/.test(q) ? parseInt(q.replace('u+', ''), 16) : null;
    return this.font.glyphOrder.filter((name) => {
      if (category !== 'all' && this.#categories.get(name) !== category) return false;
      if (!q) return true;
      const g = this.font.glyphs[name];
      return name.toLowerCase().includes(q) || (single !== null && g.unicodes.includes(single)) || (hex !== null && g.unicodes.includes(hex));
    });
  }

  setFilter(patch) {
    this.filter = { ...this.filter, ...patch };
    this.#onDidChangeFilter.fire(this.filter);
  }

  select(name) {
    if (!this.font || !(name in this.font.glyphs) || name === this.selected) return;
    this.selected = name;
    this.#onDidChangeSelection.fire(name);
  }

  /** Moves the selection inside the visible glyphs. */
  step(delta) {
    const list = this.visibleGlyphs();
    if (!list.length) return;
    const i = list.indexOf(this.selected);
    this.select(list[(Math.max(0, i) + delta + list.length) % list.length]);
  }
}
