/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Several weights of a typeface in one project.
//
// A font model may have `font.weights = [{ id, name, location, italic?, angle?, layer?, glyphs?, kerning? }, …]` and
// `font.weight`, the id of the one being worked on. The drawing and the kerning of the ACTIVE weight are
// `font.glyphs` and `font.kerning`, exactly as in a font with a single weight — so every view and tool
// works on "the font" without knowing about weights. The other weights keep their own `glyphs` and
// `kerning` in their entry. Names, metrics, groups, features and glyph order are shared by all.
// Every weight has every glyph (reconcileWeights sees to that).
//
// A weight may be an italic (`italic: true`, with its slant in `angle`, negative when it leans to the
// right). Uprights and italics are two groups: weights in between are only calculated inside a group.
// Styles that are not drawn but calculated — "instances" — are listed in the font lib under INSTANCES_KEY
// as [{ name, location, italic? }]; familyStyles() gives every style of the family, drawn or calculated.
//
// On disk (UFO): the first weight is the default layer and kerning.plist; each other weight is one more
// glyph layer, with its kerning under WEIGHTS_KEY in lib.plist (see ufoReader.js and ufoWriter.js).

import { instanceAt } from './interpolate.js';

export const WEIGHTS_KEY = 'org.lionfoundry.weights';
export const INSTANCES_KEY = 'org.lionfoundry.instances';
/** Slant given to an italic when none was chosen. */
export const DEFAULT_ANGLE = -10;
export const isItalic = (w) => !!(w && w.italic);
const clone = (v) => JSON.parse(JSON.stringify(v));

export const hasWeights = (font) => !!font && Array.isArray(font.weights) && font.weights.length > 1;
export const weightEntry = (font, id) => (Array.isArray(font.weights) ? font.weights.find((w) => w.id === id) || null : null);
export const activeWeight = (font) => weightEntry(font, font.weight);

/** Glyphs and kerning of a weight, wherever they are kept. */
export function weightData(font, id) {
  const w = weightEntry(font, id);
  return !w || id === font.weight ? { glyphs: font.glyphs, kerning: font.kerning } : { glyphs: w.glyphs, kerning: w.kerning };
}

/** OS/2 weight class for a position on the weight axis. */
export const weightClass = (location) => Math.max(1, Math.min(1000, Math.round(Number(location) || 400)));

/**
 * One weight as a font of its own, to read, check, interpolate or export (nothing is copied:
 * glyphs and kerning are the weight's own objects). Its style name is the name of the weight.
 */
export function weightFont(font, id = font.weight) {
  const w = weightEntry(font, id);
  if (!w) return font;
  const info = { ...font.info, styleName: w.name, other: { ...(font.info.other || {}), openTypeOS2WeightClass: weightClass(w.location) } };
  // names that were written for one style must not leak into the others
  delete info.postscriptFontName; delete info.postscriptFullName; delete info.styleMapStyleName; delete info.styleMapFamilyName;
  // in a family with italics the slant belongs to each style, not to the project
  if (font.weights.some(isItalic)) { if (w.italic) info.italicAngle = typeof w.angle === 'number' ? w.angle : DEFAULT_ANGLE; else delete info.italicAngle; }
  return { ...font, ...weightData(font, id), info, weights: undefined, weight: undefined };
}

/** Makes another weight the one being worked on. */
export function switchWeight(font, id) {
  const next = weightEntry(font, id);
  const current = activeWeight(font);
  if (!next || !current || next === current) return false;
  current.glyphs = font.glyphs; current.kerning = font.kerning;
  font.glyphs = next.glyphs; font.kerning = next.kerning || {};
  delete next.glyphs; delete next.kerning;
  font.weight = id;
  return true;
}

function uniqueId(font, name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'weight';
  let id = base;
  for (let i = 2; weightEntry(font, id); i++) id = `${base}-${i}`;
  return id;
}

/** Turns a font with one weight into one that lists it (the first entry is the drawing it already has). */
function ensureWeights(font) {
  if (Array.isArray(font.weights) && font.weights.length) return;
  const explicit = font.info.other && font.info.other.openTypeOS2WeightClass;
  const first = { id: 'w1', name: font.info.styleName || 'Regular', location: typeof explicit === 'number' ? explicit : 400 };
  first.id = String(first.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'w1';
  font.weights = [first];
  font.weight = first.id;
}

/**
 * Adds a weight. Without `glyphs` it starts as a copy of the weight being worked on, so the new
 * weight can be interpolated with it from the first moment.
 * @returns the id of the new weight
 */
export function addWeight(font, { name, location, glyphs, kerning, italic, angle }) {
  ensureWeights(font);
  const id = uniqueId(font, name);
  const layers = new Set([...(font.layers || []), ...font.weights.map((w) => w.layer).filter(Boolean)]);
  let layer = String(name);
  for (let i = 2; layers.has(layer) || layer === 'public.default'; i++) layer = `${name} ${i}`;
  font.weights.push({ id, name: String(name), location: Number(location) || 400, ...(italic ? { italic: true, angle: typeof angle === 'number' ? angle : DEFAULT_ANGLE } : {}),
    layer, glyphs: glyphs || clone(font.glyphs), kerning: kerning || clone(font.kerning) });
  reconcileWeights(font);
  return id;
}

/** Removes a weight that is not the one being worked on. */
export function removeWeight(font, id) {
  if (!hasWeights(font) || id === font.weight) return false;
  const before = font.weights.length;
  font.weights = font.weights.filter((w) => w.id !== id);
  return font.weights.length < before;
}

/**
 * Runs `fn(view)` for each weight that is not being worked on, where `view` looks like a font whose
 * glyphs and kerning are that weight's. Used by changes that have to happen in every weight
 * (renaming or removing a glyph, building composites).
 */
export function eachOtherWeight(font, fn) {
  if (!hasWeights(font)) return;
  for (const w of font.weights) {
    if (w.id === font.weight) continue;
    w.glyphs ||= {};
    const view = { glyphs: w.glyphs, kerning: w.kerning || {}, groups: font.groups, glyphOrder: font.glyphOrder.filter((n) => w.glyphs[n]), info: font.info, lib: font.lib, features: font.features };
    fn(view, w);
    w.glyphs = view.glyphs; w.kerning = view.kerning;
  }
}

/** Gives every weight exactly the glyphs of the font: what is missing is copied from the active weight, what is extra goes. */
export function reconcileWeights(font) {
  if (!Array.isArray(font.weights)) return;
  for (const w of font.weights) {
    if (w.id === font.weight) continue;
    w.glyphs ||= {}; w.kerning ||= {};
    for (const name of font.glyphOrder) if (!w.glyphs[name] && font.glyphs[name]) w.glyphs[name] = clone(font.glyphs[name]);
    for (const name of Object.keys(w.glyphs)) {
      if (font.glyphs[name]) { w.glyphs[name].unicodes = [...font.glyphs[name].unicodes]; continue; }
      delete w.glyphs[name];
      delete w.kerning[name];
      for (const row of Object.values(w.kerning)) delete row[name];
    }
  }
}

/** Adds another font (one that was read from its own project) as a weight of this one. */
export function importWeight(font, other, { name, location }) {
  const glyphs = {};
  for (const n of font.glyphOrder) glyphs[n] = clone(other.glyphs[n] || font.glyphs[n]);
  for (const n of font.glyphOrder) glyphs[n].unicodes = [...font.glyphs[n].unicodes];
  const missing = font.glyphOrder.filter((n) => !other.glyphs[n]);
  const id = addWeight(font, { name, location, glyphs, kerning: clone(other.kerning || {}) });
  return { id, missing };
}

/**
 * The weights as masters for interpolation: [{ id, name, location, italic, font }] — the uprights or
 * the italics (the group of the weight being worked on when `italic` is left out).
 */
export function weightMasters(font, italic = isItalic(activeWeight(font))) {
  return hasWeights(font) ? font.weights.filter((w) => isItalic(w) === !!italic)
    .map((w) => ({ id: w.id, name: w.name, location: w.location, italic: isItalic(w), font: weightFont(font, w.id) })) : [];
}

/** The weights drawn in the same group (upright or italic) as the one being worked on, except itself. */
export function siblingWeights(font) {
  if (!hasWeights(font)) return [];
  const italic = isItalic(activeWeight(font));
  return font.weights.filter((w) => w.id !== font.weight && isItalic(w) === italic);
}

/** The calculated styles the project lists: [{ name, location, italic }]. */
export function instances(font) {
  const list = font.lib && font.lib[INSTANCES_KEY];
  return Array.isArray(list) ? list.filter((i) => i && typeof i.name === 'string' && i.name && Number.isFinite(i.location)).map((i) => ({ name: i.name, location: i.location, italic: !!i.italic })) : [];
}

/** A style in between, calculated from the weights of its group: { font, skipped } or null when the group has fewer than two weights. */
export function weightInstance(font, location, name, italic = isItalic(activeWeight(font))) {
  const masters = weightMasters(font, italic);
  const exact = masters.find((m) => m.location === location);
  if (exact) return { font: name && name !== exact.name ? { ...exact.font, info: { ...exact.font.info, styleName: name } } : exact.font, skipped: [] };
  if (masters.length < 2) return null;
  const res = instanceAt(masters, location, name);
  res.font.info.other = { ...(res.font.info.other || {}), openTypeOS2WeightClass: weightClass(location) };
  return res;
}

/**
 * Every style of the family, as fonts ready to check or export: the weights that are drawn and the
 * instances calculated between them. [{ kind: 'weight'|'instance', id?, name, location, italic, font, skipped }]
 */
export function familyStyles(font) {
  if (!hasWeights(font)) {
    return [{ kind: 'weight', id: null, name: font.info.styleName || 'Regular', location: 400, italic: !!font.info.italicAngle, font, skipped: [] }];
  }
  const out = font.weights.map((w) => ({ kind: 'weight', id: w.id, name: w.name, location: w.location, italic: isItalic(w), font: weightFont(font, w.id), skipped: [] }));
  for (const inst of instances(font)) {
    if (out.some((x) => x.italic === inst.italic && (x.location === inst.location || x.name === inst.name))) continue; // drawn already
    const res = weightInstance(font, inst.location, inst.name, inst.italic);
    if (res) out.push({ kind: 'instance', name: inst.name, location: inst.location, italic: inst.italic, font: res.font, skipped: res.skipped });
  }
  return out.sort((a, b) => (a.location - b.location) || (Number(a.italic) - Number(b.italic)));
}

/** What lib.plist keeps about the weights (the first one is the default layer, so it has no layer or kerning here). */
export function weightsForLib(font) {
  if (!hasWeights(font)) return null;
  const slant = (w) => (w.italic ? { italic: true, angle: typeof w.angle === 'number' ? w.angle : DEFAULT_ANGLE } : {});
  return font.weights.map((w, i) => (i === 0 ? { id: w.id, name: w.name, location: w.location, ...slant(w) }
    : { id: w.id, name: w.name, location: w.location, ...slant(w), layer: w.layer || w.name, kerning: weightData(font, w.id).kerning || {} }));
}
