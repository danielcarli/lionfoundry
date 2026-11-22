/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Spacing" view: what kerning is made of.
//   • kerning groups — glyphs that kern alike on one side share a group, so one pair serves them all
//     (groups are shared by every weight of the project);
//   • the kerning pairs of the weight being worked on, as a list that can be searched and typed into.
// Pairs are also set by eye in the proof; this view is where they are organised.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { setKerning } from '../../../base/common/fontModel.js';
import { eachOtherWeight } from '../../../base/common/weights.js';
import { ViewPane, titled } from '../../browser/viewPane.js';
import { formDialog, codeDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

const prefixOf = (side) => `public.kern${side}.`;
const MAX_ROWS = 400;

export class SpacingView extends ViewPane {
  #filter = '';

  constructor(services) {
    super(services, 'spacing');
    this.groups = h('div.kern-groups');
    this.pairs = h('div.kern-pairs');
    this.element.append(h('div.family-body.spacing-body',
      titled('kerning.groups', t('spacing.groups'), t('spacing.groupsLead')), this.groups,
      titled('kerning.pairs', t('spacing.pairs'), t('spacing.pairsLead')), this.pairs));
    this.fonts.onDidChangeFont(() => { this.#filter = ''; this.invalidate(); });
    this.fonts.onDidEdit(() => this.invalidate());
  }

  render() {
    const { fonts } = this;
    const font = fonts.font;
    if (!font) return;

    setChildren(this.groups, [1, 2].map((side) => {
      const names = Object.keys(font.groups).filter((g) => g.startsWith(prefixOf(side))).sort();
      return h('div.kern-side', { 'data-side': String(side) },
        h('h3', t('spacing.side' + side)), h('p.muted.small', t('spacing.sideHint' + side)),
        names.length ? names.map((g) => this.#groupRow(g, side)) : h('p.muted.small', t('spacing.noGroups')),
        h('div.btn-wrap', h('button.btn.btn-secondary.btn-sm', { 'data-action': 'newGroup' + side, onclick: () => this.#newGroup(side) }, h('span', { html: icon('plus', 14) }), t('spacing.newGroup'))));
    }));

    const label = (name, side) => (name.startsWith(prefixOf(side))
      ? h('span.kern-name.kern-group', { title: (font.groups[name] || []).join(' ') }, `@${name.slice(prefixOf(side).length)}`)
      : h('span.kern-name', name));
    const all = [];
    for (const left of Object.keys(font.kerning)) for (const right of Object.keys(font.kerning[left])) all.push([left, right, font.kerning[left][right]]);
    all.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const needle = this.#filter.trim().toLowerCase();
    const shown = needle ? all.filter(([l, r]) => `${l} ${r}`.toLowerCase().includes(needle) || (font.groups[l] || []).includes(this.#filter.trim()) || (font.groups[r] || []).includes(this.#filter.trim())) : all;
    setChildren(this.pairs,
      h('div.family-controls',
        h('input.input', { type: 'search', value: this.#filter, placeholder: t('spacing.filter'), spellcheck: 'false', 'aria-label': t('spacing.filter'), 'data-field': 'pairFilter',
          onchange: (e) => { this.#filter = e.target.value; this.render(); } }),
        h('span.muted.small', `${fonts.hasWeights ? `${fonts.styleName} · ` : ''}${tn('spacing.pairCount', all.length)}`),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'newPair', onclick: () => this.#newPair() }, h('span', { html: icon('plus', 14) }), t('spacing.newPair'))),
      shown.length ? h('table.data-table.pair-table',
        h('thead', h('tr', h('th', t('spacing.first')), h('th', t('spacing.second')), h('th', t('spacing.value')), h('th'))),
        h('tbody', shown.slice(0, MAX_ROWS).map(([l, r, v]) => h('tr', { 'data-pair': `${l} ${r}` },
          h('td', label(l, 1)), h('td', label(r, 2)),
          h('td', h('input.input.input-sm', { type: 'number', step: '1', value: String(v), 'aria-label': t('spacing.value'),
            onchange: (e) => this.#setPair(l, r, Number(e.target.value) || 0) })),
          h('td', h('button.icon-button', { title: t('spacing.removePair'), html: icon('close', 12), onclick: () => this.#setPair(l, r, 0) }))))))
        : h('p.muted', t(all.length ? 'spacing.noMatch' : 'spacing.noPairs')),
      shown.length > MAX_ROWS ? h('p.muted.small', tn('check.more', shown.length - MAX_ROWS)) : null);
  }

  #groupRow(group, side) {
    const { fonts } = this;
    const members = fonts.font.groups[group] || [];
    return h('div.kern-group-row', { 'data-group': group },
      h('div.kern-group-head',
        h('strong', `@${group.slice(prefixOf(side).length)}`), h('span.muted.small', tn('common.glyphs', members.length)),
        h('button.icon-button', { title: t('spacing.removeGroup'), 'data-action': 'removeGroup', html: icon('trash', 13), onclick: () => this.#removeGroup(group) })),
      h('div.chip-list',
        members.map((name) => h('button.chip', { title: t('spacing.removeMember', { name }), 'data-member': name,
          onclick: () => fonts.edit(t('undo.groups'), { sections: ['groups'] }, (font) => { font.groups[group] = font.groups[group].filter((n) => n !== name); }) },
        name, h('span.muted', ' ×'))),
        h('input.input.input-sm.kern-add', { type: 'text', placeholder: t('spacing.addMembers'), spellcheck: 'false', 'aria-label': t('spacing.addMembers'),
          onchange: (e) => { this.#addMembers(group, side, e.target.value); } })));
  }

  /** Glyph names, or characters, typed with spaces between them. */
  #parse(text) {
    const { fonts } = this;
    const names = []; const unknown = [];
    for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
      if (fonts.glyph(token)) { names.push(token); continue; }
      for (const ch of token) { const name = fonts.glyphForChar(ch.codePointAt(0)); if (name) names.push(name); else unknown.push(ch); }
    }
    return { names: [...new Set(names)], unknown };
  }

  #addMembers(group, side, text) {
    const { names, unknown } = this.#parse(text);
    if (unknown.length) this.notifications.warn(t('spacing.unknown', { list: unknown.join(' ') }), 7000);
    if (!names.length) { this.render(); return; }
    this.fonts.edit(t('undo.groups'), { sections: ['groups'] }, (font) => {
      // a glyph belongs to one group per side: joining one leaves the other
      for (const g of Object.keys(font.groups)) if (g.startsWith(prefixOf(side)) && g !== group) font.groups[g] = font.groups[g].filter((n) => !names.includes(n));
      font.groups[group] = [...new Set([...(font.groups[group] || []), ...names])];
    });
  }

  async #newGroup(side) {
    const { fonts } = this;
    const res = await formDialog({
      title: t('spacing.dialog.group.title'), message: t('spacing.sideHint' + side), confirmLabel: t('common.create'),
      fields: [
        { id: 'name', label: t('spacing.dialog.group.name'), value: '', hint: t('spacing.dialog.group.nameHint') },
        { id: 'members', label: t('spacing.dialog.group.members'), value: '', hint: t('spacing.dialog.group.membersHint') },
      ],
      validate: (v) => (!/^[A-Za-z0-9._-]+$/.test(v.name.trim()) ? t('spacing.dialog.group.badName') : fonts.font.groups[prefixOf(side) + v.name.trim()] ? t('spacing.dialog.group.taken') : null),
    });
    if (!res) return;
    const group = prefixOf(side) + res.name.trim();
    fonts.edit(t('undo.groups'), { sections: ['groups'] }, (font) => { font.groups[group] = []; });
    if (res.members.trim()) this.#addMembers(group, side, res.members);
  }

  async #removeGroup(group) {
    const ok = await codeDialog({ title: t('spacing.dialog.remove.title', { name: `@${group.replace(/^public\.kern[12]\./, '')}` }), message: t('spacing.dialog.remove.message') });
    if (!ok) return;
    const drop = (kerning) => {
      delete kerning[group];
      for (const left of Object.keys(kerning)) { delete kerning[left][group]; if (!Object.keys(kerning[left]).length) delete kerning[left]; }
    };
    this.fonts.edit(t('undo.groups'), { sections: ['groups', 'kerning', 'weights'] }, (font) => {
      delete font.groups[group];
      drop(font.kerning);
      eachOtherWeight(font, (w) => drop(w.kerning)); // its pairs go in every weight
    });
  }

  #setPair(left, right, value) {
    this.fonts.edit(t('undo.kerning'), { sections: ['kerning'] }, (font) => setKerning(font, left, right, value));
  }

  /** One side of a pair as typed: a glyph name, a character, or @group. */
  #side(text, side) {
    const v = String(text).trim();
    if (v.startsWith('@')) { const g = prefixOf(side) + v.slice(1); return this.fonts.font.groups[g] ? g : null; }
    if (this.fonts.glyph(v)) return v;
    const chars = [...v];
    return chars.length === 1 ? this.fonts.glyphForChar(chars[0].codePointAt(0)) : null;
  }

  async #newPair() {
    const res = await formDialog({
      title: t('spacing.dialog.pair.title'), message: t('spacing.dialog.pair.message'), confirmLabel: t('common.add'),
      fields: [
        { id: 'left', label: t('spacing.first'), value: '' },
        { id: 'right', label: t('spacing.second'), value: '' },
        { id: 'value', label: t('spacing.value'), type: 'number', value: -40, hint: t('spacing.dialog.pair.valueHint') },
      ],
      validate: (v) => (!this.#side(v.left, 1) || !this.#side(v.right, 2) ? t('spacing.dialog.pair.unknown') : !v.value ? t('spacing.dialog.pair.zero') : null),
    });
    if (res) this.#setPair(this.#side(res.left, 1), this.#side(res.right, 2), res.value);
  }
}
