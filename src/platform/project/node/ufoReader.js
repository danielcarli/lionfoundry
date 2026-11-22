/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Reads a Unified Font Object (UFO 2 or 3) folder into LionFoundry's font model.
// The model is plain JSON: it crosses the bridge to the UI and is what the command line and agents read.
// Nothing here writes to disk (ufoWriter.js does, and only when the person saves).
const fs = require('fs');
const path = require('path');
const { parseXml, parsePlist } = require('./xml');

const MAX_FILE = 8 * 1024 * 1024; // a single .glif or .plist bigger than this is refused
/** Where lib.plist lists the weights of the typeface (see src/base/common/weights.js). */
const WEIGHTS_KEY = 'org.lionfoundry.weights';
const MAX_GLYPHS = 70000;

/** Font info fields the UI shows, in order (the rest of fontinfo.plist is kept under info.other). */
const INFO_FIELDS = [
  'familyName', 'styleName', 'versionMajor', 'versionMinor', 'unitsPerEm', 'ascender', 'descender', 'xHeight', 'capHeight',
  'italicAngle', 'copyright', 'trademark', 'openTypeNameDesigner', 'openTypeNameDesignerURL', 'openTypeNameManufacturer',
  'openTypeNameLicense', 'openTypeNameLicenseURL', 'openTypeNameDescription', 'postscriptFontName', 'postscriptFullName',
  'openTypeOS2TypoAscender', 'openTypeOS2TypoDescender', 'openTypeOS2TypoLineGap', 'openTypeHheaAscender',
  'openTypeHheaDescender', 'openTypeHheaLineGap', 'openTypeOS2WinAscent', 'openTypeOS2WinDescent', 'note',
];

function readText(file) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE) throw new Error(`file too large: ${path.basename(file)}`);
  return fs.readFileSync(file, 'utf8');
}

function readPlist(dir, name, fallback) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return fallback;
  return parsePlist(readText(file));
}

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Parses one .glif file (GLIF format 1 or 2). */
function parseGlif(source, fallbackName) {
  const root = parseXml(source);
  if (root.name !== 'glyph') throw new Error('not a glyph file');
  const glyph = { name: root.attrs.name || fallbackName, width: 0, unicodes: [], contours: [], components: [], anchors: [] };
  for (const el of root.children) {
    if (el.name === 'advance') {
      glyph.width = num(el.attrs.width);
      if (el.attrs.height !== undefined) glyph.height = num(el.attrs.height);
    } else if (el.name === 'unicode') {
      const code = parseInt(el.attrs.hex, 16);
      if (Number.isFinite(code)) glyph.unicodes.push(code);
    } else if (el.name === 'anchor') {
      const anchor = { name: el.attrs.name || '', x: num(el.attrs.x), y: num(el.attrs.y) };
      if (el.attrs.color) anchor.color = el.attrs.color;
      if (el.attrs.identifier) anchor.identifier = el.attrs.identifier;
      glyph.anchors.push(anchor);
    } else if (el.name === 'guideline') {
      // a reference line of the glyph: { y } horizontal, { x } vertical, { x, y, angle } through a point
      const a = el.attrs;
      const line = {};
      if (a.x !== undefined) line.x = num(a.x);
      if (a.y !== undefined) line.y = num(a.y);
      if (a.angle !== undefined) line.angle = num(a.angle);
      for (const k of ['name', 'color', 'identifier']) if (a[k]) line[k] = a[k];
      if (line.x !== undefined || line.y !== undefined) (glyph.guidelines ||= []).push(line);
    } else if (el.name === 'lib' || el.name === 'image') {
      // not edited by LionFoundry: kept as read, and written back unchanged
      (glyph.extra ||= []).push(el);
    } else if (el.name === 'note') {
      glyph.note = el.text.trim();
    } else if (el.name === 'outline') {
      for (const part of el.children) {
        if (part.name === 'component') {
          const a = part.attrs;
          if (!a.base) continue;
          const component = {
            base: a.base,
            transform: [num(a.xScale, 1), num(a.xyScale), num(a.yxScale), num(a.yScale, 1), num(a.xOffset), num(a.yOffset)],
          };
          if (a.identifier) component.identifier = a.identifier;
          glyph.components.push(component);
        } else if (part.name === 'contour') {
          const points = part.children.filter((p) => p.name === 'point').map((p) => {
            const point = [num(p.attrs.x), num(p.attrs.y), p.attrs.type || 'offcurve'];
            if (p.attrs.smooth === 'yes') point.push(1);
            if (p.attrs.name || p.attrs.identifier) {
              // point names and identifiers ride along as a fifth item
              point[3] = point[3] || 0;
              point.push({ ...(p.attrs.name ? { name: p.attrs.name } : {}), ...(p.attrs.identifier ? { identifier: p.attrs.identifier } : {}) });
            }
            return point;
          });
          // GLIF 1 stores anchors as single-point contours: a named "move" point
          const first = part.children.find((p) => p.name === 'point');
          if (points.length === 1 && points[0][2] === 'move' && first && first.attrs.name && root.attrs.format !== '2') {
            glyph.anchors.push({ name: first.attrs.name, x: points[0][0], y: points[0][1] });
          } else if (points.length) {
            glyph.contours.push(points);
          }
        }
      }
    }
  }
  return glyph;
}

/** True when the folder looks like a UFO (it has metainfo.plist). */
function isUfo(dir) {
  try { return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'metainfo.plist')); } catch { return false; }
}

/**
 * Reads a UFO folder.
 * @param {string} dir path of the .ufo folder
 * @returns the font model: { format, path, info, glyphOrder, glyphs, groups, kerning, features, layers, warnings }
 */
/** The glyphs of one layer folder, by name. */
function readLayer(glyphDir, warnings) {
  const contents = readPlist(glyphDir, 'contents.plist', {});
  const names = Object.keys(contents);
  if (names.length > MAX_GLYPHS) throw new Error(`too many glyphs: ${names.length}`);
  const glyphs = {};
  for (const name of names) {
    const fileName = String(contents[name]);
    const file = path.join(glyphDir, fileName);
    if (path.dirname(file) !== glyphDir) { warnings.push({ code: 'badFileName', glyph: name }); continue; }
    try {
      const glyph = parseGlif(readText(file), name);
      glyph.name = name; // contents.plist is authoritative
      glyphs[name] = glyph;
    } catch (err) {
      warnings.push({ code: 'unreadableGlyph', glyph: name, detail: err.message });
    }
  }
  return glyphs;
}

function readUfo(dir) {
  if (!isUfo(dir)) throw new Error('not a UFO folder (metainfo.plist is missing)');
  const warnings = [];
  const meta = readPlist(dir, 'metainfo.plist', {});
  const formatVersion = num(meta.formatVersion, 3);
  if (formatVersion < 2 || formatVersion > 3) throw new Error(`unsupported UFO version: ${meta.formatVersion}`);

  const rawInfo = readPlist(dir, 'fontinfo.plist', {});
  const info = { other: {} };
  for (const [k, v] of Object.entries(rawInfo)) {
    if (INFO_FIELDS.includes(k)) info[k] = v;
    else info.other[k] = v;
  }

  // layers: the default one is drawn; the others are listed
  const layerContents = readPlist(dir, 'layercontents.plist', [['public.default', 'glyphs']]);
  const layers = layerContents.map(([name, folder]) => ({ name, folder }));
  const glyphDir = path.join(dir, (layers.find((l) => l.folder === 'glyphs') || layers[0] || { folder: 'glyphs' }).folder);
  if (!glyphDir.startsWith(dir + path.sep)) throw new Error('invalid layer folder');

  const glyphs = readLayer(glyphDir, warnings);

  const lib = readPlist(dir, 'lib.plist', {});
  const listed = Array.isArray(lib['public.glyphOrder']) ? lib['public.glyphOrder'].filter((n) => n in glyphs) : [];
  const seen = new Set(listed);
  const glyphOrder = listed.concat(Object.keys(glyphs).filter((n) => !seen.has(n)).sort());

  for (const g of Object.values(glyphs)) {
    for (const c of g.components) {
      if (!(c.base in glyphs)) warnings.push({ code: 'missingComponent', glyph: g.name, detail: c.base });
    }
  }

  const groups = readPlist(dir, 'groups.plist', {});
  const kerning = readPlist(dir, 'kerning.plist', {});

  // Other weights of the typeface kept in this project: each one is a glyph layer, listed in the lib
  // with its name, its position on the weight axis and its kerning. The first weight is the default layer.
  let weights;
  const saved = lib[WEIGHTS_KEY];
  delete lib[WEIGHTS_KEY];
  if (Array.isArray(saved) && saved.length > 1 && saved.every((w) => w && typeof w.id === 'string' && typeof w.name === 'string')) {
    const slant = (w) => (w.italic ? { italic: true, angle: num(w.angle, -10) } : {});
    weights = [{ id: saved[0].id, name: saved[0].name, location: num(saved[0].location, 400), ...slant(saved[0]) }];
    for (const w of saved.slice(1)) {
      const layer = layers.find((l) => l.name === w.layer);
      const layerDir = layer ? path.join(dir, layer.folder) : null;
      if (!layerDir || path.dirname(layerDir) !== dir || !fs.existsSync(layerDir)) { warnings.push({ code: 'missingWeight', detail: w.name }); continue; }
      const own = readLayer(layerDir, warnings);
      const all = {};
      // every weight has every glyph: one that is missing starts as a copy of the first weight's
      for (const name of glyphOrder) {
        all[name] = own[name] || JSON.parse(JSON.stringify(glyphs[name]));
        all[name].unicodes = [...glyphs[name].unicodes];
      }
      weights.push({ id: w.id, name: w.name, location: num(w.location, 400), ...slant(w), layer: w.layer, glyphs: all, kerning: w.kerning && typeof w.kerning === 'object' ? w.kerning : {} });
    }
    if (weights.length < 2) weights = undefined;
  }
  let features = '';
  const feaFile = path.join(dir, 'features.fea');
  if (fs.existsSync(feaFile)) features = readText(feaFile);

  return {
    format: `ufo${formatVersion}`,
    path: dir,
    name: path.basename(dir),
    info,
    glyphOrder,
    glyphs,
    groups,
    kerning,
    features,
    lib,
    layers: layers.map((l) => l.name),
    ...(weights ? { weights, weight: weights[0].id } : {}),
    warnings,
  };
}

/** Short description of a font model (what the welcome page, the command line and agents list). */
function summarize(font) {
  let contours = 0;
  let points = 0;
  let composites = 0;
  let encoded = 0;
  for (const g of Object.values(font.glyphs)) {
    contours += g.contours.length;
    for (const c of g.contours) points += c.length;
    if (g.components.length) composites++;
    if (g.unicodes.length) encoded++;
  }
  let kerningPairs = 0;
  for (const right of Object.values(font.kerning)) kerningPairs += Object.keys(right).length;
  return {
    familyName: font.info.familyName || font.name,
    styleName: font.info.styleName || '',
    unitsPerEm: font.info.unitsPerEm || 1000,
    glyphs: font.glyphOrder.length,
    encoded,
    composites,
    contours,
    points,
    groups: Object.keys(font.groups).length,
    kerningPairs,
    weights: Array.isArray(font.weights) ? font.weights.map((w) => w.name) : [],
    warnings: font.warnings.length,
  };
}

module.exports = { readUfo, isUfo, parseGlif, summarize, INFO_FIELDS };
