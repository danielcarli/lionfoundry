/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Layout state: active view, side bar visibility and theme.
import { Emitter } from '../../../../base/common/event.js';
import { t } from '../../../../base/common/nls.js';

export const VIEWS = [
  { id: 'font', icon: 'grid', shortcut: 'Ctrl+1' },
  { id: 'glyph', icon: 'glyph', shortcut: 'Ctrl+2' },
  { id: 'proof', icon: 'type', shortcut: 'Ctrl+3' },
  { id: 'features', icon: 'feature', shortcut: 'Ctrl+4' },
  { id: 'family', icon: 'family', shortcut: 'Ctrl+5' },
  { id: 'check', icon: 'shield', shortcut: 'Ctrl+6' },
  { id: 'scripts', icon: 'code', shortcut: 'Ctrl+7' },
  { id: 'info', icon: 'info', shortcut: 'Ctrl+8' },
  { id: 'spacing', icon: 'kerning', shortcut: 'Ctrl+9' },
].map((v) => ({ ...v, label: t('views.' + v.id) }));

/**
 * The themes of the app. "daca" (dark) is the default and "amsterdam" is its light companion, both
 * derived from city-map palettes; "dark" and "light" are the classic neutral themes.
 */
export const THEMES = [
  { id: 'daca', icon: 'map', dark: true },
  { id: 'amsterdam', icon: 'map', dark: false },
  { id: 'dark', icon: 'moon', dark: true },
  { id: 'light', icon: 'sun', dark: false },
];

const THEME_KEY = 'lionfoundry.theme';

export class LayoutService {
  #onDidChangeView = new Emitter();
  #onDidChangeSidebar = new Emitter();
  #onDidChangeTheme = new Emitter();
  onDidChangeView = this.#onDidChangeView.event;
  onDidChangeSidebar = this.#onDidChangeSidebar.event;
  onDidChangeTheme = this.#onDidChangeTheme.event;

  activeView = 'font';
  sidebarVisible = true;

  constructor(host) {
    this.host = host;
    let pref = 'daca';
    try { pref = localStorage.getItem(THEME_KEY) || 'daca'; } catch { /* ignore */ }
    this.theme = THEMES.some((th) => th.id === pref) ? pref : 'daca';
    this.#applyTheme();
  }

  openView(id) {
    if (id === this.activeView || !VIEWS.some((v) => v.id === id)) return;
    this.activeView = id;
    this.#onDidChangeView.fire(id);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    this.#onDidChangeSidebar.fire(this.sidebarVisible);
  }

  get isDark() { return THEMES.find((th) => th.id === this.theme).dark; }

  /** @param {'daca'|'amsterdam'|'dark'|'light'} id */
  setTheme(id) {
    if (!THEMES.some((th) => th.id === id) || id === this.theme) return;
    this.theme = id;
    try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
    this.#applyTheme();
  }

  #applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    this.host.setTheme(this.theme);
    this.#onDidChangeTheme.fire(this.theme);
  }
}
