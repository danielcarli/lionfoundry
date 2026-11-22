/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Wraps a TrueType font as WOFF2 (web font). The tables are stored as they are ("null transform")
// and compressed together with Brotli, which Node already has: no extra dependency.
const zlib = require('zlib');

const KNOWN_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR',
  'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx',
  'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function base128(n) {
  const out = [];
  for (let shift = 28; shift >= 0; shift -= 7) {
    const b = (n >>> shift) & 0x7F;
    if (out.length || b || shift === 0) out.push(shift ? b | 0x80 : b);
  }
  return out;
}

/**
 * @param {Uint8Array} ttf a complete TrueType font
 * @returns {Buffer} the same font as WOFF2
 */
function ttfToWoff2(ttf) {
  const sfnt = Buffer.from(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = sfnt.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    tables.push({ tag: sfnt.toString('latin1', at, at + 4), offset: sfnt.readUInt32BE(at + 8), length: sfnt.readUInt32BE(at + 12) });
  }
  // "loca" has to come right after "glyf"
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const loca = tables.findIndex((t) => t.tag === 'loca');
  const glyf = tables.findIndex((t) => t.tag === 'glyf');
  if (loca >= 0 && glyf >= 0) { const [l] = tables.splice(loca, 1); tables.splice(tables.findIndex((t) => t.tag === 'glyf') + 1, 0, l); }

  const directory = [];
  const data = [];
  let totalSfntSize = 12 + numTables * 16;
  for (const t of tables) {
    const known = KNOWN_TAGS.indexOf(t.tag);
    // transform version 3 means "not transformed" for glyf and loca; 0 means that for every other table
    const version = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0;
    directory.push((known >= 0 ? known : 63) | (version << 6));
    if (known < 0) for (let i = 0; i < 4; i++) directory.push(t.tag.charCodeAt(i));
    directory.push(...base128(t.length));
    data.push(sfnt.subarray(t.offset, t.offset + t.length));
    totalSfntSize += Math.ceil(t.length / 4) * 4;
  }
  const compressed = zlib.brotliCompressSync(Buffer.concat(data), {
    params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT, [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const header = Buffer.alloc(48);
  const length = 48 + directory.length + compressed.length;
  header.write('wOF2', 0, 'latin1');
  header.writeUInt32BE(sfnt.readUInt32BE(0), 4);
  header.writeUInt32BE(Math.ceil(length / 4) * 4, 8);
  header.writeUInt16BE(numTables, 12);
  header.writeUInt32BE(totalSfntSize, 16);
  header.writeUInt32BE(compressed.length, 20);
  header.writeUInt16BE(1, 24);
  return Buffer.concat([header, Buffer.from(directory), compressed, Buffer.alloc(Math.ceil(length / 4) * 4 - length)]);
}

module.exports = { ttfToWoff2 };
