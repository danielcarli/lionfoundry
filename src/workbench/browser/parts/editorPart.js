/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Editor area: view tabs and the active view. With no project open, it shows the welcome page.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { VIEWS } from '../../services/layout/browser/layoutService.js';
import { newProject } from '../../contrib/font/projectActions.js';
import { t, tn } from '../../../base/common/nls.js';

export class EditorPart {
  constructor(services, views) {
    Object.assign(this, services);
    this.views = views;
    this.tabs = h('div.tabs', { role: 'tablist' });
    this.content = h('div.editor-content');
    this.element = h('main.part.editor', h('div.editor-header', this.tabs), this.content);

    for (const v of Object.values(views)) { v.element.hidden = true; this.content.append(v.element); }
    this.welcome = h('div.welcome');
    this.content.append(this.welcome);

    this.layout.onDidChangeView(() => this.render());
    this.fonts.onDidChangeFont(() => this.render());
    this.fonts.onDidChangeLists(() => { if (!this.fonts.hasFont) this.#renderWelcome(); });
    this.render();
  }

  render() {
    this.#renderTabs();
    const hasFont = this.fonts.hasFont;
    this.welcome.hidden = hasFont;
    if (!hasFont) this.#renderWelcome();
    for (const [id, view] of Object.entries(this.views)) {
      if (hasFont && id === this.layout.activeView) view.show(); else view.hide();
    }
  }

  #renderTabs() {
    setChildren(this.tabs, VIEWS.map((v) =>
      h('button.tab', {
        role: 'tab', 'aria-selected': String(v.id === this.layout.activeView),
        class: `tab${v.id === this.layout.activeView ? ' active' : ''}`,
        onclick: () => this.layout.openView(v.id), title: `${v.label} (${v.shortcut})`,
      }, h('span.tab-icon', { html: icon(v.icon, 14) }), h('span.tab-label', v.label))));
  }

  #renderWelcome() {
    const { fonts } = this;
    setChildren(this.welcome,
      h('div.welcome-inner',
        h('img.welcome-mark', { src: 'media/logo.svg', alt: t('welcome.logoAlt', { app: t('app.name') }) }),
        h('h1', 'Lion', h('span', 'Foundry')),
        h('p.welcome-tagline', t('app.tagline')),
        h('p.welcome-lead', t('welcome.lead')),
        h('div.welcome-actions',
          h('button.btn.btn-primary.btn-lg', { onclick: () => fonts.openDialog() }, h('span', { html: icon('folderOpen', 16) }), t('welcome.openProject')),
          h('button.btn.btn-secondary.btn-lg', { 'data-action': 'new', onclick: () => newProject(this) }, h('span', { html: icon('plus', 16) }), t('project.new')),
          h('button.btn.btn-secondary.btn-lg', { 'data-action': 'import', onclick: () => fonts.importFont() }, h('span', { html: icon('import', 16) }), t('project.import'))),
        fonts.examples.length
          ? h('div.welcome-examples',
              h('div.welcome-examples-title', t('welcome.examples')),
              h('div.example-cards', fonts.examples.map((e) =>
                h('button.example-card', { onclick: () => fonts.open(e.path) },
                  h('span.example-name', e.familyName),
                  h('span.example-meta', `${e.styleName} · ${tn('common.glyphs', e.glyphs)}`)))))
          : null,
        h('dl.shortcuts',
          ...[['Ctrl+O', t('welcome.shortcuts.open')], [`Ctrl+1 … ${VIEWS.length}`, VIEWS.map((v) => v.label).join(' · ')], ['Ctrl+S', t('welcome.shortcuts.save')], ['Ctrl+Z', t('welcome.shortcuts.undo')], ['Ctrl+B', t('welcome.shortcuts.toggleSidebar')]]
            .flatMap(([k, d]) => [h('dt', h('kbd', k)), h('dd', d)])),
        h('p.welcome-note', t('welcome.note'))));
  }
}
