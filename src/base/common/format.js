/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Locale-aware formatting for the UI. Formatters follow the active locale (see ./nls.js).
import { getLocale } from './nls.js';

let cache = { locale: null };

function fmt() {
  const locale = getLocale();
  if (cache.locale !== locale) {
    cache = { locale, nf: new Intl.NumberFormat(locale), nf1: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }) };
  }
  return cache;
}

export const formatNumber = (n) => fmt().nf.format(n);

/** Font units: whole numbers stay whole, others show one decimal ("12", "12.5"). */
export const formatUnits = (n) => (Number.isInteger(n) ? fmt().nf.format(n) : fmt().nf1.format(n));

/** "U+00E1" for a code point. */
export const formatUnicode = (code) => 'U+' + code.toString(16).toUpperCase().padStart(4, '0');

/** Last segment of a path, for either separator. */
export function baseName(p) {
  const parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
