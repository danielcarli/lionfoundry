/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Status bar: the open font and the selected glyph, theme and language pickers, and the version
// indicator (bottom-right corner, as in the other Lion apps), which opens the update dialog.
import { h, clear, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { formatUnicode } from '../../../base/common/format.js';
import { t, tn, getLocales, getLocalePreference, setLocalePreference } from '../../../base/common/nls.js';
import { THEMES } from '../../services/layout/browser/layoutService.js';
import { showUpdateDialog } from '../../contrib/update/updateDialog.js';
import { showShortcutsDialog } from '../../contrib/shortcuts/shortcutsDialog.js';
import { showMenu } from '../dialogs.js';

export class StatusbarPart {
  constructor(services) {
    Object.assign(this, services);
    this.left = h('div.status-left');
    this.right = h('div.status-right');
    this.themeSwitch = h('button.status-button.status-theme', { title: t('statusbar.theme'), onclick: () => this.#themeMenu() });
    this.shortcutsButton = h('button.status-button.status-shortcuts', { title: `${t('shortcuts.title')} (?)`, 'aria-label': t('shortcuts.title'), onclick: () => showShortcutsDialog() }, '?');
    this.languagePicker = this.#createLanguagePicker();
    this.versionButton = h('button.status-version', { onclick: () => showUpdateDialog(services) });
    this.element = h('footer.part.statusbar', this.left, h('div.status-right-wrap', this.right, this.themeSwitch, this.languagePicker, this.shortcutsButton, this.versionButton));
    this.update.onDidChange(() => this.#renderVersion());
    this.#renderVersion();
    this.layout.onDidChangeTheme(() => this.#renderThemeSwitch());
    this.#renderThemeSwitch();
    const r = () => this.render();
    this.fonts.onDidChangeFont(r);
    this.fonts.onDidChangeSelection(r);
    this.fonts.onDidChangeFilter(r);
    this.fonts.onDidEdit(r);
    this.fonts.onDidChangeState(r);
    this.render();
  }

  render() {
    const { fonts } = this;
    clear(this.left);
    clear(this.right);
    if (!fonts.hasFont) { this.left.append(item(null, t('statusbar.ready'))); return; }
    // the name of the project is in the title bar and in the side bar: here, only what changes while working
    const total = fonts.font.glyphOrder.length;
    const shown = fonts.visibleGlyphs().length;
    this.left.append(fonts.dirty ? item(null, t('statusbar.unsaved'), { title: t('statusbar.unsavedTitle'), cls: 'unsaved' }) : item(null, fonts.font.example ? t('statusbar.example') : t('statusbar.saved'), { cls: 'muted' }));
    if (shown !== total) this.left.append(item(null, t('statusbar.filtered', { shown, total })));
    const g = fonts.glyph(fonts.selected);
    if (g) {
      const code = g.unicodes.length ? ` · ${formatUnicode(g.unicodes[0])}` : '';
      this.right.append(item('glyph', `${g.name}${code}`, { title: t('statusbar.selectedTitle') }));
    }
  }

  /** Version indicator: "v0.1.0", highlighted when a new version is available. */
  #renderVersion() {
    const { status, info, version } = this.update;
    const available = status === 'available';
    const b = this.versionButton;
    b.classList.toggle('update-available', available);
    const title = available ? t('update.status.availableTitle', { version: info.latest })
      : status === 'checking' ? t('update.status.checking')
      : t('update.status.title');
    b.title = title;
    b.setAttribute('aria-label', title);
    setChildren(b,
      h(`span.status-icon${status === 'checking' ? '.spin' : ''}`, { html: icon(available ? 'download' : status === 'checking' ? 'refresh' : 'info', 12) }),
      available ? t('update.status.available', { version: info.latest }) : version ? `v${version}` : '');
  }

  /** One button that names the theme in use and opens the list (as in LionPhotos). */
  #renderThemeSwitch() {
    const current = THEMES.find((th) => th.id === this.layout.theme) || THEMES[0];
    setChildren(this.themeSwitch, h('span.status-icon', { html: icon(current.icon, 12) }), t(`themes.${current.id}.label`));
  }

  #themeMenu() {
    showMenu(this.themeSwitch, THEMES.map((th) => ({ label: t(`themes.${th.id}.title`), icon: th.id === this.layout.theme ? 'check' : th.icon, run: () => this.layout.setTheme(th.id) })));
  }

  /** Language picker: "auto" (follow the system) or one of the bundled locales. Changing it reloads the window. */
  #createLanguagePicker() {
    const current = getLocalePreference();
    const options = [['auto', t('nls.auto')], ...getLocales().map((l) => [l.id, l.label])];
    const select = h('select.status-select', {
      'aria-label': t('nls.language'),
      onchange: (e) => setLocalePreference(e.target.value),
    }, options.map(([value, label]) => h('option', { value, lang: value === 'auto' ? undefined : value, selected: value === current }, label)));
    return h('label.status-language', { title: `${t('nls.language')} — ${t('nls.changeHint')}` },
      h('span.status-icon', { html: icon('globe', 12) }),
      select);
  }
}

function item(iconName, text, { title, cls } = {}) {
  return h(`span.status-item${cls ? '.' + cls : ''}`, { title },
    iconName ? h('span.status-icon', { html: icon(iconName, 13) }) : null, text);
}
