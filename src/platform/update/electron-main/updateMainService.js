/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// New versions. This is the app's only network access, and it happens only when the person clicks the
// version in the status bar: it asks GitHub for the latest release of the project and compares versions.
// Nothing is downloaded or installed from here yet: the dialog offers the release page.
const { net, shell } = require('electron');
const path = require('path');

const REPO = 'danielcarli/lionfoundry';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 12000;

/** Compares "1.2.3" style versions: negative when a < b. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

class UpdateMainService {
  constructor(appRoot) {
    this.current = require(path.join(appRoot, 'package.json')).version;
  }

  registerChannels(ipc) {
    ipc.handle('update:check', () => this.check());
    ipc.handle('update:openReleasePage', () => { shell.openExternal(RELEASES_URL); return true; });
  }

  async check() {
    const base = { current: this.current, latest: null, available: false, checkedAt: Date.now(), url: RELEASES_URL };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await net.fetch(API_URL, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'LionFoundry' }, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 404) return { ...base, ok: true, noReleases: true };
      if (!res.ok) return { ...base, ok: false, error: `HTTP ${res.status}` };
      const body = await res.json();
      const latest = String(body.tag_name || '').replace(/^v/, '');
      if (!latest) return { ...base, ok: true, noReleases: true };
      return { ...base, ok: true, latest, available: compareVersions(this.current, latest) < 0 };
    } catch (err) {
      return { ...base, ok: false, error: err && err.name === 'AbortError' ? 'timeout' : 'offline' };
    }
  }
}

module.exports = { UpdateMainService, compareVersions };
