/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Workbench startup: creates the services once and injects them into the
// layout parts — the same principle as VS Code, in a lean version.
import { FontService } from '../services/font/browser/fontService.js';
import { LayoutService, VIEWS } from '../services/layout/browser/layoutService.js';
import { NotificationService } from '../services/notification/browser/notificationService.js';
import { UpdateService } from '../services/update/browser/updateService.js';

import { TitlebarPart } from './parts/titlebarPart.js';
import { ActivitybarPart } from './parts/activitybarPart.js';
import { SidebarPart } from './parts/sidebarPart.js';
import { EditorPart } from './parts/editorPart.js';
import { StatusbarPart } from './parts/statusbarPart.js';

import { FontView } from '../contrib/font/fontView.js';
import { GlyphView } from '../contrib/glyph/glyphView.js';
import { ProofView } from '../contrib/proof/proofView.js';
import { InfoView } from '../contrib/info/infoView.js';
import { FeaturesView } from '../contrib/features/featuresView.js';
import { FamilyView } from '../contrib/family/familyView.js';
import { CheckView } from '../contrib/check/checkView.js';
import { ScriptsView } from '../contrib/scripts/scriptsView.js';
import { SpacingView } from '../contrib/spacing/spacingView.js';
import { newProject } from '../contrib/font/projectActions.js';
import { showExportDialog } from '../contrib/export/exportDialog.js';
import { showShortcutsDialog } from '../contrib/shortcuts/shortcutsDialog.js';
import { h } from '../../base/browser/dom.js';
import { t } from '../../base/common/nls.js';
import { baseName } from '../../base/common/format.js';
import { bootStatus, bootDone } from './boot.js';

const host = window.host;
if (!host) throw new Error(t('workbench.preloadMissing'));
document.documentElement.dataset.platform = host.platform;

// ---- services ----
const services = {};
services.host = host;
services.layout = new LayoutService(host);
services.notifications = new NotificationService();
services.fonts = new FontService(services);
services.update = new UpdateService(services);

// ---- editor views (contributions) ----
const views = {
  font: new FontView(services),
  glyph: new GlyphView(services),
  proof: new ProofView(services),
  features: new FeaturesView(services),
  family: new FamilyView(services),
  check: new CheckView(services),
  scripts: new ScriptsView(services),
  info: new InfoView(services),
  spacing: new SpacingView(services),
};

// ---- layout ----
const root = document.getElementById('workbench');
const titlebar = new TitlebarPart(services);
const activitybar = new ActivitybarPart(services);
const sidebar = new SidebarPart(services);
const editor = new EditorPart(services, views);
const statusbar = new StatusbarPart(services);

root.append(
  titlebar.element,
  h('div.workbench-main', activitybar.element, sidebar.element, editor.element),
  statusbar.element,
  services.notifications.element,
);

// ---- startup ----
// The project that was open last time comes back (nothing is written to it until the person saves).
// "?open=<path>" is used by the test and screenshot tools to start on a given project.
(async () => {
  try {
    await services.fonts.refreshLists();
    const params = new URLSearchParams(location.search);
    const asked = params.get('open');
    const last = asked || services.fonts.lastProject;
    if (last) {
      bootStatus(t('boot.opening', { name: baseName(last) }));
      await services.fonts.open(last, { quiet: true });
    }
    const view = params.get('view');
    if (view) services.layout.openView(view);
    const glyph = params.get('glyph');
    if (glyph) services.fonts.select(glyph);
  } catch (err) {
    console.error(err);
  } finally {
    bootDone();
    document.documentElement.dataset.ready = 'true';
  }
})();

// ---- keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const key = e.key.toLowerCase();
  const { fonts, layout } = services;
  if (document.querySelector('.cm-overlay')) return; // a dialog is open: it has the keyboard
  if (mod && key === 'o') { e.preventDefault(); fonts.openDialog(); }
  else if (mod && key === 'n') { e.preventDefault(); newProject(services); }
  else if (mod && key === 's') { e.preventDefault(); if (e.shiftKey) fonts.saveAs(); else fonts.save(); }
  else if (mod && key === 'e') { e.preventDefault(); showExportDialog(services); }
  else if (!mod && !typing && e.key === '?') { e.preventDefault(); showShortcutsDialog(); }
  else if (mod && key === 'b' && !e.shiftKey) { e.preventDefault(); layout.toggleSidebar(); }
  // in a text field Ctrl+Z belongs to the text; everywhere else it undoes the last change to the font
  else if (mod && key === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) fonts.redo(); else fonts.undo(); }
  else if (mod && key === 'y' && !typing) { e.preventDefault(); fonts.redo(); }
  // in the font view Ctrl+C takes the whole selected glyph and Ctrl+V adds it to the selected one
  else if (mod && !e.shiftKey && !typing && (key === 'c' || key === 'v') && fonts.hasFont && layout.activeView === 'font' && fonts.selected && !String(window.getSelection()).length) {
    e.preventDefault();
    if (key === 'c') { if (fonts.copyGlyph(fonts.selected)) services.notifications.info(t('glyph.copyDone'), 2500); }
    else if (!fonts.clipboard) services.notifications.info(t('glyph.pasteEmpty'), 4000);
    else fonts.pasteInto(fonts.selected);
  }
  else if (mod && /^[1-9]$/.test(e.key) && VIEWS[+e.key - 1]) { e.preventDefault(); layout.openView(VIEWS[+e.key - 1].id); }
  else if (!typing && !mod && fonts.hasFont && layout.activeView === 'glyph') {
    // [ and ] as in other font editors; the arrows too, while nothing is selected
    if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === '[') { e.preventDefault(); fonts.step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ']') { e.preventDefault(); fonts.step(1); }
  }
});

