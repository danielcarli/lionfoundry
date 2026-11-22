/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Update dialog, opened by clicking the version in the status bar. Opening it does not touch the
// network: the check runs only when the person presses "Check now".
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { t } from '../../../base/common/nls.js';

export function showUpdateDialog({ update }) {
  const body = h('div.update-body');
  const actions = h('footer.cm-actions');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); sub.dispose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

  const render = () => {
    const { status, info, version } = update;
    const line = status === 'checking' ? t('update.checking')
      : status === 'available' ? t('update.available', { version: info.latest })
      : status === 'current' ? (info.noReleases ? t('update.noReleases') : t('update.current'))
      : status === 'error' ? t('update.error')
      : t('update.idle');
    setChildren(body,
      h('p.update-version', t('update.installed', { version: version || '—' })),
      h(`p.update-line.update-${status}`, h(`span${status === 'checking' ? '.spin' : ''}`, { html: icon(status === 'available' ? 'download' : status === 'checking' ? 'refresh' : status === 'error' ? 'warning' : 'info', 14) }), line),
      h('p.muted.small', t('update.networkNote')));
    setChildren(actions,
      h('button.btn.btn-secondary', { onclick: close }, t('common.close')),
      status === 'available'
        ? h('button.btn.btn-primary', { onclick: () => update.openReleasePage() }, h('span', { html: icon('arrowUpRight', 14) }), t('update.openReleases'))
        : h('button.btn.btn-primary', { disabled: status === 'checking', onclick: () => update.check() }, h('span', { html: icon('refresh', 14) }), t('update.checkNow')));
  };

  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.update-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'update-title' },
      h('h2#update-title', t('update.title')), body, actions));
  const sub = update.onDidChange(render);
  render();
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}
