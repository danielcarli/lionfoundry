/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Prints the notes of one version from CHANGELOG.md (the release workflow uses them as the text of the release).
//   node tools/release-notes.js [version]     (the version of package.json when left out)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = process.argv[2] || require(path.join(root, 'package.json')).version;
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l.trim() === `## ${version}`);
if (start < 0) { console.log(`LionFoundry ${version}`); process.exit(0); }
let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
if (end < 0) end = lines.length;
const repo = 'https://github.com/danielcarli/lionfoundry';
console.log(`${lines.slice(start + 1, end).join('\n').trim()}\n\n---\n\nInstallers for Windows, macOS and Linux are attached below; \`SHA256SUMS.txt\` has the checksum of each file. They are not signed with a paid certificate: see the [README](${repo}#download) for what Windows and macOS ask on first launch. LionFoundry is experimental — keep copies of your fonts.`);
