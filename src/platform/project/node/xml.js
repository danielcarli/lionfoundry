/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Minimal XML reader for the two dialects a UFO uses: property lists (.plist) and glyphs (.glif).
// No dependencies; it reads elements, attributes and text, and skips declarations, comments and doctypes.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  if (text.indexOf('&') < 0) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return code in ENTITIES ? ENTITIES[code] : m;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Parses an XML document.
 * @returns {{name: string, attrs: Object<string,string>, children: Array, text: string}} the root element
 */
function parseXml(source) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) stack[stack.length - 1].text += decode(source.slice(i, lt));
    if (source.startsWith('<!--', lt)) { const end = source.indexOf('-->', lt + 4); i = end < 0 ? n : end + 3; continue; }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += source.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (source[lt + 1] === '?') { const end = source.indexOf('?>', lt + 2); i = end < 0 ? n : end + 2; continue; }
    if (source[lt + 1] === '!') { const end = source.indexOf('>', lt + 2); i = end < 0 ? n : end + 1; continue; }
    const gt = source.indexOf('>', lt + 1);
    if (gt < 0) throw new Error('XML: unterminated tag');
    const raw = source.slice(lt + 1, gt);
    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      if (stack.length < 2 || stack[stack.length - 1].name !== name) throw new Error(`XML: unexpected </${name}>`);
      stack.pop();
    } else {
      const selfClosing = raw[raw.length - 1] === '/';
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const space = body.search(/\s/);
      const el = { name: space < 0 ? body : body.slice(0, space), attrs: {}, children: [], text: '' };
      if (space >= 0) {
        ATTR.lastIndex = 0;
        let m;
        while ((m = ATTR.exec(body)) !== null) el.attrs[m[1]] = decode(m[2] !== undefined ? m[2] : m[3]);
      }
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
    }
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  const top = root.children[0];
  if (!top) throw new Error('XML: empty document');
  return top;
}

/** Converts a parsed <plist> into plain JavaScript values. */
function plistValue(el) {
  switch (el.name) {
    case 'dict': {
      const out = {};
      for (let i = 0; i + 1 < el.children.length; i += 2) {
        const key = el.children[i];
        if (key.name !== 'key') throw new Error('plist: expected <key>');
        out[key.text] = plistValue(el.children[i + 1]);
      }
      return out;
    }
    case 'array': return el.children.map(plistValue);
    case 'string': return el.text;
    case 'integer': return parseInt(el.text, 10);
    case 'real': return parseFloat(el.text);
    case 'true': return true;
    case 'false': return false;
    // dates and binary data keep their type, so that writing the property list back does not turn them into strings
    case 'date': return { '@date': el.text.trim() };
    case 'data': return { '@data': el.text.replace(/\s+/g, '') };
    default: throw new Error(`plist: unknown element <${el.name}>`);
  }
}

function parsePlist(source) {
  const root = parseXml(source);
  if (root.name !== 'plist' || !root.children.length) throw new Error('not a property list');
  return plistValue(root.children[0]);
}

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (v) => esc(v).replace(/"/g, '&quot;');
/** Numbers as UFO files store them: integers when whole, short decimals otherwise. */
const fmtNumber = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6));

function plistNode(value, indent) {
  const pad = '  '.repeat(indent);
  if (value === true) return `${pad}<true/>\n`;
  if (value === false) return `${pad}<false/>\n`;
  if (typeof value === 'number') return Number.isInteger(value) ? `${pad}<integer>${value}</integer>\n` : `${pad}<real>${fmtNumber(value)}</real>\n`;
  if (typeof value === 'string') return `${pad}<string>${esc(value)}</string>\n`;
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}<array/>\n`;
    return `${pad}<array>\n${value.map((v) => plistNode(v, indent + 1)).join('')}${pad}</array>\n`;
  }
  if (value && typeof value === 'object') {
    if (typeof value['@date'] === 'string') return `${pad}<date>${esc(value['@date'])}</date>\n`;
    if (typeof value['@data'] === 'string') return `${pad}<data>${esc(value['@data'])}</data>\n`;
    const keys = Object.keys(value).filter((k) => value[k] !== undefined && value[k] !== null);
    if (!keys.length) return `${pad}<dict/>\n`;
    return `${pad}<dict>\n${keys.map((k) => `${pad}  <key>${esc(k)}</key>\n${plistNode(value[k], indent + 1)}`).join('')}${pad}</dict>\n`;
  }
  return `${pad}<string></string>\n`;
}

/** Writes plain JavaScript values as an XML property list. */
function writePlist(value) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0">\n${plistNode(value, 1)}</plist>\n`;
}

/** Writes a parsed element back as XML (used to keep parts of a file LionFoundry does not edit). */
function serializeXml(el, indent = 0) {
  const pad = '  '.repeat(indent);
  const attrs = Object.entries(el.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (!el.children.length && !el.text.trim()) return `${pad}<${el.name}${attrs}/>\n`;
  if (!el.children.length) return `${pad}<${el.name}${attrs}>${esc(el.text.trim())}</${el.name}>\n`;
  return `${pad}<${el.name}${attrs}>\n${el.children.map((c) => serializeXml(c, indent + 1)).join('')}${pad}</${el.name}>\n`;
}

module.exports = { parseXml, parsePlist, plistValue, writePlist, serializeXml, esc, escAttr, fmtNumber };
