/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// End-to-end test: starts the real app, opens the example typefaces and exercises every view,
// the themes and both languages, checking what is on screen — and edits, saves, exports and imports
// fonts, checking what lands on disk.
//
//   npm run test:e2e            → runs the checks (exit code 1 when something fails)
//   npm run shots               → also saves screenshots to shots/
//
// It uses a throw-away user data folder, so it never touches your settings or recent projects.
// The examples shipped with the app are only read; everything it writes goes to a temporary folder.
// The native file dialogs are replaced by answers the test queues, since nobody is there to click.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--shots') ? path.join(ROOT, 'shots') : null;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lionfoundry-e2e-'));
app.setPath('userData', userData);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('lang', 'en-US');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lionfoundry-e2e-files-'));
const answers = { save: [], open: [] };
dialog.showSaveDialog = async () => (answers.save.length ? { canceled: false, filePath: answers.save.shift() } : { canceled: true });
dialog.showOpenDialog = async () => (answers.open.length ? { canceled: false, filePaths: [answers.open.shift()] } : { canceled: true, filePaths: [] });
dialog.showMessageBox = async () => ({ response: 1 });

require(path.join(ROOT, 'src', 'code', 'electron-main', 'main.js'));
const { readUfo } = require(path.join(ROOT, 'src', 'platform', 'project', 'node', 'ufoReader.js'));
const { readTtf } = require(path.join(ROOT, 'src', 'platform', 'project', 'node', 'ttfReader.js'));

/** Names, sizes and contents of every file under a folder, to tell whether anything changed. */
const EXAMPLES = path.join(ROOT, 'examples');
function digest(dir) {
  const hash = require('crypto').createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else hash.update(p).update(fs.readFileSync(p)); } };
  walk(dir);
  return hash.digest('hex');
}
const examplesBefore = digest(EXAMPLES);

let failed = 0;
let count = 0;
const check = (name, ok, detail = '') => {
  count++;
  if (!ok) failed++;
  console.log(ok ? '✓' : '✗', name, ok ? '' : `\n   ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitWindow() {
  for (let i = 0; i < 100; i++) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) return win;
    await sleep(50);
  }
  throw new Error('the window did not open');
}

app.whenReady().then(async () => {
  const errors = [];
  try {
    const win = await waitWindow();
    win.setContentSize(1360, 860);
    const wc = win.webContents;
    wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push(e.message); });
    const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true);
    const ready = async () => {
      for (let i = 0; i < 200; i++) {
        if (await wc.executeJavaScript('document.documentElement.dataset.ready === "true"').catch(() => false)) return;
        await sleep(50);
      }
      throw new Error('the workbench did not become ready');
    };
    const shot = async (name) => {
      if (!SHOTS) return;
      await sleep(250);
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), (await wc.capturePage()).toPNG());
    };
    const settle = () => sleep(350);
    const waitFor = async (fn, ms = 15000) => { for (let waited = 0; waited < ms; waited += 100) { if (await fn()) return true; await sleep(100); } throw new Error('timed out waiting for ' + fn); };
    // ---- helpers to drive the interface the way a person would
    const key = (k, mods = {}) => js(`window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({ key: k, bubbles: true, ...mods })}))`);
    const click = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("not found: " + ${JSON.stringify(selector)}); el.click();`);
    const setValue = (selector, value, event = 'change') => js(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("not found: " + ${JSON.stringify(selector)});
      el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("input", { bubbles: true })); if (${JSON.stringify(event)} === "change") el.dispatchEvent(new Event("change", { bubbles: true }));`);
    const fill = (field, value) => setValue(`.cm-dialog [data-field="${field}"]`, value, 'input');
    const submit = async () => { await js('document.querySelector(".cm-dialog form").requestSubmit()'); await settle(); };
    // Export is one dialog: what (style, family, fea, designspace) and the formats
    const exportAs = async (what, formats = {}) => {
      await click('[data-action="export"]');
      await settle();
      await setValue('.cm-dialog [data-field="what"]', what);
      await js(`for (const [id, on] of ${JSON.stringify(Object.entries(formats))}) document.querySelector('.cm-dialog [data-field="' + id + '"]').checked = on;`);
      await submit();
    };
    const menu = async (button, label) => {
      await click(button);
      await js(`const item = [...document.querySelectorAll(".menu-item")].find((b) => ${label}.test(b.textContent)); if (!item) throw new Error("menu item not found: " + ${JSON.stringify(String(label))}); item.click();`);
      await settle();
    };
    const text = (selector) => js(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    const value = (selector) => js(`return document.querySelector(${JSON.stringify(selector)})?.value ?? null`);
    const toasts = () => js('return [...document.querySelectorAll(".toast-text")].map((x) => x.textContent).join(" | ")');
    const clearToasts = () => js('document.querySelectorAll(".toast").forEach((x) => x.remove())');
    const mouse = async (type, x, y) => { wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 }); await sleep(40); };
    const clickAt = async (x, y) => { await mouse('mouseMove', x, y); await mouse('mouseDown', x, y); await mouse('mouseUp', x, y); };
    const dragTo = async (x0, y0, x1, y1) => {
      await mouse('mouseMove', x0, y0); await mouse('mouseDown', x0, y0);
      for (let i = 1; i <= 4; i++) await mouse('mouseMove', x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4);
      await mouse('mouseUp', x1, y1);
    };
    /** [contours, points, handles] of the open glyph, as the panel shows them. */
    const outline = () => js('return [...document.querySelectorAll(".glyph-panel dl.info-numbers dd")].slice(0, 3).map((d) => Number(d.textContent))');

    await ready();
    await js('localStorage.setItem("lionfoundry.locale", "en")');

    // ---- welcome
    const welcome = await js(`return {
      cards: document.querySelectorAll('.example-card').length,
      title: document.title,
      theme: document.documentElement.dataset.theme,
      lang: document.documentElement.lang,
    }`);
    check('welcome page lists the example typefaces', welcome.cards === 2, JSON.stringify(welcome));
    check('default theme is "Mapa de Daca"', welcome.theme === 'daca', welcome.theme);
    await shot('01-welcome-daca');

    // ---- the bridge refuses folders the person did not pick
    const refused = await js('return window.host.project.open("/etc")');
    check('a folder that was not picked is refused', refused && refused.error === 'notAllowed', JSON.stringify(refused));
    check('the UI has no Node access', await js('return typeof require === "undefined" && typeof process === "undefined"'));

    // ---- open the sans example
    await js('[...document.querySelectorAll(".example-card")].find((c) => /Sans/.test(c.textContent) && /Regular/.test(c.textContent)).click()');
    await settle();
    const font = await js(`return {
      cells: document.querySelectorAll('.glyph-cell').length,
      thumbs: document.querySelectorAll('.glyph-thumb svg path').length,
      name: document.querySelector('.project-name')?.textContent,
      selected: document.querySelector('.glyph-cell.selected')?.dataset.name,
      status: document.querySelector('.status-left')?.textContent,
    }`);
    check('the example opens with its 114 glyphs', font.cells === 114, JSON.stringify(font));
    check('thumbnails are drawn for the visible cells', font.thumbs > 20, String(font.thumbs));
    check('the side bar names the font', /Example Sans/.test(font.name || ''), font.name);
    check('a letter is selected at start', font.selected === 'a', font.selected);
    await shot('02-font-daca');

    // ---- search and categories
    await js('const i = document.querySelector(".search-input"); i.value = "acute"; i.dispatchEvent(new Event("input"));');
    await settle();
    const found = await js('return [...document.querySelectorAll(".glyph-cell")].map((c) => c.dataset.name)');
    check('search by name filters the grid', found.length === 11 && found.every((n) => /acute/.test(n)), found.join(' '));
    await js('const i = document.querySelector(".search-input"); i.value = "ç"; i.dispatchEvent(new Event("input"));');
    await settle();
    const byChar = await js('return [...document.querySelectorAll(".glyph-cell")].map((c) => c.dataset.name)');
    check('search by character finds its glyph', byChar.join() === 'ccedilla', byChar.join(' '));
    await js('const i = document.querySelector(".search-input"); i.value = ""; i.dispatchEvent(new Event("input"));');
    await settle();
    await js('[...document.querySelectorAll(".category")].find((c) => /Figures/.test(c.textContent)).click()');
    await settle();
    check('a category filters the grid', (await js('return document.querySelectorAll(".glyph-cell").length')) === 10);
    await js('document.querySelector(".category").click()');
    await settle();

    // ---- glyph view on a composite
    await js('document.querySelector(\'.glyph-cell[data-name="aacute"]\').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
    await settle();
    const glyph = await js(`const c = document.querySelector('.glyph-canvas');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let painted = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
      return {
        visible: !document.querySelector('.view-glyph').hidden,
        title: document.querySelector('.glyph-title').textContent,
        chips: [...document.querySelectorAll('.glyph-panel .chip')].map((x) => x.textContent),
        painted,
        width: document.querySelector('.glyph-panel [data-field="width"]')?.value,
      }`);
    check('double click opens the glyph view', glyph.visible && /aacute/.test(glyph.title), JSON.stringify(glyph));
    check('the composite lists its components', glyph.chips.join() === 'a,acute' && glyph.width === '588', JSON.stringify(glyph));
    check('the canvas is painted', glyph.painted > 5000, String(glyph.painted));
    await shot('03-glyph-composite-daca');
    await js('document.querySelector(".glyph-panel .chip").click()');
    await settle();
    check('a component chip goes to its base glyph', /^a/.test(await js('return document.querySelector(".glyph-title-name").textContent')));
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }))');
    await settle();
    check('the arrow keys step through the glyphs', (await js('return document.querySelector(".glyph-title-name").textContent')) === 'b');
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }))');
    await settle();
    await shot('04-glyph-points-daca');

    // ---- proof view
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", ctrlKey: true }))');
    await settle();
    await js('const a = document.querySelector(".proof-input"); a.value = "AVATAR Tomate\\nação"; a.dispatchEvent(new Event("input"));');
    await settle();
    const proof = await js(`return {
      lines: document.querySelectorAll('.proof-line').length,
      glyphs: document.querySelectorAll('.proof-glyph').length,
      footer: document.querySelector('.proof-footer').textContent,
      width: document.querySelector('.proof-line').getAttribute('width'),
    }`);
    check('the proof sets the text in the font', proof.lines === 2 && proof.glyphs === 17, JSON.stringify(proof));
    check('kerning pairs are applied', /^[1-9]\d* kerning pairs applied/.test(proof.footer), proof.footer);
    await click('.feature-chip[data-feature="kern"]');
    await settle();
    const noKern = await js('return document.querySelector(".proof-line").getAttribute("width")');
    check('switching the kern feature off widens the line', +noKern > +proof.width, `${proof.width} → ${noKern}`);
    await click('.feature-chip[data-feature="kern"]');
    await js('const a = document.querySelector(".proof-input"); a.value = "Tipografia é ação: AVATAR, Tomate, LATA.\\nHamburgefonstiv 0123456789"; a.dispatchEvent(new Event("input"));');
    await settle();
    await shot('05-proof-daca');

    // ---- spacing and kerning, edited where the text is read
    await setValue('.proof-input', 'AVATAR', 'input');
    await settle();
    const lineWidth = () => js('return Number(document.querySelector(".proof-line").getAttribute("width"))');
    const before = await lineWidth();
    await js('document.querySelectorAll(".proof-glyph")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))');
    await settle();
    const pair = await js(`return { name: document.querySelector('.spacing-name')?.textContent, kern: document.querySelector('.spacing-bar [data-field="kern"]')?.value }`);
    check('clicking a letter in the proof shows its spacing and its kerning', pair.name === 'V' && pair.kern === '-70', JSON.stringify(pair));
    await setValue('.spacing-bar [data-field="kern"]', -150);
    await settle();
    const tighter = await lineWidth();
    check('editing the kerning in the proof moves the letters', tighter < before, `${before} → ${tighter}`);
    check('the status bar says the project has unsaved changes', /Not saved/.test(await text('.status-left')), await text('.status-left'));
    await key('z', { ctrlKey: true });
    await settle();
    check('Ctrl+Z undoes the change', (await lineWidth()) === before && (await value('.spacing-bar [data-field="kern"]')) === '-70', String(await lineWidth()));
    await key('z', { ctrlKey: true, shiftKey: true });
    await settle();
    check('Ctrl+Shift+Z redoes it', (await lineWidth()) === tighter, String(await lineWidth()));
    await key('z', { ctrlKey: true });
    await shot('05b-proof-spacing-daca');

    // the same text through the system's text engine, with the font as it would be exported
    await js('const c = document.querySelector(\'[data-toggle="compiled"]\'); c.checked = true; c.dispatchEvent(new Event("change"));');
    await waitFor(() => js('return !!document.querySelector(".proof-compiled").dataset.ready'));
    const compiled = await js(`const face = [...document.fonts].find((f) => f.family.startsWith('LionFoundryProof'));
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = '100px "' + (face ? face.family : 'none') + '"';
      return { ready: document.querySelector('.proof-compiled').dataset.ready, status: face && face.status,
        av: ctx.measureText('AV').width, a: ctx.measureText('A').width, v: ctx.measureText('V').width };`);
    check('the compiled font loads in the system text engine', compiled.ready === 'true' && compiled.status === 'loaded', JSON.stringify(compiled));
    check('…and its kerning is applied by the engine (A + V − 70 units)', Math.abs(compiled.a + compiled.v - 7 - compiled.av) < 0.2, JSON.stringify(compiled));
    await js('const c = document.querySelector(\'[data-toggle="steps"]\'); c.checked = true; c.dispatchEvent(new Event("change"));');
    await settle();
    check('"what happened" lists the steps of the shaper', /kern/.test((await text('.step-list')) || ''), await text('.step-list'));
    await js('for (const id of ["compiled", "steps"]) { const c = document.querySelector(`[data-toggle="${id}"]`); c.checked = false; c.dispatchEvent(new Event("change")); }');

    // ---- font info: editable, with the colour palette
    await key('8', { ctrlKey: true });
    await settle();
    const info = await js(`return {
      sections: document.querySelectorAll('.info-section').length,
      family: document.querySelector('#info-familyName')?.value,
    }`);
    check('font info shows names, metrics, palette and contents (kerning has its own view)', info.sections === 4 && info.family === 'LionFoundry Example Sans', JSON.stringify(info));
    await setValue('#info-openTypeNameDesigner', 'E2E Tester');
    await click('[data-action="addColor"]');
    await click('[data-action="addColor"]');
    await settle();
    check('names can be edited and colours added to the palette', (await value('#info-openTypeNameDesigner')) === 'E2E Tester' && (await js('return document.querySelectorAll(".palette-item").length')) === 2);
    await shot('06-info-daca');

    // ---- a new glyph, drawn with the pen (real mouse events)
    await key('1', { ctrlKey: true });
    await click('[data-action="newGlyph"]');
    await settle();
    await fill('char', 'Ω');
    await submit();
    check('a new glyph is created from a character and opens in the glyph view', (await text('.glyph-title-name')) === 'uni03A9' && !(await js('return document.querySelector(".view-glyph").hidden')), await text('.glyph-title-name'));
    await click('.toggle[data-tool="pen"]');
    const c = await js('const b = document.querySelector(".glyph-canvas").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }');
    const corners = [[-80, 80], [80, 80], [80, -80], [-80, -80]].map(([dx, dy]) => [c.x + dx, c.y + dy]);
    for (const [x, y] of corners) await clickAt(x, y);
    await clickAt(corners[0][0], corners[0][1]);
    await settle();
    check('the pen draws a closed contour of four corners', (await outline()).join() === '1,4,0', (await outline()).join());

    // the add-point and remove-point tools, picked with + and −
    const canvasKey = (k, mods = {}) => js(`document.querySelector(".glyph-canvas").dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({ key: k, bubbles: true, ...mods })}))`);
    await canvasKey('+');
    const addTool = await js('return document.querySelector(".glyph-canvas").dataset.tool');
    await clickAt(c.x, c.y + 80);
    await settle();
    const withPoint = { outline: (await outline()).join(), x: Number(await value('.glyph-panel [data-field="px"]')), y: Number(await value('.glyph-panel [data-field="py"]')) };
    await clickAt(c.x + 80, c.y + 20);
    await settle();
    check('+ picks the add-point tool: a click on the outline puts a point there', addTool === 'add' && withPoint.outline === '1,5,0' && (await outline()).join() === '1,6,0', JSON.stringify(withPoint));
    await canvasKey('-');
    const removeTool = await js('return document.querySelector(".glyph-canvas").dataset.tool');
    await clickAt(c.x, c.y + 80);
    await clickAt(c.x + 80, c.y + 20);
    await settle();
    check('− picks the remove-point tool: a click on a point takes it out', removeTool === 'remove' && (await outline()).join() === '1,4,0', (await outline()).join());
    await canvasKey('p');
    await dragTo(c.x - 40, c.y + 30, c.x - 10, c.y + 30);
    await dragTo(c.x + 40, c.y - 30, c.x + 60, c.y - 30);
    await js('document.querySelector(".glyph-canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    await settle();
    check('dragging with the pen makes a curve with handles', (await outline()).join() === '2,6,2', (await outline()).join());
    await shot('04b-glyph-pen-daca');

    // the direction of a handle: Shift+V, Shift+D, Shift+H, or a typed angle
    await click('.toggle[data-tool="select"]');
    await clickAt(c.x - 10, c.y + 30);
    await settle();
    const angle = async () => Number(await value('.glyph-panel [data-field="handleAngle"]'));
    const angles = [await angle()];
    await canvasKey('V', { shiftKey: true }); await settle(); angles.push(await angle());
    await canvasKey('D', { shiftKey: true }); await settle(); angles.push(await angle());
    await setValue('.glyph-panel [data-field="handleAngle"]', 30); await settle(); angles.push(await angle());
    await canvasKey('H', { shiftKey: true }); await settle(); angles.push(await angle());
    check('a handle is turned vertical, to 45°, to a typed angle and horizontal', angles[0] === 0 && angles[1] === 90 && angles[2] === 45 && Math.abs(angles[3] - 30) < 2 && angles[4] === 0, angles.join(' → '));
    check('…and the outline keeps its points', (await outline()).join() === '2,6,2');

    await click('.toggle[data-tool="select"]');
    await clickAt(corners[0][0], corners[0][1]);
    await settle();
    const x0 = Number(await value('.glyph-panel [data-field="px"]'));
    await dragTo(corners[0][0], corners[0][1], corners[0][0] + 40, corners[0][1]);
    await settle();
    const x1 = Number(await value('.glyph-panel [data-field="px"]'));
    check('the select tool drags a point', Number.isFinite(x0) && x1 > x0, `${x0} → ${x1}`);
    await key('z', { ctrlKey: true });
    await settle();
    await js('document.querySelector(".glyph-canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }))');
    await settle();
    check('the arrows nudge the selection instead of changing glyph', Number(await value('.glyph-panel [data-field="px"]')) === x0 + 10 && (await text('.glyph-title-name')) === 'uni03A9', await value('.glyph-panel [data-field="px"]'));
    await setValue('.glyph-panel [data-field="width"]', 700);
    await settle();
    await setValue('.glyph-panel [data-field="lsb"]', 60);
    await settle();
    check('width and side bearings are edited in the panel', (await value('.glyph-panel [data-field="width"]')) !== null && (await value('.glyph-panel [data-field="lsb"]')) === '60', await value('.glyph-panel [data-field="lsb"]'));

    // ---- reference lines of a glyph and the magnet
    await key('1', { ctrlKey: true });
    await click('[data-action="newGlyph"]');
    await settle();
    await fill('char', 'Δ');
    await submit();
    await click('.toggle[data-tool="pen"]');
    const point = async () => ({ x: Number(await value('.glyph-panel [data-field="px"]')), y: Number(await value('.glyph-panel [data-field="py"]')) });
    const snapOn = () => js('return document.querySelector(\'[data-action="snap"]\').getAttribute("aria-pressed") === "true"');
    const startsOn = await snapOn();
    await click('[data-action="snap"]');
    // two free points tell where the font's origin and scale are on screen
    await clickAt(c.x - 100, c.y - 40); await settle();
    const p1 = await point();
    await clickAt(c.x + 100, c.y - 90); await settle();
    const p2 = await point();
    const scale = 200 / (p2.x - p1.x);
    const screenX = (fx) => c.x - 100 + (fx - p1.x) * scale;
    const screenY = (fy) => c.y - 40 - (fy - p1.y) * scale;
    await clickAt(screenX(300), screenY(0) + 4); await settle();
    const free = await point();
    check('with the magnet off, a point stays where it was put', startsOn && !(await snapOn()) && free.y !== 0 && Math.abs(free.y) < 12, JSON.stringify({ startsOn, free, scale }));
    await click('[data-action="snap"]');
    await settle();
    check('switching the magnet back on moves nothing that is already drawn', (await snapOn()) && JSON.stringify(await point()) === JSON.stringify(free), JSON.stringify(await point()));
    await clickAt(screenX(380), screenY(0) + 4); await settle();
    const held = await point();
    check('with the magnet on, a point near the baseline lands on it', held.y === 0 && Math.abs(held.x - 380) < 4, JSON.stringify(held));
    await clickAt(screenX(598) , screenY(500) - 4); await settle();
    const corner = await point();
    check('…and near two lines it lands on their corner (x-height and advance width)', corner.x === 600 && corner.y === 500, JSON.stringify(corner));

    await click('[data-action="guideH"]');
    await settle();
    await setValue('.glyph-panel [data-field="guideY"]', 300);
    await settle();
    await setValue('.glyph-panel [data-field="guideName"]', 'bar');
    await settle();
    await click('[data-action="guideV"]');
    await settle();
    await setValue('.glyph-panel [data-field="guideX"]', 150);
    await settle();
    await click('[data-action="guideD"]');
    await settle();
    await setValue('.glyph-panel [data-field="guideX"]', 0);
    await settle();
    await setValue('.glyph-panel [data-field="guideY"]', 0);
    await settle();
    await setValue('.glyph-panel [data-field="guideAngle"]', 45);
    await settle();
    const rows = await js('return [...document.querySelectorAll(".guide-row")].map((r) => r.textContent)');
    check('a glyph gets horizontal, vertical and diagonal reference lines', rows.length === 3 && /bar · y 300/.test(rows[0]) && /x 150/.test(rows[1]) && /45°/.test(rows[2]), rows.join(' | '));
    await clickAt(screenX(153), screenY(304)); await settle();
    const onGuides = await point();
    check('the magnet holds a point on the reference lines of the glyph', onGuides.x === 150 && onGuides.y === 300, JSON.stringify(onGuides));
    await clickAt(screenX(400), screenY(408)); await settle();
    const onDiagonal = await point();
    check('…and on a diagonal one', Math.abs(onDiagonal.x - onDiagonal.y) <= 1 && Math.abs(onDiagonal.x - 404) <= 2, JSON.stringify(onDiagonal));
    await js('document.querySelector(".glyph-canvas").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
    await click('.toggle[data-tool="select"]');
    await dragTo(screenX(-60), screenY(300), screenX(-60), screenY(360));
    await settle();
    const moved = { y: Number(await value('.glyph-panel [data-field="guideY"]')), rows: await js('return document.querySelectorAll(".guide-row.selected").length') };
    check('a reference line is dragged with the select tool', Math.abs(moved.y - 360) <= 2 && moved.rows === 1, JSON.stringify(moved));
    await key('z', { ctrlKey: true });
    await settle();
    await shot('04c-glyph-guides-daca');

    // ---- glyphs as a whole: a ligature by name, duplicate, rename, delete (with the typed code)
    await key('1', { ctrlKey: true });
    await click('[data-action="newGlyph"]');
    await settle();
    await fill('name', 'f_i');
    await submit();
    await click('[data-action="addComponent"]');
    await settle();
    await fill('base', 'f');
    await submit();
    check('a component is added to a glyph', (await js('return [...document.querySelectorAll(".glyph-panel .chip")].map((x) => x.textContent).join()')) === 'f');
    await key('1', { ctrlKey: true });
    await settle();
    const cells = () => js('return document.querySelectorAll(".glyph-cell").length');
    const total = await cells();
    await click('.glyph-cell[data-name="H"]');
    await menu('[data-action="glyphMenu"]', /Duplicate/);
    await submit();
    await menu('[data-action="glyphMenu"]', /Rename/);
    await fill('name', 'H.ss01');
    await submit();
    check('a glyph is duplicated and renamed', (await cells()) === total + 1 && (await js('return !!document.querySelector(\'.glyph-cell[data-name="H.ss01"]\')')), String(await cells()));
    await menu('[data-action="glyphMenu"]', /Delete/);
    const code = await js('return document.querySelector(".cm-dialog").dataset.code');
    const blocked = await js('return document.querySelector(".cm-dialog .btn-danger").disabled');
    await setValue('.code-input', code, 'input');
    await submit();
    check('deleting a glyph needs the typed confirmation code', blocked === true && /^[A-Z2-9]{3}$/.test(code) && (await cells()) === total, `${code} ${blocked} ${await cells()}`);
    await key('z', { ctrlKey: true });
    await settle();
    check('…and can be undone', (await cells()) === total + 1);
    await menu('[data-action="glyphMenu"]', /Add glyphs/);
    await setValue('.cm-dialog [data-field="set"]', 'westernEuropean');
    await js('document.querySelector(\'.cm-dialog [data-field="empty"]\').checked = false');
    await submit();
    const built = await toasts();
    check('accented letters are built from anchors', /[1-9]\d* built/.test(built) && (await js('return !!document.querySelector(\'.glyph-cell[data-name="edieresis"]\')')), built);
    await clearToasts();
    await setValue('.search-input', 'acute', 'input');
    await settle();
    const shown = await cells();
    await menu('[data-action="glyphMenu"]', /Transform/);
    await fill('spacing', 20);
    await submit();
    check('a transformation is applied to the glyphs shown', new RegExp(`^${shown} glyphs transformed`).test(await toasts()) && shown > 10, await toasts());
    await clearToasts();
    await setValue('.search-input', '', 'input');
    await settle();
    await shot('02b-font-edited-daca');

    // ---- features: automatic, rules and code
    await key('4', { ctrlKey: true });
    await settle();
    const tags = () => js('return [...document.querySelectorAll(".feature-row")].map((r) => r.dataset.feature).join()');
    check('features are built from glyph names, kerning and anchors', (await tags()) === 'ss01,liga,kern', await tags());
    await click('[data-action="addRule"]');
    await settle();
    await fill('feature', 'dlig');
    await fill('from', 'T h');
    await fill('to', 'T');
    await submit();
    await setValue('.code-editor', "feature salt { sub a by b; } salt;\nfeature calt { sub a' b by c; } calt;\n", 'input');
    await sleep(900);
    const feat = { tags: await tags(), warnings: await text('.feature-warnings') };
    check('rules and feature code add features; what is not compiled is listed', feat.tags === 'salt,ss01,liga,dlig,kern' && /1 line is not compiled/.test(feat.warnings || ''), JSON.stringify(feat));
    await shot('14-features-daca');
    await key('3', { ctrlKey: true });
    await setValue('.proof-input', 'fi', 'input');
    await settle();
    check('the proof applies the ligature', (await js('return [...document.querySelectorAll(".proof-glyph")].map((g) => g.dataset.name).join()')) === 'f_i');
    await setValue('.proof-input', 'Tipografia é ação: AVATAR, Tomate, LATA.\nHamburgefonstiv 0123456789', 'input');

    // ---- check: project guide and problems
    await key('6', { ctrlKey: true });
    await settle();
    const report = await js(`return {
      steps: document.querySelectorAll('.guide-steps li').length, done: document.querySelectorAll('.guide-steps li.done').length,
      coverage: [...document.querySelectorAll('.coverage-value')].map((x) => x.textContent).join(),
      open: !!document.querySelector('tr[data-code="openContour"]'), rows: document.querySelectorAll('.problem-table tr').length,
    }`);
    check('the check view has the project guide, language coverage and the problems', report.steps === 6 && report.done >= 4 && /^\d+%,\d+%,\d+%,\d+%$/.test(report.coverage) && report.open && report.rows > 3, JSON.stringify(report));
    await shot('15-check-daca');

    // ---- scripts, in both languages; each run is one undoable step
    await key('7', { ctrlKey: true });
    await settle();
    const run = async (language, source) => {
      await setValue('[data-field="language"]', language);
      await setValue('.script-editor', source, 'input');
      await js('document.querySelector(".view-scripts").dataset.result = ""');
      await click('[data-action="run"]');
      await waitFor(() => js('return !!document.querySelector(".view-scripts").dataset.result'), 40000);
      return { result: await js('return document.querySelector(".view-scripts").dataset.result'), output: await text('.script-output') };
    };
    const jsRun = await run('javascript', "const g = font['H']; g.width += 20; print('width', g.width, font.length);");
    check('a JavaScript script changes the font and prints', jsRun.result === 'changed' && /^width \d+ \d+$/.test(jsRun.output.trim()), JSON.stringify(jsRun));
    const widthOfH = Number(jsRun.output.trim().split(' ')[1]);
    const failing = await run('javascript', 'font.nothing.width = 1');
    check('a script that fails changes nothing and shows the error', failing.result === 'error' && /Cannot set/.test(failing.output), JSON.stringify(failing));
    const pyRun = await run('python', "g = font.newGlyph('py.test')\ng.appendComponent('H')\ng.width = font['H'].width\nprint('python', len(font), font['H'].leftMargin)");
    check('a Python script does the same (or says Python is not installed)', (pyRun.result === 'changed' && /^python \d+ \d+/.test(pyRun.output.trim())) || /Python 3 was not found/.test(pyRun.output), JSON.stringify(pyRun));
    await clearToasts();
    await shot('16-scripts-daca');

    // ---- weights: the sans example has Regular and Bold in one project
    const style = () => text('.project-style');
    const widthOf = async (name) => { await key('1', { ctrlKey: true }); await click(`.glyph-cell[data-name="${name}"]`); await key('2', { ctrlKey: true }); await settle(); return Number(await value('.glyph-panel [data-field="width"]')); };
    const chips = await js('return [...document.querySelectorAll(".weight-switch .chip")].map((b) => b.textContent + (b.classList.contains("active") ? "*" : "")).join()');
    const regularI = await widthOf('I');
    await click('.weight-switch .chip[data-weight="bold"]');
    await settle();
    const boldI = await widthOf('I');
    check('the side bar switches between the weights of the project', chips === 'Regular*,Bold' && /^Bold/.test(await style()) && boldI !== regularI && Number.isFinite(boldI), `${chips} · ${regularI} / ${boldI} · ${await style()}`);
    await setValue('.glyph-panel [data-field="width"]', 333);
    await settle();
    await click('.weight-switch .chip[data-weight="regular"]');
    await settle();
    check('each weight has its own drawing: a change in the Bold leaves the Regular alone', (await widthOf('I')) === regularI && /^Regular/.test(await style()), String(await widthOf('I')));
    const inBold = await js('return [...document.querySelectorAll(".weight-switch .chip")].length');
    await key('z', { ctrlKey: true });
    await settle();
    const undone = { style: await style(), width: Number(await value('.glyph-panel [data-field="width"]')) };
    await key('z', { ctrlKey: true, shiftKey: true });
    await settle();
    check('undo goes back to the weight the change was made in', inBold === 2 && /^Bold/.test(undone.style) && undone.width === boldI && Number(await value('.glyph-panel [data-field="width"]')) === 333, JSON.stringify(undone));
    await click('.weight-switch .chip[data-weight="regular"]');

    await key('5', { ctrlKey: true });
    await waitFor(() => js('return document.querySelectorAll(".family-stage path").length > 5'));
    const firstPath = () => js('return document.querySelector(".family-stage path").getAttribute("d")');
    const regular = await firstPath();
    await setValue('[data-field="slider"]', 700, 'input');
    await settle();
    const rowsOf = () => js('return document.querySelectorAll(".weight-table tbody tr").length');
    const family = { weights: await rowsOf(), report: await text('.family-report h3'), changed: (await firstPath()) !== regular };
    check('the family view interpolates between the weights and reports compatibility', family.weights === 2 && family.changed && /cannot be interpolated/.test(family.report || ''), JSON.stringify(family));
    await click('[data-action="addWeight"]');
    await settle();
    await fill('location', 900);
    await submit();
    const added = { rows: await rowsOf(), style: await style(), chips: await js('return document.querySelectorAll(".weight-switch .chip").length'), toast: await toasts() };
    check('a new weight starts as a copy and becomes the one being edited', added.rows === 3 && /^Black/.test(added.style) && added.chips === 3 && (await widthOf('I')) === regularI, JSON.stringify(added));
    await clearToasts();
    await click('.weight-switch .chip[data-weight="regular"]');
    await key('5', { ctrlKey: true });
    await settle();
    await click('tr[data-weight="black"] [data-action="removeWeight"]');
    await settle();
    await setValue('.code-input', await js('return document.querySelector(".cm-dialog").dataset.code'), 'input');
    await submit();
    const afterRemove = await rowsOf();
    await key('z', { ctrlKey: true });
    await settle();
    const afterUndo = await rowsOf();
    await key('z', { ctrlKey: true, shiftKey: true });
    await settle();
    check('a weight is removed with the typed code, and that can be undone', afterRemove === 2 && afterUndo === 3 && (await rowsOf()) === 2, `${afterRemove} ${afterUndo} ${await rowsOf()}`);
    await setValue('[data-field="slider"]', 550, 'input');
    await settle();
    await shot('17-family-daca');

    // ---- save as (an example is never written to), then save in place with a backup
    const saved = path.join(work, 'Edited.ufo');
    answers.save.push(saved);
    await key('s', { ctrlKey: true });
    await waitFor(() => fs.existsSync(path.join(saved, 'glyphs', 'contents.plist')));
    await settle();
    const disk = readUfo(saved);
    check('"save" on an example saves a copy elsewhere, with every change in it',
      disk.glyphs.uni03A9 && disk.glyphs.uni03A9.contours.length === 2 && disk.glyphs.f_i.components.length === 1
      && JSON.stringify(disk.glyphs.uni0394.guidelines) === JSON.stringify([{ y: 300, name: 'bar' }, { x: 150 }, { x: 0, y: 0, angle: 45 }])
      && disk.weights.length === 2 && disk.weights[1].name === 'Bold' && disk.weights[1].glyphs.I.width === 333 && disk.glyphs.I.width === regularI
      && disk.weights[1].glyphs.uni03A9 && disk.weights[1].glyphs.uni03A9.contours.length === 0 && Object.keys(disk.weights[1].glyphs).length === disk.glyphOrder.length && disk.info.openTypeNameDesigner === 'E2E Tester'
      && disk.lib['org.lionfoundry.palette'].length === 2 && /salt/.test(disk.features) && disk.glyphs.H.width === widthOfH && /Saved/.test(await text('.status-left')),
      JSON.stringify({ omega: !!disk.glyphs.uni03A9, designer: disk.info.openTypeNameDesigner, h: disk.glyphs.H.width, status: await text('.status-left') }));
    await key('8', { ctrlKey: true });
    await setValue('#info-copyright', 'Copyright test');
    await key('s', { ctrlKey: true });
    await waitFor(() => readUfo(saved).info.copyright === 'Copyright test');
    check('"save" then writes over the project that was just created', !fs.existsSync(`${saved}.backup`) && /Saved/.test(await text('.status-left')));
    await clearToasts();

    // ---- export: TrueType, web font, specimen, feature code, designspace, an instance
    const exported = async (name, action) => { const file = path.join(work, name); answers.save.push(file); await action(); await waitFor(() => fs.existsSync(file), 20000); await settle(); return fs.readFileSync(file); };
    const ttf = await exported('out.ttf', () => exportAs('style', { ttf: true, woff2: false }));
    const back = readTtf(ttf, 'out.ttf');
    check('the exported TrueType font reads back with its glyphs, characters and kerning',
      back.glyphOrder.length === disk.glyphOrder.length && back.glyphs.uni03A9.unicodes[0] === 0x3A9 && back.glyphs.uni03A9.contours.length === 2 && back.kerning.A.V === -70 && back.info.familyName === 'LionFoundry Example Sans',
      `${back.glyphOrder.length} glyphs, A V ${back.kerning.A && back.kerning.A.V}`);
    await click('.weight-switch .chip[data-weight="bold"]');
    await settle();
    const boldTtf = readTtf(await exported('out-bold.ttf', () => exportAs('style', { ttf: true, woff2: false })), 'out-bold.ttf');
    check('each weight is exported as a font of its own, with its name and weight class',
      back.info.styleName === 'Regular' && back.info.other.openTypeOS2WeightClass === 400 && boldTtf.info.styleName === 'Bold' && boldTtf.info.other.openTypeOS2WeightClass === 700 && boldTtf.glyphs.I.width === 333,
      `${back.info.styleName} ${back.info.other.openTypeOS2WeightClass} · ${boldTtf.info.styleName} ${boldTtf.info.other.openTypeOS2WeightClass}`);
    await click('.weight-switch .chip[data-weight="regular"]');
    await settle();
    const woff2 = await exported('out.woff2', () => exportAs('style', { ttf: false, woff2: true }));
    check('the web font is a WOFF2 file, smaller than the TrueType', woff2.toString('latin1', 0, 4) === 'wOF2' && woff2.length < ttf.length, `${woff2.length} / ${ttf.length}`);
    await key('3', { ctrlKey: true });
    const pdf = await exported('specimen.pdf', () => click('[data-action="specimen"]'));
    check('the specimen is saved as PDF', pdf.toString('latin1', 0, 5) === '%PDF-' && pdf.length > 5000, String(pdf.length));
    await key('4', { ctrlKey: true });
    const fea = (await exported('features.fea', () => exportAs('fea'))).toString();
    check('the feature code is exported', /feature liga \{\s+sub f i by f_i;/.test(fea) && /pos @kern1_A @kern2_V -70;/.test(fea), fea.slice(0, 200));
    await key('5', { ctrlKey: true });
    await settle();
    const ds = (await exported('family.designspace', () => exportAs('designspace'))).toString();
    check('the masters and instances are exported as a designspace',
      /<axis tag="wght" name="Weight" minimum="400" maximum="700"/.test(ds) && /filename="Edited.ufo" layer="Bold"/.test(ds) && /stylename="Medium"/.test(ds), ds.slice(0, 300));
    const oneExport = await js('return { family: document.querySelectorAll(".view-family [data-action^=export]").length, features: document.querySelectorAll(".view-features [data-action^=export]").length }');
    check('fonts and files for other tools leave through Export only', oneExport.family === 0 && oneExport.features === 0, JSON.stringify(oneExport));
    await clearToasts();

    // ---- a project picked from disk: the first save keeps a copy of it as it was, and only what changed is rewritten
    const picked = path.join(work, 'Picked.ufo');
    fs.cpSync(path.join(EXAMPLES, 'LionFoundryExampleSerif-Regular.ufo'), picked, { recursive: true });
    const glif = path.join(picked, 'glyphs', 'A_.glif');
    const stamp = fs.statSync(glif).mtimeMs;
    answers.open.push(picked);
    await key('o', { ctrlKey: true });
    await waitFor(async () => /Serif/.test((await text('.project-name')) || ''));
    await key('8', { ctrlKey: true });
    await setValue('#info-copyright', 'Copyright test');
    await key('s', { ctrlKey: true });
    await waitFor(() => fs.existsSync(`${picked}.backup`));
    await settle();
    check('the first save over a picked project keeps a copy of it as it was',
      readUfo(picked).info.copyright === 'Copyright test' && readUfo(`${picked}.backup`).info.copyright !== 'Copyright test' && fs.statSync(glif).mtimeMs === stamp,
      await toasts());
    await clearToasts();

    // ---- import a font file as a new, unsaved project; start a new project
    answers.open.push(path.join(work, 'out.ttf'));
    await menu('[data-action="projectMenu"]', /Import/);
    await key('1', { ctrlKey: true });
    await settle();
    const imported = { cells: await cells(), status: await text('.status-left'), where: await text('.project-path') };
    check('a TrueType font is imported as a new, unsaved project', imported.cells === disk.glyphOrder.length && /Not saved/.test(imported.status) && /Not saved yet/.test(imported.where), JSON.stringify(imported));
    await clearToasts();
    await key('n', { ctrlKey: true });
    await settle();
    await fill('familyName', 'Teste Novo');
    await submit();
    check('replacing a project with unsaved changes asks first', /not saved/.test((await text('.cm-dialog')) || ''), await text('.cm-dialog'));
    await click('.cm-dialog .btn-danger');
    await settle();
    check('a new project starts with the basic glyphs, empty', (await cells()) === 64 && /Teste Novo/.test(await text('.project-name')), String(await cells()));
    await shot('18-new-project-daca');
    check('the examples shipped with the app were not changed', digest(EXAMPLES) === examplesBefore);

    // ---- a whole family: styles, italics, export of everything, structure, clipboard, kerning groups
    await js('[...document.querySelectorAll(".project-item")].find((b) => /Example Sans/.test(b.textContent)).click()');
    await settle();
    await click('.cm-dialog .btn-danger'); // the new project was not saved: let it go
    await settle();
    await key('5', { ctrlKey: true });
    await waitFor(() => js('return document.querySelectorAll(".style-row").length > 0'));
    const styleRows = () => js('return [...document.querySelectorAll(".style-row")].map((r) => r.dataset.style + ":" + r.dataset.kind).join()');
    check('the family view lists every style, drawn and calculated', (await styleRows()) === 'Regular:weight,Medium:instance,SemiBold:instance,Bold:weight', await styleRows());
    await setValue('[data-field="slider"]', 450, 'input');
    await settle();
    await click('[data-action="addInstance"]');
    await settle();
    await fill('name', 'Book');
    await submit();
    check('a position between weights becomes a style of the family', (await styleRows()) === 'Regular:weight,Book:instance,Medium:instance,SemiBold:instance,Bold:weight', await styleRows());
    await click('[data-action="addItalic"]');
    await settle();
    await fill('angle', 12);
    await submit();
    const italicStyle = { rows: await rowsOf(), style: await style(), tag: await text('.weight-table .tag-italic'), note: await text('.family-preview p'), styles: await styleRows() };
    check('an italic starts from the weight being edited and is a group of its own', italicStyle.rows === 3 && /^Italic/.test(italicStyle.style) && italicStyle.tag === 'italic' && /italics/.test(italicStyle.note || '') && /Italic:weight/.test(italicStyle.styles), JSON.stringify(italicStyle));
    await clearToasts();
    await click('[data-action="export"]');
    await settle();
    await shot('22-export-daca');
    await js('document.querySelector(".cm-dialog .btn-secondary").click()');
    await settle();
    answers.open.push(work);
    await exportAs('family', { ttf: true, woff2: true });
    const famDir = path.join(work, 'LionFoundry Example Sans fonts');
    await waitFor(() => fs.existsSync(path.join(famDir, 'LionFoundryExampleSans.css')), 30000);
    await settle();
    const famFiles = fs.readdirSync(path.join(famDir, 'ttf')).sort().join();
    const italicTtf = readTtf(fs.readFileSync(path.join(famDir, 'ttf', 'LionFoundryExampleSans-Italic.ttf')), 'i.ttf');
    const bookTtf = readTtf(fs.readFileSync(path.join(famDir, 'ttf', 'LionFoundryExampleSans-Book.ttf')), 'b.ttf');
    const cssText = fs.readFileSync(path.join(famDir, 'LionFoundryExampleSans.css'), 'utf8');
    check('the whole family is exported into a new folder: a font per style, web fonts and a style sheet',
      famFiles === ['Bold', 'Book', 'Italic', 'Medium', 'Regular', 'SemiBold'].map((n) => `LionFoundryExampleSans-${n}.ttf`).join() && fs.readdirSync(path.join(famDir, 'woff2')).length === 6
      && italicTtf.info.italicAngle === -12 && bookTtf.info.other.openTypeOS2WeightClass === 450 && (cssText.match(/@font-face/g) || []).length === 6 && /font-style: italic/.test(cssText),
      `${famFiles} · ${italicTtf.info.italicAngle} · ${bookTtf.info.other && bookTtf.info.other.openTypeOS2WeightClass}`);
    answers.open.push(work);
    await exportAs('family', { ttf: true, woff2: true });
    await waitFor(() => fs.existsSync(path.join(work, 'LionFoundry Example Sans fonts 2', 'LionFoundryExampleSans.css')), 30000);
    check('exporting again makes another folder: nothing is replaced', fs.readdirSync(path.join(famDir, 'ttf')).length === 6);
    await clearToasts();

    // the same glyph in the other weights: seen behind, compared, and its structure made to agree
    await click('.weight-switch .chip[data-weight="regular"]');
    await settle();
    await key('1', { ctrlKey: true });
    await click('.glyph-cell[data-name="dieresis"]');
    await key('2', { ctrlKey: true });
    await settle();
    const compatible = () => js('return document.querySelector(\'.weight-row[data-weight="bold"]\')?.dataset.compatible');
    const rowsBefore = await js('return [...document.querySelectorAll(".weight-row")].map((r) => r.dataset.weight).join()');
    const compatBefore = await compatible();
    await click('[data-toggle="weights"]');
    await click('.weight-row[data-weight="bold"] [data-action="match"]');
    await settle();
    check('a glyph is made to follow the structure of another weight', rowsBefore === 'bold' && compatBefore === 'false' && (await compatible()) === 'true' && /follows/.test(await toasts())
      && (await js('return document.querySelector(\'[data-toggle="weights"]\').getAttribute("aria-pressed")')) === 'true', `${rowsBefore} ${compatBefore} ${await compatible()} ${await toasts()}`);
    await clearToasts();
    await shot('19-weights-behind-daca');
    await click('[data-action="directions"]');
    await settle();
    check('the directions of the contours are checked', /already right/.test(await toasts()), await toasts());
    await clearToasts();

    // scaling what is selected: the box with handles (select tool) and the scale tool, as in Illustrator
    const sizeOf = async () => { const m = /(\d+) × (\d+)/.exec(await js('return [...document.querySelectorAll(".glyph-panel p.muted.small")].map((p) => p.textContent).find((x) => /×/.test(x)) || ""')); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; };
    const canvasAt = await js('const r = document.querySelector(".glyph-canvas").getBoundingClientRect(); return { x: r.left, y: r.top }');
    const boxOf = async () => (await js('return document.querySelector(".glyph-canvas").dataset.box')).split(',').map(Number);
    await canvasKey('v');
    const noBox = await js('return document.querySelector(".glyph-canvas").dataset.box');
    await canvasKey('a', { ctrlKey: true });
    await settle();
    const size0 = await sizeOf();
    const box0 = await boxOf();
    await shot('23-scale-box-daca');
    const bw = box0[2] - box0[0] - 20; const bh = box0[3] - box0[1] - 20; // the box is drawn 10 pixels outside the points
    await dragTo(canvasAt.x + box0[2], canvasAt.y + box0[1], canvasAt.x + box0[2] + bw / 2, canvasAt.y + box0[1] - bh / 2);
    await settle();
    const size1 = await sizeOf();
    await key('z', { ctrlKey: true });
    await settle();
    const sizeUndone = await sizeOf();
    check('several points are selected and a corner of their box makes the shape larger',
      noBox === '' && box0.length === 4 && Math.abs(size1[0] / size0[0] - 1.5) < 0.06 && Math.abs(size1[1] / size0[1] - 1.5) < 0.1 && sizeUndone.join() === size0.join(),
      `${size0} → ${size1} → ${sizeUndone} · box ${box0}`);
    await canvasKey('s');
    const scaleTool = await js('return document.querySelector(".glyph-canvas").dataset.tool');
    const box1 = await boxOf();
    const midY = canvasAt.y + (box1[1] + box1[3]) / 2;
    await dragTo(canvasAt.x + box1[2] - 10, midY, canvasAt.x + box1[2] - 10 + (box1[2] - box1[0] - 20) / 2, midY);
    await settle();
    const size2 = await sizeOf();
    await key('z', { ctrlKey: true });
    await canvasKey('b', { ctrlKey: true, shiftKey: true });
    await settle();
    const hidden = await js('return document.querySelector(".glyph-canvas").dataset.box');
    await canvasKey('b', { ctrlKey: true, shiftKey: true });
    await canvasKey('v');
    await canvasKey('Escape');
    await settle();
    check('the scale tool (S) scales from the centre, and Ctrl+Shift+B hides the box',
      scaleTool === 'scale' && Math.abs(size2[0] / size0[0] - 2) < 0.08 && size2[1] === size0[1] && hidden === '' && (await sizeOf()).join() === size0.join(), `${size0} → ${size2} · ${scaleTool} · "${hidden}"`);

    // ---- a line of text in the Glyph view, as in other font editors: the text tool, spacing and kerning from the keyboard
    const line = () => js(`const c = document.querySelector(".glyph-canvas"); return { text: c.dataset.text, active: Number(c.dataset.active), caret: Number(c.dataset.caret), tool: c.dataset.tool,
      boxes: (c.dataset.boxes || "").split(",").map((b) => b ? b.split(":").map(Number) : null), title: document.querySelector(".glyph-title-name")?.textContent }`);
    const field = (id) => js(`return Number(document.querySelector('.glyph-panel [data-field="${id}"]')?.value)`);
    const dblClickAt = async (x, y) => {
      for (const clickCount of [1, 2]) {
        wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount }); await sleep(30);
        wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount }); await sleep(30);
      }
      await settle();
    };
    const start = await line();
    const startGlyph = start.title;
    await setValue('[data-field="text"]', 'AVO', 'input');
    await settle();
    const typedInField = await line();
    await canvasKey('t');
    await canvasKey('ArrowRight');
    await settle();
    const onV = await line();
    check('the text field puts a line of glyphs in the Glyph view; T and the arrows move the cursor, and the glyph after it is edited',
      typedInField.text === 'AVO' && typedInField.active === 0 && typedInField.boxes.filter(Boolean).length === 3 && onV.tool === 'text' && onV.caret === 1 && onV.active === 1 && onV.title === 'V',
      JSON.stringify({ startGlyph, typedInField, onV }));
    const kern0 = await field('kernPrev');
    await canvasKey('ArrowLeft', { ctrlKey: true, altKey: true });
    await canvasKey('ArrowLeft', { ctrlKey: true, altKey: true, shiftKey: true });
    await settle();
    const kern1 = await field('kernPrev');
    const lsb0 = await field('lsb'); const rsb0 = await field('rsb');
    await canvasKey('ArrowLeft', { altKey: true });
    await canvasKey('ArrowRight', { ctrlKey: true, shiftKey: true });
    await settle();
    const lsb1 = await field('lsb'); const rsb1 = await field('rsb');
    await shot('24-text-tool-daca');
    for (let i = 0; i < 4; i++) await key('z', { ctrlKey: true });
    await settle();
    check('Ctrl+Alt + ← → change the kerning with the glyph before the cursor, Alt and Ctrl + ← → the side bearings (Shift: 10), and all of it is undone',
      kern1 === kern0 - 11 && lsb1 === lsb0 + 1 && rsb1 === rsb0 + 10 && (await field('kernPrev')) === kern0 && (await field('lsb')) === lsb0 && (await field('rsb')) === rsb0,
      JSON.stringify({ kern0, kern1, lsb0, lsb1, rsb0, rsb1 }));
    await canvasKey('n');
    await settle();
    const typed = await line();
    await canvasKey('?');
    await settle();
    const question = { text: (await line()).text, dialog: await js('return !!document.querySelector(".cm-overlay")') };
    await canvasKey('Backspace'); await canvasKey('Backspace');
    await settle();
    const erased = await line();
    check('typing with the text tool puts glyphs at the cursor (keys like ? and [ type, they are not shortcuts here) and Backspace takes them out',
      typed.text === 'AnVO' && typed.caret === 2 && typed.title === 'V' && question.text === 'An?VO' && !question.dialog && erased.text === 'AVO' && erased.caret === 1,
      JSON.stringify({ typed, question, erased: erased.text }));
    await canvasKey('Escape');
    await settle();
    const afterEsc = await line();
    const aBox = afterEsc.boxes[0];
    await dblClickAt(canvasAt.x + (aBox[0] + aBox[1]) / 2, canvasAt.y + aBox[2] - 30);
    const onA = await line();
    await key(']');
    await settle();
    const swapped = await line();
    await key('[');
    await settle();
    check('Esc edits the glyph after the cursor; a double-click edits another glyph of the line; ] and [ swap only the glyph being edited',
      afterEsc.tool === 'select' && afterEsc.title === 'V' && onA.active === 0 && onA.title === 'A' && swapped.text === 'BVO' && swapped.title === 'B' && (await line()).text === 'AVO',
      JSON.stringify({ afterEsc, onA, swapped: swapped.text }));
    await setValue('[data-field="text"]', 'A/V /zz€', 'input');
    await settle();
    const named = await line();
    await setValue('[data-field="samples"]', 'kerning');
    await settle();
    const sample = await line();
    await shot('25-text-kerning-daca');
    check('the text field takes /name for a glyph by its name, shows characters the font lacks as empty boxes, and offers the samples of the proof',
      named.text === 'AV/zz€' && named.boxes.filter(Boolean).length === 4 && /^AVATAR/.test(sample.text) && sample.boxes.filter(Boolean).length > 20,
      JSON.stringify({ named: named.text, sample: sample.text.slice(0, 30) }));
    await setValue('[data-field="text"]', start.text, 'input');
    await canvasKey('v');
    await settle();

    // ---- the masters side by side: the glyph in every master, the compatibility map, points added where one lacks them, the line between the masters
    const cds = (k) => js(`return document.querySelector(".glyph-canvas").dataset.${k} ?? ""`);
    const altClickAt = async (x, y) => {
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, modifiers: ['alt'] }); await sleep(40); }
    };
    await setValue('[data-field="text"]', 'I', 'input');
    await canvasKey('v');
    await settle();
    await click('[data-toggle="masters"]');
    await settle();
    const masterRow = { masters: await cds('masters'), boxes: (await cds('masterBoxes')).split(',').map((b) => b.split(':')) };
    const boldBox = masterRow.boxes.find((b) => b[0] === 'bold').slice(1).map(Number);
    await dblClickAt(canvasAt.x + (boldBox[0] + boldBox[1]) / 2, canvasAt.y + (boldBox[2] + boldBox[3]) / 2);
    const switched = await style();
    await shot('26-masters-row-daca');
    const regularBox = (await cds('masterBoxes')).split(',').map((b) => b.split(':')).find((b) => b[0] === 'regular').slice(1).map(Number);
    await dblClickAt(canvasAt.x + (regularBox[0] + regularBox[1]) / 2, canvasAt.y + (regularBox[2] + regularBox[3]) / 2);
    check('All masters shows the glyph in every master under the line; a double-click on one works in that master',
      masterRow.masters === 'regular:1,bold:1,italic:1' && masterRow.boxes.length === 3 && /^Bold/.test(switched) && /^Regular/.test(await style()), JSON.stringify({ masterRow, switched }));
    await click('[data-toggle="compat"]');
    await settle();
    const matchedAll = await cds('unmatched');
    await canvasKey('a', { ctrlKey: true });
    await settle();
    const iBox = await boxOf(); // 10 pixels outside the points
    await canvasKey('Escape');
    await canvasKey('+');
    await altClickAt(canvasAt.x + (iBox[0] + iBox[2]) / 2, canvasAt.y + iBox[3] - 10);
    await settle();
    const counts = () => cds('masterPoints');
    const afterAlt = { counts: await counts(), masters: await cds('masters') };
    await clickAt(canvasAt.x + iBox[0] + 10, canvasAt.y + (iBox[1] + iBox[3]) / 2);
    await settle();
    const afterPlain = { counts: await counts(), masters: await cds('masters'), unmatched: Number(await cds('unmatched')) };
    await shot('27-compatibility-daca');
    await clearToasts();
    await click('.weight-row[data-weight="bold"] [data-action="addPoints"]');
    await settle();
    const afterAdd = { counts: await counts(), masters: await cds('masters'), unmatched: await cds('unmatched'), toast: await toasts() };
    check('Alt with the add-point tool adds the point in every master; without it only here, and the compatibility map marks what the other master lacks',
      matchedAll === '0' && afterAlt.counts === '5/5/5' && afterAlt.masters === 'regular:1,bold:1,italic:1' && afterPlain.counts === '6/5/5' && afterPlain.masters === 'regular:1,bold:0,italic:1' && afterPlain.unmatched > 0,
      JSON.stringify({ matchedAll, afterAlt, afterPlain }));
    check('Add missing points gives the other master the point it lacks, and the two are compatible again',
      afterAdd.counts === '6/6/5' && afterAdd.masters === 'regular:1,bold:1,italic:1' && afterAdd.unmatched === '0' && /1 point added/.test(afterAdd.toast), JSON.stringify(afterAdd));
    await clearToasts();
    await setValue('[data-field="text"]', 'HIOI', 'input');
    await canvasKey('v');
    await click('[data-toggle="preview"]');
    await settle();
    const preview = () => js(`const p = document.querySelector(".glyph-preview"); const c = p.querySelector("canvas");
      return { hidden: p.hidden, at: c.dataset.at, label: p.querySelector(".glyph-preview-label").textContent, min: p.querySelector("input").min, max: p.querySelector("input").max }`);
    const preview0 = await preview();
    await setValue('[data-field="previewAt"]', '650', 'input');
    await settle();
    const preview1 = await preview();
    await shot('28-preview-daca');
    check('Preview shows the line at any point between the masters, starting at a style of the family',
      !preview0.hidden && preview0.min === '400' && preview0.max === '700' && /Medium|SemiBold/.test(preview0.label) && preview1.at === '650' && /650/.test(preview1.label), JSON.stringify({ preview0, preview1 }));
    for (let i = 0; i < 3; i++) await key('z', { ctrlKey: true });
    await settle();
    const undone4 = await counts();
    for (const tg of ['preview', 'compat', 'masters']) await click(`[data-toggle="${tg}"]`);
    await setValue('[data-field="text"]', start.text, 'input');
    await canvasKey('v');
    await settle();
    check('undo takes the points out of every master again', undone4 === '4/4/4' && (await js('return document.querySelector(".glyph-preview").hidden')), undone4);

    // ---- drawing tools: rectangle and ellipse (F), remove overlap (Ctrl+Shift+O), the knife (E), extremes
    await setValue('[data-field="text"]', 'I', 'input');
    await canvasKey('v');
    await canvasKey('0');
    await settle();
    await canvasKey('a', { ctrlKey: true });
    await settle();
    const iRect = await boxOf(); // 10 pixels outside the points
    await canvasKey('Escape');
    const iMidY = canvasAt.y + (iRect[1] + iRect[3]) / 2;
    const iMidX = canvasAt.x + (iRect[0] + iRect[2]) / 2;
    const outline0 = (await outline()).join();
    await canvasKey('f');
    const shapeTool = { tool: await cds('tool'), kind: await js('return document.querySelector(\'button[data-tool="shape"]\').dataset.kind') };
    await dragTo(iMidX - 120, iMidY - 25, iMidX + 120, iMidY + 25);
    await settle();
    const withBar = (await outline()).join();
    await shot('29-shape-tool-daca');
    await canvasKey('o', { ctrlKey: true, shiftKey: true });
    await settle();
    const merged = { outline: (await outline()).join(), toast: await toasts() };
    await clearToasts();
    check('F draws a rectangle by dragging; Ctrl+Shift+O joins it with the stem it overlaps into one contour',
      shapeTool.tool === 'shape' && shapeTool.kind === 'rect' && outline0 === '1,4,0' && withBar === '2,8,0' && merged.outline === '1,12,0' && /1 contour/.test(merged.toast),
      JSON.stringify({ shapeTool, outline0, withBar, merged }));
    await key('z', { ctrlKey: true });
    await settle();
    await canvasKey('e');
    await dragTo(iMidX + 60, iMidY + 120, iMidX + 60, iMidY - 120);
    await settle();
    const cutOutline = (await outline()).join();
    await shot('30-knife-daca');
    check('the knife (E) cuts the bar it is dragged across in two closed parts', (await cds('tool')) === 'knife' && cutOutline === '3,12,0', cutOutline);
    await key('z', { ctrlKey: true }); await key('z', { ctrlKey: true });
    await settle();
    await canvasKey('f'); await canvasKey('f');
    const kindNow = await js('return document.querySelector(\'button[data-tool="shape"]\').dataset.kind');
    await dragTo(iMidX - 60, iMidY + 160, iMidX + 60, iMidY + 60);
    await settle();
    const withEllipse = (await outline()).join();
    await clearToasts();
    await click('[data-action="addExtremes"]');
    const extremesToast = await toasts();
    await clearToasts();
    await key('z', { ctrlKey: true });
    await canvasKey('v');
    await setValue('[data-field="text"]', start.text, 'input');
    await settle();
    check('F again draws an ellipse, which already has its extremes; undo takes everything back',
      kindNow === 'ellipse' && withEllipse === '2,8,8' && /already/.test(extremesToast), JSON.stringify({ kindNow, withEllipse, extremesToast }));

    {
    // ---- ruler (L), rotate (R), background, align (Ctrl+Shift+A), Tab, lasso (Alt + drag)
    await setValue('[data-field="text"]', 'I', 'input');
    await canvasKey('v'); await canvasKey('0');
    await settle();
    await canvasKey('a', { ctrlKey: true });
    await settle();
    const jBox = await boxOf();
    await canvasKey('Escape');
    const jx = canvasAt.x + (jBox[0] + jBox[2]) / 2; const jy = canvasAt.y + (jBox[1] + jBox[3]) / 2;
    await canvasKey('l');
    await dragTo(jx - 90, jy, jx + 90, jy);
    await settle();
    const ruler = (await cds('ruler')).split('|');
    await shot('31-ruler-daca');
    check('the ruler (L) shows its length and the thickness of the stem it crosses', (await cds('tool')) === 'ruler' && ruler[1].split(',').map(Number).includes(84), ruler.join('|'));
    await canvasKey('v');
    await canvasKey('a', { ctrlKey: true });
    await settle();
    const size0r = await sizeOf();
    await canvasKey('r');
    await dragTo(jx + 120, jy, jx, jy - 120);
    await settle();
    const turned = await sizeOf();
    await key('z', { ctrlKey: true });
    await settle();
    check('the rotate tool (R) turns the selection around its centre (Shift: steps of 15°)', size0r.join() === '84,700' && Math.abs(turned[0] - 700) <= 2 && Math.abs(turned[1] - 84) <= 2 && (await sizeOf()).join() === '84,700', `${size0r} → ${turned}`);
    await canvasKey('v');
    await canvasKey('Escape');
    await click('[data-action="toBackground"]');
    await settle();
    const bg = { count: await cds('background'), pressed: await js('return document.querySelector(\'[data-toggle="background"]\').getAttribute("aria-pressed")') };
    await click('[data-action="swapBackground"]');
    await settle();
    const bgSwapped = { outline: (await outline()).join(), count: await cds('background') };
    await shot('32-background-daca');
    await key('z', { ctrlKey: true }); await key('z', { ctrlKey: true });
    await settle();
    check('Copy to background keeps the drawing behind it, shown at once; Swap brings it to the front', bg.count === '1' && bg.pressed === 'true' && bgSwapped.outline === '1,4,0' && bgSwapped.count === '1' && (await cds('background')) === '', JSON.stringify({ bg, bgSwapped }));
    await click('[data-toggle="background"]');
    await canvasKey('Tab');
    await settle();
    const p1 = [await field('px'), await field('py')];
    await canvasKey('Tab');
    await settle();
    const p2 = [await field('px'), await field('py')];
    await canvasKey('Tab', { shiftKey: true });
    await settle();
    const p3 = [await field('px'), await field('py')];
    check('Tab and Shift+Tab go from point to point of the contour', p1.join() === '74,0' && p2.join() === '158,0' && p3.join() === '74,0', JSON.stringify({ p1, p2, p3 }));
    await canvasKey('a', { ctrlKey: true });
    await canvasKey('a', { ctrlKey: true, shiftKey: true });
    await settle();
    const aligned = await sizeOf();
    await key('z', { ctrlKey: true });
    await canvasKey('Escape');
    await settle();
    // a lasso around the two top points: Alt + drag from an empty place
    const top = jBox[1] + 10; const left = jBox[0] + 10; const right = jBox[2] - 10;
    const lassoPath = [[left - 30, top - 30], [right + 30, top - 30], [right + 30, top + 30], [left - 30, top + 30], [left - 30, top - 25]].map(([x, y]) => [canvasAt.x + x, canvasAt.y + y]);
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(lassoPath[0][0]), y: Math.round(lassoPath[0][1]), modifiers: ['alt'] }); await sleep(40);
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(lassoPath[0][0]), y: Math.round(lassoPath[0][1]), button: 'left', clickCount: 1, modifiers: ['alt'] }); await sleep(40);
    for (const [x, y] of lassoPath.slice(1)) { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y), button: 'left', modifiers: ['alt', 'leftButtonDown'] }); await sleep(40); }
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(lassoPath[4][0]), y: Math.round(lassoPath[4][1]), button: 'left', clickCount: 1, modifiers: ['alt'] }); await sleep(60);
    await settle();
    const lassoBox = await boxOf();
    const lassoed = [Math.round((lassoBox[2] - lassoBox[0] - 20) / (jBox[2] - jBox[0] - 20) * 84), lassoBox[3] - lassoBox[1] - 20];
    await canvasKey('Escape');
    await setValue('[data-field="text"]', start.text, 'input');
    await settle();
    check('Ctrl+Shift+A puts the selected points on one line; Alt + drag draws a lasso around the points to take', aligned[0] === 0 && aligned[1] === 700 && lassoed.join() === '84,0', JSON.stringify({ aligned, lassoed }));
    }

    // copy and paste between glyphs
    const oOutline = (await outline()).join();
    await canvasKey('c', { ctrlKey: true });
    await key('1', { ctrlKey: true });
    await click('.glyph-cell[data-name="I"]');
    await key('2', { ctrlKey: true });
    await settle();
    const iBefore = (await outline()).join();
    await canvasKey('v', { ctrlKey: true });
    await settle();
    const pasteResult = { from: oOutline, before: iBefore, after: (await outline()).join(), selected: await text('.glyph-panel h3 + p.muted.small') };
    await key('z', { ctrlKey: true });
    await settle();
    check('a drawing is copied from one glyph and pasteResult into another', pasteResult.before === '1,4,0' && pasteResult.after === '3,12,16' && (await outline()).join() === '1,4,0', JSON.stringify(pasteResult));
    await clearToasts();

    // kerning groups and pairs
    await key('9', { ctrlKey: true });
    await settle();
    const groupCount = () => js('return document.querySelectorAll(".kern-group-row").length');
    const groupsBefore = await groupCount();
    const pairsBefore = await js('return document.querySelectorAll(".pair-table tbody tr").length');
    await click('[data-action="newGroup1"]');
    await settle();
    await fill('name', 'test');
    await fill('members', 'O Q D');
    await submit();
    await settle();
    const groupMembers = await js('return [...document.querySelectorAll(\'.kern-group-row[data-group="public.kern1.test"] [data-member]\')].map((b) => b.dataset.member).join()');
    await click('[data-action="newPair"]');
    await settle();
    await fill('left', '@test');
    await fill('right', 'T');
    await fill('value', -35);
    await submit();
    await settle();
    const pairValue = await value('tr[data-pair="public.kern1.test T"] input');
    await key('3', { ctrlKey: true });
    await settle();
    check('kerning groups and pairs are organised in the spacing view', (await groupCount()) === groupsBefore + 1 && groupMembers === 'O,Q,D' && pairValue === '-35' && pairsBefore > 0, `${groupsBefore} ${groupMembers} ${pairValue} ${pairsBefore}`);
    await key('9', { ctrlKey: true });
    await settle();
    await shot('20-spacing-daca');

    // missing characters of a language are created in one go
    await key('6', { ctrlKey: true });
    await settle();
    const missingBefore = await text('.coverage-row[data-set="portuguese"] .coverage-missing');
    await click('.coverage-row[data-set="portuguese"] [data-action="complete"]');
    await settle();
    const preset = await value('.cm-dialog [data-field="set"]');
    await submit();
    await key('6', { ctrlKey: true });
    await settle();
    check('the characters a language still needs are added from the coverage list, with the same dialog as in the font view', preset === 'portuguese' && missingBefore.length > 5 && (await text('.coverage-row[data-set="portuguese"] .coverage-value')) === '100%' && /created empty/.test(await toasts()), `${missingBefore} · ${await toasts()}`);
    await clearToasts();
    await key('5', { ctrlKey: true });
    await settle();
    const hintBefore = await js('const h2 = document.querySelector(\'h2[data-hint="family.masters"]\'); return { text: !h2.nextElementSibling.hidden, mark: !h2.querySelector(".hint-toggle").hidden }');
    await js('document.querySelector(\'h2[data-hint="family.masters"]\').nextElementSibling.querySelector(".link").click()');
    const hintAfter = await js('const h2 = document.querySelector(\'h2[data-hint="family.masters"]\'); return { text: !h2.nextElementSibling.hidden, mark: !h2.querySelector(".hint-toggle").hidden }');
    check('an explanation is shown until "Got it", then waits behind a "?"', hintBefore.text && !hintBefore.mark && !hintAfter.text && hintAfter.mark, JSON.stringify([hintBefore, hintAfter]));
    await key('?');
    await settle();
    const keysShown = await js('return document.querySelectorAll(".shortcuts-dialog kbd").length');
    await shot('21-shortcuts-daca');
    await js('document.querySelector(".shortcuts-dialog .btn-primary").click()');
    check('the ? key shows every shortcut on one screen', keysShown > 30 && (await js('return !document.querySelector(".shortcuts-dialog")')), String(keysShown));
    check('the status bar has one theme button and does not repeat the project name', (await js('return document.querySelectorAll(".status-theme").length')) === 1 && !/Example Sans/.test(await text('.status-left')), await text('.status-left'));
    check('the examples are still untouched after all that', digest(EXAMPLES) === examplesBefore);

    // ---- second theme and the serif example
    await menu('.status-theme', /Amsterd/);
    await settle();
    check('the "Mapa de Amsterdã" theme applies', (await js('return document.documentElement.dataset.theme')) === 'amsterdam');
    await js('[...document.querySelectorAll(".project-item")].find((b) => /Serif/.test(b.textContent)).click()');
    await settle();
    await click('.cm-dialog .btn-danger'); // the new project was not saved: let it go
    await settle();
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }))');
    await settle();
    check('the serif example opens', /Example Serif/.test(await js('return document.querySelector(".project-name").textContent')));
    await shot('07-font-amsterdam');
    await js('document.querySelector(\'.glyph-cell[data-name="R"]\').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))');
    await settle();
    await shot('08-glyph-amsterdam');
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", ctrlKey: true }))');
    await settle();
    await shot('09-proof-amsterdam');

    // ---- the two classic themes
    for (const [index, id] of [[2, 'dark'], [3, 'light']]) {
      await menu('.status-theme', index === 2 ? /Classic dark|escuro/i : /Classic light|claro/i);
      await settle();
      const applied = await js('return { theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.querySelector(".editor")).backgroundColor }');
      check(`the classic ${id} theme applies`, applied.theme === id && applied.bg === (id === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)'), JSON.stringify(applied));
      await shot(`09-proof-${id}`);
    }
    await menu('.status-theme', /Amsterd/);
    await settle();

    // ---- every other language: the catalog loads, the views have names, nothing is cut off
    const overflowing = {};
    for (const id of ['pt-PT', 'es', 'fr', 'de', 'it']) {
      await js(`const s = document.querySelector(".status-select"); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event("change"));`);
      await sleep(600);
      await ready();
      await settle();
      await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true }))');
      await settle();
      const state = await js(`
        const cut = (el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible';
        return {
          lang: document.documentElement.lang,
          tabs: [...document.querySelectorAll('.tab-label')].map((x) => x.textContent.trim()),
          picker: document.querySelector('.status-select').selectedOptions[0]?.textContent,
          tabsWidth: [document.querySelector('.tabs').scrollWidth, document.querySelector('.tabs').clientWidth, document.querySelector('.editor-header').clientWidth],
          raw: [...document.querySelectorAll('button, label, .tab-label, h2, h3')].filter((el) => /^[a-z]+(\\.[A-Za-z0-9]+)+$/.test(el.textContent.trim())).map((el) => el.textContent.trim()),
          cut: [...document.querySelectorAll('.tab-label, .activity-item, .statusbar *, .glyph-tools button, .view-toolbar button')].filter((el) => el.children.length === 0 && el.textContent.trim() && cut(el)).map((el) => el.textContent.trim()),
        }`);
      overflowing[id] = state.cut.concat(state.tabsWidth[0] > state.tabsWidth[1] + 1 ? [`tab bar ${state.tabsWidth}`] : []);
      check(`the interface switches to ${id}`, state.lang === id && state.tabs.length === 9 && state.tabs.every((x) => x) && new Set(state.tabs).size === 9 && state.raw.length === 0, JSON.stringify(state));
      await shot(`20-glyph-${id}`);
      if (id === 'de' || id === 'fr') {
        await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", ctrlKey: true }))');
        await settle();
        await shot(`21-family-${id}`);
        await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", ctrlKey: true }))');
        await settle();
        await shot(`22-export-${id}`);
        await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))');
        await settle();
      }
    }
    check('no label of the tabs, tools or status bar is cut off in any language', Object.values(overflowing).every((list) => list.length === 0), JSON.stringify(overflowing));

    // ---- Portuguese: the window reloads and the project comes back
    await js('const s = document.querySelector(".status-select"); s.value = "pt-BR"; s.dispatchEvent(new Event("change"));');
    await sleep(600);
    await ready();
    await settle();
    const pt = await js(`return {
      lang: document.documentElement.lang,
      tabs: [...document.querySelectorAll('.tab-label')].map((x) => x.textContent),
      name: document.querySelector('.project-name')?.textContent,
      theme: document.documentElement.dataset.theme,
    }`);
    check('the interface switches to Portuguese', pt.lang === 'pt-BR' && pt.tabs.join() === 'Fonte,Glifo,Prova,Features,Família,Verificar,Scripts,Informações,Kerning', JSON.stringify(pt));
    check('the project and the theme come back after the reload', /Example Serif/.test(pt.name || '') && pt.theme === 'amsterdam', JSON.stringify(pt));
    await shot('10-font-pt-amsterdam');
    await menu('.status-theme', /Daca/);
    await js('window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true }))');
    await settle();
    await shot('11-glyph-pt-daca');

    // ---- about and versions dialogs (the versions dialog must not touch the network by itself)
    await js('document.querySelector(".status-version").click()');
    await settle();
    check('clicking the version opens the versions dialog without checking', /Verifique se já foi publicada/.test(await js('return document.querySelector(".update-dialog").textContent')));
    await shot('12-versions-pt');
    await js('document.querySelector(".update-dialog .btn-secondary").click()');
    await js('document.querySelectorAll(".activity-bottom .activity-item")[1].click()');
    await settle();
    check('the about dialog says the project is experimental', /experimental/.test(await js('return document.querySelector(".about-dialog")?.textContent || ""')));
    await shot('13-about-pt');

    check('no errors in the console', errors.length === 0, errors.slice(0, 5).join('\n   '));
  } catch (err) {
    failed++;
    console.log('✗ the test stopped:', err.stack || err.message);
  } finally {
    console.log(failed ? `${failed} of ${count} checks failed` : `${count} checks passed`);
    try { fs.rmSync(userData, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
    app.exit(failed ? 1 : 0);
  }
});
