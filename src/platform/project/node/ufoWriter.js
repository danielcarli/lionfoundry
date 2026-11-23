/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Writes the font model as a UFO 3 folder.
// Every file is written beside its destination and renamed over it, so a crash never leaves half a file.
// When saving over an existing project only the glyphs that changed are rewritten, and what LionFoundry
// does not edit (other layers, images, data, glyph libs) is left as it is.
const fs = require('fs');
const path = require('path');
const { parsePlist, writePlist, serializeXml, escAttr, esc, fmtNumber } = require('./xml');

const WEIGHTS_KEY = 'org.lionfoundry.weights';
const ILLEGAL = new Set('"*+/:<>?[\\]|'.split(''));
const RESERVED = new Set(['con', 'prn', 'aux', 'clock$', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9']);

/** File name of a glyph, following the UFO 3 convention (safe on case-insensitive file systems). */
function glyphFileName(name, taken) {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0);
    if (ILLEGAL.has(ch) || code < 0x20 || code === 0x7F) out += '_';
    else if (ch !== ch.toLowerCase()) out += ch + '_';
    else out += ch;
  }
  if (out.startsWith('.')) out = '_' + out.slice(1);
  out = out.split('.').map((part) => (RESERVED.has(part.toLowerCase()) ? '_' + part : part)).join('.').slice(0, 240);
  let file = out + '.glif';
  for (let i = 1; taken.has(file.toLowerCase()); i++) file = `${out}${String(i).padStart(15, '0')}.glif`;
  taken.add(file.toLowerCase());
  return file;
}

/** One glyph as a GLIF (format 2) document. */
function writeGlif(glyph) {
  let out = `<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="${escAttr(glyph.name)}" format="2">\n`;
  out += `  <advance width="${fmtNumber(glyph.width || 0)}"${glyph.height !== undefined ? ` height="${fmtNumber(glyph.height)}"` : ''}/>\n`;
  for (const u of glyph.unicodes || []) out += `  <unicode hex="${u.toString(16).toUpperCase().padStart(4, '0')}"/>\n`;
  if (glyph.note) out += `  <note>${esc(glyph.note)}</note>\n`;
  const extra = glyph.extra || [];
  for (const el of extra) if (el.name === 'image') out += serializeXml(el, 1);
  for (const g of glyph.guidelines || []) {
    const diagonal = g.x !== undefined && g.x !== null && g.y !== undefined && g.y !== null;
    out += `  <guideline${g.x !== undefined && g.x !== null ? ` x="${fmtNumber(g.x)}"` : ''}${g.y !== undefined && g.y !== null ? ` y="${fmtNumber(g.y)}"` : ''}`
      + `${diagonal ? ` angle="${fmtNumber(((Number(g.angle) || 0) % 360 + 360) % 360)}"` : ''}${g.name ? ` name="${escAttr(g.name)}"` : ''}`
      + `${g.color ? ` color="${escAttr(g.color)}"` : ''}${g.identifier ? ` identifier="${escAttr(g.identifier)}"` : ''}/>\n`;
  }
  for (const a of glyph.anchors || []) {
    out += `  <anchor${a.name ? ` name="${escAttr(a.name)}"` : ''} x="${fmtNumber(a.x)}" y="${fmtNumber(a.y)}"${a.color ? ` color="${escAttr(a.color)}"` : ''}${a.identifier ? ` identifier="${escAttr(a.identifier)}"` : ''}/>\n`;
  }
  if ((glyph.contours && glyph.contours.length) || (glyph.components && glyph.components.length)) {
    out += '  <outline>\n';
    for (const contour of glyph.contours) {
      out += '    <contour>\n';
      for (const p of contour) {
        const meta = p[4] || {};
        out += `      <point x="${fmtNumber(p[0])}" y="${fmtNumber(p[1])}"${p[2] !== 'offcurve' ? ` type="${p[2]}"` : ''}${p[3] && p[2] !== 'offcurve' ? ' smooth="yes"' : ''}`
          + `${meta.name ? ` name="${escAttr(meta.name)}"` : ''}${meta.identifier ? ` identifier="${escAttr(meta.identifier)}"` : ''}/>\n`;
      }
      out += '    </contour>\n';
    }
    for (const c of glyph.components) {
      const [a, b, cc, d, e, f] = c.transform;
      out += `    <component base="${escAttr(c.base)}"${a !== 1 ? ` xScale="${fmtNumber(a)}"` : ''}${b ? ` xyScale="${fmtNumber(b)}"` : ''}${cc ? ` yxScale="${fmtNumber(cc)}"` : ''}`
        + `${d !== 1 ? ` yScale="${fmtNumber(d)}"` : ''}${e ? ` xOffset="${fmtNumber(e)}"` : ''}${f ? ` yOffset="${fmtNumber(f)}"` : ''}${c.identifier ? ` identifier="${escAttr(c.identifier)}"` : ''}/>\n`;
    }
    out += '  </outline>\n';
  }
  for (const el of extra) if (el.name === 'lib') out += serializeXml(el, 1);
  return out + '</glyph>\n';
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function writeIfChanged(file, content) {
  try { if (fs.readFileSync(file, 'utf8') === content) return false; } catch { /* new file */ }
  writeAtomic(file, content);
  return true;
}

const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

/**
 * Writes `font` into the UFO folder `dir` (created when missing).
 * @param {string} dir
 * @param {object} font the font model
 * @param {{glyphs?: 'all'|string[]}} options glyphs to (re)write; the rest of the files are always refreshed
 * @returns {{written: number, removed: number}}
 */
function writeUfo(dir, font, { glyphs = 'all' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  writeIfChanged(path.join(dir, 'metainfo.plist'), writePlist({ creator: 'org.lionfoundry', formatVersion: 3 }));

  const info = {};
  for (const [k, v] of Object.entries(font.info || {})) if (k !== 'other' && v !== undefined && v !== null && v !== '') info[k] = v;
  Object.assign(info, (font.info && font.info.other) || {});
  writeIfChanged(path.join(dir, 'fontinfo.plist'), writePlist(sortKeys(info)));

  // The weights of the typeface: glyphs and kerning of the one being worked on are the font's own,
  // the others keep theirs in their entry (see src/base/common/weights.js). On disk the first weight
  // is the default layer and kerning.plist, whichever one is active.
  const weights = Array.isArray(font.weights) && font.weights.length > 1 ? font.weights : [{ id: font.weight }];
  const dataOf = (w) => (weights.length === 1 || w.id === font.weight ? { glyphs: font.glyphs, kerning: font.kerning } : { glyphs: w.glyphs || {}, kerning: w.kerning || {} });
  const first = dataOf(weights[0]);

  let previousLayers = [];
  try {
    const old = parsePlist(fs.readFileSync(path.join(dir, 'lib.plist'), 'utf8'))[WEIGHTS_KEY];
    if (Array.isArray(old)) previousLayers = old.slice(1).map((w) => w && w.layer).filter((n) => typeof n === 'string');
  } catch { /* new project */ }

  const lib = { ...(font.lib || {}), 'public.glyphOrder': font.glyphOrder };
  delete lib[WEIGHTS_KEY];
  if (weights.length > 1) {
    const slant = (w) => (w.italic ? { italic: true, angle: typeof w.angle === 'number' ? w.angle : -10 } : {});
    lib[WEIGHTS_KEY] = weights.map((w, i) => (i === 0 ? { id: w.id, name: w.name, location: w.location, ...slant(w) }
      : { id: w.id, name: w.name, location: w.location, ...slant(w), layer: w.layer || w.name, kerning: dataOf(w).kerning || {} }));
  }
  writeIfChanged(path.join(dir, 'lib.plist'), writePlist(lib));
  writeIfChanged(path.join(dir, 'groups.plist'), writePlist(font.groups || {}));
  writeIfChanged(path.join(dir, 'kerning.plist'), writePlist(first.kerning || {}));
  const feaFile = path.join(dir, 'features.fea');
  if (font.features && font.features.trim()) writeIfChanged(feaFile, font.features);
  else if (fs.existsSync(feaFile)) fs.rmSync(feaFile);

  // layers: the default one is the first weight; each other weight has a layer of its own
  const layerFile = path.join(dir, 'layercontents.plist');
  let layers = [['public.default', 'glyphs']];
  try { layers = parsePlist(fs.readFileSync(layerFile, 'utf8')); } catch { /* new project */ }
  if (!layers.some((l) => l[1] === 'glyphs')) layers = [['public.default', 'glyphs'], ...layers];
  const stats = { written: 0, removed: 0 };
  writeLayer(path.join(dir, 'glyphs'), font.glyphOrder, first.glyphs, glyphs, stats);

  // the backgrounds of the glyphs: a layer next to the layer of each weight, only while there is one
  const writeBackground = (layerName, glyphMap) => {
    const name = layerName === 'public.default' ? 'public.background' : `${layerName}.background`;
    const bg = {};
    for (const g of font.glyphOrder) {
      const back = glyphMap[g] && glyphMap[g].background;
      if (back && ((back.contours || []).length || (back.components || []).length)) {
        bg[g] = { name: g, width: glyphMap[g].width, unicodes: [], contours: back.contours || [], components: back.components || [], anchors: [] };
      }
    }
    let entry = layers.find((l) => l[0] === name);
    if (!Object.keys(bg).length) {
      if (entry && entry[1] !== 'glyphs' && path.basename(entry[1]) === entry[1] && /^glyphs\./.test(entry[1])) {
        fs.rmSync(path.join(dir, entry[1]), { recursive: true, force: true });
        layers.splice(layers.indexOf(entry), 1);
      }
      return;
    }
    if (!entry) {
      const folders = new Set(layers.map((l) => String(l[1]).toLowerCase()));
      entry = [name, `glyphs.${glyphFileName(name, folders).replace(/\.glif$/, '')}`];
      layers.push(entry);
    }
    if (path.basename(entry[1]) !== entry[1] || !/^glyphs\./.test(entry[1])) throw new Error(`invalid layer folder: ${entry[1]}`);
    writeLayer(path.join(dir, entry[1]), font.glyphOrder, bg, 'all', stats);
  };
  writeBackground('public.default', first.glyphs);

  const kept = new Set();
  for (const w of weights.slice(1)) {
    const name = w.layer || w.name;
    let entry = layers.find((l) => l[0] === name);
    if (!entry) {
      const folders = new Set(layers.map((l) => String(l[1]).toLowerCase()));
      const folder = `glyphs.${glyphFileName(name, folders).replace(/\.glif$/, '')}`;
      entry = [name, folder];
      layers.push(entry);
    }
    if (path.basename(entry[1]) !== entry[1] || !/^glyphs\./.test(entry[1])) throw new Error(`invalid layer folder: ${entry[1]}`);
    kept.add(name);
    writeLayer(path.join(dir, entry[1]), font.glyphOrder, dataOf(w).glyphs, 'all', stats);
    writeBackground(name, dataOf(w).glyphs);
  }
  // layers of weights that were removed from the project go away with them
  for (const name of [...previousLayers, ...previousLayers.map((n) => `${n}.background`)]) {
    if (kept.has(name) || kept.has(name.replace(/\.background$/, ''))) continue;
    const i = layers.findIndex((l) => l[0] === name);
    if (i < 0 || layers[i][1] === 'glyphs' || path.basename(layers[i][1]) !== layers[i][1]) continue;
    fs.rmSync(path.join(dir, layers[i][1]), { recursive: true, force: true });
    layers.splice(i, 1);
  }
  writeIfChanged(layerFile, writePlist(layers));
  return stats;
}

/** Writes the glyphs of one layer: glyph files and contents.plist; files of glyphs that left the font are removed. */
function writeLayer(glyphDir, glyphOrder, glyphMap, glyphs, stats) {
  fs.mkdirSync(glyphDir, { recursive: true });
  let existing = {};
  try { existing = parsePlist(fs.readFileSync(path.join(glyphDir, 'contents.plist'), 'utf8')); } catch { /* new layer */ }
  const contents = {};
  const taken = new Set();
  const order = glyphOrder.filter((name) => glyphMap[name]);
  for (const name of order) {
    const file = existing[name];
    if (typeof file === 'string' && path.basename(file) === file && file.endsWith('.glif')) { contents[name] = file; taken.add(file.toLowerCase()); }
  }
  const todo = glyphs === 'all' ? null : new Set(glyphs);
  for (const name of order) {
    const isNew = !contents[name];
    if (isNew) contents[name] = glyphFileName(name, taken);
    const file = path.join(glyphDir, contents[name]);
    if (isNew || !todo || todo.has(name) || !fs.existsSync(file)) {
      if (writeIfChanged(file, writeGlif({ ...glyphMap[name], name }))) stats.written++;
    }
  }
  for (const [name, file] of Object.entries(existing)) {
    if (contents[name] || typeof file !== 'string' || path.basename(file) !== file) continue;
    if (Object.values(contents).some((f) => f.toLowerCase() === file.toLowerCase())) continue;
    try { fs.rmSync(path.join(glyphDir, file)); stats.removed++; } catch { /* already gone */ }
  }
  writeIfChanged(path.join(glyphDir, 'contents.plist'), writePlist(contents));
}

/** Copies a UFO folder (used by "save as" and for the backup made before the first save of a session). */
function copyUfo(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

module.exports = { writeUfo, writeGlif, copyUfo, glyphFileName };
