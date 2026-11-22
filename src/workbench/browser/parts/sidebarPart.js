/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Project" side bar: the open font, the glyph categories (they filter the glyph grid),
// the example typefaces and the projects opened before.
import { showExportDialog } from '../../contrib/export/exportDialog.js';
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { baseName, formatNumber } from '../../../base/common/format.js';
import { CATEGORIES } from '../../services/font/browser/fontService.js';
import { showMenu } from '../dialogs.js';
import { newProject } from '../../contrib/font/projectActions.js';
import { t, tn } from '../../../base/common/nls.js';

export class SidebarPart {
  constructor(services) {
    Object.assign(this, services);
    this.project = h('div.sidebar-project');
    this.categories = h('div.category-list', { role: 'listbox', 'aria-label': t('sidebar.glyphs') });
    this.examples = h('div.project-list');
    this.recent = h('div.project-list');
    this.recentSection = this.#section(t('sidebar.recent'), this.recent);

    this.element = h('aside.part.sidebar',
      h('div.sidebar-header', h('span', t('sidebar.title'))),
      this.#section(t('sidebar.font'), this.project),
      this.#section(t('sidebar.glyphs'), this.categories, { grow: true }),
      this.#section(t('sidebar.examples'), this.examples),
      this.recentSection,
      this.#sash());

    this.fonts.onDidChangeFont(() => this.render());
    this.fonts.onDidEdit((e) => { this.#renderProject(); if (!e.glyphs || e.glyphs.length || e.sections.includes('glyphOrder')) this.#renderCategories(); });
    this.fonts.onDidChangeState(() => this.#renderProject());
    this.fonts.onDidChangeFilter(() => this.#renderCategories());
    this.fonts.onDidChangeLists(() => this.#renderLists());
    this.layout.onDidChangeSidebar((v) => { this.element.hidden = !v; });
    this.render();
  }

  #section(title, body, { grow = false } = {}) {
    const section = h(`section.sidebar-section${grow ? '.grow' : ''}`,
      h('button.section-header', { onclick: () => { section.classList.toggle('collapsed'); } },
        h('span.section-chevron', { html: icon('chevronDown', 14) }), h('span.section-title-text', title)),
      h('div.section-body', body));
    return section;
  }

  #sash() {
    const sash = h('div.sash', { title: t('sidebar.resize') });
    sash.addEventListener('pointerdown', (e) => {
      sash.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = this.element.getBoundingClientRect().width;
      const move = (ev) => { this.element.style.width = `${Math.min(520, Math.max(220, startW + ev.clientX - startX))}px`; };
      const up = () => { sash.removeEventListener('pointermove', move); sash.removeEventListener('pointerup', up); };
      sash.addEventListener('pointermove', move);
      sash.addEventListener('pointerup', up);
    });
    return sash;
  }

  render() {
    this.#renderProject();
    this.#renderCategories();
    this.#renderLists();
  }

  #renderProject() {
    const { fonts } = this;
    const menu = (e) => showMenu(e.currentTarget, [
      { label: t('project.new'), icon: 'plus', hint: 'Ctrl+N', run: () => newProject(this) },
      { label: t('common.openProject'), icon: 'folderOpen', hint: 'Ctrl+O', run: () => fonts.openDialog() },
      { label: t('project.import'), icon: 'import', run: () => fonts.importFont() },
      ...(fonts.hasFont ? [null, { label: t('project.saveAs'), icon: 'save', hint: 'Ctrl+Shift+S', run: () => fonts.saveAs() }, { label: t('project.close'), icon: 'close', run: () => fonts.close() }] : []),
    ]);
    if (!fonts.hasFont) {
      setChildren(this.project,
        h('p.muted.small', t('sidebar.noFont')),
        h('button.btn.btn-primary.btn-block', { onclick: () => fonts.openDialog() }, h('span', { html: icon('folderOpen', 14) }), t('common.openProject')),
        h('div.project-actions',
          h('button.btn.btn-secondary.btn-sm', { 'data-action': 'new', onclick: () => newProject(this) }, h('span', { html: icon('plus', 14) }), t('project.new')),
          h('button.btn.btn-secondary.btn-sm', { 'data-action': 'import', onclick: () => fonts.importFont() }, h('span', { html: icon('import', 14) }), t('project.import'))));
      return;
    }
    const font = fonts.font;
    const where = font.path ? baseName(font.path) : t('sidebar.notSaved');
    setChildren(this.project,
      h('div.project-name', fonts.familyName, fonts.dirty ? h('span.dirty-dot', { title: t('statusbar.unsaved') }, '•') : null),
      h('div.project-style', fonts.styleName || '—', font.example ? h('span.tag', t('sidebar.exampleTag')) : null),
      h('div.project-path', { title: font.path || font.source || '' }, where),
      h('div.project-meta', tn('common.glyphs', font.glyphOrder.length), ' · ', t('sidebar.unitsPerEm', { upm: formatNumber(fonts.unitsPerEm) })),
      // the weights of the typeface: the one that is lit is what every view shows and edits
      fonts.hasWeights ? h('div.weight-switch', { role: 'group', 'aria-label': t('sidebar.weights') },
        fonts.weights.map((w) => h('button.chip', { class: `chip${w.active ? ' active' : ''}`, 'aria-pressed': String(w.active), 'data-weight': w.id, title: t('sidebar.weightTitle', { name: w.name, location: w.location }), onclick: () => fonts.setWeight(w.id) }, w.name))) : null,
      h('div.project-actions',
        h('button.btn.btn-primary.btn-sm', { 'data-action': 'save', disabled: !fonts.dirty && fonts.canSaveInPlace, title: `${fonts.canSaveInPlace ? t('project.saveTitle') : t('project.saveAsTitle')} (Ctrl+S)`, onclick: () => fonts.save() },
          h('span', { html: icon('save', 14) }), fonts.canSaveInPlace ? t('common.save') : t('project.saveAs')),
        h('button.btn.btn-secondary.btn-sm', { 'data-action': 'export', title: `${t('exportDialog.title')} (Ctrl+E)`, onclick: () => showExportDialog(this) },
          h('span', { html: icon('export', 14) }), t('export.button'))),
      h('div.project-actions',
        h('button.icon-button', { 'data-action': 'undo', disabled: !fonts.canUndo, title: fonts.canUndo ? `${t('common.undo')}: ${fonts.undoLabel} (Ctrl+Z)` : t('common.undo'), html: icon('undo', 15), onclick: () => fonts.undo() }),
        h('button.icon-button', { 'data-action': 'redo', disabled: !fonts.canRedo, title: fonts.canRedo ? `${t('common.redo')}: ${fonts.redoLabel} (Ctrl+Shift+Z)` : t('common.redo'), html: icon('redo', 15), onclick: () => fonts.redo() }),
        h('span.toolbar-spacer'),
        font.path ? h('button.icon-button', { onclick: () => this.host.reveal(font.path), title: t('sidebar.revealTitle'), html: icon('reveal', 15) }) : null,
        h('button.btn.btn-ghost.btn-sm', { 'data-action': 'projectMenu', onclick: menu }, t('sidebar.project'), h('span', { html: icon('chevronDown', 12) }))));
  }

  #renderCategories() {
    const { fonts } = this;
    if (!fonts.hasFont) { setChildren(this.categories, h('p.muted.small', t('sidebar.noGlyphs'))); return; }
    const counts = fonts.categoryCounts();
    const row = (id, label, count) => h('button.category', {
      role: 'option', 'aria-selected': String(fonts.filter.category === id),
      class: `category${fonts.filter.category === id ? ' active' : ''}`,
      onclick: () => { fonts.setFilter({ category: id }); this.layout.openView('font'); },
    }, h('span.category-label', label), h('span.category-count', formatNumber(count)));
    setChildren(this.categories,
      row('all', t('categories.all'), fonts.font.glyphOrder.length),
      CATEGORIES.filter((c) => counts[c]).map((c) => row(c, t('categories.' + c), counts[c])));
  }

  #renderLists() {
    const { fonts } = this;
    const current = fonts.font?.path;
    const item = (path, title, subtitle) => h('button.project-item', {
      class: `project-item${path === current ? ' active' : ''}`, title: path, onclick: () => fonts.open(path),
    }, h('span.project-item-title', title), subtitle ? h('span.project-item-sub', subtitle) : null);
    setChildren(this.examples, fonts.examples.length
      ? fonts.examples.map((e) => item(e.path, e.familyName, `${e.styleName} · ${tn('common.glyphs', e.glyphs)}`))
      : h('p.muted.small', t('sidebar.noExamples')));
    const recent = fonts.recent;
    this.recentSection.hidden = !recent.length;
    setChildren(this.recent, recent.map((p) => item(p, baseName(p))));
  }
}
