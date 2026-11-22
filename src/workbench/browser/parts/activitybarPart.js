/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Activity bar: switches the editor view and toggles the side bar.
import { h } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { VIEWS } from '../../services/layout/browser/layoutService.js';
import { showAboutDialog } from '../../contrib/about/aboutDialog.js';
import { t } from '../../../base/common/nls.js';

export class ActivitybarPart {
  constructor({ layout, host }) {
    this.layout = layout;
    this.buttons = VIEWS.map((v) =>
      h('button.activity-item', {
        title: `${v.label} (${v.shortcut})`, 'aria-label': v.label, 'data-view': v.id,
        html: icon(v.icon, 22), onclick: () => layout.openView(v.id),
      }));
    this.element = h('nav.part.activitybar', { 'aria-label': t('activitybar.ariaLabel') },
      h('div.activity-top', this.buttons),
      h('div.activity-bottom',
        h('button.activity-item', { title: t('activitybar.toggleSidebar', { key: 'Ctrl+B' }), 'aria-label': t('activitybar.toggleSidebar', { key: 'Ctrl+B' }), html: icon('sidebar', 20), onclick: () => layout.toggleSidebar() }),
        h('button.activity-item', { title: t('about.title'), 'aria-label': t('about.title'), html: icon('sparkle', 20), onclick: () => showAboutDialog(host) })));
    layout.onDidChangeView(() => this.render());
    this.render();
  }

  render() {
    for (const b of this.buttons) b.classList.toggle('active', b.dataset.view === this.layout.activeView);
  }
}
