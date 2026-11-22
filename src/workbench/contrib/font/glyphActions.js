/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Actions on glyphs as a whole: create, duplicate, rename, delete, build accented letters from
// anchors, and transform many glyphs at once. Each one is a single step in the undo history.
import * as model from '../../../base/common/fontModel.js';
import { CHARSETS, missingCharacters } from '../../../base/common/validate.js';
import { eachOtherWeight } from '../../../base/common/weights.js';
import { formatUnicode } from '../../../base/common/format.js';
import { formDialog, codeDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

/** Combining mark → name of the accent glyph that draws it. */
const ACCENTS = {
  0x300: 'grave', 0x301: 'acute', 0x302: 'circumflex', 0x303: 'tilde', 0x304: 'macron', 0x306: 'breve', 0x307: 'dotaccent',
  0x308: 'dieresis', 0x30A: 'ring', 0x30B: 'hungarumlaut', 0x30C: 'caron', 0x327: 'cedilla', 0x328: 'ogonek',
};

function parseCode(text) {
  const v = String(text || '').trim();
  if (!v) return null;
  if ([...v].length === 1) return v.codePointAt(0);
  const m = /^(?:u\+|0x)?([0-9a-f]{4,6})$/i.exec(v);
  return m ? parseInt(m[1], 16) : NaN;
}

export async function newGlyph({ fonts, layout }) {
  const font = fonts.font;
  const res = await formDialog({
    title: t('font.dialog.new.title'), message: t('font.dialog.new.message'), confirmLabel: t('common.create'),
    fields: [
      { id: 'char', label: t('font.dialog.new.char'), value: '', hint: t('font.dialog.new.charHint') },
      { id: 'name', label: t('font.dialog.new.name'), value: '', hint: t('font.dialog.new.nameHint') },
      { id: 'width', label: t('glyph.width'), type: 'number', value: Math.round(fonts.unitsPerEm * 0.6) },
    ],
    validate: (v) => {
      const code = parseCode(v.char);
      if (Number.isNaN(code)) return t('font.dialog.new.badChar');
      const name = v.name.trim() || (code !== null ? model.suggestGlyphName(code) : '');
      if (!name) return t('font.dialog.new.needName');
      if (!model.isValidGlyphName(name)) return t('font.dialog.badName');
      if (font.glyphs[name]) return t('font.dialog.exists', { name });
      if (code !== null && fonts.glyphForChar(code)) return t('font.dialog.codeTaken', { code: formatUnicode(code), name: fonts.glyphForChar(code) });
      return null;
    },
  });
  if (!res) return;
  const code = parseCode(res.char);
  const name = res.name.trim() || model.suggestGlyphName(code);
  fonts.edit(t('undo.newGlyph'), { glyphs: [name], sections: ['glyphOrder'] }, (f) => {
    f.glyphs[name] = model.newGlyph(name, code !== null ? [code] : [], Math.max(0, Math.round(res.width || 0)));
    f.glyphOrder.push(name);
  });
  fonts.select(name);
  layout.openView('glyph');
}

export async function duplicateGlyph({ fonts }) {
  const source = fonts.glyph(fonts.selected);
  if (!source) return;
  let suggestion = `${source.name}.alt`;
  for (let i = 1; fonts.font.glyphs[suggestion]; i++) suggestion = `${source.name}.alt${i}`;
  const res = await formDialog({
    title: t('font.dialog.duplicate.title', { name: source.name }), confirmLabel: t('font.action.duplicate'),
    fields: [{ id: 'name', label: t('font.dialog.new.name'), value: suggestion, hint: t('font.dialog.duplicate.hint') }],
    validate: (v) => (!model.isValidGlyphName(v.name.trim()) ? t('font.dialog.badName') : fonts.font.glyphs[v.name.trim()] ? t('font.dialog.exists', { name: v.name.trim() }) : null),
  });
  if (!res) return;
  const name = res.name.trim();
  fonts.edit(t('undo.duplicate'), { glyphs: [name], sections: ['glyphOrder'] }, (f) => {
    f.glyphs[name] = { ...model.clone(source), name, unicodes: [] };
    // in each other weight the copy is made from that weight's own drawing
    eachOtherWeight(f, (w) => { if (w.glyphs[source.name]) w.glyphs[name] = { ...model.clone(w.glyphs[source.name]), name, unicodes: [] }; });
    f.glyphOrder.splice(f.glyphOrder.indexOf(source.name) + 1, 0, name);
  });
  fonts.select(name);
}

export async function renameGlyph({ fonts }) {
  const glyph = fonts.glyph(fonts.selected);
  if (!glyph) return;
  const res = await formDialog({
    title: t('font.dialog.rename.title', { name: glyph.name }), message: t('font.dialog.rename.message'), confirmLabel: t('font.action.rename'),
    fields: [
      { id: 'name', label: t('font.dialog.new.name'), value: glyph.name },
      { id: 'char', label: t('font.dialog.new.char'), value: glyph.unicodes.map((u) => u.toString(16).toUpperCase().padStart(4, '0')).join(' '), hint: t('font.dialog.rename.charHint') },
    ],
    validate: (v) => {
      const name = v.name.trim();
      if (!model.isValidGlyphName(name)) return t('font.dialog.badName');
      if (name !== glyph.name && fonts.font.glyphs[name]) return t('font.dialog.exists', { name });
      for (const part of v.char.trim().split(/[\s,]+/).filter(Boolean)) {
        const code = parseCode(part);
        if (code === null || Number.isNaN(code)) return t('font.dialog.new.badChar');
        const owner = fonts.glyphForChar(code);
        if (owner && owner !== glyph.name) return t('font.dialog.codeTaken', { code: formatUnicode(code), name: owner });
      }
      return null;
    },
  });
  if (!res) return;
  const name = res.name.trim();
  const codes = res.char.trim().split(/[\s,]+/).filter(Boolean).map(parseCode);
  fonts.edit(t('undo.rename'), { all: true }, (f) => {
    f.glyphs[glyph.name].unicodes = codes;
    if (name !== glyph.name) {
      eachOtherWeight(f, (w) => model.renameGlyph(w, glyph.name, name));
      model.renameGlyph(f, glyph.name, name);
    }
  });
  fonts.select(name);
}

export async function deleteGlyph({ fonts }) {
  const glyph = fonts.glyph(fonts.selected);
  if (!glyph) return;
  const users = model.usersOf(fonts.font, glyph.name);
  const ok = await codeDialog({
    title: t('font.dialog.delete.title', { name: glyph.name }),
    message: users.length ? tn('font.dialog.delete.users', users.length, { list: users.slice(0, 8).join(', ') }) : t('font.dialog.delete.message'),
  });
  if (!ok) return;
  fonts.edit(t('undo.deleteGlyph'), { all: true }, (f) => { eachOtherWeight(f, (w) => model.removeGlyph(w, glyph.name)); model.removeGlyph(f, glyph.name); });
}

/** Builds the accented letters a language needs out of a base letter and an accent, joined at their anchors. */
/** Which of the characters can be built from a base letter and an accent the font has: { plan, skipped }. */
function planAccents(fonts, chars) {
  const font = fonts.font;
  const plan = [];
  const skipped = [];
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    if (fonts.glyphForChar(code)) continue;
    const parts = [...ch.normalize('NFD')];
    if (parts.length !== 2 || !ACCENTS[parts[1].codePointAt(0)]) continue;
    const accent = ACCENTS[parts[1].codePointAt(0)];
    let base = fonts.glyphForChar(parts[0].codePointAt(0));
    if (parts[0] === 'i' && accent !== 'cedilla' && accent !== 'ogonek' && font.glyphs.dotlessi) base = 'dotlessi';
    const upper = parts[0] !== parts[0].toLowerCase();
    const mark = [`${accent}comb${upper ? '.case' : ''}`, `${accent}comb`, `${accent}${upper ? '.case' : ''}`, accent].find((n) => font.glyphs[n]);
    const name = `${parts[0]}${accent}`;
    if (!base || !mark || font.glyphs[name]) { skipped.push(ch); continue; }
    plan.push({ name, base, mark, code, ch });
  }
  return { plan, skipped };
}

/**
 * Gives the font a glyph for every character of a set that it lacks: accented letters are built from
 * base and accent where the font has both; the rest are created empty, with their code and a width,
 * ready to be drawn. Every weight gets them.
 */
export function completeCharset({ fonts, notifications }, set, { empty: withEmpty = true } = {}) {
  const missing = missingCharacters(fonts.font, set);
  if (!missing.length) return;
  const { plan } = planAccents(fonts, missing);
  const composed = new Map(plan.map((p) => [p.ch, p]));
  const upm = fonts.unitsPerEm;
  const taken = new Set(Object.keys(fonts.font.glyphs));
  const todo = [];
  for (const ch of missing) {
    const code = ch.codePointAt(0);
    const p = composed.get(ch);
    let plain = model.suggestGlyphName(code);
    if (taken.has(plain)) plain = `uni${code.toString(16).toUpperCase().padStart(4, '0')}`;
    if (taken.has(plain) && !(p && !taken.has(p.name))) continue;
    const item = { ch, code, p: p && !taken.has(p.name) ? p : null, plain };
    if (!item.p && !withEmpty) continue;
    taken.add(item.p ? item.p.name : plain);
    todo.push(item);
  }
  let built = 0; let empty = 0; let first = null;
  fonts.edit(t('undo.addCharacters'), { glyphs: todo.flatMap((x) => (x.p ? [x.p.name, x.plain] : [x.plain])), sections: ['glyphOrder'] }, (f) => {
    for (const { ch, code, p, plain } of todo) {
      const glyph = p ? model.buildComposite(f, p.name, p.base, p.mark, [code]) : null;
      if (glyph) {
        f.glyphs[p.name] = glyph; f.glyphOrder.push(p.name); built++; first ||= p.name;
        eachOtherWeight(f, (w) => { const own = model.buildComposite(w, p.name, p.base, p.mark, [code]); if (own) w.glyphs[p.name] = own; });
        continue;
      }
      if (f.glyphs[plain]) continue;
      // an accented letter that could not be built starts with the width of its base letter
      const base = [...ch.normalize('NFD')][0];
      const like = base !== ch ? fonts.glyphForChar(base.codePointAt(0)) : null;
      f.glyphs[plain] = model.newGlyph(plain, [code], like ? f.glyphs[like].width : Math.round(upm * 0.6));
      f.glyphOrder.push(plain); empty++; first ||= plain;
    }
  });
  notifications.info(t('font.completed', { built, empty }), 9000);
  if (first) fonts.select(first);
}

/**
 * "Add glyphs for a language": the one way to give the font the characters a language needs — reached
 * from the font view and, with the language already chosen, from the coverage list in Check.
 */
export async function addGlyphs(services, preset) {
  const { fonts } = services;
  const sets = ['basicLatin', 'portuguese', 'spanish', 'westernEuropean'];
  const count = (set) => missingCharacters(fonts.font, set).length;
  const res = await formDialog({
    title: t('font.dialog.add.title'), message: t('font.dialog.add.message'), confirmLabel: t('common.add'),
    fields: [
      { id: 'set', label: t('font.dialog.accents.set'), type: 'select', value: preset || sets.find(count) || 'portuguese', options: sets.map((set) => [set, `${t('charsets.' + set)} · ${tn('font.dialog.add.missing', count(set))}`]) },
      { id: 'empty', label: t('font.dialog.add.empty'), type: 'checkbox', value: true },
    ],
    validate: (v) => (count(v.set) ? null : t('font.dialog.add.complete')),
  });
  if (res) completeCharset(services, res.set, { empty: res.empty });
}

export async function transformGlyphs({ fonts, notifications }) {
  const names = fonts.visibleGlyphs();
  if (!names.length) return;
  const res = await formDialog({
    title: t('font.dialog.transform.title'), message: tn('font.dialog.transform.message', names.length), confirmLabel: t('font.dialog.transform.apply'),
    fields: [
      { id: 'scale', label: t('font.dialog.transform.scale'), type: 'number', value: 100 },
      { id: 'dx', label: t('font.dialog.transform.dx'), type: 'number', value: 0 },
      { id: 'dy', label: t('font.dialog.transform.dy'), type: 'number', value: 0 },
      { id: 'skew', label: t('font.dialog.transform.skew'), type: 'number', value: 0 },
      { id: 'spacing', label: t('font.dialog.transform.spacing'), type: 'number', value: 0, hint: t('font.dialog.transform.spacingHint') },
    ],
    validate: (v) => (!(v.scale > 0) || v.scale > 1000 ? t('font.dialog.transform.badScale') : Math.abs(v.skew || 0) > 60 ? t('font.dialog.transform.badSkew') : null),
  });
  if (!res) return;
  const k = res.scale / 100;
  const all = names.length === fonts.font.glyphOrder.length;
  const set = new Set(names);
  fonts.edit(t('undo.transformGlyphs'), all ? { all: true } : { glyphs: names }, (f) => {
    for (const name of names) {
      const g = f.glyphs[name];
      // a component whose base glyph is transformed too only has to follow in position
      const scaleComponents = !g.components.every((c) => set.has(c.base));
      if (k !== 1) { model.transformGlyph(g, model.scaling(k, k), { scaleComponents }); g.width = Math.round(g.width * k); }
      if (res.skew) model.transformGlyph(g, model.skewing(res.skew), { scaleComponents });
      if (res.dx || res.dy) {
        for (const c of g.contours) for (const p of c) { p[0] += Math.round(res.dx || 0); p[1] += Math.round(res.dy || 0); }
        for (const a of g.anchors) { a.x += Math.round(res.dx || 0); a.y += Math.round(res.dy || 0); }
        if (scaleComponents) for (const c of g.components) { c.transform[4] += Math.round(res.dx || 0); c.transform[5] += Math.round(res.dy || 0); }
        model.shiftGuidelines(g, Math.round(res.dx || 0), Math.round(res.dy || 0));
      }
      if (res.spacing) {
        const half = Math.round(res.spacing / 2);
        for (const c of g.contours) for (const p of c) p[0] += half;
        for (const a of g.anchors) a.x += half;
        if (scaleComponents) for (const c of g.components) c.transform[4] += half;
        model.shiftGuidelines(g, half);
        g.width = Math.max(0, g.width + half * 2);
      }
    }
    if (all && k !== 1) {
      for (const rights of Object.values(f.kerning)) for (const key of Object.keys(rights)) rights[key] = Math.round(rights[key] * k);
      if (res.skew && !f.info.italicAngle) f.info.italicAngle = -res.skew;
    }
  });
  notifications.info(tn('font.transform.done', names.length));
}
