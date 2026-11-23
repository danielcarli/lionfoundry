/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// The line of text of the Glyph view, as in the edit view of other font editors: glyphs set one after
// the other, with their spacing and kerning, one of them being edited.
//   Items: { name } for a glyph of the font, { br: true } for a line break, { missing } for a character
//   (or a /name) the font does not have yet — shown as an empty box so the text keeps its shape.
//   Text form: characters for glyphs that have one, "/name" for the others (as in Glyphs: "/a.sc"),
//   a new line for a line break. After "/name" a space ends the name and is not a glyph itself.
// No DOM, no Node: the view and the tests use the same functions.

const NAME_CHAR = /[A-Za-z0-9._\-]/;

/**
 * Reads the text form.
 * @param {string} text
 * @param {{ hasGlyph(name: string): boolean, glyphForChar(code: number): string|null }} font
 * @returns {Array<{name?: string, br?: true, missing?: string}>}
 */
export function parseText(text, font) {
  const items = [];
  const chars = [...String(text ?? '').replace(/\r\n?/g, '\n')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') { items.push({ br: true }); continue; }
    if (ch === '/' && i + 1 < chars.length && NAME_CHAR.test(chars[i + 1])) {
      let j = i + 1;
      while (j < chars.length && NAME_CHAR.test(chars[j])) j++;
      const name = chars.slice(i + 1, j).join('');
      items.push(font.hasGlyph(name) ? { name } : { missing: '/' + name });
      if (chars[j] === ' ') j++; // the space that ends a name is part of it
      i = j - 1;
      continue;
    }
    const name = font.glyphForChar(ch.codePointAt(0));
    items.push(name ? { name } : { missing: ch });
  }
  return items;
}

/**
 * Writes the text form back: a glyph is written as its character when that character brings back the
 * same glyph, and as "/name" otherwise.
 * @param {Array} items
 * @param {{ unicodesOf(name: string): number[], glyphForChar(code: number): string|null }} font
 */
export function serializeText(items, font) {
  let out = '';
  items.forEach((item, k) => {
    if (item.br) { out += '\n'; return; }
    if (item.missing !== undefined) { out += item.missing + (item.missing.startsWith('/') ? nameEnd(items[k + 1], font) : ''); return; }
    const code = (font.unicodesOf(item.name) || []).find((c) => font.glyphForChar(c) === item.name);
    if (code !== undefined && code !== 0x2F && code !== 0x0A) out += String.fromCodePoint(code);
    else out += '/' + item.name + nameEnd(items[k + 1], font);
  });
  return out;
}

// A space after "/name" only where the next thing could be read as more of the name.
function nameEnd(next, font) {
  if (!next || next.br) return '';
  if (next.missing !== undefined) return next.missing.startsWith('/') ? '' : NAME_CHAR.test(next.missing) || next.missing === ' ' ? ' ' : '';
  const code = (font.unicodesOf(next.name) || []).find((c) => font.glyphForChar(c) === next.name);
  if (code === undefined || code === 0x2F) return ''; // written as "/name" too
  const ch = String.fromCodePoint(code);
  return NAME_CHAR.test(ch) || ch === ' ' ? ' ' : '';
}

/**
 * Sets the items in lines.
 * @param {Array} items
 * @param {{ advance(name: string): number, kern(left: string, right: string): number, lineHeight: number, missingWidth: number }} opts
 * @returns {{ boxes: Array<{i: number, x: number, y: number, w: number, kern: number}>, carets: Array<{x: number, y: number, line: number}>, lines: number }}
 *   x and y in font units from the start of the first line (y grows upwards, so the second line is at -lineHeight);
 *   `kern` is the kerning applied between the item and the one before it; one caret position per gap (items.length + 1).
 */
export function layoutText(items, opts) {
  const boxes = new Array(items.length).fill(null);
  const carets = [];
  let x = 0; let line = 0; let prev = null;
  const lineY = (n) => (n ? -n * opts.lineHeight : 0); // never -0
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const y = lineY(line);
    if (item.br) {
      carets.push({ x, y, line });
      line++; x = 0; prev = null;
      continue;
    }
    const kern = item.name && prev ? opts.kern(prev, item.name) || 0 : 0;
    x += kern;
    carets.push({ x, y, line });
    const w = item.name ? opts.advance(item.name) : opts.missingWidth;
    boxes[i] = { i, x, y, w, kern };
    x += w;
    prev = item.name || null;
  }
  carets.push({ x, y: lineY(line), line });
  return { boxes, carets, lines: line + 1 };
}

/** The glyph a text cursor refers to: the one after it, or the one before when nothing follows on its line. */
export function glyphAtCaret(items, caret) {
  if (items[caret] && items[caret].name) return caret;
  if (items[caret - 1] && items[caret - 1].name) return caret - 1;
  return -1;
}
