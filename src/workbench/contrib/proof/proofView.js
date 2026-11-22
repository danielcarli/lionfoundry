/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Proof" view: type a text and read it set in the open font.
//  • The text is shaped with the font's own features (substitutions, kerning, mark attachment), each of
//    which can be switched on and off; "what happened" lists every step the shaper took.
//  • Click a glyph to adjust its spacing and its kerning with the glyph before it, right where you read.
//  • "Compiled font" sets the same text with the font exactly as it would be exported, through the
//    system's text engine — the check that the exported font behaves like the drawing.
import { h, s, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { shape } from '../../../base/common/shaper.js';
import { layoutFeatures, DEFAULT_ON } from '../../../base/common/features.js';
import * as model from '../../../base/common/fontModel.js';
import { formatUnicode, formatUnits } from '../../../base/common/format.js';
import { ViewPane } from '../../browser/viewPane.js';
import { t, tn } from '../../../base/common/nls.js';

const STATE_KEY = 'lionfoundry.proof';
const SAMPLES = ['pangram', 'spacing', 'kerning', 'alphabet', 'figures'];
const SAMPLE_TEXT = {
  spacing: 'HHOHOOH nnonoon\nHamburgefonstiv',
  kerning: 'AVATAR Tokyo LATTE\nType, Wave, Yo-yo. PA FA LV',
  alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz',
  figures: '0123456789\n1 + 2 = 3; (4/5) - 6? 7! "8" \'9\'',
};
let faceCount = 0;

export class ProofView extends ViewPane {
  state = { text: '', size: 72, features: {}, compiled: false, steps: false };
  /** The glyph being spaced: position in the shaped text ("line:index"). */
  #focus = null;
  #face = null;

  constructor(services) {
    super(services, 'proof');
    try { Object.assign(this.state, JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); } catch { /* defaults */ }
    if (!this.state.text) this.state.text = t('proof.sample.pangram');
    if (!this.state.features || typeof this.state.features !== 'object') this.state.features = {};

    this.input = h('textarea.proof-input', {
      rows: '2', spellcheck: 'false', 'aria-label': t('proof.textLabel'), placeholder: t('proof.placeholder'),
      oninput: debounce((e) => { this.#focus = null; this.#set({ text: e.target.value }); }, 80),
    });
    this.input.value = this.state.text;
    this.sizeLabel = h('span.size-label');
    this.size = h('input.size-range', {
      type: 'range', min: '16', max: '280', step: '2', value: String(this.state.size), 'aria-label': t('proof.size'),
      oninput: (e) => this.#set({ size: +e.target.value }),
    });
    this.features = h('div.feature-chips', { role: 'group', 'aria-label': t('proof.features') });
    this.spacing = h('div.spacing-bar');
    this.output = h('div.proof-output', { 'aria-label': t('proof.outputLabel') });
    this.compiled = h('div.proof-compiled', { hidden: true });
    this.steps = h('div.proof-steps', { hidden: true });
    this.footer = h('div.proof-footer');
    const toggle = (id, label) => h('label.check', h('input', { type: 'checkbox', checked: !!this.state[id], 'data-toggle': id, onchange: (e) => this.#set({ [id]: e.target.checked }) }), label);
    this.element.append(
      h('div.view-toolbar.proof-toolbar',
        h('label.proof-size', t('proof.size'), this.size, this.sizeLabel),
        toggle('compiled', t('proof.compiled')),
        toggle('steps', t('proof.steps')),
        h('span.toolbar-spacer'),
        h('div.sample-buttons', SAMPLES.map((id) => h('button.btn.btn-ghost.btn-sm', {
          onclick: () => { const text = SAMPLE_TEXT[id] || t('proof.sample.pangram'); this.input.value = text; this.#focus = null; this.#set({ text }); },
        }, t('proof.samples.' + id))),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'specimen', title: t('proof.specimenTitle'), onclick: () => this.#specimen() }, h('span', { html: icon('export', 14) }), t('proof.specimen')))),
      h('div.proof-features', h('span.muted.small', t('proof.features')), this.features),
      this.input,
      this.spacing,
      h('div.proof-scroll', this.output, this.compiled, this.steps),
      this.footer);

    new ResizeObserver(debounce(() => { if (this.visible) this.render(); }, 60)).observe(this.output);
    this.fonts.onDidChangeFont(() => { this.#focus = null; this.#dropFace(); this.invalidate(); });
    this.fonts.onDidEdit(() => { this.#dropFace(); this.invalidate(); });
    this.fonts.onDidChangeSelection(() => this.#markSelection());
  }

  #set(patch) {
    Object.assign(this.state, patch);
    try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch { /* storage unavailable */ }
    this.render();
  }

  #featureOn(tag) { return tag in this.state.features ? !!this.state.features[tag] : DEFAULT_ON.has(tag); }

  render() {
    const { fonts, state } = this;
    if (!fonts.hasFont) return;
    this.sizeLabel.textContent = `${state.size} px`;
    const plan = fonts.plan;
    const tags = layoutFeatures(plan);
    setChildren(this.features, tags.length ? tags.map((tag) => h('button.chip.feature-chip', {
      'aria-pressed': String(this.#featureOn(tag)), class: `chip feature-chip${this.#featureOn(tag) ? ' active' : ''}`, 'data-feature': tag,
      title: t('proof.featureTitle', { tag }),
      onclick: () => this.#set({ features: { ...state.features, [tag]: !this.#featureOn(tag) } }),
    }, tag)) : h('span.muted.small', t('proof.noFeatures')));

    const upm = fonts.unitsPerEm;
    const scale = state.size / upm;
    const m = fonts.metrics;
    const top = Math.max(m.ascender, m.capHeight || 0) + upm * 0.08;
    const lineHeight = top - m.descender + upm * 0.08;
    const maxWidth = Math.max(200, this.output.clientWidth - 8) / scale;
    const missing = new Set();
    const steps = [];
    let pairs = 0;

    // each typed line is shaped whole, then broken at spaces to the available width
    const lines = [];
    const features = Object.fromEntries(tags.map((tag) => [tag, this.#featureOn(tag)]));
    for (const raw of state.text.split('\n')) {
      const run = shape(fonts.font, plan, raw, { features, cmap: (code) => fonts.glyphForChar(code) });
      run.missing.forEach((c) => missing.add(c));
      steps.push(...run.steps);
      pairs += run.steps.filter((st) => st.feature === 'kern').length;
      let line = { glyphs: [], origin: 0 }; let lastSpace = -1;
      const chars = [...raw];
      for (const g of run.glyphs) {
        if (g.advance && g.x + g.advance - line.origin > maxWidth && lastSpace >= 0) {
          const rest = line.glyphs.splice(lastSpace + 1);
          lines.push(line);
          line = { glyphs: rest, origin: rest.length ? rest[0].x : g.x };
          lastSpace = -1;
        }
        line.glyphs.push(g);
        if (chars[g.cluster] === ' ') lastSpace = line.glyphs.length - 1;
      }
      lines.push(line);
    }

    setChildren(this.output, lines.map(({ glyphs: line, origin }, li) => {
      const last = [...line].reverse().find((g) => g.advance) || line[line.length - 1];
      const width = last ? last.x + last.advance - origin : upm * 0.3;
      return s('svg', { class: 'proof-line', width: Math.ceil(Math.max(1, width) * scale), height: Math.ceil(lineHeight * scale), viewBox: `0 0 ${Math.max(1, width)} ${lineHeight}` },
        line.map((item, gi) => {
          const d = fonts.shape(item.name).d;
          const prev = [...line.slice(0, gi)].reverse().find((g) => g.advance);
          // every glyph gets a transparent box over its advance, so it can be clicked even when it is empty
          return s('g', {
            class: 'proof-glyph', 'data-name': item.name, 'data-pos': `${li}:${gi}`, transform: `translate(${item.x - origin} ${top - item.y}) scale(1 -1)`,
            onclick: () => { this.#focus = { pos: `${li}:${gi}`, name: item.name, prev: prev ? prev.name : null }; fonts.select(item.name); this.#renderSpacing(); this.#markSelection(); },
            ondblclick: () => { fonts.select(item.name); this.layout.openView('glyph'); },
          },
          s('rect', { x: 0, y: m.descender, width: Math.max(item.advance, upm * 0.05), height: top - m.descender, class: 'proof-box' }),
          d ? s('path', { d }) : null,
          s('title', null, item.kern ? `${item.name} · ${t('proof.kernValue', { value: formatUnits(item.kern) })}` : item.name));
        }));
    }));
    this.#markSelection();
    this.#renderSpacing();

    this.steps.hidden = !state.steps;
    if (state.steps) {
      const describe = (st) => (st.type === 'pair' ? `${st.from.join(' ')}  ${st.value > 0 ? '+' : ''}${st.value}` : st.type === 'attach' ? `${st.from[0]} → ${st.to}` : `${st.from.join(' ')} → ${st.to}`);
      setChildren(this.steps, h('h3', t('proof.steps')), steps.length
        ? h('ol.step-list', steps.slice(0, 400).map((st) => h('li', h('span.step-tag', st.feature), h('span.step-text', describe(st)))))
        : h('p.muted', t('proof.noSteps')));
    }

    this.compiled.hidden = !state.compiled;
    if (state.compiled) this.#renderCompiled(tags);

    setChildren(this.footer,
      h('span', this.#featureOn('kern') ? tn('proof.pairsApplied', pairs) : t('proof.kerningOff')),
      missing.size
        ? h('span.warn', tn('proof.missing', missing.size, { list: [...missing].slice(0, 12).map((c) => `${String.fromCodePoint(c)} ${formatUnicode(c)}`).join(', ') }))
        : null,
      h('span.muted', t('proof.hint')));
  }

  // ---- spacing and kerning of the glyph that was clicked
  #renderSpacing() {
    const { fonts } = this;
    const f = this.#focus;
    const glyph = f ? fonts.glyph(f.name) : null;
    if (!glyph) { setChildren(this.spacing, h('span.muted.small', t('proof.spacing.hint'))); return; }
    const b = fonts.shape(glyph.name).bounds;
    const num = (id, label, value, apply, disabled = false) => h('label.num-field', h('span', label),
      h('input.input.input-sm', { type: 'number', step: '1', value: value === null ? '' : String(value), disabled, 'data-field': id, onchange: (e) => { if (e.target.value !== '') apply(Number(e.target.value)); } }));
    const edit = (fn) => fonts.edit(t('undo.metrics'), { glyphs: [glyph.name] }, (font) => fn(font.glyphs[glyph.name], font));
    const parts = [
      h('span.spacing-name', glyph.name),
      num('lsb', t('glyph.lsb'), b ? Math.round(b.xMin) : null, (v) => edit((g, font) => model.setLeftMargin(font, g, v)), !b),
      num('rsb', t('glyph.rsb'), b ? Math.round(glyph.width - b.xMax) : null, (v) => edit((g, font) => model.setRightMargin(font, g, v)), !b),
      num('width', t('glyph.width'), glyph.width, (v) => edit((g) => { g.width = Math.max(0, Math.round(v)); })),
    ];
    if (f.prev && fonts.glyph(f.prev)) {
      // the pair that is edited: the one that applies now, or a new one between the groups (or glyphs)
      const font = fonts.font;
      const gl = model.kerningGroupOf(font, f.prev, 1); const gr = model.kerningGroupOf(font, glyph.name, 2);
      const has = (l, r) => l && r && font.kerning[l] && typeof font.kerning[l][r] === 'number';
      const pair = [[f.prev, glyph.name], [f.prev, gr], [gl, glyph.name], [gl, gr]].find(([l, r]) => has(l, r)) || [gl || f.prev, gr || glyph.name];
      const show = (side) => side.replace(/^public\.kern[12]\./, '@');
      parts.push(h('span.toolbar-sep'),
        h('span.spacing-name', { title: t('proof.spacing.pairTitle') }, `${show(pair[0])} · ${show(pair[1])}`),
        num('kern', t('proof.spacing.kerning'), fonts.kern(f.prev, glyph.name), (v) => fonts.edit(t('undo.kerning'), { sections: ['kerning'] }, (fnt) => model.setKerning(fnt, pair[0], pair[1], v))));
    }
    setChildren(this.spacing, parts);
  }

  // ---- the same text through the system's text engine, with the font as it would be exported
  #dropFace() {
    if (this.#face) { try { document.fonts.delete(this.#face); } catch { /* already gone */ } }
    this.#face = null;
  }

  async #renderCompiled(tags) {
    const { fonts, state } = this;
    try {
      if (!this.#face) {
        const { bytes } = fonts.compile();
        const face = new FontFace(`LionFoundryProof${++faceCount}`, bytes);
        await face.load();
        document.fonts.add(face);
        this.#face = face;
      }
      const settings = tags.map((tag) => `"${tag}" ${this.#featureOn(tag) ? 1 : 0}`).join(', ');
      setChildren(this.compiled,
        h('h3', t('proof.compiled')),
        h('div.compiled-text', { style: { fontFamily: `"${this.#face.family}"`, fontSize: `${state.size}px`, fontFeatureSettings: settings || 'normal', fontKerning: this.#featureOn('kern') ? 'normal' : 'none' } }, state.text),
        h('p.muted.small', t('proof.compiledNote')));
      this.compiled.dataset.ready = 'true';
    } catch (err) {
      setChildren(this.compiled, h('h3', t('proof.compiled')), h('p.warn', t('export.error', { detail: String(err && err.message) })));
      this.compiled.dataset.ready = 'error';
    }
  }

  // ---- a printable specimen, saved as PDF
  async #specimen() {
    const { fonts } = this;
    const upm = fonts.unitsPerEm;
    const m = fonts.metrics;
    const top = Math.max(m.ascender, m.capHeight || 0) + upm * 0.05;
    const lineHeight = top - m.descender + upm * 0.05;
    const set = (text, size) => {
      const run = shape(fonts.font, fonts.plan, text, { cmap: (code) => fonts.glyphForChar(code) });
      const width = Math.max(1, run.width);
      return s('svg', { class: 'specimen-line', height: `${size}pt`, viewBox: `0 0 ${width} ${lineHeight}`, style: `max-width: 100%; height: ${size * lineHeight / upm}pt` },
        run.glyphs.map((g) => { const d = fonts.shape(g.name).d; return d ? s('path', { d, transform: `translate(${g.x} ${top - g.y}) scale(1 -1)` }) : null; }));
    };
    const info = fonts.font.info;
    const sheet = h('div.print-sheet',
      h('header', h('div.specimen-family', set(`${fonts.familyName}`, 54)), h('p', `${fonts.familyName} ${fonts.styleName} · ${tn('common.glyphs', fonts.font.glyphOrder.length)} · ${info.copyright || ''}`)),
      h('section', set('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 26), set('abcdefghijklmnopqrstuvwxyz', 26), set('0123456789 .,:;!?()-', 26)),
      h('section', [48, 32, 22, 15, 11].map((size) => h('div.specimen-row', h('span.specimen-size', `${size} pt`), set(t('proof.sample.pangram'), size)))),
      h('section', this.state.text.split('\n').filter(Boolean).slice(0, 12).map((line) => set(line, 20))),
      h('footer', t('proof.specimenFooter', { app: t('app.name') })));
    document.body.append(sheet);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { await fonts.exportPdf(`${fonts.familyName} ${fonts.styleName} specimen`.trim()); } finally { sheet.remove(); }
  }

  #markSelection() {
    const selected = this.fonts.selected;
    const pos = this.#focus ? this.#focus.pos : null;
    for (const g of this.output.querySelectorAll('.proof-glyph')) {
      g.classList.toggle('selected', g.dataset.name === selected);
      g.classList.toggle('focused', g.dataset.pos === pos);
    }
  }
}
