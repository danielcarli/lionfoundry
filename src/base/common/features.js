/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// OpenType features of a font, from three sources that end up in one "layout plan":
//   1. automatic — read from glyph names (f_i is a ligature, a.sc a small cap…), kerning and anchors;
//   2. rules — substitutions added in the Features view, kept in the project;
//   3. code — the project's feature file. A subset of the Adobe FEA syntax is understood; what is
//      not understood is reported (with its line) and left out of the exported font, never dropped
//      from the project.
// The plan is what the proof view shapes text with and what the exporter writes as GSUB and GPOS.

export const FEATURES_KEY = 'org.lionfoundry.features';

/** Glyph name suffix → feature tag. */
export const SUFFIX_FEATURES = {
  sc: 'smcp', smcp: 'smcp', c2sc: 'c2sc', onum: 'onum', osf: 'onum', lnum: 'lnum', lf: 'lnum', tnum: 'tnum', tf: 'tnum',
  pnum: 'pnum', sups: 'sups', subs: 'subs', sinf: 'sinf', numr: 'numr', dnom: 'dnom', case: 'case', zero: 'zero',
  salt: 'salt', alt: 'salt', swsh: 'swsh', titl: 'titl', hist: 'hist', ordn: 'ordn',
};
for (let i = 1; i <= 20; i++) SUFFIX_FEATURES['ss' + String(i).padStart(2, '0')] = 'ss' + String(i).padStart(2, '0');

/** Features applied without being asked for, as in most applications. */
export const DEFAULT_ON = new Set(['ccmp', 'locl', 'rlig', 'liga', 'calt', 'kern', 'mark', 'mkmk']);

/** Order in which substitution features are written and applied. */
const GSUB_ORDER = ['ccmp', 'locl', 'smcp', 'c2sc', 'case', 'onum', 'lnum', 'tnum', 'pnum', 'zero', 'ordn', 'sups', 'subs', 'sinf', 'numr', 'dnom',
  'salt', 'swsh', 'titl', 'hist', ...Array.from({ length: 20 }, (_, i) => 'ss' + String(i + 1).padStart(2, '0')), 'rlig', 'liga', 'dlig', 'hlig', 'calt'];

/** The project's feature settings, with defaults filled in. */
export function featureSettings(font) {
  const s = (font.lib && font.lib[FEATURES_KEY]) || {};
  return {
    auto: { kern: true, mark: true, liga: true, suffixes: true, ...(s.auto || {}) },
    rules: Array.isArray(s.rules) ? s.rules : [],
  };
}

/** Substitution rules read from glyph names: [{ feature, type, from, to, auto: true }]. */
export function automaticRules(font, auto) {
  const rules = [];
  for (const name of font.glyphOrder) {
    const dot = name.indexOf('.', 1);
    if (auto.suffixes && dot > 0) {
      const base = name.slice(0, dot);
      const tag = SUFFIX_FEATURES[name.slice(dot + 1)];
      if (tag && font.glyphs[base]) rules.push({ feature: tag, type: 'single', from: base, to: name, auto: true });
    }
    if (auto.liga && dot < 0 && name.includes('_') && !name.startsWith('_')) {
      const parts = name.split('_');
      if (parts.length > 1 && parts.every((p) => font.glyphs[p])) rules.push({ feature: 'liga', type: 'ligature', from: parts, to: name, auto: true });
    }
  }
  return rules;
}

// ---------------------------------------------------------------- feature code (FEA subset)
/**
 * Reads the subset of the Adobe feature syntax LionFoundry compiles:
 *   @class = [a b c];                glyph classes (they may include other classes)
 *   feature liga { … } liga;         feature blocks; lookup blocks inside them are flattened
 *   sub a by b;  sub f i by f_i;     single and ligature substitutions
 *   sub [a b] by [a.sc b.sc];        single substitutions over classes of the same size
 *   pos A V -60;                     pair adjustments (glyphs or classes), inside "kern"
 * languagesystem, script, language and lookupflag statements are accepted and ignored.
 * @returns {{rules: Array, pairs: Array, warnings: Array<{line:number, text:string}>}}
 */
export function parseFeatureCode(code, font) {
  const rules = [];
  const pairs = [];
  const warnings = [];
  const classes = {};
  const has = (g) => !font || !!font.glyphs[g];

  // statements end with ";" — "{" and "}" open and close blocks; comments run to the end of the line
  const tokens = [];
  let line = 1;
  const re = /#[^\n]*|\n|[{};]|\[|\]|[^\s{};[\]#]+/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (m[0] === '\n') line++;
    else if (m[0][0] !== '#') tokens.push({ text: m[0], line });
  }

  /** Reads a glyph, a @class or a [list] starting at tokens[i]; returns [names, next index]. */
  const readSet = (list, i) => {
    const tk = list[i];
    if (!tk) return [null, i];
    if (tk.text === '[') {
      const names = [];
      let j = i + 1;
      while (j < list.length && list[j].text !== ']') {
        const [inner, next] = readSet(list, j);
        if (!inner) return [null, j];
        names.push(...inner);
        j = next;
      }
      return [names, j + 1];
    }
    if (tk.text[0] === '@') return [classes[tk.text] ? [...classes[tk.text]] : null, i + 1];
    return [[tk.text.replace(/^\\/, '')], i + 1];
  };

  const stack = []; // open blocks: { kind: 'feature'|'lookup'|'other', tag }
  let stmt = [];
  const feature = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === 'feature') return stack[i].tag; return null; };
  const warn = (tk, text) => warnings.push({ line: tk.line, text });

  const statement = (s) => {
    const head = s[0].text;
    const first = s[0];
    if (['languagesystem', 'script', 'language', 'lookupflag', 'include', 'markClass', 'parameters', 'featureNames', 'name', 'sizemenuname'].includes(head)) {
      if (head === 'include' || head === 'markClass') warn(first, `"${head}" is not compiled yet`);
      return;
    }
    if (head[0] === '@' && s[1] && s[1].text === '=') {
      const [names] = readSet(s, 2);
      if (names) classes[head] = names; else warn(first, `class ${head} could not be read`);
      return;
    }
    const tag = feature();
    if (head === 'lookup' && s.length === 2) return; // reference to a named lookup: its rules were already read where it was defined
    if (!tag) { warn(first, `statement outside a feature: ${s.map((t) => t.text).join(' ')}`); return; }
    if (head === 'sub' || head === 'substitute') {
      const by = s.findIndex((t) => t.text === 'by');
      if (by < 0 || s.some((t) => t.text.endsWith("'") || t.text === 'from' || t.text === 'ignore')) { warn(first, 'contextual and alternate substitutions are not compiled yet'); return; }
      const sources = [];
      let i = 1;
      while (i < by) { const [set, next] = readSet(s, i); if (!set) { warn(first, 'unknown class in substitution'); return; } sources.push(set); i = next; }
      const [target] = readSet(s, by + 1);
      if (!target || !sources.length) { warn(first, 'substitution could not be read'); return; }
      if (sources.length === 1) {
        if (target.length !== sources[0].length && target.length !== 1) { warn(first, 'classes of different sizes in substitution'); return; }
        sources[0].forEach((from, k) => {
          const to = target.length === 1 ? target[0] : target[k];
          if (has(from) && has(to)) rules.push({ feature: tag, type: 'single', from, to });
          else warn(first, `unknown glyph in substitution: ${has(from) ? to : from}`);
        });
      } else if (sources.every((x) => x.length === 1) && target.length === 1) {
        const from = sources.map((x) => x[0]);
        if (from.every(has) && has(target[0])) rules.push({ feature: tag, type: 'ligature', from, to: target[0] });
        else warn(first, `unknown glyph in ligature: ${[...from, target[0]].find((g) => !has(g))}`);
      } else warn(first, 'ligatures over classes are not compiled yet');
      return;
    }
    if (head === 'pos' || head === 'position') {
      const [a, i1] = readSet(s, 1);
      const [b, i2] = a ? readSet(s, i1) : [null, 0];
      const value = b && s[i2] ? Number(s[i2].text) : NaN;
      if (!a || !b || !Number.isFinite(value) || s.length !== i2 + 1) { warn(first, 'only pair adjustments with one value are compiled'); return; }
      for (const l of a) for (const r of b) if (has(l) && has(r)) pairs.push({ left: l, right: r, value });
      return;
    }
    warn(first, `"${head}" is not compiled yet`);
  };

  let closing = false; // just after "}", the block's name and its ";" follow: "} liga;"
  for (const tk of tokens) {
    if (tk.text === '{') {
      const head = stmt[0] ? stmt[0].text : '';
      stack.push({ kind: head === 'feature' ? 'feature' : head === 'lookup' ? 'lookup' : 'other', tag: stmt[1] ? stmt[1].text : '' });
      if (head !== 'feature' && head !== 'lookup') warn(tk, `"${head || '{'}" block is not compiled yet`);
      stmt = [];
      closing = false;
    } else if (tk.text === '}') {
      if (!stack.length) warn(tk, 'unexpected "}"'); else stack.pop();
      stmt = [];
      closing = true;
    } else if (tk.text === ';') {
      if (stmt.length && !closing && !stack.some((blk) => blk.kind === 'other')) statement(stmt);
      stmt = [];
      closing = false;
    } else stmt.push(tk);
  }
  if (stack.length) warnings.push({ line, text: `"${stack[stack.length - 1].tag}" block is not closed` });
  return { rules, pairs, warnings };
}

// ---------------------------------------------------------------- the layout plan
/** Kerning expanded to glyph pairs, following the UFO precedence (glyph pairs win over group pairs). */
export function expandKerning(font) {
  const out = new Map();
  const members = (side) => (side in font.groups && Array.isArray(font.groups[side]) ? font.groups[side] : font.glyphs[side] ? [side] : []);
  const isGroup = (side) => side.startsWith('public.kern');
  const entries = [];
  for (const [left, rights] of Object.entries(font.kerning || {})) {
    for (const [right, value] of Object.entries(rights)) {
      if (typeof value === 'number') entries.push([left, right, value, (isGroup(left) ? 0 : 2) + (isGroup(right) ? 0 : 1)]);
    }
  }
  // least specific first, so the more specific pairs overwrite them
  entries.sort((a, b) => a[3] - b[3]);
  for (const [left, right, value] of entries) {
    for (const l of members(left)) {
      if (!font.glyphs[l]) continue;
      for (const r of members(right)) {
        if (!font.glyphs[r]) continue;
        if (!out.has(l)) out.set(l, new Map());
        out.get(l).set(r, value);
      }
    }
  }
  return out;
}

/** True for glyphs that attach to a base instead of taking space: combining marks by Unicode or by name. */
const COMBINING = /\p{Mn}|\p{Me}/u;
export function isMarkGlyph(glyph) {
  if (glyph.unicodes.some((c) => COMBINING.test(String.fromCodePoint(c)))) return true;
  return /comb(\.|$)/.test(glyph.name) && glyph.anchors.some((a) => a.name.startsWith('_'));
}

/**
 * Everything the font does with glyph sequences, ready to shape with or to write to a font file.
 * @returns {{
 *   gsub: Array<{tag: string, lookups: Array<{type: 'single', map: Object}|{type: 'ligature', ligatures: Array<{from: string[], to: string}>}>}>,
 *   kerning: Map<string, Map<string, number>>,
 *   marks: {classes: string[], marks: Object, bases: Object},
 *   warnings: Array<{line: number, text: string}>
 * }}
 */
export function buildLayout(font) {
  const settings = featureSettings(font);
  const parsed = parseFeatureCode(font.features || '', font);
  const all = [...automaticRules(font, settings.auto), ...settings.rules.filter((r) => r.enabled !== false), ...parsed.rules];
  const usable = (r) => (r.type === 'single'
    ? font.glyphs[r.from] && font.glyphs[r.to]
    : Array.isArray(r.from) && r.from.length > 1 && r.from.every((g) => font.glyphs[g]) && font.glyphs[r.to]);

  const byTag = new Map();
  for (const r of all) {
    if (!usable(r) || !/^[A-Za-z0-9]{4}$/.test(r.feature)) continue;
    if (!byTag.has(r.feature)) byTag.set(r.feature, { single: {}, ligatures: [], seen: new Set() });
    const f = byTag.get(r.feature);
    if (r.type === 'single') { if (!(r.from in f.single)) f.single[r.from] = r.to; } else {
      const key = r.from.join(' ');
      if (!f.seen.has(key)) { f.seen.add(key); f.ligatures.push({ from: r.from, to: r.to }); }
    }
  }
  const order = (t) => { const i = GSUB_ORDER.indexOf(t); return i < 0 ? GSUB_ORDER.length : i; };
  const gsub = [...byTag.keys()].sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1)).map((tag) => {
    const f = byTag.get(tag);
    const lookups = [];
    if (Object.keys(f.single).length) lookups.push({ type: 'single', map: f.single });
    // longer ligatures first, so "f f i" is tried before "f i"
    if (f.ligatures.length) lookups.push({ type: 'ligature', ligatures: f.ligatures.sort((a, b) => b.from.length - a.from.length) });
    return { tag, lookups };
  });

  const kerning = settings.auto.kern ? expandKerning(font) : new Map();
  for (const p of parsed.pairs) {
    if (!kerning.has(p.left)) kerning.set(p.left, new Map());
    kerning.get(p.left).set(p.right, p.value);
  }

  // mark attachment: classes are anchor names ("top" pairs with "_top")
  const marks = { classes: [], marks: {}, bases: {} };
  if (settings.auto.mark) {
    for (const name of font.glyphOrder) {
      const g = font.glyphs[name];
      if (!isMarkGlyph(g)) continue;
      const a = g.anchors.find((x) => x.name.startsWith('_'));
      if (!a) continue;
      const cls = a.name.slice(1);
      if (!marks.classes.includes(cls)) marks.classes.push(cls);
      marks.marks[name] = { cls, x: a.x, y: a.y };
    }
    if (marks.classes.length) {
      for (const name of font.glyphOrder) {
        const g = font.glyphs[name];
        if (marks.marks[name]) continue;
        const anchors = {};
        for (const a of g.anchors) if (marks.classes.includes(a.name)) anchors[a.name] = { x: a.x, y: a.y };
        if (Object.keys(anchors).length) marks.bases[name] = anchors;
      }
    }
  }
  return { gsub, kerning, marks, warnings: parsed.warnings };
}

/** Feature tags present in a plan, substitutions first. */
export function layoutFeatures(plan) {
  const tags = plan.gsub.map((f) => f.tag);
  if (plan.kerning.size) tags.push('kern');
  if (plan.marks.classes.length && Object.keys(plan.marks.bases).length) tags.push('mark');
  return tags;
}

const feaName = (g) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(g) ? g : '\\' + g);

/** Feature code equivalent to the automatic features and the rules (what other tools need to see them). */
export function generateFeatureCode(font) {
  const settings = featureSettings(font);
  const rules = [...automaticRules(font, settings.auto), ...settings.rules.filter((r) => r.enabled !== false)];
  const byTag = new Map();
  for (const r of rules) { if (!byTag.has(r.feature)) byTag.set(r.feature, []); byTag.get(r.feature).push(r); }
  let out = '# Generated by LionFoundry from glyph names, rules, kerning and anchors.\nlanguagesystem DFLT dflt;\nlanguagesystem latn dflt;\n';
  for (const [tag, list] of byTag) {
    out += `\nfeature ${tag} {\n`;
    for (const r of list) out += r.type === 'single' ? `  sub ${feaName(r.from)} by ${feaName(r.to)};\n` : `  sub ${r.from.map(feaName).join(' ')} by ${feaName(r.to)};\n`;
    out += `} ${tag};\n`;
  }
  if (settings.auto.kern && Object.keys(font.kerning || {}).length) {
    const side = (s) => (s.startsWith('public.kern') ? '@' + s.replace(/^public\.kern([12])\./, 'kern$1_').replace(/[^A-Za-z0-9_.]/g, '_') : feaName(s));
    out += '\n';
    for (const [group, members] of Object.entries(font.groups || {})) {
      if (group.startsWith('public.kern') && Array.isArray(members)) out += `${side(group)} = [${members.map(feaName).join(' ')}];\n`;
    }
    out += '\nfeature kern {\n';
    for (const [left, rights] of Object.entries(font.kerning)) for (const [right, v] of Object.entries(rights)) out += `  pos ${side(left)} ${side(right)} ${v};\n`;
    out += '} kern;\n';
  }
  return out;
}
