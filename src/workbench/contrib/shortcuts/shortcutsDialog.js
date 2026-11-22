/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// The keyboard shortcuts, on one screen (the ? key, or the button in the status bar — as in LionPhotos).
// What has a shortcut here does not need a button of its own in every panel.
import { h } from '../../../base/browser/dom.js';
import { VIEWS } from '../../services/layout/browser/layoutService.js';
import { t } from '../../../base/common/nls.js';

const GROUPS = [
  ['project', [['Ctrl+N', 'new'], ['Ctrl+O', 'open'], ['Ctrl+S', 'save'], ['Ctrl+Shift+S', 'saveAs'], ['Ctrl+E', 'export'], ['Ctrl+Z', 'undo'], ['Ctrl+Shift+Z', 'redo'], ['Ctrl+B', 'sidebar'], ['?', 'shortcuts']]],
  ['tools', [['V', 'select'], ['P', 'pen'], ['S', 'scale'], ['+', 'addPoint'], ['−', 'removePoint'], ['M', 'snap'], ['Space', 'pan'], ['Ctrl + / −', 'zoom'], ['Ctrl+0', 'fit'], ['[  ]', 'glyphs']]],
  ['edit', [['Ctrl+A', 'selectAll'], ['Ctrl+C / X / V', 'clipboard'], ['← ↑ → ↓', 'nudge'], ['Shift + ← ↑ → ↓', 'nudge10'], ['Delete', 'delete'], ['Alt', 'noSnap'], ['Shift', 'constrain'], ['Ctrl+Shift+B', 'bbox'], ['Shift / Alt', 'boxKeys'], ['Shift+H / V / D', 'handle'], ['Shift+A', 'handleAngle'], ['Esc', 'deselect']]],
];

export function showShortcutsDialog() {
  if (document.querySelector('.cm-overlay')) return;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const list = (rows) => h('dl.shortcut-list', rows.map(([keys, label]) => [h('dt', h('kbd', keys)), h('dd', label)]));
  const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } },
    h('div.cm-dialog.shortcuts-dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('shortcuts.title') },
      h('h2', t('shortcuts.title')),
      h('div.shortcut-columns',
        h('section', h('h3', t('shortcuts.group.views')), list(VIEWS.map((v) => [v.shortcut, v.label]))),
        GROUPS.map(([group, rows]) => h('section', h('h3', t('shortcuts.group.' + group)), list(rows.map(([keys, id]) => [keys, t('shortcuts.' + id)]))))),
      h('div.cm-actions', h('button.btn.btn-primary', { onclick: close }, t('common.close')))));
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  overlay.querySelector('button').focus();
}
