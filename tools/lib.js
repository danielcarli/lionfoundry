/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// What the command line and the server for AI agents share: the same engine the app uses, reached
// without opening the app. Every operation here reads the project and never changes it; what is
// produced (a font file, a new project) is written to a path that must not exist yet.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..', 'src');
const { readUfo, isUfo, summarize } = require(path.join(SRC, 'platform', 'project', 'node', 'ufoReader.js'));
const { writeUfo, copyUfo } = require(path.join(SRC, 'platform', 'project', 'node', 'ufoWriter.js'));
const { readTtf } = require(path.join(SRC, 'platform', 'project', 'node', 'ttfReader.js'));
const { ttfToWoff2 } = require(path.join(SRC, 'platform', 'project', 'node', 'woff2.js'));
const { run } = require(path.join(SRC, 'platform', 'script', 'node', 'scriptRunner.js'));
const common = (name) => import(pathToFileURL(path.join(SRC, 'base', 'common', name)).href);

/**
 * Opens a UFO project or a TrueType font as a font model. For a project with several weights,
 * `weight` (a name or an id) chooses the one every operation works on; the first one otherwise.
 */
function open(target, weight) {
  const file = path.resolve(String(target || ''));
  if (isUfo(file)) {
    const font = readUfo(file);
    if (weight) {
      const wanted = String(weight).toLowerCase();
      const entry = (font.weights || []).find((w) => w.id.toLowerCase() === wanted || w.name.toLowerCase() === wanted);
      if (!entry) throw new Error(`no weight named "${weight}" (this project has: ${(font.weights || []).map((w) => w.name).join(', ') || 'a single weight'})`);
      switchTo(font, entry.id);
    }
    return font;
  }
  if (/\.ttf$/i.test(file) && fs.existsSync(file)) return readTtf(fs.readFileSync(file), path.basename(file));
  throw new Error(`not a UFO project or a .ttf font: ${target}`);
}

/** Refuses to write over anything that is already there. */
function fresh(target) {
  const file = path.resolve(String(target || ''));
  if (!target) throw new Error('an output path is needed');
  if (fs.existsSync(file)) throw new Error(`"${file}" already exists: choose a path that does not exist yet`);
  return file;
}

/** Same as switchWeight in src/base/common/weights.js, for the CommonJS side. */
function switchTo(font, id) {
  const next = font.weights.find((w) => w.id === id);
  const current = font.weights.find((w) => w.id === font.weight);
  if (!next || next === current) return;
  current.glyphs = font.glyphs; current.kerning = font.kerning;
  font.glyphs = next.glyphs; font.kerning = next.kerning || {};
  delete next.glyphs; delete next.kerning;
  font.weight = id;
  font.info = { ...font.info, styleName: next.name, other: { ...(font.info.other || {}), openTypeOS2WeightClass: Math.round(next.location) } };
  for (const k of ['postscriptFontName', 'postscriptFullName', 'styleMapStyleName', 'styleMapFamilyName']) delete font.info[k];
}

function describe(font) {
  const info = { ...font.info };
  delete info.other;
  const weights = (font.weights || []).map((w) => ({ name: w.name, location: w.location, italic: !!w.italic, active: w.id === font.weight }));
  return { project: { path: font.path, format: font.format, layers: font.layers }, summary: summarize(font), weights, info };
}

function glyphLine(font, name, bounds) {
  const g = font.glyphs[name];
  return {
    name, unicodes: g.unicodes.map((u) => u.toString(16).toUpperCase().padStart(4, '0')), width: g.width,
    contours: g.contours.length, points: g.contours.reduce((n, c) => n + c.length, 0), components: g.components.map((c) => c.base),
    anchors: g.anchors.map((a) => a.name), bounds,
  };
}

async function listGlyphs(font, filter) {
  const { glyphBounds } = await common('fontModel.js');
  const q = String(filter || '').toLowerCase();
  return font.glyphOrder.filter((n) => !q || n.toLowerCase().includes(q)).map((n) => glyphLine(font, n, glyphBounds(font, n)));
}

async function validate(font) {
  const { checkFont, countByLevel } = await common('validate.js');
  const problems = checkFont(font, { charsets: ['basicLatin', 'portuguese', 'spanish', 'westernEuropean'] });
  return { counts: countByLevel(problems), problems };
}

async function features(font) {
  const { buildLayout, layoutFeatures, generateFeatureCode } = await common('features.js');
  const plan = buildLayout(font);
  return { features: layoutFeatures(plan), warnings: plan.warnings, code: generateFeatureCode(font) };
}

async function shapeText(font, text, featureSettings = {}) {
  const { buildLayout } = await common('features.js');
  const { shape } = await common('shaper.js');
  const cmap = new Map();
  for (const name of font.glyphOrder) for (const u of font.glyphs[name].unicodes) if (!cmap.has(u)) cmap.set(u, name);
  const res = shape(font, buildLayout(font), String(text), { features: featureSettings, cmap: (c) => cmap.get(c) || null });
  return { width: res.width, glyphs: res.glyphs.map((g) => ({ name: g.name, x: g.x, y: g.y, advance: g.advance })), steps: res.steps,
    missing: res.missing.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`) };
}

/** Compiles the font and writes it; the format follows the extension (.ttf or .woff2). */
async function exportFont(font, output) {
  const file = fresh(output);
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.ttf' && ext !== '.woff2') throw new Error('the output must end in .ttf or .woff2');
  const { compileTtf } = await common('ttfWriter.js');
  const { hasWeights, weightFont } = await common('weights.js');
  const result = compileTtf(hasWeights(font) ? weightFont(font) : font);
  const bytes = ext === '.woff2' ? ttfToWoff2(result.bytes) : Buffer.from(result.bytes);
  fs.writeFileSync(file, bytes);
  return { path: file, size: bytes.length, glyphs: result.glyphOrder.length, tables: result.tables, warnings: result.warnings };
}

/**
 * Exports every style of the family (the weights that are drawn and the instances the project lists)
 * into a NEW folder: ttf/ and woff2/ with one font per style, and a style sheet for the web.
 */
async function exportFamily(font, output) {
  const dir = fresh(output);
  const { compileTtf, postscriptName } = await common('ttfWriter.js');
  const { familyStyles, weightClass } = await common('weights.js');
  const styles = familyStyles(font);
  const family = font.info.familyName || font.name || 'Untitled';
  const compiled = styles.map((s) => ({ style: s, name: postscriptName(s.font.info), result: compileTtf(s.font) }));
  fs.mkdirSync(path.join(dir, 'ttf'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'woff2'));
  const out = []; const css = [];
  for (const { style, name, result } of compiled) {
    fs.writeFileSync(path.join(dir, 'ttf', `${name}.ttf`), Buffer.from(result.bytes));
    fs.writeFileSync(path.join(dir, 'woff2', `${name}.woff2`), ttfToWoff2(result.bytes));
    css.push(`@font-face {\n  font-family: "${family.replace(/"/g, '')}";\n  src: url("woff2/${name}.woff2") format("woff2");\n  font-weight: ${weightClass(style.location)};\n  font-style: ${style.italic ? 'italic' : 'normal'};\n  font-display: swap;\n}\n`);
    out.push({ style: style.name, kind: style.kind, weight: weightClass(style.location), italic: style.italic, file: `${name}.ttf`, glyphs: result.glyphOrder.length,
      notInterpolated: style.skipped.length, overlapping: result.overlapping, warnings: result.warnings.length });
  }
  fs.writeFileSync(path.join(dir, `${family.replace(/[^A-Za-z0-9]/g, '') || 'family'}.css`), css.join('\n'));
  return { path: dir, family, styles: out };
}

/** Writes a font model as a new UFO project (other layers and data of the original project come along). */
function saveAs(font, output) {
  const file = fresh(output);
  if (!/\.ufo$/i.test(file)) throw new Error('the output must end in .ufo');
  if (font.path && isUfo(font.path)) copyUfo(font.path, file);
  const res = writeUfo(file, font, { glyphs: 'all' });
  return { path: file, ...res };
}

/** Runs a script on a copy of the font. With `output`, the changed font is written as a new project. */
async function runScript(font, language, code, output) {
  const res = await run({ language, code, font, selection: [] });
  if (res.error) return { ok: false, output: res.output, error: res.error };
  const out = { ok: true, output: res.output, glyphs: res.font.glyphOrder.length };
  if (output) out.saved = saveAs({ ...font, ...res.font }, output);
  return out;
}

module.exports = { open, describe, listGlyphs, validate, features, shapeText, exportFont, exportFamily, saveAs, runScript, glyphLine };
