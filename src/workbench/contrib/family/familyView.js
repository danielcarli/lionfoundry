/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Family" view: the weights of the typeface, all kept in this one project.
//   • add a weight (it starts as a copy of the one being worked on), or bring one in from another project;
//   • choose which weight every view shows and edits;
//   • see any weight in between with the slider, and which glyphs cannot be interpolated and why;
//   • add an italic (it starts as the weight being worked on, slanted) — uprights and italics are two groups;
//   • list the styles that are calculated between weights ("instances") and see the whole family set in a text;
//   • export the whole family in one go, a weight in between as a font, or a .designspace for other tools.
// Names, metrics, kerning groups, features and the list of glyphs are shared; each weight has its own
// drawing, widths, anchors and kerning values. One axis (weight) in this version.
import { h, s, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { compatibilityReport, instanceAt, FAMILY_KEY } from '../../../base/common/interpolate.js';
import { weightMasters, familyStyles, isItalic, activeWeight } from '../../../base/common/weights.js';
import { glyphCommands, commandsToSvg, createKerner } from '../../../base/common/glyphPath.js';
import { ViewPane, titled } from '../../browser/viewPane.js';
import { formDialog, codeDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

/** Usual names for positions on the weight axis. */
const NAMES = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];

export class FamilyView extends ViewPane {
  #location = null;
  #text = 'Hamburgefonstiv';

  constructor(services) {
    super(services, 'family');
    this.masters = h('div.family-masters');
    this.preview = h('div.family-preview');
    this.report = h('div.family-report');
    this.styles = h('div.family-styles');
    this.element.append(h('div.family-body',
      titled('family.masters', t('family.weights'), t('family.lead')), this.masters,
      h('h2', t('family.preview')), this.preview,
      titled('family.styles', t('family.styles'), t('family.stylesLead')), this.styles,
      h('h2', t('family.compatibility')), this.report));
    this.fonts.onDidChangeFont(() => { this.#location = null; this.invalidate(); });
    this.fonts.onDidEdit(() => this.invalidate());
  }

  render() {
    const { fonts } = this;
    if (!fonts.hasFont) return;
    const list = fonts.weights;
    const many = fonts.hasWeights;
    const legacy = fonts.font.lib[FAMILY_KEY];

    setChildren(this.masters,
      h('table.data-table.weight-table',
        h('thead', h('tr', h('th', t('family.weight')), h('th', t('family.position')), h('th'), h('th'))),
        h('tbody', list.map((w) => h('tr', { class: w.active ? 'current' : '', 'data-weight': w.id || '' },
          h('td', many
            ? h('input.input.input-sm', { type: 'text', value: w.name, spellcheck: 'false', 'aria-label': t('family.weight'), onchange: (e) => fonts.updateWeight(w.id, { name: e.target.value }) })
            : h('strong', w.name),
            w.italic ? h('span.tag.tag-italic', t('family.italic')) : null),
          h('td', many
            ? h('input.input.input-sm', { type: 'number', step: 'any', value: String(w.location), 'aria-label': t('family.position'), onchange: (e) => { if (e.target.value !== '') fonts.updateWeight(w.id, { location: Number(e.target.value) }); } })
            : h('span.mono', String(w.location)),
            w.italic ? h('input.input.input-sm.angle-input', { type: 'number', step: 'any', min: '0', max: '45', value: String(Math.abs(w.angle ?? 10)), title: t('family.angle'), 'aria-label': t('family.angle'), 'data-field': 'angle',
              onchange: (e) => { if (e.target.value !== '') fonts.updateWeight(w.id, { angle: Number(e.target.value) }); } }) : null),
          h('td', w.active ? h('span.tag', t('family.editing')) : null),
          h('td', many && !w.active ? h('button.icon-button', { title: t('family.removeWeight'), 'data-action': 'removeWeight', html: icon('close', 13), onclick: () => this.#remove(w) }) : null))))),
      h('div.btn-wrap',
        h('button.btn.btn-primary.btn-sm', { 'data-action': 'addWeight', onclick: () => this.#add() }, h('span', { html: icon('plus', 14) }), t('family.addWeight')),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'addItalic', onclick: () => this.#addItalic() }, h('span', { html: icon('plus', 14) }), t('family.addItalic')),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'importWeight', onclick: () => this.#import() }, h('span', { html: icon('import', 14) }), t('family.importWeight'))),
      legacy ? h('p.muted.small', t('family.legacy'), ' ',
        h('button.link', { onclick: () => fonts.edit(t('undo.weight'), { sections: ['lib'] }, (font) => { delete font.lib[FAMILY_KEY]; }) }, t('family.legacyDismiss'))) : null);

    this.#renderStyles();
    const masters = weightMasters(fonts.font);
    const italics = many && fonts.font.weights.some(isItalic);
    const group = italics ? h('p.muted.small', t(isItalic(activeWeight(fonts.font)) ? 'family.groupItalic' : 'family.groupUpright')) : null;
    if (masters.length < 2) {
      setChildren(this.preview, group, h('p.muted', t('family.needWeight')));
      setChildren(this.report);
      return;
    }
    const locations = masters.map((m) => m.location);
    const min = Math.min(...locations); const max = Math.max(...locations);
    if (min === max) {
      setChildren(this.preview, h('p.warn', t('family.samePosition')));
      setChildren(this.report);
      return;
    }
    if (this.#location === null || this.#location < min || this.#location > max) this.#location = Math.round((min + max) / 2);
    const value = h('span.size-label');
    const stage = h('div.family-stage');
    const draw = () => {
      value.textContent = String(this.#location);
      const { font, skipped } = instanceAt(masters, this.#location);
      addInstance.disabled = masters.some((m) => m.location === this.#location);
      stage.dataset.skipped = String(skipped.length);
      setChildren(stage, this.#setText(font, this.#text), skipped.length ? h('p.muted.small', tn('family.skipped', skipped.length)) : null);
    };
    const addInstance = h('button.btn.btn-secondary.btn-sm', { 'data-action': 'addInstance', onclick: () => this.#addInstance() }, h('span', { html: icon('plus', 14) }), t('family.addInstance'));
    setChildren(this.preview,
      group,
      h('div.family-controls',
        h('input.input', { type: 'text', value: this.#text, spellcheck: 'false', 'aria-label': t('proof.textLabel'), oninput: debounce((e) => { this.#text = e.target.value; draw(); }, 80) }),
        h('label.proof-size', t('family.axis'), h('input.size-range', { type: 'range', min: String(min), max: String(max), step: '1', value: String(this.#location), 'data-field': 'slider', oninput: (e) => { this.#location = Number(e.target.value); draw(); } }), value)),
      stage,
      h('div.btn-wrap',
        addInstance));
    draw();

    // compatibility of the weight being worked on with each of the others
    const active = masters.find((m) => m.id === fonts.font.weight);
    const reports = masters.filter((m) => m !== active).map((m) => ({ master: m, problems: compatibilityReport(active.font, m.font) }));
    // the glyphs themselves are listed once, in Check; each is fixed in its own glyph view
    setChildren(this.report,
      reports.map(({ master, problems }) => h('h3', { 'data-report': master.id }, `${active.name} ↔ ${master.name} · `, problems.length ? tn('family.incompatible', problems.length) : t('family.compatible'))),
      reports.some((r) => r.problems.length) ? h('p.muted.small', t('family.seeCheck'), ' ', h('button.link', { 'data-action': 'seeCheck', onclick: () => this.layout.openView('check') }, t('views.check'))) : null);
  }

  /** Every style of the family — drawn or calculated — set in the same text, and the export of them all. */
  #renderStyles() {
    const { fonts } = this;
    const styles = familyStyles(fonts.font);
    const listed = fonts.instances;
    const missing = listed.filter((i) => !styles.some((x) => x.kind === 'instance' && x.name === i.name && x.italic === i.italic));
    setChildren(this.styles,
      h('div.style-list', styles.map((style) => h('div.style-row', { 'data-style': style.name, 'data-kind': style.kind },
        h('div.style-label',
          h('strong', style.name), h('span.mono.muted', ` ${style.location}`),
          h('span.tag', t(style.kind === 'weight' ? 'family.drawn' : 'family.calculated')),
          style.skipped.length ? h('span.warn.small', tn('family.skippedShort', style.skipped.length)) : null,
          style.kind === 'instance' ? h('button.icon-button', { title: t('family.removeInstance'), 'data-action': 'removeInstance', html: icon('close', 12),
            onclick: () => fonts.setInstances(listed.filter((i) => !(i.name === style.name && i.italic === style.italic))) }) : null),
        this.#setText(style.font, this.#text, 56)))),
      missing.length ? h('p.muted.small', t('family.instancesWaiting', { names: missing.map((i) => i.name).join(', ') })) : null);
  }

  /** Lists the position of the slider as a style of the family (calculated, not drawn). */
  async #addInstance() {
    const { fonts } = this;
    const location = this.#location;
    const italic = isItalic(activeWeight(fonts.font));
    const nearest = NAMES.find(([v]) => v === location);
    const base = nearest ? nearest[1] : `${t('family.axis')} ${location}`;
    const res = await formDialog({
      title: t('family.dialog.instance.title'), message: t('family.dialog.instance.message', { position: location }), confirmLabel: t('common.add'),
      fields: [{ id: 'name', label: t('family.styleName'), value: italic ? (base === 'Regular' ? 'Italic' : `${base} Italic`) : base }],
      validate: (v) => (!v.name.trim() ? t('family.dialog.instance.noName') : familyStyles(fonts.font).some((x) => x.name.toLowerCase() === v.name.trim().toLowerCase()) ? t('family.dialog.instance.taken') : null),
    });
    if (res) fonts.setInstances([...fonts.instances, { name: res.name.trim(), location, italic }]);
  }

  async #addItalic() {
    const { fonts } = this;
    const from = fonts.styleName || 'Regular';
    const res = await formDialog({
      title: t('family.dialog.italic.title'), message: t('family.dialog.italic.message', { name: from }), confirmLabel: t('common.add'),
      fields: [
        { id: 'angle', label: t('family.angle'), type: 'number', value: 10, hint: t('family.angleHint') },
        { id: 'name', label: t('family.styleName'), value: /italic|oblique/i.test(from) ? `${from} 2` : from.toLowerCase() === 'regular' ? 'Italic' : `${from} Italic` },
      ],
      validate: (v) => (!(v.angle >= 0 && v.angle <= 45) ? t('family.badAngle') : !v.name.trim() ? t('family.dialog.instance.noName') : null),
    });
    if (!res) return;
    const id = fonts.addItalic(res.name.trim(), res.angle);
    if (id) { fonts.setWeight(id); this.notifications.info(t('family.added', { name: res.name.trim() }), 7000); }
  }

  /** A line of text set in any font model (a weight in between is not the open font, so it has no cache). */
  #setText(font, text, size = 120) {
    const upm = font.info.unitsPerEm || 1000;
    const cmap = new Map();
    for (const name of font.glyphOrder) for (const u of font.glyphs[name].unicodes) if (!cmap.has(u)) cmap.set(u, name);
    const kern = createKerner(font);
    const top = Math.max(font.info.ascender || upm * 0.8, font.info.capHeight || 0) + upm * 0.08;
    const height = top - (font.info.descender || -upm * 0.2) + upm * 0.08;
    let x = 0; let prev = null;
    const paths = [];
    for (const ch of text) {
      const name = cmap.get(ch.codePointAt(0)) || (font.glyphs['.notdef'] ? '.notdef' : null);
      if (!name) continue;
      if (prev) x += kern(prev, name);
      const d = commandsToSvg(glyphCommands(font, name));
      if (d) paths.push(s('path', { d, transform: `translate(${x} ${top}) scale(1 -1)` }));
      x += font.glyphs[name].width; prev = name;
    }
    return s('svg', { class: 'proof-line family-line', viewBox: `0 0 ${Math.max(1, x)} ${height}`, height: String(size), width: String(Math.ceil(Math.max(1, x) * size / height)) }, paths);
  }

  /** Name and position for a new weight; the name follows the position until it is typed. */
  async #ask(title, message) {
    const used = new Set(this.fonts.weights.map((w) => w.location));
    const suggestion = [700, 300, 900, 500, 100, 600, 800, 200, 400].find((v) => !used.has(v)) || 700;
    const res = await formDialog({
      title, message, confirmLabel: t('common.add'),
      fields: [
        { id: 'location', label: t('family.position'), type: 'number', value: suggestion, hint: t('family.positionHint') },
        { id: 'name', label: t('family.weight'), value: '', placeholder: (NAMES.find(([v]) => v === suggestion) || [0, ''])[1], hint: t('family.nameHint') },
      ],
      validate: (v) => (!(v.location >= 1 && v.location <= 1000) ? t('family.badPosition') : null),
    });
    if (!res) return null;
    const nearest = NAMES.reduce((a, b) => (Math.abs(b[0] - res.location) < Math.abs(a[0] - res.location) ? b : a));
    return { location: res.location, name: res.name.trim() || (nearest[0] === res.location ? nearest[1] : `${t('family.axis')} ${res.location}`) };
  }

  async #add() {
    const res = await this.#ask(t('family.dialog.add.title'), t('family.dialog.add.message', { name: this.fonts.styleName || 'Regular' }));
    if (!res) return;
    const id = this.fonts.addWeight(res.name, res.location);
    if (id) { this.fonts.setWeight(id); this.notifications.info(t('family.added', { name: res.name }), 7000); }
  }

  async #import() {
    const res = await this.#ask(t('family.dialog.import.title'), t('family.dialog.import.message'));
    if (res) await this.fonts.importWeight(res.name, res.location);
  }

  async #remove(weight) {
    const ok = await codeDialog({ title: t('family.dialog.remove.title', { name: weight.name }), message: t('family.dialog.remove.message') });
    if (ok) this.fonts.removeWeight(weight.id);
  }
}
