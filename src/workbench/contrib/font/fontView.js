/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Font" view: the grid of glyphs, and the actions on glyphs as a whole (new, duplicate, rename, delete,
// accented letters, transform many). Search by name, character or code point; the side bar filters by
// category. Thumbnails are drawn only when their cell scrolls into view, so large fonts stay fluid.
import { h, s, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { debounce } from '../../../base/common/event.js';
import { formatUnicode } from '../../../base/common/format.js';
import { ViewPane } from '../../browser/viewPane.js';
import { showMenu } from '../../browser/dialogs.js';
import * as actions from './glyphActions.js';
import { t, tn } from '../../../base/common/nls.js';

export class FontView extends ViewPane {
  #cells = new Map();
  #observer = null;

  constructor(services) {
    super(services, 'font');
    this.search = h('input.search-input', {
      type: 'search', placeholder: t('font.searchPlaceholder'), 'aria-label': t('font.searchPlaceholder'),
      oninput: debounce((e) => this.fonts.setFilter({ query: e.target.value }), 120),
    });
    this.count = h('span.view-count');
    this.grid = h('div.glyph-grid', { role: 'listbox', 'aria-label': t('views.font'), tabindex: '0', onkeydown: (e) => this.#onKey(e) });
    this.empty = h('p.view-empty', { hidden: true }, t('font.noMatch'));
    this.element.append(
      h('div.view-toolbar', h('label.search-box', h('span.search-icon', { html: icon('search', 14) }), this.search), this.count,
        h('span.toolbar-spacer'),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'newGlyph', onclick: () => actions.newGlyph(services) }, h('span', { html: icon('plus', 14) }), t('font.action.new')),
        h('button.btn.btn-secondary.btn-sm', {
          'data-action': 'glyphMenu',
          onclick: (e) => showMenu(e.currentTarget, [
            { label: t('font.action.duplicate'), icon: 'copy', run: () => actions.duplicateGlyph(services), disabled: !this.fonts.selected },
            { label: t('font.action.rename'), icon: 'rename', run: () => actions.renameGlyph(services), disabled: !this.fonts.selected },
            { label: t('font.action.delete'), icon: 'trash', run: () => actions.deleteGlyph(services), disabled: !this.fonts.selected },
            null,
            { label: t('font.action.accents'), icon: 'sparkle', run: () => actions.addGlyphs(services) },
            { label: t('font.action.transform'), icon: 'fit', run: () => actions.transformGlyphs(services) },
          ]),
        }, t('font.action.glyphs'), h('span', { html: icon('chevronDown', 12) }))),
      h('div.glyph-grid-wrap', this.grid, this.empty));

    this.fonts.onDidChangeFont(() => { this.search.value = ''; this.invalidate(); });
    this.fonts.onDidChangeFilter(() => this.invalidate());
    this.fonts.onDidEdit(() => this.invalidate());
    this.fonts.onDidChangeSelection(() => this.#markSelection(true));
  }

  render() {
    const { fonts } = this;
    this.#observer?.disconnect();
    this.#cells.clear();
    const names = fonts.visibleGlyphs();
    const total = fonts.font ? fonts.font.glyphOrder.length : 0;
    this.count.textContent = names.length === total ? tn('common.glyphs', total) : t('statusbar.filtered', { shown: names.length, total });
    this.empty.hidden = names.length > 0;
    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.#observer.unobserve(entry.target);
        this.#drawThumb(entry.target);
      }
    }, { root: this.grid.parentElement, rootMargin: '300px' });

    setChildren(this.grid, names.map((name) => {
      const glyph = fonts.glyph(name);
      const code = glyph.unicodes[0];
      const cell = h('button.glyph-cell', {
        role: 'option', 'data-name': name, tabindex: '-1',
        title: code !== undefined ? `${name} · ${formatUnicode(code)}` : name,
        onclick: () => fonts.select(name),
        ondblclick: () => { fonts.select(name); this.layout.openView('glyph'); },
      },
      h('span.glyph-thumb'),
      h('span.glyph-name', name),
      h('span.glyph-code', code !== undefined ? formatUnicode(code) : glyph.components.length ? t('font.composite') : '—'));
      this.#cells.set(name, cell);
      this.#observer.observe(cell);
      return cell;
    }));
    this.#markSelection(false);
  }

  /** Thumbnail: the glyph centred on its advance width, between ascender and descender. */
  #drawThumb(cell) {
    const { fonts } = this;
    const name = cell.dataset.name;
    const glyph = fonts.glyph(name);
    if (!glyph) return;
    const m = fonts.metrics;
    const margin = fonts.unitsPerEm * 0.12;
    const top = Math.max(m.ascender, m.capHeight || 0) + margin;
    const height = top - m.descender + margin;
    const width = Math.max(height, glyph.width + margin * 2);
    const shape = fonts.shape(name);
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' },
      shape.d
        ? s('path', { d: shape.d, transform: `translate(${(width - glyph.width) / 2} ${top}) scale(1 -1)` })
        : null);
    cell.firstChild.replaceChildren(svg);
    if (!shape.d) cell.classList.add('empty');
  }

  #markSelection(scroll) {
    const selected = this.fonts.selected;
    for (const [name, cell] of this.#cells) {
      const on = name === selected;
      cell.classList.toggle('selected', on);
      cell.setAttribute('aria-selected', String(on));
      if (on && scroll && this.visible) cell.scrollIntoView({ block: 'nearest' });
    }
  }

  #onKey(e) {
    const names = [...this.#cells.keys()];
    if (!names.length) return;
    const i = Math.max(0, names.indexOf(this.fonts.selected));
    // columns of the grid, measured from the first row
    const firstTop = this.#cells.get(names[0]).offsetTop;
    let cols = names.findIndex((n) => this.#cells.get(n).offsetTop !== firstTop);
    if (cols < 1) cols = names.length;
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      this.fonts.select(names[Math.min(names.length - 1, Math.max(0, i + move))]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.layout.openView('glyph');
    }
  }
}
