/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Integration with the operating system: show a project in the file manager, copy text.
const { shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

class ShellMainService {
  /** @param {{recent: string[], examplesDir: string}} projects only folders the project service knows are revealed */
  constructor(projects) {
    this.projects = projects;
  }

  registerChannels(ipc) {
    ipc.handle('shell:reveal', (_e, target) => this.reveal(target));
    ipc.handle('shell:copyText', (_e, text) => { clipboard.writeText(String(text ?? '').slice(0, 1024 * 1024)); return true; });
  }

  reveal(target) {
    const dir = path.resolve(String(target || ''));
    const known = this.projects.recent.includes(dir) || path.dirname(dir) === this.projects.examplesDir || this.projects.exported.has(dir);
    if (!known || !fs.existsSync(dir)) return false;
    shell.showItemInFolder(dir);
    return true;
  }
}

module.exports = { ShellMainService };
