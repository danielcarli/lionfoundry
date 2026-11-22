/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Custom title bar with a "command center" showing the open project.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t } from '../../../base/common/nls.js';

export class TitlebarPart {
  constructor({ fonts }) {
    this.fonts = fonts;
    this.center = h('button.command-center', { onclick: () => fonts.openDialog(), title: t('titlebar.openProject', { key: 'Ctrl+O' }) });
    this.element = h('header.part.titlebar',
      h('div.titlebar-left', h('img.app-glyph', { src: 'media/logo.svg', alt: '' }), h('span.app-name', 'Lion', h('b', 'Foundry'))),
      h('div.titlebar-center', this.center),
      h('div.titlebar-right'));
    this.render();
    fonts.onDidChangeFont(() => this.render());
    fonts.onDidChangeState(() => this.render());
    fonts.onDidEdit((e) => { if (e.sections.includes('info') || e.sections.includes('weights')) this.render(); });
  }

  render() {
    const { fonts } = this;
    const name = fonts.hasFont ? `${fonts.familyName} ${fonts.styleName}`.trim() : '';
    setChildren(this.center,
      h('span.cc-icon', { html: icon('search', 14) }),
      h('span.cc-text', name ? `${name}${fonts.dirty ? ' •' : ''}` : t('titlebar.placeholder')),
      h('kbd', 'Ctrl+O'));
    // the window title also says whether there are changes that were not saved
    document.title = name ? `${fonts.dirty ? '• ' : ''}${name} — ${t('app.name')}` : `${t('app.name')} — ${t('app.tagline')}`;
  }
}
