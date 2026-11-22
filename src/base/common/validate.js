/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Checks a font and reports problems as data: { code, level, glyph?, detail? }.
// The interface turns each code into a sentence in the person's language; the command line and
// agents read the codes. level: 'error' (the exported font will be wrong), 'warning' (worth a look)
// or 'info' (a suggestion).
import { contourArea, isClosed } from './fontModel.js';
import { glyphCommands, commandsBounds } from './glyphPath.js';
import { buildLayout } from './features.js';
import { incompatibility } from './interpolate.js';

/** Characters a font should cover to write each language set. */
export const CHARSETS = {
  basicLatin: ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
  portuguese: 'ÁÀÂÃÇÉÊÍÓÔÕÚÜáàâãçéêíóôõúüªº«»“”‘’–—…',
  spanish: 'ÁÉÍÑÓÚÜáéíñóúü¡¿ªº«»“”‘’–—…',
  westernEuropean: 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿŒœŠšŸŽž€£¥¢©®°±×÷¡¿«»“”‘’‚„–—…•·',
};

const key = (p) => p[0] + ',' + p[1];

/** Problems of one glyph. */
export function checkGlyph(font, name) {
  const out = [];
  const glyph = font.glyphs[name];
  const add = (code, level, detail) => out.push({ code, level, glyph: name, ...(detail !== undefined ? { detail } : {}) });
  if (!glyph) return out;

  let offGrid = false;
  let duplicates = 0;
  let open = 0;
  let tiny = 0;
  for (const contour of glyph.contours) {
    if (!isClosed(contour)) open++;
    const on = contour.filter((p) => p[2] !== 'offcurve');
    if (on.length < 2 || (isClosed(contour) && contour.length < 3)) tiny++;
    for (let i = 0; i < contour.length; i++) {
      const p = contour[i];
      if (!Number.isInteger(p[0]) || !Number.isInteger(p[1])) offGrid = true;
      const q = contour[(i + 1) % contour.length];
      if (contour.length > 1 && p[2] !== 'offcurve' && q[2] !== 'offcurve' && key(p) === key(q) && (i + 1 < contour.length || isClosed(contour))) duplicates++;
    }
  }
  if (open) add('openContour', 'error', open);
  if (tiny) add('tinyContour', 'warning', tiny);
  if (duplicates) add('duplicatePoints', 'warning', duplicates);
  if (offGrid) add('offGrid', 'info');

  // curves should have points at their horizontal and vertical extremes
  let missingExtrema = 0;
  for (const contour of glyph.contours) {
    const n = contour.length;
    for (let i = 0; i < n; i++) {
      const p = contour[i];
      if (p[2] !== 'curve') continue;
      const h2 = contour[(i - 1 + n) % n]; const h1 = contour[(i - 2 + n) % n]; const p0 = contour[(i - 3 + n) % n];
      if (h1[2] !== 'offcurve' || h2[2] !== 'offcurve' || p0[2] === 'offcurve') continue;
      for (const axis of [0, 1]) {
        const lo = Math.min(p0[axis], p[axis]); const hi = Math.max(p0[axis], p[axis]);
        const slack = Math.max(2, (font.info.unitsPerEm || 1000) / 250);
        if (h1[axis] < lo - slack || h1[axis] > hi + slack || h2[axis] < lo - slack || h2[axis] > hi + slack) { missingExtrema++; break; }
      }
    }
  }
  if (missingExtrema) add('missingExtrema', 'info', missingExtrema);

  // the biggest contour should run counter-clockwise (PostScript convention); quadratic fonts run the other way
  if (glyph.contours.length) {
    let big = 0; let bigArea = 0;
    const quadratic = glyph.contours.some((c) => c.some((p) => p[2] === 'qcurve'));
    glyph.contours.forEach((c, i) => { const a = contourArea(c); if (Math.abs(a) > Math.abs(bigArea)) { bigArea = a; big = i; } });
    void big;
    if (bigArea !== 0 && (quadratic ? bigArea > 0 : bigArea < 0)) add('wrongDirection', 'warning');
  }

  for (const c of glyph.components) {
    if (!font.glyphs[c.base]) add('missingComponent', 'error', c.base);
    else if (c.base === name) add('selfComponent', 'error');
  }
  if (glyph.contours.length && glyph.components.length) add('mixedOutline', 'info');

  const empty = !glyph.contours.length && !glyph.components.length;
  const blank = glyph.unicodes.some((u) => u === 0x20 || u === 0xA0 || (u >= 0x2000 && u <= 0x200B) || u === 0x202F || u === 0xFEFF || u === 0x0D || u === 0x09);
  if (empty && glyph.unicodes.length && !blank) add('emptyGlyph', 'warning');
  if (!empty && glyph.width === 0 && !glyph.unicodes.some((u) => u >= 0x300 && u <= 0x36F) && !/comb/.test(name)) add('zeroWidth', 'warning');
  if (glyph.width < 0) add('negativeWidth', 'error');
  if (!empty) {
    const b = commandsBounds(glyphCommands(font, name));
    const upm = font.info.unitsPerEm || 1000;
    if (b && (b.yMax > upm * 2 || b.yMin < -upm * 2 || b.xMax > upm * 4 || b.xMin < -upm * 4)) add('outOfBounds', 'warning');
  }
  return out;
}

/** Characters of a set the font has no glyph for. */
export function missingCharacters(font, set) {
  const have = new Set();
  for (const g of Object.values(font.glyphs)) for (const u of g.unicodes) have.add(u);
  return [...new Set([...CHARSETS[set] || ''])].filter((ch) => !have.has(ch.codePointAt(0)));
}

/** Problems of the whole font (glyph problems included unless `glyphs` is false). */
export function checkFont(font, { glyphs = true, charsets = ['basicLatin'] } = {}) {
  const out = [];
  const add = (code, level, detail, glyph) => out.push({ code, level, ...(glyph ? { glyph } : {}), ...(detail !== undefined ? { detail } : {}) });
  const info = font.info || {};

  if (!info.familyName) add('noFamilyName', 'error');
  if (!info.styleName) add('noStyleName', 'warning');
  if (!info.unitsPerEm) add('noUnitsPerEm', 'error');
  else if (info.unitsPerEm < 16 || info.unitsPerEm > 16384) add('badUnitsPerEm', 'error', info.unitsPerEm);
  if (typeof info.ascender !== 'number' || typeof info.descender !== 'number') add('noVerticalMetrics', 'warning');
  else {
    if (info.descender > 0) add('positiveDescender', 'warning', info.descender);
    if (info.unitsPerEm && Math.abs(info.ascender - info.descender - info.unitsPerEm) > info.unitsPerEm * 0.35) add('unusualLineHeight', 'info', info.ascender - info.descender);
  }
  if (!info.copyright) add('noCopyright', 'info');
  if (!info.openTypeNameLicense) add('noLicense', 'info');

  if (!font.glyphs['.notdef']) add('noNotdef', 'warning');
  const seen = new Map();
  let hasSpace = false;
  for (const name of font.glyphOrder) {
    for (const u of font.glyphs[name].unicodes) {
      if (u === 0x20) hasSpace = true;
      if (seen.has(u)) add('duplicateUnicode', 'error', `U+${u.toString(16).toUpperCase().padStart(4, '0')} ${seen.get(u)}`, name);
      else seen.set(u, name);
    }
  }
  if (!hasSpace) add('noSpace', 'error');
  if (font.glyphOrder.length > 65535) add('tooManyGlyphs', 'error', font.glyphOrder.length);

  for (const set of charsets) {
    const missing = missingCharacters(font, set);
    if (missing.length) add('missingCharacters', set === 'basicLatin' ? 'warning' : 'info', `${set}: ${missing.join(' ')}`);
  }

  // kerning and groups that point to glyphs or groups that are not there
  const side = (s) => (s.startsWith('public.kern') ? s in font.groups : !!font.glyphs[s]);
  let badKerning = 0;
  for (const [left, rights] of Object.entries(font.kerning || {})) {
    for (const right of Object.keys(rights)) if (!side(left) || !side(right)) badKerning++;
  }
  if (badKerning) add('unknownKerningSide', 'warning', badKerning);
  for (const [group, members] of Object.entries(font.groups || {})) {
    if (!Array.isArray(members)) continue;
    const unknown = members.filter((m) => !font.glyphs[m]);
    if (unknown.length) add('unknownGroupMember', 'warning', `${group}: ${unknown.join(' ')}`);
  }

  for (const w of buildLayout(font).warnings) add('featureCode', 'warning', `${w.line}: ${w.text}`);

  // weights of the same typeface should be drawn with the same structure, or nothing in between can be calculated
  if (Array.isArray(font.weights) && font.weights.length > 1) {
    const active = font.weights.find((w) => w.id === font.weight);
    for (const w of font.weights) {
      // uprights are only compared with uprights, italics with italics
      if (w.id === font.weight || !w.glyphs || !!w.italic !== !!(active && active.italic)) continue;
      for (const name of font.glyphOrder) {
        const reason = incompatibility(font.glyphs[name], w.glyphs[name]);
        if (reason) add('notInterpolable', 'info', `${w.name}: ${reason}`, name);
      }
    }
  }

  if (glyphs) for (const name of font.glyphOrder) out.push(...checkGlyph(font, name));
  return out;
}

export function countByLevel(problems) {
  const c = { error: 0, warning: 0, info: 0 };
  for (const p of problems) c[p.level]++;
  return c;
}
