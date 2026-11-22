/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Base class for editor views: only re-renders while visible and marks itself "dirty" while hidden.
import { h } from '../../base/browser/dom.js';
import { t } from '../../base/common/nls.js';

const HINTS_KEY = 'lionfoundry.hints';
const seenHints = () => { try { return JSON.parse(localStorage.getItem(HINTS_KEY) || '{}'); } catch { return {}; } };

/**
 * A section title with its explanation. The explanation is there the first time, with "Got it";
 * after that it waits behind a "?" beside the title (the same behaviour as in LionPhotos).
 */
export function titled(id, title, text) {
  const p = h('p.muted.hint', text, ' ', h('button.link', { onclick: () => set(true) }, t('common.gotIt')));
  const q = h('button.hint-toggle', { title: t('common.explain'), 'aria-label': t('common.explain'), onclick: () => set(false) }, '?');
  const set = (hide) => {
    p.hidden = hide; q.hidden = !hide;
    if (hide) { try { localStorage.setItem(HINTS_KEY, JSON.stringify({ ...seenHints(), [id]: true })); } catch { /* storage unavailable */ } }
  };
  p.hidden = !!seenHints()[id]; q.hidden = !p.hidden;
  return [h('h2', { 'data-hint': id }, title, q), p];
}

export class ViewPane {
  visible = false;
  #dirty = true;

  constructor(services, id) {
    Object.assign(this, services);
    this.element = h(`section.view.view-${id}`);
  }

  /** Call on any data change: re-renders now, or the next time the view is shown. */
  invalidate() {
    if (this.visible) this.render();
    else this.#dirty = true;
  }

  show() {
    this.element.hidden = false;
    const wasVisible = this.visible;
    this.visible = true;
    if (this.#dirty || !wasVisible) { this.#dirty = false; this.render(); }
  }

  hide() {
    this.element.hidden = true;
    this.visible = false;
  }

  render() {}
}
