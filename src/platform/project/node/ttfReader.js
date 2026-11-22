/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Imports an OpenType font with TrueType outlines (.ttf) as a new, unsaved project.
// Read: outlines and components, character map, advance widths, names, vertical metrics, glyph names
// and pair kerning (GPOS pair adjustments or the old "kern" table).
// Not read yet: CFF outlines (.otf), substitutions, mark positioning, hinting, variations — the
// result lists what was left behind in `warnings`. The font file itself is never changed.
const MAX_GLYPHS = 65535;
const MAX_PAIRS = 60000;

/** The 258 glyph names of the standard Macintosh ordering ("post" table formats 1 and 2). */
const MAC_NAMES = '.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat'.split(' ');

class Reader {
  constructor(buffer, offset = 0) { this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength); this.pos = offset; this.buffer = buffer; }
  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  fixed() { return this.i32() / 65536; }
  f2dot14() { return this.i16() / 16384; }
  tag() { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(this.u8()); return s; }
  at(offset) { return new Reader(this.buffer, offset); }
}

function suggestName(code) {
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) return String.fromCodePoint(code);
  return code > 0xFFFF ? 'u' + code.toString(16).toUpperCase() : 'uni' + code.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * @param {Buffer} buffer the bytes of a .ttf file
 * @param {string} fileName used for names when the font has none
 * @returns the font model (no path: it has to be saved as a project)
 */
function readTtf(buffer, fileName = 'Imported') {
  if (buffer.length < 12) throw new Error('not a font file');
  const r = new Reader(buffer);
  const flavor = r.tag();
  if (flavor === 'OTTO') throw new Error('unsupportedCff');
  if (flavor === 'wOFF' || flavor === 'wOF2') throw new Error('unsupportedWoff');
  if (flavor === 'ttcf') throw new Error('unsupportedCollection');
  if (flavor !== '\x00\x01\x00\x00' && flavor !== 'true') throw new Error('not a TrueType font');
  const numTables = r.u16();
  r.pos = 12;
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag(); r.u32();
    const offset = r.u32(); const length = r.u32();
    if (offset + length <= buffer.length) tables[tag] = { offset, length };
  }
  for (const tag of ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap']) if (!tables[tag]) throw new Error(`table "${tag}" is missing`);
  const table = (tag) => r.at(tables[tag].offset);
  const warnings = [];

  const head = table('head');
  head.pos += 4;
  const revision = head.fixed();
  head.pos += 10;
  const unitsPerEm = head.u16();
  head.pos += 16 + 8;
  const macStyle = head.u16();
  head.pos += 4;
  const longLoca = head.i16() === 1;

  const maxp = table('maxp');
  maxp.pos += 4;
  const numGlyphs = Math.min(MAX_GLYPHS, maxp.u16());

  const hhea = table('hhea');
  hhea.pos += 4;
  const hheaAscender = hhea.i16(); const hheaDescender = hhea.i16(); const hheaLineGap = hhea.i16();
  hhea.pos += 24;
  const numHMetrics = hhea.u16();

  const hmtx = table('hmtx');
  const widths = [];
  for (let i = 0; i < numGlyphs; i++) {
    if (i < numHMetrics) { widths.push(hmtx.u16()); hmtx.i16(); } else widths.push(widths[numHMetrics - 1] || 0);
  }

  // ---- glyph names
  let names = null;
  if (tables.post) {
    const post = table('post');
    const version = post.u32();
    var italicAngle = post.fixed(); // eslint-disable-line no-var
    var underlinePosition = post.i16(); var underlineThickness = post.i16(); // eslint-disable-line no-var
    var fixedPitch = post.u32() !== 0; // eslint-disable-line no-var
    post.pos += 16;
    if (version === 0x00020000) {
      const n = post.u16();
      const indices = [];
      for (let i = 0; i < n; i++) indices.push(post.u16());
      const strings = [];
      const end = tables.post.offset + tables.post.length;
      while (post.pos < end) { const len = post.u8(); let s = ''; for (let i = 0; i < len && post.pos < end; i++) s += String.fromCharCode(post.u8()); strings.push(s); }
      names = indices.map((idx) => (idx < 258 ? MAC_NAMES[idx] : strings[idx - 258]));
    } else if (version === 0x00010000) names = MAC_NAMES.slice();
  }

  // ---- character map
  const cmap = table('cmap');
  const cmapStart = tables.cmap.offset;
  cmap.u16();
  const nSub = cmap.u16();
  let best = null;
  for (let i = 0; i < nSub; i++) {
    const platform = cmap.u16(); const encoding = cmap.u16(); const offset = cmap.u32();
    const format = r.at(cmapStart + offset).u16();
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!best || format > best.format) best = { format, offset: cmapStart + offset };
  }
  const unicodes = new Map(); // gid → [code]
  const map = (code, gid) => { if (gid > 0 && gid < numGlyphs) { if (!unicodes.has(gid)) unicodes.set(gid, []); unicodes.get(gid).push(code); } };
  if (best && best.format === 12) {
    const t = r.at(best.offset + 12);
    const n = t.u32();
    for (let i = 0; i < n; i++) { const start = t.u32(); const end = t.u32(); const gid = t.u32(); for (let c = start; c <= end && c - start < 70000; c++) map(c, gid + c - start); }
  } else if (best) {
    const t = r.at(best.offset + 6);
    const segCount = t.u16() / 2;
    t.pos += 6;
    const ends = []; for (let i = 0; i < segCount; i++) ends.push(t.u16());
    t.u16();
    const starts = []; for (let i = 0; i < segCount; i++) starts.push(t.u16());
    const deltas = []; for (let i = 0; i < segCount; i++) deltas.push(t.i16());
    const rangePos = t.pos;
    for (let i = 0; i < segCount; i++) {
      const rangeOffset = r.at(rangePos + i * 2).u16();
      for (let c = starts[i]; c <= ends[i] && c < 0xFFFF; c++) {
        let gid;
        if (rangeOffset === 0) gid = (c + deltas[i]) & 0xFFFF;
        else {
          const at = rangePos + i * 2 + rangeOffset + (c - starts[i]) * 2;
          if (at + 2 > buffer.length) continue;
          gid = r.at(at).u16();
          if (gid) gid = (gid + deltas[i]) & 0xFFFF;
        }
        map(c, gid);
      }
    }
  } else warnings.push({ code: 'noUnicodeCmap' });

  // unique, usable glyph names
  const used = new Set();
  const glyphNames = [];
  for (let gid = 0; gid < numGlyphs; gid++) {
    let name = names && names[gid];
    if (gid === 0) name = '.notdef';
    if (!name || !/^[A-Za-z_.][A-Za-z0-9_.\-]*$/.test(name) || (gid > 0 && name === '.notdef')) {
      const u = unicodes.get(gid);
      name = u ? suggestName(u[0]) : 'glyph' + String(gid).padStart(5, '0');
    }
    let unique = name;
    for (let i = 1; used.has(unique); i++) unique = `${name}.${i}`;
    used.add(unique);
    glyphNames.push(unique);
  }

  // ---- outlines
  const loca = table('loca');
  const offsets = [];
  for (let i = 0; i <= numGlyphs; i++) offsets.push(longLoca ? loca.u32() : loca.u16() * 2);
  const glyfStart = tables.glyf.offset;
  const glyphs = {};
  for (let gid = 0; gid < numGlyphs; gid++) {
    const glyph = { name: glyphNames[gid], width: widths[gid], unicodes: unicodes.get(gid) || [], contours: [], components: [], anchors: [] };
    glyphs[glyph.name] = glyph;
    if (offsets[gid + 1] <= offsets[gid] || glyfStart + offsets[gid + 1] > buffer.length) continue;
    try {
      const g = r.at(glyfStart + offsets[gid]);
      const nContours = g.i16();
      g.pos += 8;
      if (nContours >= 0) {
        const ends = []; for (let i = 0; i < nContours; i++) ends.push(g.u16());
        const nPoints = nContours ? ends[nContours - 1] + 1 : 0;
        const instructions = g.u16();
        g.pos += instructions;
        const flags = [];
        while (flags.length < nPoints) { const f = g.u8(); flags.push(f); if (f & 8) { let rep = g.u8(); while (rep-- > 0 && flags.length < nPoints) flags.push(f); } }
        const xs = []; let v = 0;
        for (const f of flags) { if (f & 2) { const d = g.u8(); v += f & 16 ? d : -d; } else if (!(f & 16)) v += g.i16(); xs.push(v); }
        const ys = []; v = 0;
        for (const f of flags) { if (f & 4) { const d = g.u8(); v += f & 32 ? d : -d; } else if (!(f & 32)) v += g.i16(); ys.push(v); }
        let start = 0;
        for (const end of ends) {
          const n = end - start + 1;
          const contour = [];
          for (let i = 0; i < n; i++) {
            const k = start + i;
            const on = flags[k] & 1;
            const prevOn = flags[start + ((i - 1 + n) % n)] & 1;
            contour.push([xs[k], ys[k], on ? (prevOn ? 'line' : 'qcurve') : 'offcurve']);
          }
          if (contour.length) glyph.contours.push(contour);
          start = end + 1;
        }
      } else {
        for (let more = true; more;) {
          const flags = g.u16(); const gidRef = g.u16();
          let dx = 0; let dy = 0;
          if (flags & 1) { dx = g.i16(); dy = g.i16(); } else { dx = g.i8(); dy = g.i8(); }
          if (!(flags & 2)) { dx = 0; dy = 0; warnings.push({ code: 'pointMatching', glyph: glyph.name }); }
          let a = 1; let b = 0; let c = 0; let d = 1;
          if (flags & 8) { a = d = g.f2dot14(); } else if (flags & 0x40) { a = g.f2dot14(); d = g.f2dot14(); } else if (flags & 0x80) { a = g.f2dot14(); b = g.f2dot14(); c = g.f2dot14(); d = g.f2dot14(); }
          if (gidRef < numGlyphs) glyph.components.push({ base: glyphNames[gidRef], transform: [a, b, c, d, dx, dy] });
          more = !!(flags & 0x20);
        }
      }
    } catch (err) {
      glyph.contours = []; glyph.components = [];
      warnings.push({ code: 'unreadableGlyph', glyph: glyph.name, detail: err.message });
    }
  }

  // ---- names
  const strings = {};
  if (tables.name) {
    const name = table('name');
    const start = tables.name.offset;
    name.u16();
    const count = name.u16(); const stringOffset = name.u16();
    for (let i = 0; i < count; i++) {
      const platform = name.u16(); const encoding = name.u16(); const language = name.u16(); const id = name.u16(); const length = name.u16(); const offset = name.u16();
      const at = start + stringOffset + offset;
      if (at + length > buffer.length) continue;
      let text = '';
      if (platform === 3 || platform === 0) { for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(buffer.readUInt16BE(at + k)); } else if (platform === 1 && encoding === 0) text = buffer.toString('latin1', at, at + length); else continue;
      const english = (platform === 3 && language === 0x409) || (platform === 1 && language === 0);
      if (!(id in strings) || english) strings[id] = text;
    }
  }

  const base = fileName.replace(/\.[^.]+$/, '');
  const info = { other: {} };
  info.familyName = strings[16] || strings[1] || base;
  info.styleName = strings[17] || strings[2] || 'Regular';
  info.versionMajor = Math.floor(revision);
  info.versionMinor = Math.round((revision - Math.floor(revision)) * 1000);
  info.unitsPerEm = unitsPerEm;
  for (const [id, key] of [[0, 'copyright'], [7, 'trademark'], [8, 'openTypeNameManufacturer'], [9, 'openTypeNameDesigner'], [10, 'openTypeNameDescription'],
    [12, 'openTypeNameDesignerURL'], [13, 'openTypeNameLicense'], [14, 'openTypeNameLicenseURL'], [6, 'postscriptFontName'], [4, 'postscriptFullName']]) {
    if (strings[id]) info[key] = strings[id];
  }
  info.ascender = hheaAscender; info.descender = hheaDescender;
  info.openTypeHheaAscender = hheaAscender; info.openTypeHheaDescender = hheaDescender; info.openTypeHheaLineGap = hheaLineGap;
  if (typeof italicAngle === 'number') {
    info.italicAngle = italicAngle;
    info.other.postscriptUnderlinePosition = underlinePosition; info.other.postscriptUnderlineThickness = underlineThickness;
    if (fixedPitch) info.other.postscriptIsFixedPitch = true;
  }
  if (tables['OS/2'] && tables['OS/2'].length >= 78) {
    const os2 = table('OS/2');
    const version = os2.u16();
    os2.pos += 2;
    info.other.openTypeOS2WeightClass = os2.u16();
    info.other.openTypeOS2WidthClass = os2.u16();
    os2.pos = tables['OS/2'].offset + 68;
    info.openTypeOS2TypoAscender = os2.i16(); info.openTypeOS2TypoDescender = os2.i16(); info.openTypeOS2TypoLineGap = os2.i16();
    info.openTypeOS2WinAscent = os2.u16(); info.openTypeOS2WinDescent = os2.u16();
    info.ascender = info.openTypeOS2TypoAscender; info.descender = info.openTypeOS2TypoDescender;
    if (version >= 2 && tables['OS/2'].length >= 90) { os2.pos += 8; info.xHeight = os2.i16(); info.capHeight = os2.i16(); }
  }
  void macStyle;

  // ---- kerning
  const kerning = {};
  let pairs = 0;
  let truncated = false;
  const kern = (l, rr, v) => {
    if (!v || l >= numGlyphs || rr >= numGlyphs) return;
    if (pairs >= MAX_PAIRS) { truncated = true; return; }
    const row = (kerning[glyphNames[l]] ||= {});
    if (!(glyphNames[rr] in row)) { row[glyphNames[rr]] = v; pairs++; }
  };
  try { if (tables.GPOS) readGposKerning(r, tables.GPOS.offset, kern); } catch (err) { warnings.push({ code: 'kerningUnreadable', detail: err.message }); }
  if (!pairs && tables.kern) {
    try {
      const k = table('kern');
      if (k.u16() === 0) {
        const n = k.u16();
        for (let i = 0; i < n; i++) {
          const start = k.pos;
          k.u16(); const length = k.u16(); const coverage = k.u16();
          if ((coverage >> 8) === 0 && (coverage & 1)) { const np = k.u16(); k.pos += 6; for (let p = 0; p < np; p++) kern(k.u16(), k.u16(), k.i16()); }
          k.pos = start + length;
        }
      }
    } catch (err) { warnings.push({ code: 'kerningUnreadable', detail: err.message }); }
  }
  if (truncated) warnings.push({ code: 'kerningTruncated', detail: MAX_PAIRS });
  if (tables.GSUB) warnings.push({ code: 'featuresNotImported' });
  for (const tag of ['fpgm', 'prep', 'cvt ']) if (tables[tag]) { warnings.push({ code: 'hintingNotImported' }); break; }
  if (tables.fvar) warnings.push({ code: 'variationsNotImported' });

  return {
    format: 'ttf', path: null, source: fileName, name: `${base}.ufo`, info, glyphOrder: glyphNames, glyphs, groups: {}, kerning, features: '',
    lib: { 'org.lionfoundry.importedFrom': fileName }, layers: ['public.default'], warnings,
  };
}

function coverageGlyphs(r, offset) {
  const c = r.at(offset);
  const format = c.u16(); const n = c.u16();
  const out = [];
  if (format === 1) { for (let i = 0; i < n; i++) out.push(c.u16()); } else if (format === 2) {
    for (let i = 0; i < n; i++) { const start = c.u16(); const end = c.u16(); c.u16(); for (let g = start; g <= end; g++) out.push(g); }
  }
  return out;
}

function classDefinition(r, offset) {
  const c = r.at(offset);
  const format = c.u16();
  const out = new Map();
  if (format === 1) { const start = c.u16(); const n = c.u16(); for (let i = 0; i < n; i++) out.set(start + i, c.u16()); } else if (format === 2) {
    const n = c.u16();
    for (let i = 0; i < n; i++) { const start = c.u16(); const end = c.u16(); const cls = c.u16(); for (let g = start; g <= end; g++) out.set(g, cls); }
  }
  return out;
}

const valueSize = (format) => { let n = 0; for (let b = format; b; b >>= 1) n += b & 1; return n * 2; };
/** Reads a value record and returns its horizontal advance adjustment. */
function xAdvance(c, format) {
  let v = 0;
  for (let bit = 1; bit <= 0x80; bit <<= 1) { if (format & bit) { const x = c.i16(); if (bit === 4) v = x; } }
  return v;
}

/** Pair adjustments of the "kern" feature, class pairs expanded to glyph pairs. */
function readGposKerning(r, start, kern) {
  const h = r.at(start);
  h.pos += 4;
  h.u16();
  const featureList = start + h.u16(); const lookupList = start + h.u16();
  const fl = r.at(featureList);
  const wanted = new Set();
  const nFeatures = fl.u16();
  for (let i = 0; i < nFeatures; i++) {
    const tag = fl.tag(); const off = fl.u16();
    if (tag !== 'kern') continue;
    const f = r.at(featureList + off);
    f.u16();
    const n = f.u16();
    for (let k = 0; k < n; k++) wanted.add(f.u16());
  }
  const ll = r.at(lookupList);
  const nLookups = ll.u16();
  for (let i = 0; i < nLookups; i++) {
    const lookupOffset = lookupList + ll.u16();
    if (!wanted.has(i)) continue;
    const l = r.at(lookupOffset);
    const type = l.u16(); l.u16();
    const nSub = l.u16();
    for (let s = 0; s < nSub; s++) {
      let sub = lookupOffset + l.u16();
      let subType = type;
      if (type === 9) { const e = r.at(sub); e.u16(); subType = e.u16(); sub += e.u32(); }
      if (subType !== 2) continue;
      const t = r.at(sub);
      const format = t.u16(); const coverage = coverageGlyphs(r, sub + t.u16()); const f1 = t.u16(); const f2 = t.u16();
      if (format === 1) {
        const n = t.u16();
        for (let k = 0; k < n && k < coverage.length; k++) {
          const set = r.at(sub + t.u16());
          const count = set.u16();
          for (let p = 0; p < count; p++) { const second = set.u16(); const v = xAdvance(set, f1); set.pos += valueSize(f2); kern(coverage[k], second, v); }
        }
      } else if (format === 2) {
        const c1 = classDefinition(r, sub + t.u16()); const c2 = classDefinition(r, sub + t.u16());
        const n1 = t.u16(); const n2 = t.u16();
        const values = [];
        for (let a = 0; a < n1; a++) { const row = []; for (let b = 0; b < n2; b++) { row.push(xAdvance(t, f1)); t.pos += valueSize(f2); } values.push(row); }
        const seconds = new Map(); // class → glyphs
        for (const [g, cls] of c2) { if (!seconds.has(cls)) seconds.set(cls, []); seconds.get(cls).push(g); }
        for (const first of coverage) {
          const row = values[c1.get(first) || 0];
          if (!row) continue;
          for (let b = 1; b < n2; b++) { if (row[b]) for (const second of seconds.get(b) || []) kern(first, second, row[b]); }
        }
      }
    }
  }
}

module.exports = { readTtf, MAC_NAMES };
