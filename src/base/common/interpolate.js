/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Families: checks whether two masters can be interpolated and builds the font in between.
// One axis in this version (the masters are ordered along it and blended two by two).

/** Where a project keeps its family: { axis, tag, location, masters: [{ path, location }] } (in the font lib). */
export const FAMILY_KEY = 'org.lionfoundry.family';

/** Why two versions of a glyph cannot be interpolated, or null when they can. */
export function incompatibility(a, b) {
  if (!a || !b) return 'missing';
  if (a.contours.length !== b.contours.length) return 'contours';
  for (let i = 0; i < a.contours.length; i++) {
    const ca = a.contours[i]; const cb = b.contours[i];
    if (ca.length !== cb.length) return 'points';
    for (let j = 0; j < ca.length; j++) if (ca[j][2] !== cb[j][2]) return 'pointTypes';
  }
  if (a.components.length !== b.components.length) return 'components';
  for (let i = 0; i < a.components.length; i++) if (a.components[i].base !== b.components[i].base) return 'components';
  return null;
}

/** Glyph names that cannot be interpolated between two masters: [{ name, reason }]. */
export function compatibilityReport(a, b) {
  const out = [];
  for (const name of a.glyphOrder) {
    const reason = incompatibility(a.glyphs[name], b.glyphs[name]);
    if (reason) out.push({ name, reason });
  }
  for (const name of b.glyphOrder) if (!a.glyphs[name]) out.push({ name, reason: 'missing' });
  return out;
}

const mix = (x, y, t) => x + (y - x) * t;
const mixRound = (x, y, t) => Math.round(mix(x, y, t));

function mixGlyph(a, b, t) {
  return {
    name: a.name,
    width: mixRound(a.width, b.width, t),
    unicodes: [...a.unicodes],
    contours: a.contours.map((c, i) => c.map((p, j) => {
      const q = b.contours[i][j];
      const out = [mixRound(p[0], q[0], t), mixRound(p[1], q[1], t), p[2]];
      if (p[3]) out.push(p[3]);
      return out;
    })),
    components: a.components.map((c, i) => ({ base: c.base, transform: c.transform.map((v, k) => (k > 3 ? mixRound(v, b.components[i].transform[k], t) : mix(v, b.components[i].transform[k], t))) })),
    anchors: a.anchors.map((anchor) => {
      const other = b.anchors.find((x) => x.name === anchor.name) || anchor;
      return { name: anchor.name, x: mixRound(anchor.x, other.x, t), y: mixRound(anchor.y, other.y, t) };
    }),
  };
}

/**
 * The font between two masters at t (0 = a, 1 = b; values outside extrapolate).
 * Glyphs that are not compatible are taken from the nearer master and listed in `skipped`.
 */
export function interpolateFonts(a, b, t, styleName) {
  const skipped = [];
  const glyphs = {};
  for (const name of a.glyphOrder) {
    const ga = a.glyphs[name]; const gb = b.glyphs[name];
    if (incompatibility(ga, gb)) { skipped.push(name); glyphs[name] = JSON.parse(JSON.stringify(t < 0.5 || !gb ? ga : gb)); } else glyphs[name] = mixGlyph(ga, gb, t);
  }
  const kerning = {};
  const sides = new Set([...Object.keys(a.kerning), ...Object.keys(b.kerning)]);
  for (const left of sides) {
    const ra = a.kerning[left] || {}; const rb = b.kerning[left] || {};
    for (const right of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      const v = mixRound(ra[right] || 0, rb[right] || 0, t);
      if (v) (kerning[left] ||= {})[right] = v;
    }
  }
  const info = { ...a.info, other: { ...(a.info.other || {}) } };
  for (const k of ['ascender', 'descender', 'xHeight', 'capHeight', 'italicAngle', 'openTypeOS2TypoAscender', 'openTypeOS2TypoDescender', 'openTypeHheaAscender', 'openTypeHheaDescender', 'openTypeOS2WinAscent', 'openTypeOS2WinDescent']) {
    if (typeof a.info[k] === 'number' && typeof b.info[k] === 'number') info[k] = mixRound(a.info[k], b.info[k], t);
  }
  if (styleName) { info.styleName = styleName; delete info.postscriptFontName; delete info.postscriptFullName; delete info.styleMapStyleName; }
  return {
    font: { ...a, info, glyphs, glyphOrder: [...a.glyphOrder], kerning, groups: a.groups, features: a.features, lib: a.lib, warnings: [] },
    skipped,
  };
}

/**
 * The font of a family at a position on its axis.
 * @param {Array<{location: number, font: object}>} masters
 */
export function instanceAt(masters, location, styleName) {
  if (masters.length === 1) return { font: masters[0].font, skipped: [] };
  const { a, b, t } = bracket(masters, location);
  return interpolateFonts(a.font, b.font, t, styleName);
}

/**
 * The two masters a location falls between, and how far along from the first (0–1; outside the masters
 * it extrapolates from the two nearest). Masters need a `location`; at least two of them.
 */
export function bracket(masters, location) {
  const sorted = [...masters].sort((x, y) => x.location - y.location);
  let i = sorted.findIndex((m) => m.location >= location);
  if (i <= 0) i = i === 0 ? 1 : sorted.length - 1;
  const a = sorted[i - 1]; const b = sorted[i];
  return { a, b, t: b.location === a.location ? 0 : (location - a.location) / (b.location - a.location) };
}

/** One glyph between two masters at t (they must be compatible: see incompatibility()). */
export const interpolateGlyph = (a, b, t) => mixGlyph(a, b, t);

const xmlAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * A .designspace document for a family: what other tools (fontmake, fontTools) need to build its
 * instances or a variable font from the same masters.
 * @param {{axis: string, tag: string, masters: Array<{filename, layer?, familyName, styleName, location}>, instances?: Array<{styleName, location}>}} family
 */
export function designspaceXml({ axis, tag, masters, instances = [] }) {
  const locations = masters.map((m) => m.location);
  const min = Math.min(...locations); const max = Math.max(...locations);
  const def = masters[0].location;
  const location = (v) => `<location><dimension name="${xmlAttr(axis)}" xvalue="${v}"/></location>`;
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<designspace format="4.1">\n  <axes>\n';
  out += `    <axis tag="${xmlAttr(tag)}" name="${xmlAttr(axis)}" minimum="${min}" maximum="${max}" default="${def}"/>\n  </axes>\n  <sources>\n`;
  // a master may be a layer of a project (several weights kept in one UFO): `layer` names it
  for (const m of masters) out += `    <source filename="${xmlAttr(m.filename)}"${m.layer ? ` layer="${xmlAttr(m.layer)}"` : ''} familyname="${xmlAttr(m.familyName)}" stylename="${xmlAttr(m.styleName)}">\n      ${location(m.location)}\n    </source>\n`;
  out += '  </sources>\n';
  if (instances.length) {
    out += '  <instances>\n';
    for (const i of instances) out += `    <instance familyname="${xmlAttr(masters[0].familyName)}" stylename="${xmlAttr(i.styleName)}">\n      ${location(i.location)}\n    </instance>\n`;
    out += '  </instances>\n';
  }
  return out + '</designspace>\n';
}
