/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// The object model scripts work with (JavaScript scripts use it directly; the Python scripts get the
// same names from a small Python module). It follows the vocabulary of fontParts where it can:
//   font["A"], font.keys(), font.newGlyph(name), font.removeGlyph(name), font.info, font.kerning, font.groups
//   glyph.width, glyph.leftMargin, glyph.rightMargin, glyph.unicodes, glyph.moveBy(), glyph.scaleBy()…
import * as model from './fontModel.js';

export class ScriptGlyph {
  #font; #glyph;
  constructor(font, glyph) { this.#font = font; this.#glyph = glyph; }
  get name() { return this.#glyph.name; }
  get width() { return this.#glyph.width; }
  set width(v) { this.#glyph.width = Math.max(0, Math.round(Number(v) || 0)); }
  get unicodes() { return this.#glyph.unicodes; }
  set unicodes(list) { this.#glyph.unicodes = [...list].map(Number).filter(Number.isInteger); }
  get unicode() { return this.#glyph.unicodes[0] ?? null; }
  set unicode(v) { this.#glyph.unicodes = v === null || v === undefined ? [] : [Number(v)]; }
  get contours() { return this.#glyph.contours; }
  set contours(v) { this.#glyph.contours = v; }
  get components() { return this.#glyph.components; }
  get anchors() { return this.#glyph.anchors; }
  /** Reference lines: { y } horizontal, { x } vertical, { x, y, angle } through a point. */
  get guidelines() { return (this.#glyph.guidelines ||= []); }
  /** A reference line through (x, y): angle 0 is horizontal, 90 vertical, anything else diagonal. */
  appendGuideline(x, y, angle = 0, name) {
    const a = ((Number(angle) || 0) % 180 + 180) % 180;
    const line = a === 0 ? { y: Math.round(y) } : a === 90 ? { x: Math.round(x) } : { x: Math.round(x), y: Math.round(y), angle: a };
    if (name) line.name = String(name);
    this.guidelines.push(line);
    return this;
  }
  /** { xMin, yMin, xMax, yMax } or null for an empty glyph. */
  get bounds() { return model.glyphBounds(this.#font, this.#glyph.name); }
  get leftMargin() { const b = this.bounds; return b ? b.xMin : null; }
  set leftMargin(v) { model.setLeftMargin(this.#font, this.#glyph, Number(v)); }
  get rightMargin() { const b = this.bounds; return b ? this.#glyph.width - b.xMax : null; }
  set rightMargin(v) { model.setRightMargin(this.#font, this.#glyph, Number(v)); }
  transformBy(matrix) { model.transformGlyph(this.#glyph, matrix); return this; }
  moveBy(dx, dy = 0) { return this.transformBy(model.translation(dx, dy)); }
  scaleBy(sx, sy = sx, origin = [0, 0]) { return this.transformBy(model.scaling(sx, sy, origin[0], origin[1])); }
  rotateBy(degrees, origin = [0, 0]) { return this.transformBy(model.rotation(degrees, origin[0], origin[1])); }
  skewBy(degrees) { return this.transformBy(model.skewing(degrees)); }
  reverse() { this.#glyph.contours = this.#glyph.contours.map(model.reverseContour); return this; }
  round() { for (const c of this.#glyph.contours) for (const p of c) { p[0] = Math.round(p[0]); p[1] = Math.round(p[1]); } return this; }
  clear() { this.#glyph.contours = []; this.#glyph.components = []; this.#glyph.anchors = []; return this; }
  decompose() { model.decompose(this.#font, this.#glyph); return this; }
  appendAnchor(name, x, y) { this.#glyph.anchors.push({ name: String(name), x: Math.round(x), y: Math.round(y) }); return this; }
  removeAnchor(name) { this.#glyph.anchors = this.#glyph.anchors.filter((a) => a.name !== name); return this; }
  appendComponent(base, dx = 0, dy = 0) { this.#glyph.components.push({ base: String(base), transform: [1, 0, 0, 1, Math.round(dx), Math.round(dy)] }); return this; }
  /** Appends a contour given as [[x, y, type?, smooth?], …] ("line" when the type is left out). */
  appendContour(points) { this.#glyph.contours.push(points.map((p) => [Number(p[0]), Number(p[1]), p[2] || 'line', ...(p[3] ? [1] : [])])); return this; }
  copyFrom(other) {
    const src = model.clone(this.#font.glyphs[typeof other === 'string' ? other : other.name]);
    if (src) { this.#glyph.contours = src.contours; this.#glyph.components = src.components; this.#glyph.anchors = src.anchors; this.#glyph.width = src.width; }
    return this;
  }
}

class ScriptKerning {
  #font;
  constructor(font) { this.#font = font; }
  get(left, right) { return (this.#font.kerning[left] && this.#font.kerning[left][right]) || 0; }
  set(left, right, value) { model.setKerning(this.#font, left, right, value); }
  remove(left, right) { model.setKerning(this.#font, left, right, 0); }
  /** [[left, right, value], …] */
  pairs() { const out = []; for (const [l, rs] of Object.entries(this.#font.kerning)) for (const [r, v] of Object.entries(rs)) out.push([l, r, v]); return out; }
  scaleBy(factor) { for (const [l, r, v] of this.pairs()) this.set(l, r, v * factor); }
}

export class ScriptFont {
  #font; #cache = new Map();
  constructor(font, selection = []) {
    this.#font = font;
    this.selection = selection.filter((n) => font.glyphs[n]);
    this.kerning = new ScriptKerning(font);
  }
  get info() { return this.#font.info; }
  get groups() { return this.#font.groups; }
  get lib() { return (this.#font.lib ||= {}); }
  get features() { return this.#font.features || ''; }
  set features(text) { this.#font.features = String(text); }
  get length() { return this.#font.glyphOrder.length; }
  get glyphOrder() { return [...this.#font.glyphOrder]; }
  keys() { return [...this.#font.glyphOrder]; }
  has(name) { return !!this.#font.glyphs[name]; }
  glyph(name) {
    const g = this.#font.glyphs[name];
    if (!g) return undefined;
    if (!this.#cache.has(g)) this.#cache.set(g, new ScriptGlyph(this.#font, g));
    return this.#cache.get(g);
  }
  get glyphs() { return this.keys().map((n) => this.glyph(n)); }
  get selectedGlyphs() { return this.selection.map((n) => this.glyph(n)).filter(Boolean); }
  [Symbol.iterator]() { return this.glyphs[Symbol.iterator](); }
  newGlyph(name, { unicodes = [], width = 600 } = {}) {
    if (!model.isValidGlyphName(name)) throw new Error(`invalid glyph name: ${name}`);
    if (!this.#font.glyphs[name]) { this.#font.glyphs[name] = model.newGlyph(name, unicodes, width); this.#font.glyphOrder.push(name); }
    return this.glyph(name);
  }
  removeGlyph(name) { return model.removeGlyph(this.#font, name); }
  renameGlyph(from, to) { if (!model.isValidGlyphName(to)) throw new Error(`invalid glyph name: ${to}`); return model.renameGlyph(this.#font, from, to); }
  buildComposite(name, base, mark, unicodes = []) {
    const g = model.buildComposite(this.#font, name, base, mark, unicodes);
    if (!g) return undefined;
    if (!this.#font.glyphs[name]) this.#font.glyphOrder.push(name);
    this.#font.glyphs[name] = g;
    return this.glyph(name);
  }
}

/** The script's view of a font: `font["A"]` works as well as `font.glyph("A")`. */
export function createScriptFont(font, selection = []) {
  const api = new ScriptFont(font, selection);
  return new Proxy(api, {
    get(target, key) {
      if (typeof key === 'string' && !(key in target) && target.has(key)) return target.glyph(key);
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, key) { return key in target || (typeof key === 'string' && target.has(key)); },
  });
}
