/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Export: the one place where fonts and the files other tools read leave the app (Export button, Ctrl+E).
//   what     the master being edited · the whole family (masters and instances) · feature code · designspace
//   formats  TrueType and/or web font
// One font in one format asks for a file name; anything more goes into a new folder, so nothing is replaced.
import { familyStyles } from '../../../base/common/weights.js';
import { formDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

export async function showExportDialog({ fonts }) {
  if (!fonts.hasFont || document.querySelector('.cm-overlay')) return;
  const styles = familyStyles(fonts.font);
  const many = styles.length > 1;
  const res = await formDialog({
    title: t('exportDialog.title'), message: t('exportDialog.message'), confirmLabel: t('export.button'),
    fields: [
      { id: 'what', label: t('exportDialog.what'), type: 'select', value: many ? 'family' : 'style', options: [
        ['style', t('exportDialog.style', { name: fonts.styleName || 'Regular' })],
        ...(many ? [['family', tn('exportDialog.family', styles.length)]] : []),
        ['fea', t('exportDialog.fea')],
        ...(fonts.hasWeights ? [['designspace', t('exportDialog.designspace')]] : []),
      ] },
      { id: 'ttf', label: t('export.ttf'), type: 'checkbox', value: true },
      { id: 'woff2', label: t('export.woff2'), type: 'checkbox', value: many },
    ],
    validate: (v) => ((v.what === 'style' || v.what === 'family') && !v.ttf && !v.woff2 ? t('exportDialog.noFormat') : null),
  });
  if (!res) return;
  if (res.what === 'fea') { await fonts.exportFeatureCode(); return; }
  if (res.what === 'designspace') { await fonts.exportDesignspace(); return; }
  if (res.what === 'style' && res.ttf !== res.woff2) { await fonts.exportFont(res.ttf ? 'ttf' : 'woff2'); return; }
  await fonts.exportFamily({ ttf: res.ttf, woff2: res.woff2 }, res.what === 'style');
}
