/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// New versions: state shown by the version indicator in the status bar and by the update dialog.
// The check runs in the main process and only when the person asks for it (the app never goes
// to the network on its own).
import { Emitter } from '../../../../base/common/event.js';

export class UpdateService {
  #onDidChange = new Emitter();
  onDidChange = this.#onDidChange.event;

  /** @type {'idle'|'checking'|'current'|'available'|'error'} */
  status = 'idle';
  /** last answer of the main process: { current, latest, available, ok, error, noReleases, url } */
  info = null;
  version = '';

  constructor({ host }) {
    this.host = host;
    host.appInfo().then((i) => { this.version = i.version || ''; this.#onDidChange.fire(); }, () => {});
  }

  async check() {
    if (this.status === 'checking') return this.info;
    this.status = 'checking';
    this.#onDidChange.fire();
    try {
      this.info = await this.host.update.check();
      this.status = !this.info.ok ? 'error' : this.info.available ? 'available' : 'current';
    } catch {
      this.info = null;
      this.status = 'error';
    }
    this.#onDidChange.fire();
    return this.info;
  }

  openReleasePage() { return this.host.update.openReleasePage(); }
}
