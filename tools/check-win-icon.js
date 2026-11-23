/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Checks that a Windows executable carries the app icon: the icon group the Start menu, the task bar
// and the file manager read. The release workflow runs it on the packaged app and reports a missing
// icon on the run page.
//   node tools/check-win-icon.js <path-to.exe> [reference.ico]
// Exit code 0 when the executable has an icon group with the 16, 32, 48 and 256 pixel images (and, with
// a reference .ico, when those images are the ones of that file); 1 otherwise. Prints what it found as JSON.
const fs = require('fs');
const crypto = require('crypto');

const RT_ICON = 3; const RT_GROUP_ICON = 14;
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

/** The resources of a PE file: { [typeId]: [{ id, data }] } (types and items with a name instead of a number are skipped). */
function readResources(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a Windows executable');
  const sections = buf.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const plus = buf.readUInt16LE(optional) === 0x20b; // PE32+
  const dirRva = buf.readUInt32LE(optional + (plus ? 112 : 96) + 2 * 8);
  const table = optional + buf.readUInt16LE(pe + 20);
  const toOffset = (rva) => {
    for (let i = 0; i < sections; i++) {
      const s = table + 40 * i;
      const va = buf.readUInt32LE(s + 12); const size = Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16));
      if (rva >= va && rva < va + size) return rva - va + buf.readUInt32LE(s + 20);
    }
    throw new Error('address outside the file');
  };
  if (!dirRva) return {};
  const root = toOffset(dirRva);
  const entries = (at) => {
    const named = buf.readUInt16LE(at + 12); const ids = buf.readUInt16LE(at + 14);
    const out = [];
    for (let i = 0; i < named + ids; i++) {
      const e = at + 16 + 8 * i;
      const id = buf.readUInt32LE(e); const off = buf.readUInt32LE(e + 4);
      out.push({ id: id & 0x80000000 ? null : id, dir: !!(off & 0x80000000), at: root + (off & 0x7fffffff) });
    }
    return out;
  };
  const res = {};
  for (const type of entries(root)) {
    if (type.id === null || !type.dir) continue;
    res[type.id] = [];
    for (const item of entries(type.at)) {
      for (const lang of item.dir ? entries(item.at) : [item]) {
        const rva = buf.readUInt32LE(lang.at); const size = buf.readUInt32LE(lang.at + 4);
        const start = toOffset(rva);
        res[type.id].push({ id: item.id, data: buf.subarray(start, start + size) });
      }
    }
  }
  return res;
}

function check(exePath, icoPath) {
  const res = readResources(fs.readFileSync(exePath));
  const groups = res[RT_GROUP_ICON] || [];
  const images = new Map((res[RT_ICON] || []).map((r) => [r.id, r.data]));
  const report = { file: exePath, groups: groups.length, sizes: [], problems: [] };
  if (!groups.length) { report.problems.push('the executable has no icon group'); return report; }
  const g = groups[0].data;
  const found = [];
  for (let i = 0; i < g.readUInt16LE(4); i++) {
    const e = 6 + 14 * i;
    const size = g[e] || 256; const id = g.readUInt16LE(e + 12);
    const data = images.get(id);
    found.push({ size, bytes: data ? data.length : 0, md5: data ? md5(data) : null });
    if (!data || !data.length) report.problems.push(`the ${size} px image is listed but missing`);
  }
  report.sizes = found.map((f) => f.size).sort((a, b) => a - b);
  for (const need of [16, 32, 48, 256]) if (!report.sizes.includes(need)) report.problems.push(`no ${need} px image`);
  if (icoPath) {
    const ico = fs.readFileSync(icoPath);
    const wanted = new Map();
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const e = 6 + 16 * i;
      const off = ico.readUInt32LE(e + 12); const len = ico.readUInt32LE(e + 8);
      wanted.set(ico[e] || 256, md5(ico.subarray(off, off + len)));
    }
    for (const [size, hash] of wanted) {
      const f = found.find((x) => x.size === size);
      if (!f || f.md5 !== hash) report.problems.push(`the ${size} px image is not the one of ${icoPath}`);
    }
    report.reference = icoPath;
  }
  return report;
}

if (require.main === module) {
  const [exe, ico] = process.argv.slice(2);
  if (!exe) { console.error('usage: node tools/check-win-icon.js <path-to.exe> [reference.ico]'); process.exit(2); }
  let report;
  try { report = check(exe, ico); } catch (err) { report = { file: exe, problems: [String(err && err.message)] }; }
  console.log(JSON.stringify({ ok: !report.problems.length, ...report }, null, 2));
  process.exit(report.problems.length ? 1 : 0);
}

module.exports = { check, readResources };
