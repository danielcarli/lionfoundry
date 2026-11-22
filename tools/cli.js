#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// LionFoundry on the command line: the same engine as the app, for build scripts and AI agents.
// Every command prints JSON. The project that is read is never changed; what a command produces is
// written to a path that does not exist yet.
//
//   node tools/cli.js info      <project.ufo|font.ttf>                 summary: names, metrics, counts
//   node tools/cli.js glyphs    <project> [filter]                     one line of data per glyph
//   node tools/cli.js glyph     <project> <name>                       the full outline of one glyph
//   node tools/cli.js validate  <project>                              problems (exit code 1 when there are errors)
//   node tools/cli.js features  <project>                              features of the font and their code
//   node tools/cli.js shape     <project> <text> [--off kern,liga]     glyphs, positions and steps for a text
//   node tools/cli.js export    <project> <out.ttf|out.woff2>          compile a font
//   node tools/cli.js export-family <project> <new-folder>              every style of the family: ttf, woff2 and a style sheet
//   node tools/cli.js convert   <font.ttf|project.ufo> <out.ufo>       save as a new UFO project
//   node tools/cli.js run       <project> <script.js|script.py> [--out new.ufo]   run a script on a copy
//
// A project with several weights: add  --weight <name>  to any command to work on that weight
// (the first weight otherwise).
//
// Exit codes: 0 fine · 1 the command failed or found errors · 2 wrong usage.
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const USAGE = fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => /^\/\/ {3}node /.test(l)).map((l) => l.slice(5)).join('\n');
const print = (data) => console.log(JSON.stringify({ tool: 'lionfoundry', schema: 1, ...data }, null, 2));

async function main() {
  const [command, target, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || !target) { console.error(`Usage:\n${USAGE}`); process.exit(2); }
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const args = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] || '').startsWith('--'));
  const font = lib.open(target, flag('--weight'));
  switch (command) {
    case 'info': print({ ok: true, ...lib.describe(font) }); break;
    case 'glyphs': print({ ok: true, glyphs: await lib.listGlyphs(font, args[0]) }); break;
    case 'glyph': {
      if (!font.glyphs[args[0]]) throw new Error(`no glyph named "${args[0]}"`);
      print({ ok: true, glyph: font.glyphs[args[0]] });
      break;
    }
    case 'validate': {
      const res = await lib.validate(font);
      print({ ok: res.counts.error === 0, ...res });
      if (res.counts.error) process.exitCode = 1;
      break;
    }
    case 'features': print({ ok: true, ...(await lib.features(font)) }); break;
    case 'shape': {
      const off = Object.fromEntries(String(flag('--off') || '').split(',').filter(Boolean).map((tag) => [tag, false]));
      print({ ok: true, text: args[0] || '', ...(await lib.shapeText(font, args[0] || '', off)) });
      break;
    }
    case 'export': print({ ok: true, ...(await lib.exportFont(font, args[0])) }); break;
    case 'export-family': print({ ok: true, ...(await lib.exportFamily(font, args[0])) }); break;
    case 'convert': print({ ok: true, ...lib.saveAs(font, args[0]) }); break;
    case 'run': {
      if (!args[0] || !fs.existsSync(args[0])) throw new Error('a script file is needed');
      const res = await lib.runScript(font, /\.py$/i.test(args[0]) ? 'python' : 'javascript', fs.readFileSync(path.resolve(args[0]), 'utf8'), flag('--out'));
      print(res);
      if (!res.ok) process.exitCode = 1;
      break;
    }
    default: console.error(`Unknown command "${command}".\n${USAGE}`); process.exit(2);
  }
}

main().catch((err) => { print({ ok: false, error: err.message }); process.exit(1); });
