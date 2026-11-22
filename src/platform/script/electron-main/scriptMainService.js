/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Runs the person's scripts on a copy of the open font and returns the changed copy; the UI applies
// it as one step that can be undone. Nothing is written to disk here.
//  • JavaScript runs in a separate V8 context that only sees the font, print() and the usual globals.
//  • Python runs in the Python 3 found on the computer, fed through a small module (shim.py).
// A script is the person's own code: it is given no file or network helpers by the app, but this is
// not a security sandbox, and it is not presented as one.
const { run } = require('../node/scriptRunner');

class ScriptMainService {
  registerChannels(ipc) {
    ipc.handle('script:run', (_e, request) => run(request || {}));
  }
}

module.exports = { ScriptMainService };
