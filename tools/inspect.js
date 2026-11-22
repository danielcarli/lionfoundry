#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Command line: describes a font project as JSON, without opening the app.
// It is the first piece of LionFoundry's integration with scripts and AI agents: the same reader the
// app uses, with a stable, documented output an agent can read before proposing changes.
//
//   node tools/inspect.js <project.ufo>                 → summary (names, metrics, counts, warnings)
//   node tools/inspect.js <project.ufo> --glyphs        → + one line of data per glyph
//   node tools/inspect.js <project.ufo> --glyph a       → the full outline of one glyph
//   node tools/inspect.js <project.ufo> --kerning       → + groups and kerning pairs
//
// Read-only: the project is never changed. Exit code 1 when the project cannot be read.
const path = require('path');
const { readUfo, summarize } = require('../src/platform/project/node/ufoReader');

function usage() {
  console.error('Usage: node tools/inspect.js <project.ufo> [--glyphs] [--glyph <name>] [--kerning]');
  process.exit(2);
}

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--glyph');
if (!target) usage();
const glyphName = args.includes('--glyph') ? args[args.indexOf('--glyph') + 1] : null;

let font;
try {
  font = readUfo(path.resolve(target));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
}

const info = { ...font.info };
delete info.other;
const out = {
  ok: true,
  tool: 'lionfoundry-inspect',
  schema: 1,
  project: { path: font.path, format: font.format, layers: font.layers },
  summary: summarize(font),
  info,
  warnings: font.warnings,
};

if (glyphName) {
  const g = font.glyphs[glyphName];
  if (!g) { console.log(JSON.stringify({ ok: false, error: `no glyph named "${glyphName}"` }, null, 2)); process.exit(1); }
  out.glyph = g;
}
if (args.includes('--glyphs')) {
  out.glyphs = font.glyphOrder.map((name) => {
    const g = font.glyphs[name];
    return {
      name,
      unicodes: g.unicodes.map((c) => 'U+' + c.toString(16).toUpperCase().padStart(4, '0')),
      width: g.width,
      contours: g.contours.length,
      points: g.contours.reduce((n, c) => n + c.length, 0),
      components: g.components.map((c) => c.base),
      anchors: g.anchors.map((a) => a.name),
    };
  });
}
if (args.includes('--kerning')) {
  out.groups = font.groups;
  out.kerning = font.kerning;
}
console.log(JSON.stringify(out, null, 2));
