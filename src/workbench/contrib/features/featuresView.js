/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Features" view: what the font does with sequences of glyphs (OpenType features), at three depths.
//   1. Automatic — LionFoundry reads glyph names (f_i is a ligature, a.sc a small cap…), kerning and
//      anchors, and builds the features by itself. Nothing to write.
//   2. Rules — "replace this by that" lines added here, one at a time.
//   3. Code — the project's feature file, for those who write the Adobe feature syntax.
// The result of the three is listed on the right, exactly as it goes into the exported font.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { FEATURES_KEY, featureSettings, layoutFeatures, generateFeatureCode } from '../../../base/common/features.js';
import { ViewPane, titled } from '../../browser/viewPane.js';
import { formDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

const AUTO = ['kern', 'mark', 'liga', 'suffixes'];
/** Features that have a plain-language name in the interface. */
const KNOWN = new Set(['kern', 'mark', 'liga', 'dlig', 'rlig', 'smcp', 'c2sc', 'onum', 'lnum', 'tnum', 'pnum', 'sups', 'subs', 'sinf', 'numr', 'dnom', 'ordn', 'case', 'zero', 'salt', 'swsh', 'titl', 'hist', 'calt', 'locl', 'ccmp', 'ss']);

export class FeaturesView extends ViewPane {
  constructor(services) {
    super(services, 'features');
    this.auto = h('div.feature-auto');
    this.rules = h('div.feature-rules');
    this.code = h('textarea.code-editor', { spellcheck: 'false', 'aria-label': t('features.code'), oninput: debounce(() => this.#applyCode(), 500) });
    this.warnings = h('div.feature-warnings');
    this.result = h('div.feature-result');
    this.element.append(h('div.split-view',
      h('div.split-main',
        titled('features.auto', t('features.auto'), t('features.autoLead')), this.auto,
        titled('features.rules', t('features.rules'), t('features.rulesLead')), this.rules,
        titled('features.code', t('features.code'), t('features.codeLead')), this.code, this.warnings),
      h('aside.split-side', h('h2', t('features.result')), h('p.muted.small', t('features.resultLead')), this.result)));
    this.fonts.onDidChangeFont(() => this.invalidate());
    this.fonts.onDidEdit((e) => { if (e.label !== t('undo.featureCode') || document.activeElement !== this.code) this.invalidate(); else this.#renderResult(); });
  }

  #settings() { return featureSettings(this.fonts.font); }

  #update(label, fn) {
    this.fonts.edit(t('undo.' + label), { sections: ['lib'] }, (font) => {
      const s = featureSettings(font);
      fn(s);
      font.lib[FEATURES_KEY] = s;
    });
  }

  #applyCode() {
    const text = this.code.value;
    if (text === (this.fonts.font.features || '')) return;
    this.fonts.edit(t('undo.featureCode'), { sections: ['features'] }, (font) => { font.features = text; });
  }

  render() {
    const font = this.fonts.font;
    if (!font) return;
    const settings = this.#settings();
    setChildren(this.auto, AUTO.map((id) => h('label.check.feature-toggle',
      h('input', { type: 'checkbox', checked: !!settings.auto[id], 'data-auto': id, onchange: (e) => this.#update('features', (s) => { s.auto[id] = e.target.checked; }) }),
      h('span', h('strong', t(`features.auto.${id}`)), h('span.muted.small', ` — ${t(`features.auto.${id}.hint`)}`)))));

    setChildren(this.rules,
      settings.rules.length
        ? h('table.data-table', h('thead', h('tr', h('th', t('features.rule.feature')), h('th', t('features.rule.from')), h('th', t('features.rule.to')), h('th'))),
          h('tbody', settings.rules.map((r, i) => h('tr',
            h('td.mono', r.feature), h('td.mono', Array.isArray(r.from) ? r.from.join(' ') : r.from), h('td.mono', r.to),
            h('td', h('button.icon-button', { title: t('common.delete'), html: icon('close', 13), onclick: () => this.#update('features', (s) => { s.rules.splice(i, 1); }) }))))))
        : h('p.muted.small', t('features.noRules')),
      h('div.btn-wrap', h('button.btn.btn-secondary.btn-sm', { 'data-action': 'addRule', onclick: () => this.#addRule() }, h('span', { html: icon('plus', 14) }), t('features.addRule'))));

    if (document.activeElement !== this.code) this.code.value = font.features || '';
    this.#renderResult();
  }

  #renderResult() {
    const { fonts } = this;
    const plan = fonts.plan;
    setChildren(this.warnings, plan.warnings.length
      ? [h('p.warn', tn('features.warnings', plan.warnings.length)), h('ul.warning-list', plan.warnings.slice(0, 40).map((w) => h('li', h('span.mono', t('features.line', { line: w.line })), ' ', w.text)))]
      : null);
    const tags = layoutFeatures(plan);
    const count = (tag) => {
      if (tag === 'kern') { let n = 0; for (const row of plan.kerning.values()) n += row.size; return tn('features.count.pairs', n); }
      if (tag === 'mark') return tn('features.count.marks', Object.keys(plan.marks.marks).length);
      const f = plan.gsub.find((x) => x.tag === tag);
      return tn('features.count.rules', f.lookups.reduce((n, l) => n + (l.type === 'single' ? Object.keys(l.map).length : l.ligatures.length), 0));
    };
    const sample = (tag) => {
      const f = plan.gsub.find((x) => x.tag === tag);
      if (!f) return '';
      return f.lookups.flatMap((l) => (l.type === 'single' ? Object.entries(l.map).map(([a, b]) => `${a} → ${b}`) : l.ligatures.map((x) => `${x.from.join(' ')} → ${x.to}`))).slice(0, 6).join(' · ');
    };
    setChildren(this.result, tags.length
      ? h('div.feature-list', tags.map((tag) => h('div.feature-row', { 'data-feature': tag },
        h('span.feature-tag', tag), h('span.feature-name', KNOWN.has(tag.replace(/^ss\d\d$/, 'ss')) ? t(`features.name.${tag.replace(/^ss\d\d$/, 'ss')}`, { n: String(Number(tag.slice(2))) }) : ''), h('span.feature-count', count(tag)),
        sample(tag) ? h('span.feature-sample', sample(tag)) : null)))
      : h('p.muted', t('features.none')));
  }

  async #addRule() {
    const { fonts } = this;
    const res = await formDialog({
      title: t('features.addRule'), message: t('features.dialog.message'), confirmLabel: t('common.add'),
      fields: [
        { id: 'feature', label: t('features.rule.feature'), value: 'liga', hint: t('features.dialog.featureHint') },
        { id: 'from', label: t('features.rule.from'), value: '', hint: t('features.dialog.fromHint') },
        { id: 'to', label: t('features.rule.to'), value: '' },
      ],
      validate: (v) => {
        if (!/^[A-Za-z0-9]{4}$/.test(v.feature.trim())) return t('features.dialog.badTag');
        const from = v.from.trim().split(/\s+/).filter(Boolean);
        const unknown = [...from, v.to.trim()].find((g) => !fonts.glyph(g));
        if (!from.length || !v.to.trim()) return t('features.dialog.needGlyphs');
        return unknown !== undefined ? t('glyph.dialog.unknownGlyph', { name: unknown }) : null;
      },
    });
    if (!res) return;
    const from = res.from.trim().split(/\s+/).filter(Boolean);
    this.#update('features', (s) => { s.rules.push(from.length === 1 ? { feature: res.feature.trim(), type: 'single', from: from[0], to: res.to.trim() } : { feature: res.feature.trim(), type: 'ligature', from, to: res.to.trim() }); });
  }
}
