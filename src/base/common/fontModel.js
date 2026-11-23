/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Editing operations on the font model. Pure functions over plain data, so the interface, the
// scripts, the command line and agents all change a font through the same code.
//
// A glyph is { name, width, unicodes, contours, components, anchors, extra? }; a contour is a list of
// points [x, y, type, smooth?] (see glyphPath.js).
import { glyphCommands, commandsBounds, applyTransform } from './glyphPath.js';

export const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

export function newGlyph(name, unicodes = [], width = 600) {
  return { name, width, unicodes: [...unicodes], contours: [], components: [], anchors: [] };
}

export const isOn = (p) => p[2] !== 'offcurve';
export const isClosed = (contour) => contour.length > 0 && contour[0][2] !== 'move';

/** Exact bounds of a glyph with its components, or null when it has no outline. */
export function glyphBounds(font, name) {
  return commandsBounds(glyphCommands(font, name));
}

/** Applies an affine transform [a, b, c, d, e, f] to the contours, anchors and component offsets of a glyph. */
export function transformGlyph(glyph, t, { round = true, scaleComponents = true } = {}) {
  const r = (v) => (round ? Math.round(v) : v);
  for (const contour of glyph.contours) {
    for (const p of contour) { const [x, y] = applyTransform(t, p[0], p[1]); p[0] = r(x); p[1] = r(y); }
  }
  for (const a of glyph.anchors) { const [x, y] = applyTransform(t, a.x, a.y); a.x = r(x); a.y = r(y); }
  for (const c of glyph.components) {
    const m = c.transform;
    const [e, f] = applyTransform(t, m[4], m[5]);
    // the 2×2 part of the component composes with the 2×2 part of the transform — unless the base glyphs
    // are being transformed too (a whole-font operation), when only the position has to follow
    c.transform = scaleComponents
      ? [m[0] * t[0] + m[1] * t[2], m[0] * t[1] + m[1] * t[3], m[2] * t[0] + m[3] * t[2], m[2] * t[1] + m[3] * t[3], r(e), r(f)]
      : [m[0], m[1], m[2], m[3], r(e), r(f)];
  }
  // a mirror flips the direction of every contour: put it back
  if (t[0] * t[3] - t[1] * t[2] < 0) glyph.contours = glyph.contours.map(reverseContour);
  return glyph;
}

export const translation = (dx, dy) => [1, 0, 0, 1, dx, dy];
/** Scale around (cx, cy). */
export const scaling = (sx, sy, cx = 0, cy = 0) => [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
/** Counter-clockwise rotation in degrees around (cx, cy). */
export function rotation(deg, cx = 0, cy = 0) {
  const a = deg * Math.PI / 180;
  const cos = Math.cos(a); const sin = Math.sin(a);
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}
/** Slant to the right by `deg` degrees, keeping the baseline (or `cy`) in place. */
export function skewing(deg, cy = 0) {
  const k = Math.tan(deg * Math.PI / 180);
  return [1, 0, k, 1, -k * cy, 0];
}

/**
 * Reverses the direction of a contour. In the UFO point model the type of a point describes the
 * segment that arrives at it, so each on-curve point takes the type of the next one before the list is flipped.
 */
export function reverseContour(points) {
  const n = points.length;
  if (n < 2) return points.map((p) => [...p]);
  const closed = isClosed(points);
  const out = points.map((p) => [...p]);
  const on = [];
  for (let i = 0; i < n; i++) if (isOn(points[i])) on.push(i);
  if (!on.length) return out.reverse();
  for (let k = 0; k < on.length; k++) {
    const next = on[k + 1];
    if (next !== undefined) out[on[k]][2] = points[next][2];
    else out[on[k]][2] = closed ? points[on[0]][2] : 'move';
  }
  out.reverse();
  if (!closed) {
    // an open contour must start with its "move" point
    while (out.length && out[0][2] === 'offcurve') out.push(out.shift());
  }
  return out;
}

/** Signed area of a contour's control polygon: positive when counter-clockwise. */
export function contourArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

/**
 * Deletes points of a contour. Deleting an on-curve point also removes the handles of the segment
 * that arrived at it; deleting a handle turns its segment into a line.
 * @returns the new contour, or null when fewer than two on-curve points are left
 */
export function deletePoints(points, indices) {
  const drop = new Set(indices);
  const n = points.length;
  const closed = isClosed(points);
  const out = points.map((p) => [...p]);
  for (const i of indices) {
    if (isOn(points[i])) {
      for (let j = i - 1; ; j--) {
        const k = closed ? (j + n) % n : j;
        if (k < 0 || k === i || isOn(points[k])) break;
        drop.add(k);
      }
    } else {
      // remove every handle of this segment and make its end point a line
      for (const dir of [-1, 1]) {
        for (let j = i + dir; ; j += dir) {
          const k = closed ? (j + n) % n : j;
          if (k < 0 || k >= n || k === i) break;
          if (isOn(points[k])) { if (dir === 1) out[k][2] = 'line'; break; }
          drop.add(k);
        }
      }
    }
  }
  let kept = out.filter((_, i) => !drop.has(i));
  if (kept.filter(isOn).length < 2) return null;
  if (!closed && kept[0][2] !== 'move') {
    while (kept.length && !isOn(kept[0])) kept.shift();
    kept[0][2] = 'move';
  }
  // a point left with no handles before it can no longer be a curve
  const m = kept.length;
  kept = kept.map((p, i) => {
    if (p[2] !== 'curve' && p[2] !== 'qcurve') return p;
    const prev = kept[(i - 1 + m) % m];
    return (i === 0 && !closed) || isOn(prev) ? [p[0], p[1], 'line'] : p;
  });
  return kept;
}

/** Moves the reference lines of a glyph along with a shift of its whole drawing. */
export function shiftGuidelines(glyph, dx, dy = 0) {
  for (const g of glyph.guidelines || []) {
    if (g.x !== undefined && g.x !== null) g.x += dx;
    if (g.y !== undefined && g.y !== null) g.y += dy;
  }
}

/** Sets the left side bearing by moving the whole outline (the advance width follows, the right bearing stays). */
export function setLeftMargin(font, glyph, value) {
  const b = glyphBounds(font, glyph.name);
  if (!b) return;
  const dx = Math.round(value - b.xMin);
  for (const c of glyph.contours) for (const p of c) p[0] += dx;
  for (const a of glyph.anchors) a.x += dx;
  for (const c of glyph.components) c.transform[4] += dx;
  shiftGuidelines(glyph, dx); // the drawing moved as a whole: its reference lines go with it
  glyph.width = Math.max(0, glyph.width + dx);
}

export function setRightMargin(font, glyph, value) {
  const b = glyphBounds(font, glyph.name);
  if (!b) return;
  glyph.width = Math.max(0, Math.round(b.xMax + value));
}

/** Replaces the components of a glyph by copies of their outlines. */
export function decompose(font, glyph) {
  for (const comp of glyph.components) {
    const base = font.glyphs[comp.base];
    if (!base) continue;
    const copy = clone(base);
    if (copy.components.length) decompose(font, copy);
    transformGlyph(copy, comp.transform);
    glyph.contours.push(...copy.contours);
  }
  glyph.components = [];
}

/**
 * Builds a composite: the base glyph plus a mark placed where the anchors meet
 * ("top" on the base with "_top" on the mark, and so on).
 * @returns the new glyph, or null when the two glyphs share no anchor pair
 */
export function buildComposite(font, name, baseName, markName, unicodes = []) {
  const base = font.glyphs[baseName];
  const mark = font.glyphs[markName];
  if (!base || !mark) return null;
  for (const m of mark.anchors) {
    if (!m.name.startsWith('_')) continue;
    const b = base.anchors.find((a) => a.name === m.name.slice(1));
    if (!b) continue;
    const glyph = newGlyph(name, unicodes, base.width);
    glyph.components = [
      { base: baseName, transform: [1, 0, 0, 1, 0, 0] },
      { base: markName, transform: [1, 0, 0, 1, b.x - m.x, b.y - m.y] },
    ];
    return glyph;
  }
  return null;
}

/** Glyphs that use `name` as a component. */
export function usersOf(font, name) {
  return font.glyphOrder.filter((n) => font.glyphs[n].components.some((c) => c.base === name));
}

/** Renames a glyph everywhere it is referred to: order, components, groups and kerning. */
export function renameGlyph(font, oldName, newName) {
  if (!font.glyphs[oldName] || font.glyphs[newName] || !newName) return false;
  const glyph = font.glyphs[oldName];
  delete font.glyphs[oldName];
  glyph.name = newName;
  font.glyphs[newName] = glyph;
  font.glyphOrder = font.glyphOrder.map((n) => (n === oldName ? newName : n));
  for (const g of Object.values(font.glyphs)) for (const c of g.components) if (c.base === oldName) c.base = newName;
  for (const key of Object.keys(font.groups)) {
    if (Array.isArray(font.groups[key])) font.groups[key] = font.groups[key].map((n) => (n === oldName ? newName : n));
  }
  const kerning = {};
  for (const [left, rights] of Object.entries(font.kerning)) {
    const row = {};
    for (const [right, v] of Object.entries(rights)) row[right === oldName ? newName : right] = v;
    kerning[left === oldName ? newName : left] = row;
  }
  font.kerning = kerning;
  return true;
}

/** Removes a glyph and every reference to it in groups and kerning (components that use it are decomposed first). */
export function removeGlyph(font, name) {
  if (!font.glyphs[name]) return false;
  for (const user of usersOf(font, name)) decompose(font, font.glyphs[user]);
  delete font.glyphs[name];
  font.glyphOrder = font.glyphOrder.filter((n) => n !== name);
  for (const key of Object.keys(font.groups)) {
    if (Array.isArray(font.groups[key])) font.groups[key] = font.groups[key].filter((n) => n !== name);
  }
  delete font.kerning[name];
  for (const rights of Object.values(font.kerning)) delete rights[name];
  return true;
}

/**
 * Sets a kerning value between two sides (glyph names or group names); 0 removes the pair.
 */
export function setKerning(font, left, right, value) {
  const v = Math.round(Number(value) || 0);
  if (!v) {
    if (font.kerning[left]) {
      delete font.kerning[left][right];
      if (!Object.keys(font.kerning[left]).length) delete font.kerning[left];
    }
    return;
  }
  (font.kerning[left] ||= {})[right] = v;
}

/** The kerning group a glyph belongs to on one side (1 = first glyph of the pair, 2 = second), if any. */
export function kerningGroupOf(font, name, side) {
  const prefix = `public.kern${side}.`;
  for (const [group, members] of Object.entries(font.groups)) {
    if (group.startsWith(prefix) && Array.isArray(members) && members.includes(name)) return group;
  }
  return null;
}

/**
 * The pair to write when the kerning between two glyphs is changed: the one that applies now (glyph or
 * group on each side); when none does, the pair between their groups, or between the glyphs that have no group.
 */
export function kerningPairFor(font, left, right) {
  const gl = kerningGroupOf(font, left, 1); const gr = kerningGroupOf(font, right, 2);
  const has = (l, r) => l && r && font.kerning[l] && typeof font.kerning[l][r] === 'number';
  return [[left, right], [left, gr], [gl, right], [gl, gr]].find(([l, r]) => has(l, r)) || [gl || left, gr || right];
}

/** Suggests the glyph name for a character: AGL-style names for letters and digits, "uniXXXX" otherwise. */
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export function suggestGlyphName(code) {
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return String.fromCodePoint(code);
  if (code >= 0x30 && code <= 0x39) return DIGITS[code - 0x30];
  if (code === 0x20) return 'space';
  return code > 0xFFFF ? 'u' + code.toString(16).toUpperCase() : 'uni' + code.toString(16).toUpperCase().padStart(4, '0');
}

const NAME_RE = /^[A-Za-z_.][A-Za-z0-9_.\-]{0,62}$/;
/** Glyph names must work in feature code and in the exported font. */
export const isValidGlyphName = (name) => NAME_RE.test(name) || name === '.notdef';
