/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Script execution shared by the app, the command line and the tests (see scriptMainService.js).
const vm = require('vm');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const JS_TIMEOUT = 10000;
const PY_TIMEOUT = 30000;
const SECTIONS = ['info', 'glyphOrder', 'glyphs', 'groups', 'kerning', 'features', 'lib'];
const commonModule = (name) => import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'base', 'common', name)).href);

const pick = (font) => Object.fromEntries(SECTIONS.map((k) => [k, font[k]]));

/** Keeps a changed font well-formed whatever the script did to it. */
function tidy(font) {
  font.glyphOrder = [...new Set((font.glyphOrder || []).filter((n) => font.glyphs[n]))];
  for (const name of Object.keys(font.glyphs)) {
    if (!font.glyphOrder.includes(name)) font.glyphOrder.push(name);
    const g = font.glyphs[name];
    g.name = name;
    g.width = Math.max(0, Math.round(Number(g.width) || 0));
    g.unicodes = (Array.isArray(g.unicodes) ? g.unicodes : []).filter(Number.isInteger);
    g.contours = (Array.isArray(g.contours) ? g.contours : []).filter((c) => Array.isArray(c) && c.length);
    g.components = Array.isArray(g.components) ? g.components : [];
    g.anchors = Array.isArray(g.anchors) ? g.anchors : [];
  }
  return font;
}

async function runJavaScript(code, font, selection) {
  const { createScriptFont } = await commonModule('scriptApi.js');
  const lines = [];
  const print = (...args) => { if (lines.length < 5000) lines.push(args.map((a) => (typeof a === 'string' ? a : safeString(a))).join(' ')); };
  const sandbox = { font: createScriptFont(font, selection), print, console: { log: print, warn: print, error: print } };
  try {
    vm.runInNewContext(code, sandbox, { timeout: JS_TIMEOUT, filename: 'script.js' });
  } catch (err) {
    const where = /script\.js:(\d+)/.exec(String(err && err.stack));
    return { output: lines.join('\n'), error: `${err && err.message ? err.message : err}${where ? ` (line ${where[1]})` : ''}` };
  }
  return { font: tidy(pick(font)), output: lines.join('\n') };
}

function safeString(value) {
  try { const s = JSON.stringify(value); return s === undefined ? String(value) : s; } catch { return String(value); }
}

function runPython(code, font, selection) {
  return new Promise((resolve) => {
    const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
    const attempt = (i) => {
      if (i >= candidates.length) { resolve({ output: '', error: 'pythonMissing' }); return; }
      // in an installed app the module sits outside the archive, where Python can read it (see "asarUnpack" in package.json)
      const shim = path.join(__dirname, 'shim.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      const child = spawn(candidates[i], ['-I', shim], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let out = ''; let err = ''; let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ output: '', error: 'timeout' }); } }, PY_TIMEOUT);
      child.on('error', () => { if (!done) { done = true; clearTimeout(timer); attempt(i + 1); } });
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (status) => {
        if (done) return;
        done = true; clearTimeout(timer);
        // "python" on Windows may be the Microsoft Store placeholder: it exits without running anything
        if (status === 9009 || (status !== 0 && !out && /not found|não foi encontrado/i.test(err))) { attempt(i + 1); return; }
        try {
          const res = JSON.parse(out);
          resolve(res.error ? { output: res.output || '', error: res.error } : { font: tidy(pick(res.font)), output: res.output || '' });
        } catch { resolve({ output: '', error: (err || 'the script produced no result').slice(-2000) }); }
      });
      child.stdin.on('error', () => { /* the process went away */ });
      child.stdin.end(JSON.stringify({ code, font: pick(font), selection }));
    };
    attempt(0);
  });
}

/**
 * @param {{language: 'javascript'|'python', code: string, font: object, selection?: string[]}} request
 * @returns {Promise<{font?: object, output: string, error?: string}>}
 */
async function run({ language, code, font, selection = [] }) {
  if (typeof code !== 'string' || !font || !font.glyphs) return { output: '', error: 'bad request' };
  const copy = JSON.parse(JSON.stringify(pick(font)));
  copy.lib ||= {};
  return language === 'python' ? runPython(code, copy, selection) : runJavaScript(code, copy, selection);
}

module.exports = { run, tidy };
