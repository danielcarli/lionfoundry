/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Actions on the project as a whole that need a dialog.
import { formDialog } from '../../browser/dialogs.js';
import { t } from '../../../base/common/nls.js';

/** Asks for the names of a new typeface and starts it: empty glyphs for the basic letters, ready to draw. */
export async function newProject({ fonts, layout }) {
  const res = await formDialog({
    title: t('project.dialog.new.title'), message: t('project.dialog.new.message'), confirmLabel: t('common.create'),
    fields: [
      { id: 'familyName', label: t('info.field.familyName'), value: '' },
      { id: 'styleName', label: t('info.field.styleName'), value: 'Regular' },
      { id: 'unitsPerEm', label: t('info.field.unitsPerEm'), type: 'number', value: 1000, hint: t('project.dialog.new.upmHint') },
    ],
    validate: (v) => (!v.familyName.trim() ? t('project.dialog.new.needName') : !(v.unitsPerEm >= 16 && v.unitsPerEm <= 16384) ? t('project.dialog.new.badUpm') : null),
  });
  if (!res) return false;
  const ok = await fonts.newFont({ familyName: res.familyName.trim(), styleName: res.styleName.trim() || 'Regular', unitsPerEm: Math.round(res.unitsPerEm) });
  if (ok) layout.openView('font');
  return ok;
}
