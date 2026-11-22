#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// A local server that lets an AI agent work with font projects through the Model Context Protocol:
// it speaks JSON-RPC over standard input and output, opens no network port and needs no account.
// Start it from the agent's configuration:   node tools/mcp-server.js [folder]
//
// What an agent can do here:
//   • read: describe a font, list and read glyphs, validate, list features, shape a text;
//   • produce: compile a font, or run a script and save the result as a NEW project.
// What it cannot do: change or delete an existing project or file. Every path it is given must be
// inside the folder the server was started with (the current folder by default), and every output
// path must not exist yet. The person stays in charge of what replaces what.
const path = require('path');
const readline = require('readline');
const lib = require('./lib');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const VERSION = require('../package.json').version;

function inside(target) {
  const file = path.resolve(ROOT, String(target || ''));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) throw new Error(`"${target}" is outside the folder this server works in (${ROOT})`);
  return file;
}

const project = { type: 'string', description: 'Path of a UFO project folder or a .ttf font, inside the working folder.' };
const weight = { type: 'string', description: 'For a project with several weights: the name of the weight to work on (the first one when left out). describe_font lists them.' };
const TOOLS = [
  { name: 'describe_font', description: 'Names, metrics and counts of a font project.', inputSchema: { type: 'object', properties: { path: project, weight, weight }, required: ['path'] },
    run: async (a) => lib.describe(lib.open(inside(a.path), a.weight)) },
  { name: 'list_glyphs', description: 'One line of data per glyph: unicodes, advance width, contours, components, anchors, bounds. "filter" keeps names that contain it.',
    inputSchema: { type: 'object', properties: { path: project, weight, filter: { type: 'string' } }, required: ['path'] },
    run: async (a) => ({ glyphs: await lib.listGlyphs(lib.open(inside(a.path), a.weight), a.filter) }) },
  { name: 'get_glyph', description: 'The full outline of one glyph: contours as [x, y, type, smooth] points, components, anchors.',
    inputSchema: { type: 'object', properties: { path: project, weight, name: { type: 'string' } }, required: ['path', 'name'] },
    run: async (a) => { const font = lib.open(inside(a.path), a.weight); if (!font.glyphs[a.name]) throw new Error(`no glyph named "${a.name}"`); return { glyph: font.glyphs[a.name] }; } },
  { name: 'validate_font', description: 'Problems of the font as data: { code, level (error, warning, info), glyph?, detail? }.',
    inputSchema: { type: 'object', properties: { path: project, weight, weight }, required: ['path'] },
    run: async (a) => lib.validate(lib.open(inside(a.path), a.weight)) },
  { name: 'list_features', description: 'OpenType features the font has (from glyph names, rules, kerning, anchors and feature code) and the equivalent feature code.',
    inputSchema: { type: 'object', properties: { path: project, weight, weight }, required: ['path'] },
    run: async (a) => lib.features(lib.open(inside(a.path), a.weight)) },
  { name: 'shape_text', description: 'Sets a text in the font: glyph names, positions, total width and every substitution and kerning step. "off" lists feature tags to switch off.',
    inputSchema: { type: 'object', properties: { path: project, weight, text: { type: 'string' }, off: { type: 'array', items: { type: 'string' } } }, required: ['path', 'text'] },
    run: async (a) => lib.shapeText(lib.open(inside(a.path), a.weight), a.text, Object.fromEntries((a.off || []).map((tag) => [tag, false]))) },
  { name: 'export_font', description: 'Compiles the font to a new .ttf or .woff2 file. The output path must not exist yet.',
    inputSchema: { type: 'object', properties: { path: project, weight, output: { type: 'string' } }, required: ['path', 'output'] },
    run: async (a) => lib.exportFont(lib.open(inside(a.path), a.weight), inside(a.output)) },
  { name: 'export_family', description: 'Compiles every style of the family (the weights that are drawn and the instances the project lists) into a new folder with ttf/, woff2/ and a style sheet. The output folder must not exist yet.',
    inputSchema: { type: 'object', properties: { path: project, output: { type: 'string' } }, required: ['path', 'output'] },
    run: async (a) => lib.exportFamily(lib.open(inside(a.path)), inside(a.output)) },
  { name: 'run_script', description: 'Runs a JavaScript or Python script on a copy of the font (object model: font["A"].width, font.kerning, glyph.moveBy…). Returns what it printed. With "output" (a .ufo path that does not exist yet) the changed font is saved as a new project; the original is never changed.',
    inputSchema: { type: 'object', properties: { path: project, weight, language: { type: 'string', enum: ['javascript', 'python'] }, code: { type: 'string' }, output: { type: 'string' } }, required: ['path', 'language', 'code'] },
    run: async (a) => lib.runScript(lib.open(inside(a.path), a.weight), a.language, String(a.code), a.output ? inside(a.output) : null) },
];

const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

async function handle(request) {
  const { id, method, params = {} } = request;
  const reply = (result) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
  const fail = (code, message) => { if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code, message } }); };
  if (method === 'initialize') {
    reply({ protocolVersion: params.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lionfoundry', version: VERSION },
      instructions: 'Font projects are read, never changed. Outputs go to paths that do not exist yet, inside the working folder.' });
  } else if (method === 'ping') reply({});
  else if (method === 'tools/list') reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  else if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) { fail(-32602, `unknown tool: ${params.name}`); return; }
    try {
      const result = await tool.run(params.arguments || {});
      reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result && result.ok === false });
    } catch (err) {
      reply({ content: [{ type: 'text', text: err.message }], isError: true });
    }
  } else if (typeof method === 'string' && method.startsWith('notifications/')) { /* nothing to answer */ } else fail(-32601, `method not found: ${method}`);
}

// one request at a time, in the order they arrive
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
  queue = queue.then(() => handle(request)).catch((err) => { if (request.id !== undefined) send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: err.message } }); });
});
