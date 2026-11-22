/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Compiles the font model into an OpenType font with TrueType outlines (.ttf).
// Written from the OpenType specification, with no dependencies, so it runs the same in the
// interface, on the command line and in tests.
//
// What it writes: glyf/loca (cubic curves are converted to quadratic), cmap (formats 4 and 12), head,
// hhea, hmtx, maxp, OS/2, name, post (with glyph names), gasp, and — from the layout plan of
// features.js — GDEF, GSUB (single and ligature substitutions) and GPOS (pair kerning and
// mark-to-base). Colour glyphs become COLR/CPAL (version 0).
// What it does not write yet: hinting, CFF outlines, contextual lookups, variations.
import { contourCommands, multiply, applyTransform, IDENTITY } from './glyphPath.js';
import { buildLayout } from './features.js';

export const COLOR_GLYPHS_KEY = 'org.lionfoundry.colorGlyphs';
export const PALETTE_KEY = 'org.lionfoundry.palette';

// ---------------------------------------------------------------- bytes
class Writer {
  constructor() { this.bytes = []; }
  get length() { return this.bytes.length; }
  u8(v) { this.bytes.push(v & 0xFF); return this; }
  u16(v) { this.bytes.push((v >>> 8) & 0xFF, v & 0xFF); return this; }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { this.bytes.push((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF); return this; }
  i32(v) { return this.u32(v < 0 ? v + 0x100000000 : v); }
  fixed(v) { return this.i32(Math.round(v * 65536)); }
  f2dot14(v) { return this.i16(Math.round(Math.max(-2, Math.min(1.99993896484375, v)) * 16384)); }
  tag(s) { for (let i = 0; i < 4; i++) this.bytes.push((s.charCodeAt(i) || 0x20) & 0xFF); return this; }
  date(seconds) { this.u32(Math.floor(seconds / 0x100000000)); return this.u32(seconds >>> 0); }
  raw(data) { for (let i = 0; i < data.length; i++) this.bytes.push(data[i]); return this; }
  pad(n = 4) { while (this.bytes.length % n) this.bytes.push(0); return this; }
  setU16(at, v) { this.bytes[at] = (v >>> 8) & 0xFF; this.bytes[at + 1] = v & 0xFF; }
  setU32(at, v) { this.bytes[at] = (v >>> 24) & 0xFF; this.bytes[at + 1] = (v >>> 16) & 0xFF; this.bytes[at + 2] = (v >>> 8) & 0xFF; this.bytes[at + 3] = v & 0xFF; }
  done() { return Uint8Array.from(this.bytes); }
}

const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampU16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));

function checksum(data) {
  let sum = 0;
  const n = data.length;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + (((data[i] << 24) | ((data[i + 1] || 0) << 16) | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0)) >>> 0)) >>> 0;
  }
  return sum;
}

// ---------------------------------------------------------------- outlines
/**
 * Approximates a cubic Bézier by quadratic ones (the curve is cut in equal parts until every part is
 * within `tolerance` units). Returns [[cx, cy, x, y], …].
 */
export function cubicToQuadratics(p0, c1, c2, p3, tolerance = 1) {
  // error of approximating one cubic by the quadratic through its ends: √3/36 · |p3 − 3c2 + 3c1 − p0|
  const dx = p3[0] - 3 * c2[0] + 3 * c1[0] - p0[0];
  const dy = p3[1] - 3 * c2[1] + 3 * c1[1] - p0[1];
  const err = Math.hypot(dx, dy) * Math.sqrt(3) / 36;
  // the error of each part falls with the cube of the number of parts
  const n = Math.min(24, Math.max(1, Math.ceil(Math.cbrt(err / tolerance))));
  const out = [];
  const at = (t) => {
    const u = 1 - t;
    return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]];
  };
  const tangent = (t) => {
    const u = 1 - t;
    return [3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]),
      3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1])];
  };
  for (let i = 0; i < n; i++) {
    const t0 = i / n; const t1 = (i + 1) / n;
    const a = at(t0); const b = at(t1);
    const da = tangent(t0); const db = tangent(t1);
    // control points of this part as a cubic, then the quadratic control that best matches them
    const h = (t1 - t0) / 3;
    const q1 = [a[0] + da[0] * h, a[1] + da[1] * h];
    const q2 = [b[0] - db[0] * h, b[1] - db[1] * h];
    out.push([(3 * q1[0] - a[0] + 3 * q2[0] - b[0]) / 4, (3 * q1[1] - a[1] + 3 * q2[1] - b[1]) / 4, b[0], b[1]]);
  }
  return out;
}

/** One contour as TrueType points [{x, y, on}], rounded, without repeated points. */
function contourToTrueType(points, tolerance) {
  const out = [];
  if (!points.some((p) => p[2] === 'curve')) {
    // already lines and quadratic curves: the points are used as they are, implied points stay implied
    for (const p of points) out.push({ x: clamp16(p[0]), y: clamp16(p[1]), on: p[2] !== 'offcurve' });
    return out.filter((p, i) => { const prev = out[(i - 1 + out.length) % out.length]; return !(out.length > 1 && p.on && prev.on && prev.x === p.x && prev.y === p.y); });
  }
  const cmds = contourCommands(points);
  let cur = null;
  for (const c of cmds) {
    if (c[0] === 'M') { cur = [c[1], c[2]]; out.push({ x: c[1], y: c[2], on: true }); } else if (c[0] === 'L') {
      out.push({ x: c[1], y: c[2], on: true }); cur = [c[1], c[2]];
    } else if (c[0] === 'Q') {
      out.push({ x: c[1], y: c[2], on: false }, { x: c[3], y: c[4], on: true }); cur = [c[3], c[4]];
    } else if (c[0] === 'C') {
      for (const q of cubicToQuadratics(cur, [c[1], c[2]], [c[3], c[4]], [c[5], c[6]], tolerance)) {
        out.push({ x: q[0], y: q[1], on: false }, { x: q[2], y: q[3], on: true });
      }
      cur = [c[5], c[6]];
    }
  }
  for (const p of out) { p.x = clamp16(p.x); p.y = clamp16(p.y); }
  // drop on-curve points that repeat the previous point (the closing point repeats the first one)
  const clean = [];
  for (const p of out) {
    const prev = clean[clean.length - 1];
    if (prev && prev.on && p.on && prev.x === p.x && prev.y === p.y) continue;
    clean.push(p);
  }
  while (clean.length > 1) {
    const first = clean[0]; const last = clean[clean.length - 1];
    if (first.on && last.on && first.x === last.x && first.y === last.y) clean.pop(); else break;
  }
  return clean;
}

const boxOf = (pts) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) { const x = p.x ?? p[0]; const y = p.y ?? p[1]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  return b;
};
const boxesMeet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Whether shapes of a glyph are drawn over one another: two contours wound the same way whose boxes
 * meet (a counter is wound the other way, so it does not count). Such glyphs are marked as overlapping,
 * which is what rasterizers need to fill them without holes; the drawing itself is left as it is.
 */
export function shapesOverlap(contours) {
  const shapes = contours.map((c) => {
    let area = 0;
    for (let i = 0; i < c.length; i++) { const a = c[i]; const b = c[(i + 1) % c.length]; area += a.x * b.y - b.x * a.y; }
    return { sign: Math.sign(area), box: boxOf(c) };
  });
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) if (shapes[i].sign && shapes[i].sign === shapes[j].sign && boxesMeet(shapes[i].box, shapes[j].box)) return true;
  return false;
}

function encodeSimpleGlyph(contours, bounds, overlap = false) {
  const w = new Writer();
  w.i16(contours.length).i16(bounds.xMin).i16(bounds.yMin).i16(bounds.xMax).i16(bounds.yMax);
  let end = -1;
  for (const c of contours) { end += c.length; w.u16(end); }
  w.u16(0); // no instructions
  const flags = []; const xs = new Writer(); const ys = new Writer();
  let px = 0; let py = 0;
  for (const c of contours) {
    for (const p of c) {
      let flag = p.on ? 0x01 : 0;
      const dx = p.x - px; const dy = p.y - py;
      if (dx === 0) flag |= 0x10; else if (dx >= -255 && dx <= 255) { flag |= 0x02; if (dx > 0) flag |= 0x10; xs.u8(Math.abs(dx)); } else xs.i16(dx);
      if (dy === 0) flag |= 0x20; else if (dy >= -255 && dy <= 255) { flag |= 0x04; if (dy > 0) flag |= 0x20; ys.u8(Math.abs(dy)); } else ys.i16(dy);
      flags.push(flag);
      px = p.x; py = p.y;
    }
  }
  if (overlap && flags.length) flags[0] |= 0x40; // OVERLAP_SIMPLE
  // runs of equal flags are stored once with a repeat count
  for (let i = 0; i < flags.length;) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 2) { w.u8(flags[i] | 0x08).u8(run - 1); } else { for (let k = 0; k < run; k++) w.u8(flags[i]); }
    i += run;
  }
  w.raw(xs.bytes).raw(ys.bytes);
  return w.pad(4).bytes;
}

function encodeCompositeGlyph(components, bounds, gidOf, overlap = false) {
  const w = new Writer();
  w.i16(-1).i16(bounds.xMin).i16(bounds.yMin).i16(bounds.xMax).i16(bounds.yMax);
  components.forEach((c, i) => {
    const [a, b, cc, d, e, f] = c.transform;
    const dx = clamp16(e); const dy = clamp16(f);
    let flags = 0x0002 | 0x0004; // arguments are offsets, rounded to the grid
    if (dx < -128 || dx > 127 || dy < -128 || dy > 127) flags |= 0x0001;
    const plain = b === 0 && cc === 0;
    if (!(plain && a === 1 && d === 1)) flags |= plain ? (a === d ? 0x0008 : 0x0040) : 0x0080;
    if (i < components.length - 1) flags |= 0x0020;
    if (overlap && i === 0) flags |= 0x0400; // OVERLAP_COMPOUND
    w.u16(flags).u16(gidOf.get(c.base));
    if (flags & 0x0001) w.i16(dx).i16(dy); else w.u8(dx & 0xFF).u8(dy & 0xFF);
    if (flags & 0x0008) w.f2dot14(a); else if (flags & 0x0040) w.f2dot14(a).f2dot14(d); else if (flags & 0x0080) w.f2dot14(a).f2dot14(b).f2dot14(cc).f2dot14(d);
  });
  return w.pad(4).bytes;
}

// ---------------------------------------------------------------- layout tables (shared by GSUB and GPOS)
function coverageTable(gids) {
  const w = new Writer();
  w.u16(1).u16(gids.length);
  for (const g of gids) w.u16(g);
  return w.bytes;
}

/**
 * ScriptList + FeatureList + LookupList.
 * @param {Array<{tag: string, lookups: number[]}>} features
 * @param {Array<{type: number, flag: number, subtables: number[][]}>} lookups
 * @param {number} extensionType lookup type of the extension mechanism (7 in GSUB, 9 in GPOS)
 */
function layoutTable(features, lookups, extensionType) {
  const sorted = [...features].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const scripts = new Writer();
  const langSys = new Writer();
  langSys.u16(0).u16(0xFFFF).u16(sorted.length);
  sorted.forEach((_, i) => langSys.u16(i));
  const tags = ['DFLT', 'latn'];
  scripts.u16(tags.length);
  const scriptSize = 4 + langSys.length;
  tags.forEach((tag, i) => scripts.tag(tag).u16(2 + tags.length * 6 + i * scriptSize));
  for (let i = 0; i < tags.length; i++) scripts.u16(4).u16(0).raw(langSys.bytes);

  const featureList = new Writer();
  featureList.u16(sorted.length);
  let off = 2 + sorted.length * 6;
  for (const f of sorted) { featureList.tag(f.tag).u16(off); off += 4 + f.lookups.length * 2; }
  for (const f of sorted) { featureList.u16(0).u16(f.lookups.length); for (const l of f.lookups) featureList.u16(l); }

  // lookups: directly when everything fits in 16-bit offsets, through extension subtables otherwise
  const headerSize = (l) => 6 + l.subtables.length * 2;
  const directSize = 2 + lookups.length * 2 + lookups.reduce((s, l) => s + headerSize(l) + l.subtables.reduce((x, t) => x + t.length, 0), 0);
  const useExtension = directSize > 0xFFF0;
  const lookupList = new Writer();
  lookupList.u16(lookups.length);
  if (!useExtension) {
    let at = 2 + lookups.length * 2;
    for (const l of lookups) { lookupList.u16(at); at += headerSize(l) + l.subtables.reduce((x, t) => x + t.length, 0); }
    for (const l of lookups) {
      lookupList.u16(l.type).u16(l.flag).u16(l.subtables.length);
      let sub = headerSize(l);
      for (const t of l.subtables) { lookupList.u16(sub); sub += t.length; }
      for (const t of l.subtables) lookupList.raw(t);
    }
  } else {
    let at = 2 + lookups.length * 2;
    for (const l of lookups) { lookupList.u16(at); at += headerSize(l) + l.subtables.length * 8; }
    let data = at; // the real subtables start after every lookup and extension record
    const pending = [];
    for (const l of lookups) {
      const start = lookupList.length;
      lookupList.u16(extensionType).u16(l.flag).u16(l.subtables.length);
      l.subtables.forEach((_, i) => lookupList.u16(headerSize(l) + i * 8));
      l.subtables.forEach((t, i) => {
        const here = start + headerSize(l) + i * 8;
        lookupList.u16(1).u16(l.type).u32(data - here);
        pending.push(t);
        data += t.length;
      });
    }
    for (const t of pending) lookupList.raw(t);
  }

  const w = new Writer();
  w.u16(1).u16(0).u16(10).u16(10 + scripts.length).u16(10 + scripts.length + featureList.length);
  return w.raw(scripts.bytes).raw(featureList.bytes).raw(lookupList.bytes).done();
}

function singleSubst(map, gidOf) {
  const pairs = Object.entries(map).map(([from, to]) => [gidOf.get(from), gidOf.get(to)]).filter(([a, b]) => a !== undefined && b !== undefined).sort((x, y) => x[0] - y[0]);
  if (!pairs.length) return null;
  const w = new Writer();
  w.u16(2).u16(6 + pairs.length * 2).u16(pairs.length);
  for (const [, to] of pairs) w.u16(to);
  return w.raw(coverageTable(pairs.map((p) => p[0]))).pad(2).bytes;
}

function ligatureSubst(ligatures, gidOf) {
  const sets = new Map(); // first glyph id → [{rest: gid[], to: gid}]
  for (const l of ligatures) {
    const ids = l.from.map((g) => gidOf.get(g));
    const to = gidOf.get(l.to);
    if (ids.includes(undefined) || to === undefined) continue;
    if (!sets.has(ids[0])) sets.set(ids[0], []);
    sets.get(ids[0]).push({ rest: ids.slice(1), to });
  }
  if (!sets.size) return null;
  const firsts = [...sets.keys()].sort((a, b) => a - b);
  const setBytes = firsts.map((first) => {
    const list = sets.get(first).sort((a, b) => b.rest.length - a.rest.length); // longest match first
    const s = new Writer();
    s.u16(list.length);
    let off = 2 + list.length * 2;
    for (const lig of list) { s.u16(off); off += 4 + lig.rest.length * 2; }
    for (const lig of list) { s.u16(lig.to).u16(lig.rest.length + 1); for (const g of lig.rest) s.u16(g); }
    return s.bytes;
  });
  const w = new Writer();
  const header = 6 + firsts.length * 2;
  const coverage = coverageTable(firsts);
  w.u16(1).u16(header).u16(firsts.length);
  let off = header + coverage.length;
  for (const s of setBytes) { w.u16(off); off += s.length; }
  w.raw(coverage);
  for (const s of setBytes) w.raw(s);
  return off > 0xFFFF ? null : w.bytes;
}

/** Pair kerning as PairPos format 1 subtables, split so that every offset fits in 16 bits. */
function pairPosSubtables(kerning, gidOf) {
  const rows = [];
  for (const [left, rights] of kerning) {
    const l = gidOf.get(left);
    if (l === undefined) continue;
    const pairs = [];
    for (const [right, value] of rights) {
      const r = gidOf.get(right);
      if (r !== undefined && value) pairs.push([r, clamp16(value)]);
    }
    if (pairs.length) rows.push([l, pairs.sort((a, b) => a[0] - b[0])]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const subtables = [];
  let chunk = []; let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    const w = new Writer();
    const header = 10 + chunk.length * 2;
    const coverage = coverageTable(chunk.map((r) => r[0]));
    w.u16(1).u16(header).u16(0x0004).u16(0).u16(chunk.length);
    let off = header + coverage.length;
    for (const [, pairs] of chunk) { w.u16(off); off += 2 + pairs.length * 4; }
    w.raw(coverage);
    for (const [, pairs] of chunk) { w.u16(pairs.length); for (const [r, v] of pairs) w.u16(r).i16(v); }
    subtables.push(w.bytes);
    chunk = []; size = 0;
  };
  for (const row of rows) {
    const rowSize = 6 + row[1].length * 4;
    if (size + rowSize > 60000) flush();
    chunk.push(row); size += rowSize;
  }
  flush();
  return subtables;
}

function markBasePos(marks, gidOf) {
  const classes = marks.classes;
  const markList = Object.entries(marks.marks).map(([name, m]) => [gidOf.get(name), m]).filter((x) => x[0] !== undefined).sort((a, b) => a[0] - b[0]);
  const baseList = Object.entries(marks.bases).map(([name, a]) => [gidOf.get(name), a]).filter((x) => x[0] !== undefined).sort((a, b) => a[0] - b[0]);
  if (!markList.length || !baseList.length) return null;
  const anchor = (w, a) => w.u16(1).i16(clamp16(a.x)).i16(clamp16(a.y));

  const markArray = new Writer();
  markArray.u16(markList.length);
  markList.forEach(([, m], i) => markArray.u16(classes.indexOf(m.cls)).u16(2 + markList.length * 4 + i * 6));
  for (const [, m] of markList) anchor(markArray, m);

  const baseArray = new Writer();
  baseArray.u16(baseList.length);
  let off = 2 + baseList.length * classes.length * 2;
  const anchors = new Writer();
  for (const [, a] of baseList) {
    for (const cls of classes) {
      if (a[cls]) { baseArray.u16(off); anchor(anchors, a[cls]); off += 6; } else baseArray.u16(0);
    }
  }
  baseArray.raw(anchors.bytes);

  const markCoverage = coverageTable(markList.map((m) => m[0]));
  const baseCoverage = coverageTable(baseList.map((b) => b[0]));
  const w = new Writer();
  let at = 12;
  w.u16(1).u16(at); at += markCoverage.length;
  w.u16(at); at += baseCoverage.length;
  w.u16(classes.length).u16(at); at += markArray.length;
  w.u16(at);
  if (at + baseArray.length > 0xFFFF) return null;
  return w.raw(markCoverage).raw(baseCoverage).raw(markArray.bytes).raw(baseArray.bytes).bytes;
}

function classDef(pairs) { // [[gid, class]] sorted by gid → format 2 ranges
  const ranges = [];
  for (const [gid, cls] of pairs) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === gid - 1 && last[2] === cls) last[1] = gid; else ranges.push([gid, gid, cls]);
  }
  const w = new Writer();
  w.u16(2).u16(ranges.length);
  for (const [a, b, c] of ranges) w.u16(a).u16(b).u16(c);
  return w.bytes;
}

// ---------------------------------------------------------------- names
const RIBBI = ['regular', 'italic', 'bold', 'bold italic'];
const WEIGHTS = [['thin', 100], ['hairline', 100], ['extralight', 200], ['extra light', 200], ['ultralight', 200], ['light', 300], ['regular', 400], ['book', 400],
  ['medium', 500], ['semibold', 600], ['semi bold', 600], ['demibold', 600], ['extrabold', 800], ['extra bold', 800], ['ultrabold', 800], ['bold', 700], ['black', 900], ['heavy', 900]];

export function weightClassOf(info) {
  const explicit = info.other && info.other.openTypeOS2WeightClass;
  if (typeof explicit === 'number') return explicit;
  const style = String(info.styleName || '').toLowerCase();
  for (const [word, value] of WEIGHTS) if (style.includes(word)) return value;
  return 400;
}

export const postscriptName = (info) => (info.postscriptFontName
  || `${String(info.familyName || 'Untitled').replace(/[^A-Za-z0-9]/g, '')}-${String(info.styleName || 'Regular').replace(/[^A-Za-z0-9]/g, '')}`).slice(0, 63);

/**
 * How a style sits in its family for programs that only know Regular, Italic, Bold and Bold Italic:
 * "Light Italic" is the Italic of the "<Family> Light" group, so the italic button finds it.
 * @returns {{ group: string, linked: string, ribbi: boolean }}
 */
export function styleLinking(info) {
  const family = info.familyName || 'Untitled';
  const style = String(info.styleName || 'Regular').trim() || 'Regular';
  if (RIBBI.includes(style.toLowerCase())) return { group: family, linked: style, ribbi: true };
  const m = /^(.*\S)\s+(italic|oblique)$/i.exec(style);
  if (m) return { group: `${family} ${m[1]}`, linked: 'Italic', ribbi: false };
  return { group: `${family} ${style}`, linked: 'Regular', ribbi: false };
}

function nameRecords(info) {
  const family = info.familyName || 'Untitled';
  const style = info.styleName || 'Regular';
  const { group, linked, ribbi } = styleLinking(info);
  const version = `Version ${info.versionMajor ?? 1}.${String(info.versionMinor ?? 0).padStart(3, '0')}`;
  const ps = postscriptName(info);
  const names = {
    0: info.copyright, 1: group, 2: linked, 3: `${version.slice(8)};${ps}`,
    4: info.postscriptFullName || `${family} ${style}`, 5: version, 6: ps, 7: info.trademark, 8: info.openTypeNameManufacturer,
    9: info.openTypeNameDesigner, 10: info.openTypeNameDescription, 12: info.openTypeNameDesignerURL,
    13: info.openTypeNameLicense, 14: info.openTypeNameLicenseURL,
  };
  if (!ribbi) { names[16] = family; names[17] = style; }
  return Object.entries(names).filter(([, v]) => typeof v === 'string' && v.length).map(([id, v]) => [Number(id), v]);
}

// ---------------------------------------------------------------- the compiler
/**
 * @param {object} font the font model
 * @param {{now?: Date, tolerance?: number, plan?: object}} options
 * @returns {{bytes: Uint8Array, glyphOrder: string[], tables: string[], warnings: Array<{code, glyph?, detail?}>}}
 */
export function compileTtf(font, options = {}) {
  const warnings = [];
  const info = font.info || {};
  const upm = clampU16(info.unitsPerEm || 1000);
  const tolerance = options.tolerance ?? Math.max(0.5, upm / 1000);
  const plan = options.plan || buildLayout(font);

  // ---- glyph order: .notdef first
  const glyphs = { ...font.glyphs };
  if (!glyphs['.notdef']) {
    const w = Math.round(upm / 2); const h = Math.round(upm * 0.7); const s = Math.round(upm / 20);
    glyphs['.notdef'] = { name: '.notdef', width: w, unicodes: [], components: [], anchors: [],
      contours: [[[s, 0, 'line'], [w - s, 0, 'line'], [w - s, h, 'line'], [s, h, 'line']], [[s * 2, s, 'line'], [s * 2, h - s, 'line'], [w - s * 2, h - s, 'line'], [w - s * 2, s, 'line']]] };
  }
  let order = ['.notdef', ...font.glyphOrder.filter((n) => n !== '.notdef' && glyphs[n])];
  if (order.length > 65535) { warnings.push({ code: 'tooManyGlyphs', detail: order.length }); order = order.slice(0, 65535); }
  const gidOf = new Map(order.map((n, i) => [n, i]));
  const model = { glyphs };

  // cubic sources run counter-clockwise outside; TrueType wants clockwise
  let cubic = 0; let quadratic = 0;
  for (const n of order) for (const c of glyphs[n].contours) for (const p of c) { if (p[2] === 'curve') cubic++; else if (p[2] === 'qcurve') quadratic++; }
  const reverse = !(quadratic > cubic);

  // ---- outlines
  const records = order.map((name) => {
    const g = glyphs[name];
    let contours = g.contours;
    let components = g.components.filter((c) => gidOf.has(c.base) && c.base !== name);
    const flipped = components.some((c) => c.transform[0] * c.transform[3] - c.transform[1] * c.transform[2] <= 0);
    const big = components.some((c) => c.transform.slice(0, 4).some((v) => Math.abs(v) >= 2));
    if (components.length && (contours.length || flipped || big)) {
      // TrueType cannot mix outlines and components (nor mirror them safely): use the flattened outline
      const flat = { name, contours: contours.map((c) => c.map((p) => [...p])), components: [] };
      const addFrom = (list, t, depth) => {
        for (const c of list) {
          const base = glyphs[c.base];
          if (!base || depth > 8) continue;
          const m = multiply(c.transform, t);
          const mirror = m[0] * m[3] - m[1] * m[2] < 0;
          for (const contour of base.contours) {
            let pts = contour.map((p) => { const [x, y] = applyTransform(m, p[0], p[1]); return [x, y, p[2]]; });
            if (mirror) pts = reversePoints(pts);
            flat.contours.push(pts);
          }
          addFrom(base.components, m, depth + 1);
        }
      };
      addFrom(g.components, IDENTITY, 0);
      contours = flat.contours; components = [];
    }
    let tt = contours.map((c) => contourToTrueType(c, tolerance)).filter((c) => c.length >= 2);
    if (reverse) tt = tt.map((c) => [c[0], ...c.slice(1).reverse()]);
    return { name, glyph: g, contours: tt, components };
  });

  // points of a glyph with its components, for bounds and maxp
  const flatCache = new Map();
  const flatPoints = (gid, depth = 0) => {
    if (flatCache.has(gid)) return flatCache.get(gid);
    const r = records[gid];
    let pts = []; let nContours = r.contours.length; let maxDepth = r.components.length ? 1 : 0;
    for (const c of r.contours) for (const p of c) pts.push([p.x, p.y]);
    if (depth < 8) {
      for (const c of r.components) {
        const sub = flatPoints(gidOf.get(c.base), depth + 1);
        for (const p of sub.pts) { const [x, y] = applyTransform([c.transform[0], c.transform[1], c.transform[2], c.transform[3], clamp16(c.transform[4]), clamp16(c.transform[5])], p[0], p[1]); pts.push([Math.round(x), Math.round(y)]); }
        nContours += sub.nContours;
        maxDepth = Math.max(maxDepth, 1 + sub.maxDepth);
      }
    }
    const out = { pts, nContours, maxDepth };
    flatCache.set(gid, out);
    return out;
  };

  const glyf = new Writer();
  const loca = [0];
  const hmtx = new Writer();
  const max = { points: 0, contours: 0, compositePoints: 0, compositeContours: 0, componentElements: 0, componentDepth: 0 };
  const font_ = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  let overlapping = 0;
  let advanceMax = 0; let minLsb = Infinity; let minRsb = Infinity; let maxExtent = -Infinity; let widthSum = 0; let widthCount = 0;
  records.forEach((r, gid) => {
    const flat = flatPoints(gid);
    const advance = clampU16(r.glyph.width || 0);
    let lsb = 0;
    if (flat.pts.length) {
      const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
      for (const [x, y] of flat.pts) { if (x < b.xMin) b.xMin = x; if (x > b.xMax) b.xMax = x; if (y < b.yMin) b.yMin = y; if (y > b.yMax) b.yMax = y; }
      for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) b[k] = clamp16(b[k]);
      if (r.components.length) {
        const boxes = r.components.map((c) => boxOf(flatPoints(gidOf.get(c.base)).pts.map(([x, y]) => applyTransform(c.transform, x, y))));
        const meet = boxes.some((x, i) => boxes.some((y, j) => j > i && boxesMeet(x, y)));
        if (meet) overlapping++;
        glyf.raw(encodeCompositeGlyph(r.components, b, gidOf, meet));
        max.compositePoints = Math.max(max.compositePoints, flat.pts.length);
        max.compositeContours = Math.max(max.compositeContours, flat.nContours);
        max.componentElements = Math.max(max.componentElements, r.components.length);
        max.componentDepth = Math.max(max.componentDepth, flat.maxDepth);
      } else {
        const meet = shapesOverlap(r.contours);
        if (meet) overlapping++;
        glyf.raw(encodeSimpleGlyph(r.contours, b, meet));
        max.points = Math.max(max.points, flat.pts.length);
        max.contours = Math.max(max.contours, r.contours.length);
      }
      lsb = b.xMin;
      font_.xMin = Math.min(font_.xMin, b.xMin); font_.yMin = Math.min(font_.yMin, b.yMin);
      font_.xMax = Math.max(font_.xMax, b.xMax); font_.yMax = Math.max(font_.yMax, b.yMax);
      minLsb = Math.min(minLsb, lsb); minRsb = Math.min(minRsb, advance - b.xMax); maxExtent = Math.max(maxExtent, b.xMax);
    }
    loca.push(glyf.length);
    hmtx.u16(advance).i16(lsb);
    advanceMax = Math.max(advanceMax, advance);
    if (advance > 0) { widthSum += advance; widthCount++; }
  });
  if (font_.xMin === Infinity) { font_.xMin = font_.yMin = font_.xMax = font_.yMax = 0; minLsb = minRsb = maxExtent = 0; }

  // ---- character map
  const cmapEntries = [];
  const seen = new Set();
  for (const name of order) {
    for (const u of glyphs[name].unicodes) {
      if (!Number.isInteger(u) || u < 0 || u > 0x10FFFF || seen.has(u)) continue;
      seen.add(u); cmapEntries.push([u, gidOf.get(name)]);
    }
  }
  cmapEntries.sort((a, b) => a[0] - b[0]);
  const bmp = cmapEntries.filter(([u]) => u < 0xFFFF);
  const hasAstral = cmapEntries.some(([u]) => u > 0xFFFF);

  const format4 = (() => {
    const segs = [];
    for (const [u, g] of bmp) {
      const last = segs[segs.length - 1];
      if (last && last.end === u - 1 && g - u === last.delta) last.end = u; else segs.push({ start: u, end: u, delta: g - u });
    }
    segs.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 });
    const n = segs.length;
    const w = new Writer();
    const pow = 2 ** Math.floor(Math.log2(n));
    w.u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(pow * 2).u16(Math.log2(pow)).u16(n * 2 - pow * 2);
    for (const s of segs) w.u16(s.end);
    w.u16(0);
    for (const s of segs) w.u16(s.start);
    for (const s of segs) w.u16(((s.delta % 65536) + 65536) % 65536);
    for (let i = 0; i < n; i++) w.u16(0);
    return w.bytes;
  })();
  const format12 = (() => {
    const groups = [];
    for (const [u, g] of cmapEntries) {
      const last = groups[groups.length - 1];
      if (last && last.end === u - 1 && last.gid + (u - last.start) === g) last.end = u; else groups.push({ start: u, end: u, gid: g });
    }
    const w = new Writer();
    w.u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
    for (const g of groups) w.u32(g.start).u32(g.end).u32(g.gid);
    return w.bytes;
  })();
  const cmap = new Writer();
  const cmapRecords = hasAstral ? [[0, 3, format4], [0, 4, format12], [3, 1, format4], [3, 10, format12]] : [[0, 3, format4], [3, 1, format4]];
  cmap.u16(0).u16(cmapRecords.length);
  {
    const offsets = new Map();
    let at = 4 + cmapRecords.length * 8;
    for (const [, , data] of cmapRecords) if (!offsets.has(data)) { offsets.set(data, at); at += data.length; }
    for (const [platform, encoding, data] of cmapRecords) cmap.u16(platform).u16(encoding).u32(offsets.get(data));
    for (const data of offsets.keys()) cmap.raw(data);
  }

  // ---- vertical metrics
  const ascender = clamp16(info.ascender ?? upm * 0.8);
  const descender = clamp16(info.descender ?? -upm * 0.2);
  const typoAsc = clamp16(info.openTypeOS2TypoAscender ?? ascender);
  const typoDesc = clamp16(info.openTypeOS2TypoDescender ?? descender);
  const typoGap = clamp16(info.openTypeOS2TypoLineGap ?? Math.max(0, Math.round(upm * 1.2) - (typoAsc - typoDesc)));
  const hheaAsc = clamp16(info.openTypeHheaAscender ?? Math.max(typoAsc, font_.yMax));
  const hheaDesc = clamp16(info.openTypeHheaDescender ?? Math.min(typoDesc, font_.yMin));
  const hheaGap = clamp16(info.openTypeHheaLineGap ?? 0);
  const winAsc = clampU16(info.openTypeOS2WinAscent ?? Math.max(typoAsc, font_.yMax));
  const winDesc = clampU16(info.openTypeOS2WinDescent ?? Math.max(-typoDesc, -font_.yMin));

  const style = String(info.styleName || 'Regular').toLowerCase();
  const weight = weightClassOf(info);
  const italic = /italic|oblique/.test(style) || !!info.italicAngle;
  const bold = weight >= 700 && RIBBI.includes(style);
  const now = Math.floor(((options.now || new Date()).getTime()) / 1000) + 2082844800;

  const head = new Writer();
  head.u16(1).u16(0).fixed(Number(`${info.versionMajor ?? 1}.${String(info.versionMinor ?? 0).padStart(3, '0')}`)).u32(0).u32(0x5F0F3CF5)
    .u16(0x0003).u16(upm).date(now).date(now).i16(font_.xMin).i16(font_.yMin).i16(font_.xMax).i16(font_.yMax)
    .u16((bold ? 1 : 0) | (italic ? 2 : 0)).u16(8).i16(2).i16(1).i16(0);

  const hhea = new Writer();
  hhea.u16(1).u16(0).i16(hheaAsc).i16(hheaDesc).i16(hheaGap).u16(advanceMax).i16(minLsb).i16(clamp16(minRsb)).i16(clamp16(maxExtent))
    .i16(italic && info.italicAngle ? upm : 1).i16(italic && info.italicAngle ? Math.round(-Math.tan(info.italicAngle * Math.PI / 180) * upm) : 0).i16(0)
    .i16(0).i16(0).i16(0).i16(0).i16(0).u16(order.length);

  const maxp = new Writer();
  maxp.u32(0x00010000).u16(order.length).u16(max.points).u16(max.contours).u16(max.compositePoints).u16(max.compositeContours)
    .u16(1).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(max.componentElements).u16(max.componentDepth);

  const os2 = new Writer();
  const has = (lo, hi) => cmapEntries.some(([u]) => u >= lo && u <= hi);
  const range1 = (has(0x20, 0x7E) ? 1 : 0) | (has(0xA0, 0xFF) ? 2 : 0) | (has(0x100, 0x17F) ? 4 : 0) | (has(0x180, 0x24F) ? 8 : 0)
    | (has(0x300, 0x36F) ? 0x40 : 0) | (has(0x370, 0x3FF) ? 0x80 : 0) | (has(0x400, 0x4FF) ? 0x200 : 0);
  const range2 = (has(0x2000, 0x206F) ? 0x2000 : 0) | (has(0x20A0, 0x20CF) ? 0x200 : 0);
  const maxContext = Math.max(plan.kerning.size ? 2 : 0, ...plan.gsub.flatMap((f) => f.lookups.map((l) => (l.type === 'ligature' ? Math.max(...l.ligatures.map((x) => x.from.length)) : 1))), 0);
  const sub = Math.round(upm * 0.65); const strike = Math.round(upm * 0.05);
  os2.u16(4).i16(widthCount ? Math.round(widthSum / widthCount) : 0).u16(weight).u16(info.other?.openTypeOS2WidthClass || 5).u16(0)
    .i16(sub).i16(Math.round(upm * 0.6)).i16(0).i16(Math.round(upm * 0.075)).i16(sub).i16(Math.round(upm * 0.6)).i16(0).i16(Math.round(upm * 0.35))
    .i16(strike).i16(Math.round((info.xHeight ?? upm * 0.5) * 0.6)).i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(range1 >>> 0).u32(range2 >>> 0).u32(0).u32(0).tag((info.other?.openTypeOS2VendorID || 'LNFY').padEnd(4))
    .u16((italic ? 0x01 : 0) | (bold ? 0x20 : 0) | (!italic && !bold ? 0x40 : 0) | 0x80)
    .u16(bmp.length ? bmp[0][0] : 0).u16(cmapEntries.length ? Math.min(0xFFFF, cmapEntries[cmapEntries.length - 1][0]) : 0)
    .i16(typoAsc).i16(typoDesc).i16(typoGap).u16(winAsc).u16(winDesc).u32(1).u32(0)
    .i16(clamp16(info.xHeight ?? 0)).i16(clamp16(info.capHeight ?? 0)).u16(0).u16(seen.has(0x20) ? 0x20 : 0).u16(maxContext);

  const name = new Writer();
  {
    const records_ = nameRecords(info);
    const strings = new Writer();
    name.u16(0).u16(records_.length).u16(6 + records_.length * 12);
    for (const [id, text] of records_) {
      const start = strings.length;
      for (let i = 0; i < text.length; i++) strings.u16(text.charCodeAt(i));
      name.u16(3).u16(1).u16(0x409).u16(id).u16(strings.length - start).u16(start);
    }
    name.raw(strings.bytes);
  }

  const post = new Writer();
  post.u32(0x00020000).fixed(info.italicAngle || 0).i16(clamp16(info.other?.postscriptUnderlinePosition ?? -upm * 0.1))
    .i16(clamp16(info.other?.postscriptUnderlineThickness ?? upm * 0.05)).u32(info.other?.postscriptIsFixedPitch ? 1 : 0).u32(0).u32(0).u32(0).u32(0).u16(order.length);
  post.u16(0);
  for (let i = 1; i < order.length; i++) post.u16(258 + i - 1);
  for (let i = 1; i < order.length; i++) {
    const n = order[i].replace(/[^\x21-\x7E]/g, '_').slice(0, 63);
    post.u8(n.length);
    for (let k = 0; k < n.length; k++) post.u8(n.charCodeAt(k));
  }

  const gasp = new Writer();
  gasp.u16(1).u16(1).u16(0xFFFF).u16(0x000F);

  const tables = {
    'OS/2': os2.done(), cmap: cmap.done(), gasp: gasp.done(), glyf: glyf.done(), head: head.done(), hhea: hhea.done(),
    hmtx: hmtx.done(), maxp: maxp.done(), name: name.done(), post: post.done(),
  };
  {
    const w = new Writer();
    for (const off of loca) w.u32(off);
    tables.loca = w.done();
  }

  // ---- substitutions
  {
    const lookups = []; const features = [];
    for (const f of plan.gsub) {
      const indices = [];
      for (const l of f.lookups) {
        const data = l.type === 'single' ? singleSubst(l.map, gidOf) : ligatureSubst(l.ligatures, gidOf);
        if (!data) { warnings.push({ code: 'lookupSkipped', detail: f.tag }); continue; }
        indices.push(lookups.length);
        lookups.push({ type: l.type === 'single' ? 1 : 4, flag: 0, subtables: [data] });
      }
      if (indices.length) features.push({ tag: f.tag, lookups: indices });
    }
    if (features.length) tables.GSUB = layoutTable(features, lookups, 7);
  }

  // ---- positioning
  let marksWritten = false;
  {
    const lookups = []; const features = [];
    const pairs = pairPosSubtables(plan.kerning, gidOf);
    if (pairs.length) { features.push({ tag: 'kern', lookups: [lookups.length] }); lookups.push({ type: 2, flag: 0, subtables: pairs }); }
    const mark = plan.marks.classes.length ? markBasePos(plan.marks, gidOf) : null;
    if (mark) { features.push({ tag: 'mark', lookups: [lookups.length] }); lookups.push({ type: 4, flag: 0, subtables: [mark] }); marksWritten = true; }
    if (features.length) tables.GPOS = layoutTable(features, lookups, 9);
  }

  // ---- glyph classes (bases, ligatures, marks)
  if (tables.GSUB || tables.GPOS) {
    const ligs = new Set(plan.gsub.flatMap((f) => f.lookups.filter((l) => l.type === 'ligature').flatMap((l) => l.ligatures.map((x) => x.to))));
    const classes = [];
    order.forEach((n, gid) => {
      if (marksWritten && plan.marks.marks[n]) classes.push([gid, 3]);
      else if (ligs.has(n)) classes.push([gid, 2]);
      else if (gid > 0 && (glyphs[n].contours.length || glyphs[n].components.length)) classes.push([gid, 1]);
    });
    const w = new Writer();
    w.u16(1).u16(0).u16(12).u16(0).u16(0).u16(0).raw(classDef(classes));
    tables.GDEF = w.done();
  }

  // ---- colour layers
  const color = font.lib && font.lib[COLOR_GLYPHS_KEY];
  const palette = font.lib && Array.isArray(font.lib[PALETTE_KEY]) ? font.lib[PALETTE_KEY] : [];
  if (color && palette.length) {
    const bases = Object.entries(color).map(([n, layers]) => [gidOf.get(n), (Array.isArray(layers) ? layers : [])
      .map((l) => [gidOf.get(l.glyph), l.color]).filter(([g, c]) => g !== undefined && Number.isInteger(c) && ((c >= 0 && c < palette.length) || c === 0xFFFF))])
      .filter(([g, layers]) => g !== undefined && layers.length).sort((a, b) => a[0] - b[0]);
    if (bases.length) {
      const colr = new Writer();
      const total = bases.reduce((s, b) => s + b[1].length, 0);
      colr.u16(0).u16(bases.length).u32(14).u32(14 + bases.length * 6).u16(total);
      let first = 0;
      for (const [g, layers] of bases) { colr.u16(g).u16(first).u16(layers.length); first += layers.length; }
      for (const [, layers] of bases) for (const [g, c] of layers) colr.u16(g).u16(c);
      tables.COLR = colr.done();
      const cpal = new Writer();
      cpal.u16(0).u16(palette.length).u16(1).u16(palette.length).u32(14).u16(0);
      for (const hex of palette) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(String(hex)) || [0, '00', '00', '00', 'ff'];
        cpal.u8(parseInt(m[3], 16)).u8(parseInt(m[2], 16)).u8(parseInt(m[1], 16)).u8(m[4] ? parseInt(m[4], 16) : 255); // BGRA
      }
      tables.CPAL = cpal.done();
    }
  }

  return { bytes: assemble(tables), glyphOrder: order, tables: Object.keys(tables).sort(), warnings, overlapping };
}

function reversePoints(points) {
  // same rule as fontModel.reverseContour, for a contour that is known to be closed
  const on = [];
  points.forEach((p, i) => { if (p[2] !== 'offcurve') on.push(i); });
  const out = points.map((p) => [...p]);
  on.forEach((idx, k) => { out[idx][2] = points[on[(k + 1) % on.length]][2]; });
  return out.reverse();
}

/** Puts tables together as an sfnt file with checksums. */
export function assemble(tables, flavor = 0x00010000) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  const pow = 2 ** Math.floor(Math.log2(n));
  const w = new Writer();
  w.u32(flavor).u16(n).u16(pow * 16).u16(Math.log2(pow)).u16(n * 16 - pow * 16);
  let offset = 12 + n * 16;
  let headOffset = 0;
  for (const tag of tags) {
    const data = tables[tag];
    if (tag === 'head') headOffset = offset;
    w.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const tag of tags) w.raw(tables[tag]).pad(4);
  const bytes = w.done();
  if (headOffset) {
    const adjust = (0xB1B0AFBA - checksum(bytes)) >>> 0;
    bytes[headOffset + 8] = adjust >>> 24; bytes[headOffset + 9] = (adjust >>> 16) & 0xFF; bytes[headOffset + 10] = (adjust >>> 8) & 0xFF; bytes[headOffset + 11] = adjust & 0xFF;
  }
  return bytes;
}
