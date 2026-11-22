/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Font info" view: names and metrics (editable), the colour palette, what the project contains, kerning
// groups and pairs, and the problems found while reading the project.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { PALETTE_KEY } from '../../../base/common/ttfWriter.js';
import { formatNumber, formatUnits } from '../../../base/common/format.js';
import { ViewPane } from '../../browser/viewPane.js';
import { t, tn } from '../../../base/common/nls.js';

const NAMES = ['familyName', 'styleName', 'versionMajor', 'versionMinor', 'openTypeNameDesigner', 'openTypeNameDesignerURL', 'openTypeNameManufacturer', 'copyright', 'trademark',
  'openTypeNameLicense', 'openTypeNameLicenseURL', 'openTypeNameDescription', 'postscriptFontName', 'note'];
const METRICS = ['unitsPerEm', 'ascender', 'capHeight', 'xHeight', 'descender', 'italicAngle',
  'openTypeOS2TypoAscender', 'openTypeOS2TypoDescender', 'openTypeOS2TypoLineGap',
  'openTypeHheaAscender', 'openTypeHheaDescender', 'openTypeHheaLineGap', 'openTypeOS2WinAscent', 'openTypeOS2WinDescent'];
const MAX_PAIRS = 300;

export class InfoView extends ViewPane {
  constructor(services) {
    super(services, 'info');
    this.body = h('div.info-body');
    this.element.append(this.body);
    this.fonts.onDidChangeFont(() => this.invalidate());
    this.fonts.onDidEdit(() => { if (!this.body.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') this.invalidate(); });
  }

  #setInfo(field, value) {
    this.fonts.edit(t('undo.info'), { sections: ['info'] }, (font) => { if (value === '' || value === null) delete font.info[field]; else font.info[field] = value; });
  }

  #setPalette(fn) {
    this.fonts.edit(t('undo.color'), { sections: ['lib'] }, (font) => {
      const palette = [...(font.lib[PALETTE_KEY] || [])];
      fn(palette);
      if (palette.length) font.lib[PALETTE_KEY] = palette; else delete font.lib[PALETTE_KEY];
    });
  }

  render() {
    const font = this.fonts.font;
    if (!font) { setChildren(this.body); return; }
    const info = font.info;
    const NUMERIC = new Set([...METRICS, 'versionMajor', 'versionMinor']);
    // every field is shown, filled in or not, so that it can be filled in
    const rows = (fields) => fields.map((f) => [h('dt', h('label', { for: `info-${f}` }, t('info.field.' + f))),
      h('dd', h('input.input.input-sm.info-input', {
        id: `info-${f}`, type: NUMERIC.has(f) ? 'number' : 'text', step: f === 'italicAngle' ? 'any' : '1', spellcheck: 'false', 'data-field': f,
        value: info[f] === undefined || info[f] === null ? '' : String(info[f]),
        onchange: (e) => this.#setInfo(f, NUMERIC.has(f) ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value),
      }))]);
    const palette = font.lib[PALETTE_KEY] || [];

    let contours = 0; let points = 0; let composites = 0; let encoded = 0; let anchors = 0;
    for (const g of Object.values(font.glyphs)) {
      contours += g.contours.length;
      for (const c of g.contours) points += c.length;
      if (g.components.length) composites++;
      if (g.unicodes.length) encoded++;
      anchors += g.anchors.length;
    }
    const pairs = [];
    for (const [left, rights] of Object.entries(font.kerning)) for (const [right, value] of Object.entries(rights)) pairs.push([left, right, value]);
    const groups = Object.entries(font.groups);
    const side = (name) => name.replace(/^public\.kern[12]\./, '@');

    setChildren(this.body,
      section(t('info.names'), h('dl.info-list', rows(NAMES))),
      section(t('info.metrics'), h('p.muted.small', t('info.metricsLead')), h('dl.info-list.info-numbers', rows(METRICS))),
      section(t('info.palette'), h('p.muted.small', t('info.paletteLead')),
        h('div.palette', palette.map((color, i) => h('span.palette-item',
          h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000', 'aria-label': t('info.paletteColor', { n: i + 1 }), 'data-color': String(i), onchange: (e) => this.#setPalette((p) => { p[i] = e.target.value; }) }),
          h('button.icon-button', { title: t('common.delete'), html: icon('close', 12), onclick: () => this.#setPalette((p) => { p.splice(i, 1); }) }))),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'addColor', onclick: () => this.#setPalette((p) => { p.push(['#cf874b', '#7b6f9f', '#cdc2c2', '#394042'][p.length % 4]); }) }, h('span', { html: icon('plus', 14) }), t('info.addColor')))),
      section(t('info.contents'), h('dl.info-list.info-numbers',
        h('dt', t('info.format')), h('dd', font.format.toUpperCase().replace(/(\d)/, ' $1')),
        h('dt', t('info.glyphCount')), h('dd', formatNumber(font.glyphOrder.length)),
        h('dt', t('info.encoded')), h('dd', formatNumber(encoded)),
        h('dt', t('info.composites')), h('dd', formatNumber(composites)),
        h('dt', t('info.contours')), h('dd', formatNumber(contours)),
        h('dt', t('info.points')), h('dd', formatNumber(points)),
        h('dt', t('info.anchors')), h('dd', formatNumber(anchors)),
        h('dt', t('info.layers')), h('dd', font.layers.join(', ')))),
      font.warnings.length
        ? section(`${t('info.warnings')} · ${formatNumber(font.warnings.length)}`, h('ul.warning-list',
          font.warnings.slice(0, 100).map((w) => h('li', t('warning.' + w.code, { glyph: w.glyph || '', detail: w.detail || '' })))))
        : null);
  }
}

function section(title, ...body) {
  return h('section.info-section', h('h2', title), body);
}
