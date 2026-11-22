/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Tests of the engine behind editing: operations on the font model, features and shaping, validation,
// interpolation, writing UFO projects, compiling and importing TrueType fonts, WOFF2, scripts, the
// command line and the server for AI agents. No window is opened.
// Usage: node tools/test-engine.js   (exit code 1 when something fails)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { readUfo } = require('../src/platform/project/node/ufoReader');
const { writeUfo, writeGlif, glyphFileName } = require('../src/platform/project/node/ufoWriter');
const { parsePlist, writePlist } = require('../src/platform/project/node/xml');
const { parseGlif } = require('../src/platform/project/node/ufoReader');
const { readTtf, MAC_NAMES } = require('../src/platform/project/node/ttfReader');
const { ttfToWoff2 } = require('../src/platform/project/node/woff2');
const { run } = require('../src/platform/script/node/scriptRunner');

const ROOT = path.join(__dirname, '..');
const SANS = path.join(ROOT, 'examples', 'LionFoundryExampleSans.ufo');
const SERIF = path.join(ROOT, 'examples', 'LionFoundryExampleSerif-Regular.ufo');
let failed = 0;
let count = 0;
async function test(name, fn) {
  count++;
  try { await fn(); console.log('✓', name); } catch (err) { failed++; console.log('✗', name, '\n  ', err.stack.split('\n').slice(0, 6).join('\n   ')); }
}
const square = (x0, y0, x1, y1) => [[x0, y0, 'line'], [x1, y0, 'line'], [x1, y1, 'line'], [x0, y1, 'line']];
const blank = (name, unicodes = [], width = 500) => ({ name, width, unicodes, contours: [], components: [], anchors: [] });
const add = (font, glyph) => { font.glyphs[glyph.name] = glyph; font.glyphOrder.push(glyph.name); return glyph; };

(async () => {
  const model = await import('../src/base/common/fontModel.js');
  const geo = await import('../src/base/common/glyphPath.js');
  const fea = await import('../src/base/common/features.js');
  const { shape } = await import('../src/base/common/shaper.js');
  const { checkFont, checkGlyph, missingCharacters } = await import('../src/base/common/validate.js');
  const interp = await import('../src/base/common/interpolate.js');
  const { compileTtf, cubicToQuadratics, styleLinking, shapesOverlap } = await import('../src/base/common/ttfWriter.js');
  const weights = await import('../src/base/common/weights.js');
  const outline = await import('../src/base/common/outlineEdit.js');
  // the sans example holds two weights in one project: each one as a font of its own
  const regularOf = () => weights.weightFont(readUfo(SANS), 'regular');
  const boldOf = () => weights.weightFont(readUfo(SANS), 'bold');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lionfoundry-engine-'));
  const cmapOf = (font) => { const m = new Map(); for (const n of font.glyphOrder) for (const u of font.glyphs[n].unicodes) if (!m.has(u)) m.set(u, n); return (c) => m.get(c) || null; };

  // ---------------------------------------------------------------- the font model
  await test('model: reversing a contour keeps its shape and flips its direction', () => {
    const font = readUfo(SANS);
    for (const name of ['O', 'a', 'S', 'n']) {
      for (const contour of font.glyphs[name].contours) {
        const reversed = model.reverseContour(contour);
        assert.strictEqual(reversed.length, contour.length);
        assert.ok(Math.abs(model.contourArea(reversed) + model.contourArea(contour)) < 1e-6, `${name}: area`);
        const a = geo.commandsBounds(geo.contourCommands(contour)); const b = geo.commandsBounds(geo.contourCommands(reversed));
        for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${name}: ${k}`);
        assert.deepStrictEqual(model.reverseContour(reversed).map((p) => p.slice(0, 3)).sort(), contour.map((p) => p.slice(0, 3)).sort());
      }
    }
    const open = [[0, 0, 'move'], [10, 0, 'offcurve'], [20, 10, 'offcurve'], [20, 20, 'curve'], [40, 20, 'line']];
    assert.deepStrictEqual(model.reverseContour(open), [[40, 20, 'move'], [20, 20, 'line'], [20, 10, 'offcurve'], [10, 0, 'offcurve'], [0, 0, 'curve']]);
  });

  await test('model: side bearings, transforms, deleting points', () => {
    const font = readUfo(SANS);
    const h = font.glyphs.H;
    const before = model.glyphBounds(font, 'H');
    model.setLeftMargin(font, h, before.xMin + 25);
    model.setRightMargin(font, h, 40);
    const after = model.glyphBounds(font, 'H');
    assert.strictEqual(after.xMin, before.xMin + 25);
    assert.strictEqual(h.width - after.xMax, 40);
    assert.strictEqual(after.xMax - after.xMin, before.xMax - before.xMin);

    const g = { ...blank('x'), contours: [square(0, 0, 100, 200)], anchors: [{ name: 'top', x: 50, y: 200 }] };
    model.transformGlyph(g, model.scaling(2, 0.5));
    assert.deepStrictEqual(g.contours[0].map((p) => [p[0], p[1]]), [[0, 0], [200, 0], [200, 100], [0, 100]]);
    assert.deepStrictEqual(g.anchors[0], { name: 'top', x: 100, y: 100 });
    const area = model.contourArea(g.contours[0]);
    model.transformGlyph(g, model.scaling(-1, 1, 100, 0));
    assert.ok(Math.sign(model.contourArea(g.contours[0])) === Math.sign(area), 'a mirror keeps the direction of the contour');
    model.transformGlyph(g, model.rotation(90));
    assert.deepStrictEqual(geo.commandsBounds(geo.contourCommands(g.contours[0])), { xMin: -100, yMin: 0, xMax: 0, yMax: 200 });

    const curve = [[0, 0, 'line'], [100, 0, 'line'], [100, 50, 'offcurve'], [50, 100, 'offcurve'], [0, 100, 'curve']];
    assert.deepStrictEqual(model.deletePoints(curve, [2]), [[0, 0, 'line'], [100, 0, 'line'], [0, 100, 'line']]);
    assert.deepStrictEqual(model.deletePoints(curve, [4]), [[0, 0, 'line'], [100, 0, 'line']]);
    assert.strictEqual(model.deletePoints(curve, [0, 1]), null);
  });

  await test('model: composites, rename and remove follow every reference', () => {
    const font = readUfo(SANS);
    const built = model.buildComposite(font, 'edieresis', 'e', 'dieresis', [0xEB]);
    assert.deepStrictEqual(built.components.map((c) => c.base), ['e', 'dieresis']);
    const top = font.glyphs.e.anchors.find((a) => a.name === 'top'); const mark = font.glyphs.dieresis.anchors.find((a) => a.name === '_top');
    assert.deepStrictEqual(built.components[1].transform.slice(4), [top.x - mark.x, top.y - mark.y]);
    assert.strictEqual(model.buildComposite(font, 'x', 'e', 'cedilla.none'), null);

    assert.ok(model.usersOf(font, 'A').includes('Aacute'));
    assert.strictEqual(model.kerningGroupOf(font, 'Aacute', 1), 'public.kern1.A');
    model.renameGlyph(font, 'A', 'A.new');
    assert.ok(!font.glyphs.A && font.glyphs['A.new'] && font.glyphOrder.includes('A.new'));
    assert.strictEqual(font.glyphs.Aacute.components[0].base, 'A.new');
    assert.ok(font.groups['public.kern1.A'].includes('A.new') && !font.groups['public.kern1.A'].includes('A'));
    const contours = geo.glyphCommands(font, 'Aacute').length;
    model.removeGlyph(font, 'A.new');
    assert.ok(!font.groups['public.kern1.A'].includes('A.new'));
    assert.strictEqual(font.glyphs.Aacute.components.length, 0, 'glyphs that used it keep a copy of the outline');
    assert.strictEqual(geo.glyphCommands(font, 'Aacute').length, contours);
    assert.ok(model.isValidGlyphName('a.sc') && model.isValidGlyphName('.notdef') && !model.isValidGlyphName('1a') && !model.isValidGlyphName('a b'));
    assert.deepStrictEqual([0x41, 0x35, 0xE9, 0x1F600].map(model.suggestGlyphName), ['A', 'five', 'uni00E9', 'u1F600']);
  });

  // ---------------------------------------------------------------- features and shaping
  await test('features: built from glyph names, rules and code; what is not compiled is reported', () => {
    const font = readUfo(SANS);
    add(font, blank('f_i')); add(font, blank('a.sc')); add(font, blank('one.onum')); add(font, blank('a.ss03')); add(font, blank('_part'));
    font.lib[fea.FEATURES_KEY] = { rules: [{ feature: 'dlig', type: 'ligature', from: ['T', 'h'], to: 'T' }, { feature: 'zero', type: 'single', from: 'zero', to: 'nope' }] };
    font.features += '@caps = [A B];\nfeature case { sub @caps by [C D]; lookup x { sub f f by f; } x; } case;\nfeature kern { pos T o -33; }\nfeature calt { sub a\' b by c; } calt;\ntable OS/2 { TypoAscender 900; } OS/2;\n';
    const plan = fea.buildLayout(font);
    assert.deepStrictEqual(fea.layoutFeatures(plan), ['smcp', 'case', 'onum', 'ss03', 'liga', 'dlig', 'kern']);
    assert.deepStrictEqual(plan.gsub.find((f) => f.tag === 'case').lookups.map((l) => l.type), ['single', 'ligature']);
    assert.deepStrictEqual(plan.gsub.find((f) => f.tag === 'case').lookups[0].map, { A: 'C', B: 'D' });
    assert.strictEqual(plan.kerning.get('A').get('V'), -70, 'group kerning is expanded to glyph pairs');
    assert.strictEqual(plan.kerning.get('Atilde').get('V'), -70);
    assert.strictEqual(plan.kerning.get('T').get('o'), -33, 'pairs in feature code are added');
    const first = readUfo(SANS).features.split('\n').length - 1;
    assert.deepStrictEqual(plan.warnings.map((w) => w.line - first), [4, 5], 'warnings carry the line of the code they are about');
    font.lib[fea.FEATURES_KEY].auto = { liga: false, kern: false };
    const off = fea.buildLayout(font);
    assert.ok(!fea.layoutFeatures(off).includes('liga') && off.kerning.get('A') === undefined && off.kerning.get('T').get('o') === -33);
    const code = fea.generateFeatureCode(readUfo(SANS));
    assert.ok(/@kern1_A = \[A Aacute/.test(code) && /pos @kern1_A @kern2_V -70;/.test(code));
    assert.deepStrictEqual(fea.parseFeatureCode(code, readUfo(SANS)).warnings, [], 'the generated code is understood by the reader');
  });

  await test('shaper: substitutions, ligatures, kerning, mark attachment, features on and off', () => {
    const font = readUfo(SANS);
    add(font, blank('f_i', [], 480)); add(font, blank('a.sc', [], 520));
    add(font, { ...blank('acutecomb', [0x301], 0), anchors: [{ name: '_top', x: 100, y: 500 }] });
    const plan = fea.buildLayout(font);
    const cmap = cmapOf(font);
    const a = shape(font, plan, 'AVfi a', { cmap });
    assert.deepStrictEqual(a.glyphs.map((g) => g.name), ['A', 'V', 'f_i', 'space', 'a']);
    assert.strictEqual(a.glyphs[1].x, font.glyphs.A.width - 70);
    assert.deepStrictEqual(a.steps.map((s) => s.feature), ['liga', 'kern']);
    const b = shape(font, plan, 'AVfi a', { cmap, features: { kern: false, liga: false, smcp: true } });
    assert.deepStrictEqual(b.glyphs.map((g) => g.name), ['A', 'V', 'f', 'i', 'space', 'a.sc']);
    assert.strictEqual(b.glyphs[1].x, font.glyphs.A.width);
    const c = shape(font, plan, 'éx', { cmap });
    const top = font.glyphs.e.anchors.find((x) => x.name === 'top');
    assert.deepStrictEqual([c.glyphs[1].x, c.glyphs[1].y, c.glyphs[1].advance], [top.x - 100, top.y - 500, 0], 'the accent sits on the anchor of the letter');
    assert.strictEqual(c.glyphs[2].x, font.glyphs.e.width, 'and takes no space');
    assert.deepStrictEqual(shape(font, plan, 'a一', { cmap }).missing, [0x4E00]);
  });

  // ---------------------------------------------------------------- validation and interpolation
  await test('validation: the examples have no glyph problems; broken glyphs are found', () => {
    for (const [label, example] of [['sans regular', regularOf()], ['sans bold', boldOf()], ['serif', readUfo(SERIF)]]) {
      const problems = checkFont(example);
      assert.deepStrictEqual(problems.filter((p) => p.glyph), [], label);
      assert.strictEqual(problems.filter((p) => p.level === 'error').length, 0);
    }
    const font = readUfo(SANS);
    add(font, { ...blank('open', [0xE000]), contours: [[[0, 0, 'move'], [100, 0, 'line'], [100, 100, 'line']]] });
    add(font, { ...blank('twin', [0x41]), contours: [square(0, 0, 100, 100)] });
    add(font, { ...blank('backwards', [0xE001]), contours: [model.reverseContour(square(0, 0, 100, 100))] });
    add(font, { ...blank('lost', [0xE002]), components: [{ base: 'gone', transform: [1, 0, 0, 1, 0, 0] }] });
    add(font, { ...blank('doubled', [0xE003]), contours: [[[0, 0, 'line'], [0, 0, 'line'], [100, 0, 'line'], [100, 100.5, 'line']]] });
    add(font, blank('void', [0xE004]));
    font.kerning.nobody = { A: -10 };
    delete font.info.familyName;
    const codes = (name) => checkGlyph(font, name).map((p) => p.code);
    assert.deepStrictEqual(codes('open'), ['openContour']);
    assert.deepStrictEqual(codes('backwards'), ['wrongDirection']);
    assert.deepStrictEqual(codes('lost'), ['missingComponent']);
    assert.deepStrictEqual(codes('doubled'), ['duplicatePoints', 'offGrid']);
    assert.deepStrictEqual(codes('void'), ['emptyGlyph']);
    const all = checkFont(font).map((p) => p.code);
    for (const code of ['noFamilyName', 'duplicateUnicode', 'unknownKerningSide', 'missingCharacters']) assert.ok(all.includes(code), code);
    assert.ok(missingCharacters(readUfo(SANS), 'portuguese').every((ch) => !'áàâãçéêíóôõú'.includes(ch)), 'the accented letters of Portuguese are there');
  });

  await test('interpolation: masters, what is not compatible, the font in between, designspace', () => {
    const a = regularOf(); const b = boldOf();
    const report = interp.compatibilityReport(a, b);
    assert.ok(report.length > 0 && report.length < 12, `${report.length} incompatible glyphs`);
    assert.ok(report.every((p) => ['contours', 'points', 'pointTypes', 'components', 'missing'].includes(p.reason)));
    assert.strictEqual(interp.incompatibility(a.glyphs.H, b.glyphs.H), null);
    const { font: mid, skipped } = interp.instanceAt([{ location: 400, font: a }, { location: 700, font: b }], 550, 'Medium');
    assert.strictEqual(skipped.length, report.length);
    assert.strictEqual(mid.glyphs.H.width, Math.round((a.glyphs.H.width + b.glyphs.H.width) / 2));
    const stem = (font) => { const xs = [...new Set(font.glyphs.I.contours[0].map((p) => p[0]))].sort((x, y) => x - y); return xs[xs.length - 1] - xs[0]; };
    assert.ok(stem(a) < stem(mid) && stem(mid) < stem(b), `stems ${stem(a)} < ${stem(mid)} < ${stem(b)}`);
    assert.strictEqual(mid.info.styleName, 'Medium');
    assert.deepStrictEqual(interp.instanceAt([{ location: 400, font: a }, { location: 700, font: b }], 400).font.glyphs.O, a.glyphs.O);
    assert.strictEqual(checkFont(mid).filter((p) => p.level === 'error').length, 0);
    const xml = interp.designspaceXml({ axis: 'Weight', tag: 'wght', masters: [{ filename: 'A.ufo', familyName: 'F & Co', styleName: 'Regular', location: 400 }, { filename: 'B.ufo', familyName: 'F & Co', styleName: 'Bold', location: 700 }] });
    assert.ok(/<axis tag="wght" name="Weight" minimum="400" maximum="700" default="400"\/>/.test(xml) && /familyname="F &amp; Co"/.test(xml));
  });

  // ---------------------------------------------------------------- reference lines and the magnet
  await test('magnet: positions are pulled onto the lines near them, and only those', async () => {
    const { snapPoint, lineKind, distanceToLine, newGuideline } = await import('../src/base/common/snap.js');
    const lines = [{ y: 0 }, { y: 500 }, { x: 0 }, { x: 600 }, { x: 100, y: 100, angle: 45 }];
    assert.deepStrictEqual(lines.map(lineKind), ['h', 'h', 'v', 'v', 'd']);
    assert.deepStrictEqual(snapPoint(300, 6, lines, 8), { x: 300, y: 0, hits: [0] }, 'a horizontal line holds the height only');
    assert.deepStrictEqual(snapPoint(300, 9, lines, 8), { x: 300, y: 9, hits: [] }, 'out of reach: nothing moves');
    assert.deepStrictEqual(snapPoint(595, 497, lines, 8), { x: 600, y: 500, hits: [1, 3] }, 'a corner: one horizontal and one vertical line');
    assert.deepStrictEqual(snapPoint(300, 251, [{ y: 250 }, { y: 255 }], 8).hits, [0], 'the nearest of two lines wins');
    const d = snapPoint(300, 306, lines, 8);
    assert.ok(Math.abs(d.x - 303) < 1e-9 && Math.abs(d.y - 303) < 1e-9 && d.hits.join() === '4', 'the nearest spot on a diagonal');
    const cross = snapPoint(497, 495, lines, 8);
    assert.ok(Math.abs(cross.x - 500) < 1e-9 && cross.y === 500 && cross.hits.join() === '1,4', 'where a diagonal crosses a horizontal line');
    assert.ok(Math.abs(distanceToLine({ x: 0, y: 0, angle: 90 }, 7, 123) - 7) < 1e-9 && Math.abs(distanceToLine({ x: 0, y: 0, angle: 30 }, 0, 10) - 10 * Math.cos(Math.PI / 6)) < 1e-9);
    assert.deepStrictEqual([newGuideline('h', 10.4, 20.6), newGuideline('v', 10.4, 20.6), newGuideline('d', 10.4, 20.6)], [{ y: 21 }, { x: 10 }, { x: 10, y: 21, angle: 45 }]);
  });

  await test('reference lines: kept in the project, moved with the drawing, reachable from scripts', async () => {
    const font = readUfo(SANS);
    font.glyphs.H.guidelines = [{ y: 350, name: 'bar' }, { x: 120 }, { x: 40, y: 0, angle: 78.5, color: '1,0,0,1' }];
    const out = path.join(tmp, 'guides.ufo');
    writeUfo(out, font);
    assert.ok(/<guideline y="350" name="bar"\/>\n  <guideline x="120"\/>\n  <guideline x="40" y="0" angle="78.5" color="1,0,0,1"\/>/.test(fs.readFileSync(path.join(out, 'glyphs', 'H_.glif'), 'utf8')));
    const back = readUfo(out);
    assert.deepStrictEqual(back.glyphs.H.guidelines, font.glyphs.H.guidelines);
    assert.strictEqual(back.glyphs.A.guidelines, undefined);
    const lsb = model.glyphBounds(back, 'H').xMin;
    model.setLeftMargin(back, back.glyphs.H, lsb + 30);
    assert.deepStrictEqual(back.glyphs.H.guidelines.map((g) => [g.x, g.y]), [[undefined, 350], [150, undefined], [70, 0]], 'a new left bearing shifts the drawing and its lines together');
    model.transformGlyph(back.glyphs.H, model.scaling(2, 2));
    assert.strictEqual(back.glyphs.H.guidelines[0].y, 350, 'scaling the outline leaves the reference lines where they are');
    const res = await run({ language: 'javascript', font, code: "font.A.appendGuideline(0, 480, 0, 'x'); font.A.appendGuideline(200, 0, 90); font.A.appendGuideline(10, 20, 30); print(font.H.guidelines.length, font.A.guidelines.length)" });
    assert.strictEqual(res.output, '3 3');
    assert.deepStrictEqual(res.font.glyphs.A.guidelines, [{ y: 480, name: 'x' }, { x: 200 }, { x: 10, y: 20, angle: 30 }]);
    const py = await run({ language: 'python', font, code: "font['A'].appendGuideline((0, 480), 0, 'x'); font['A'].appendGuideline((200, 0), 90); font['A'].appendGuideline((10, 20), 30)\nprint(len(font['H'].guidelines), len(font['A'].guidelines))" });
    if (py.error !== 'pythonMissing') assert.deepStrictEqual([py.output.trim(), py.font.glyphs.A.guidelines], ['3 3', [{ y: 480, name: 'x' }, { x: 200 }, { x: 10, y: 20, angle: 30 }]]);
  });

  // ---------------------------------------------------------------- points and handles
  await test('outline: a point is added without changing the shape, and removed giving the curve back', () => {
    const font = readUfo(SERIF);
    for (const name of ['O', 'S', 'a', 'n', 'H']) {
      font.glyphs[name].contours.forEach((contour, ci) => {
        const before = geo.commandsBounds(geo.contourCommands(contour));
        const area = model.contourArea(contour);
        const path = outline.toPath(contour);
        assert.deepStrictEqual(outline.fromPath(path).length, contour.length, 'a path gives its contour back');
        for (let seg = 0; seg < path.segs.length; seg++) {
          const res = outline.insertPoint(contour.map((p) => [...p]), seg, 0.37);
          assert.ok(res && model.isOn(res.contour[res.index]), `${name}: point added`);
          const added = res.contour.length - contour.length;
          assert.ok(added === 1 || added === 3, `${name}: a line gains one point, a curve a point and two handles`);
          const after = geo.commandsBounds(geo.contourCommands(res.contour));
          for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) assert.ok(Math.abs(after[k] - before[k]) <= 1, `${name}/${ci}/${seg}: ${k} ${before[k]} → ${after[k]}`);
          // the control polygon is not the outline, but it moves very little for an unchanged shape
          const back = outline.removePoint(res.contour, res.index);
          assert.strictEqual(back.length, contour.length, `${name}: removing the point gives back the same number of points`);
          const again = geo.commandsBounds(geo.contourCommands(back));
          for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) assert.ok(Math.abs(again[k] - before[k]) <= 3, `${name}/${ci}/${seg}: after removing, ${k} ${before[k]} → ${again[k]}`);
          assert.ok(Math.sign(model.contourArea(back)) === Math.sign(area));
        }
      });
    }
    const o = font.glyphs.O;
    const spot = outline.nearestOnOutline(o, model.glyphBounds(font, 'O').xMin - 5, 350);
    assert.ok(spot && spot.distance < 8 && spot.t >= 0 && spot.t <= 1, JSON.stringify(spot));
    const square = [[0, 0, 'line'], [100, 0, 'line'], [100, 100, 'line'], [0, 100, 'line']];
    assert.deepStrictEqual(outline.nearestOnOutline({ contours: [square] }, 50, -7), { contour: 0, segment: 0, t: 0.5, x: 50, y: 0, distance: 7 });
    assert.deepStrictEqual(outline.insertPoint(square, 0, 0.5), { contour: [[0, 0, 'line'], [50, 0, 'line'], [100, 0, 'line'], [100, 100, 'line'], [0, 100, 'line']], index: 1 });
    assert.deepStrictEqual(outline.removePoint([[0, 0, 'line'], [50, 0, 'line'], [100, 0, 'line'], [100, 100, 'line']], 1), [[0, 0, 'line'], [100, 0, 'line'], [100, 100, 'line']]);
    assert.strictEqual(outline.removePoint([[0, 0, 'line'], [100, 0, 'line']], 0), null, 'nothing is left of a contour with one point');
    // removing the first point of a closed contour works like any other
    const circle = font.glyphs.o.contours[0];
    const first = circle.findIndex(model.isOn);
    assert.strictEqual(outline.removePoint(circle.map((p) => [...p]), first).filter(model.isOn).length, circle.filter(model.isOn).length - 1);
  });

  await test('outline: a handle is turned horizontal, vertical, to 45° or to a typed angle', () => {
    const make = () => [[0, 0, 'curve', 1], [37, 12, 'offcurve'], [80, 60, 'offcurve'], [100, 100, 'curve'], [100, 140, 'offcurve'], [-30, -9, 'offcurve']];
    let c = make();
    assert.deepStrictEqual(outline.handleAnchor(c, 1), [0, c[0]]);
    assert.deepStrictEqual(outline.handleAnchor(c, 5), [0, c[0]]);
    assert.ok(Math.abs(outline.handleAngle(c, 1) - 17.97) < 0.01);
    const len = Math.hypot(37, 12);
    assert.ok(outline.alignHandle(c, 1, 'h') && c[1][1] === 0 && c[1][0] === Math.round(len), 'horizontal, on the side it was, same length');
    c = make(); outline.alignHandle(c, 5, 'h');
    assert.deepStrictEqual([c[5][0], c[5][1]], [-Math.round(Math.hypot(30, 9)), 0], 'the handle on the left stays on the left');
    c = make(); outline.alignHandle(c, 1, 'v');
    assert.deepStrictEqual([c[1][0], c[1][1]], [0, Math.round(len)]);
    c = make(); outline.alignHandle(c, 1, 'd');
    assert.ok(c[1][0] === c[1][1] && c[1][0] === Math.round(len * Math.SQRT1_2), '45°: equal steps right and up');
    c = make(); outline.alignHandle(c, 5, 30);
    assert.ok(Math.abs(outline.handleAngle(c, 5) - 210) < 1.5, 'a typed angle is a direction: the handle keeps its side');
    c = make(); outline.alignHandle(c, 5, 30, true);
    assert.ok(Math.abs(outline.handleAngle(c, 5) - 30) < 1.5, 'unless the exact angle is asked for');
    c = make(); outline.alignHandle(c, 1, 'h');
    assert.strictEqual(outline.alignHandle(c, 1, 'h'), false, 'already there: nothing to do');
    assert.strictEqual(outline.alignHandle(c, 0, 'h'), false, 'a point on the curve is not a handle');
    assert.deepStrictEqual(outline.constrainToAngles([0, 0], 50, 4), [50, 0]);
    assert.deepStrictEqual(outline.constrainToAngles([10, 10], 12, 90), [10, 90]);
    const d = outline.constrainToAngles([0, 0], 60, 50);
    assert.ok(Math.abs(d[0] - 55) < 1e-9 && Math.abs(d[1] - 55) < 1e-9);
  });

  // ---------------------------------------------------------------- weights in one project
  await test('weights: several weights live in one project, as layers that other tools can read', async () => {
    const font = readUfo(SANS);
    assert.deepStrictEqual(font.weights.map((w) => [w.id, w.name, w.location]), [['regular', 'Regular', 400], ['bold', 'Bold', 700]]);
    assert.ok(font.weight === 'regular' && !font.weights[0].glyphs && Object.keys(font.weights[1].glyphs).length === 114 && !('org.lionfoundry.weights' in font.lib));
    const regularH = model.clone(font.glyphs.H); const boldH = model.clone(font.weights[1].glyphs.H);
    assert.notDeepStrictEqual(regularH.contours, boldH.contours);
    assert.strictEqual(weights.weightFont(font, 'bold').info.styleName, 'Bold');
    assert.strictEqual(weights.weightFont(font, 'bold').info.other.openTypeOS2WeightClass, 700);
    const notInterpolable = checkFont(font).filter((p) => p.code === 'notInterpolable');
    assert.ok(notInterpolable.length > 0 && notInterpolable.length < 12 && notInterpolable.every((p) => /^Bold: /.test(p.detail)));

    // switching: the bold becomes "the font", the regular waits in its entry
    assert.ok(weights.switchWeight(font, 'bold') && font.weight === 'bold');
    assert.deepStrictEqual(font.glyphs.H, boldH);
    assert.deepStrictEqual(font.weights[0].glyphs.H, regularH);
    assert.ok(!font.weights[1].glyphs && !weights.switchWeight(font, 'bold') && !weights.switchWeight(font, 'nope'));

    // saved with the bold active, the project is the same on disk: the first weight is the default layer
    const out = path.join(tmp, 'weights.ufo');
    writeUfo(out, font);
    const back = readUfo(out);
    assert.deepStrictEqual(back.glyphs.H, regularH);
    assert.deepStrictEqual(back.weights[1].glyphs.H, boldH);
    assert.deepStrictEqual(back.weights[1].kerning, font.kerning);
    assert.deepStrictEqual(parsePlist(fs.readFileSync(path.join(out, 'layercontents.plist'), 'utf8')), [['public.default', 'glyphs'], ['Bold', 'glyphs.B_old']]);

    // a third weight starts as a copy of the one being worked on; glyph changes reach every weight
    const id = weights.addWeight(back, { name: 'Extra Bold', location: 800 });
    assert.strictEqual(id, 'extra-bold');
    assert.deepStrictEqual(weights.weightEntry(back, id).glyphs.H, regularH);
    add(back, { ...blank('New', [0xE000]), contours: [square(0, 0, 10, 10)] });
    weights.eachOtherWeight(back, (w) => model.removeGlyph(w, 'B'));
    model.removeGlyph(back, 'B');
    weights.reconcileWeights(back);
    for (const w of back.weights.slice(1)) assert.ok(w.glyphs.New && !w.glyphs.B && Object.keys(w.glyphs).length === back.glyphOrder.length, w.name);
    writeUfo(out, back);
    const third = readUfo(out);
    assert.deepStrictEqual(third.weights.map((w) => w.name), ['Regular', 'Bold', 'Extra Bold']);
    assert.ok(fs.existsSync(path.join(out, 'glyphs.E_xtra B_old', 'contents.plist')) && third.weights[2].glyphs.New && !third.weights[1].glyphs.B);
    assert.strictEqual(third.warnings.length, 0);

    // a weight that is removed takes its layer with it; the weight being worked on cannot be removed
    assert.ok(!weights.removeWeight(third, 'regular') && weights.removeWeight(third, 'bold'));
    writeUfo(out, third);
    assert.ok(!fs.existsSync(path.join(out, 'glyphs.B_old')) && fs.existsSync(path.join(out, 'glyphs.E_xtra B_old')));
    assert.deepStrictEqual(readUfo(out).weights.map((w) => w.name), ['Regular', 'Extra Bold']);
    weights.removeWeight(third, 'extra-bold');
    writeUfo(out, third);
    const single = readUfo(out);
    assert.ok(single.weights === undefined && fs.readdirSync(out).filter((n) => n.startsWith('glyphs')).join() === 'glyphs' && !('org.lionfoundry.weights' in single.lib));

    // masters for interpolation, and another project brought in as a weight
    const masters = weights.weightMasters(readUfo(SANS));
    assert.deepStrictEqual(masters.map((m) => [m.name, m.location, m.font.info.styleName]), [['Regular', 400, 'Regular'], ['Bold', 700, 'Bold']]);
    const host = readUfo(SERIF);
    const res = weights.importWeight(host, regularOf(), { name: 'Sans', location: 300 });
    assert.ok(res.missing.length === 0 && host.weights.length === 2 && host.weights[0].name === 'Regular' && host.weight === 'regular');
    assert.deepStrictEqual(weights.weightData(host, res.id).glyphs.H.contours, regularH.contours);
  });

  // ---------------------------------------------------------------- a whole family
  await test('family: italics are a group of their own, instances are calculated, every style is exported', () => {
    const font = readUfo(SANS);
    // an italic of the regular: its own style, slanted, never mixed with the uprights
    const id = weights.addWeight(font, { name: 'Italic', location: 400, italic: true, angle: -12 });
    assert.strictEqual(weights.weightFont(font, id).info.italicAngle, -12);
    assert.strictEqual(weights.weightFont(font, 'regular').info.italicAngle, undefined);
    assert.deepStrictEqual(weights.weightMasters(font).map((m) => m.name), ['Regular', 'Bold']);
    assert.deepStrictEqual(weights.weightMasters(font, true).map((m) => m.name), ['Italic']);
    assert.deepStrictEqual(weights.siblingWeights(font).map((w) => w.name), ['Bold']);
    // styles that are not drawn: listed in the lib, calculated inside their group
    font.lib[weights.INSTANCES_KEY] = [{ name: 'Medium', location: 500 }, { name: 'SemiBold', location: 600 }, { name: 'Medium Italic', location: 500, italic: true }, { name: 'Bold', location: 700 }];
    const styles = weights.familyStyles(font);
    assert.deepStrictEqual(styles.map((x) => [x.name, x.kind, x.location, x.italic]),
      [['Regular', 'weight', 400, false], ['Italic', 'weight', 400, true], ['Medium', 'instance', 500, false], ['SemiBold', 'instance', 600, false], ['Bold', 'weight', 700, false]],
      'an instance of a group with one weight waits; one that is drawn already is not repeated');
    const medium = styles[2].font;
    assert.strictEqual(medium.info.styleName, 'Medium');
    assert.strictEqual(medium.info.other.openTypeOS2WeightClass, 500);
    const w = (f) => f.glyphs.H.width;
    assert.ok(w(medium) > Math.min(w(styles[0].font), w(styles[4].font)) - 1 && w(medium) < Math.max(w(styles[0].font), w(styles[4].font)) + 1);
    for (const style of styles) assert.ok(compileTtf(style.font).bytes.length > 1000, style.name);

    // the italic and the instances survive saving
    const out = path.join(tmp, 'family.ufo');
    writeUfo(out, font);
    const back = readUfo(out);
    assert.deepStrictEqual(back.weights.map((x) => [x.name, !!x.italic, x.angle]), [['Regular', false, undefined], ['Bold', false, undefined], ['Italic', true, -12]]);
    assert.strictEqual(weights.instances(back).length, 4);

    // names: programs that only know Regular / Italic / Bold / Bold Italic still find every style
    const link = (styleName) => styleLinking({ familyName: 'Fam', styleName });
    assert.deepStrictEqual(link('Bold Italic'), { group: 'Fam', linked: 'Bold Italic', ribbi: true });
    assert.deepStrictEqual(link('Light'), { group: 'Fam Light', linked: 'Regular', ribbi: false });
    assert.deepStrictEqual(link('Light Italic'), { group: 'Fam Light', linked: 'Italic', ribbi: false });
  });

  await test('family: the structure of a glyph can follow another weight; overlapping shapes are marked', () => {
    const font = readUfo(SANS);
    const bold = font.weights[1].glyphs;
    for (const name of ['B', 'o', 'e', 'dieresis', 'g']) {
      const g = JSON.parse(JSON.stringify(font.glyphs[name]));
      const shape0 = JSON.stringify(model.glyphBounds({ glyphs: { [name]: g } }, name));
      // scrambled: contours in another order, another start point, the first one turned
      g.contours = g.contours.map((c, i) => { const k = c.findIndex((p, j) => j > 1 && p[2] !== 'offcurve'); const r = k > 0 ? outline.setStartPoint(c, k) : c; return i === 0 ? model.reverseContour(r) : r; }).reverse();
      const res = outline.matchStructure(g, bold[name]);
      assert.ok(res && res.changed, name);
      g.contours = res.contours;
      assert.strictEqual(interp.incompatibility(g, bold[name]), null, name);
      assert.strictEqual(JSON.stringify(model.glyphBounds({ glyphs: { [name]: g } }, name)), shape0, 'the shape is the same');
    }
    assert.strictEqual(outline.matchStructure(font.glyphs.M, bold.M), null, 'different points: reordering cannot help');
    const o = JSON.parse(JSON.stringify(font.glyphs.o));
    o.contours = o.contours.map((c) => model.reverseContour(c));
    assert.strictEqual(outline.correctDirections(o), 2);
    assert.strictEqual(outline.correctDirections(o), 0);
    assert.strictEqual(interp.incompatibility(o, font.glyphs.o), null);
    const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    assert.strictEqual(shapesOverlap([sq(0, 0, 100, 100), sq(50, 50, 150, 150)]), true);
    assert.strictEqual(shapesOverlap([sq(0, 0, 100, 100), sq(20, 20, 80, 80).reverse()]), false, 'a counter is not an overlap');
    assert.strictEqual(shapesOverlap([sq(0, 0, 100, 100), sq(200, 0, 300, 100)]), false);
    const f = regularOf();
    f.glyphs.H.contours.push(square(0, 0, 400, 80));
    assert.strictEqual(compileTtf(f).overlapping, compileTtf(regularOf()).overlapping + 1);
  });

  // ---------------------------------------------------------------- UFO writer
  await test('ufo writer: what is written reads back the same, and only what changed is rewritten', () => {
    for (const file of [SANS, SERIF]) {
      const font = readUfo(file);
      const out = path.join(tmp, path.basename(file));
      const layers = font.weights ? font.weights.length : 1; // each weight is a layer of glyph files
      assert.deepStrictEqual(writeUfo(out, font), { written: font.glyphOrder.length * layers, removed: 0 });
      const back = readUfo(out);
      for (const key of ['info', 'glyphOrder', 'groups', 'kerning', 'features', 'lib']) assert.deepStrictEqual(back[key], font[key], key);
      for (const name of font.glyphOrder) assert.deepStrictEqual(back.glyphs[name], font.glyphs[name], name);
      assert.deepStrictEqual(writeUfo(out, back, { glyphs: [] }), { written: 0, removed: 0 });
      back.glyphs.A.width += 1; delete back.glyphs.B; back.glyphOrder = back.glyphOrder.filter((n) => n !== 'B');
      add(back, { ...blank('New.Glyph', [0xE000]), contours: [square(0, 0, 10, 10)] });
      weights.reconcileWeights(back); // a glyph that comes or goes does so in every weight
      assert.deepStrictEqual(writeUfo(out, back, { glyphs: ['A'] }), { written: 1 + layers, removed: layers });
      const again = readUfo(out);
      assert.ok(!again.glyphs.B && again.glyphs['New.Glyph'] && again.glyphs.A.width === back.glyphs.A.width && again.warnings.length === 0);
    }
  });

  await test('ufo writer: file names, and what LionFoundry does not edit is kept', () => {
    const taken = new Set();
    assert.deepStrictEqual(['a', 'A', 'AE', 'f_i', '.notdef', 'con', 'a*b'].map((n) => glyphFileName(n, taken)), ['a.glif', 'A_.glif', 'A_E_.glif', 'f_i.glif', '_notdef.glif', '_con.glif', 'a_b.glif']);
    const source = '<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="x" format="2">\n  <advance width="500" height="1000"/>\n  <unicode hex="0078"/>\n  <note>keep &amp; me</note>\n'
      + '  <guideline x="10" y="20" angle="90" name="g"/>\n  <anchor name="top" x="1.5" y="2" color="1,0,0,1" identifier="an1"/>\n  <outline>\n    <contour>\n'
      + '      <point x="0" y="0" type="line" name="start" identifier="p1"/>\n      <point x="10" y="0" type="line" smooth="yes"/>\n      <point x="10" y="10"/>\n      <point x="0" y="10" type="qcurve"/>\n    </contour>\n'
      + '    <component base="a" xScale="0.5" yOffset="-3" identifier="c1"/>\n  </outline>\n  <lib>\n    <dict>\n      <key>com.example.mark</key>\n      <array>\n        <real>0.5</real>\n        <true/>\n      </array>\n    </dict>\n  </lib>\n</glyph>\n';
    assert.strictEqual(writeGlif(parseGlif(source, 'x')), source);
    const value = { a: 1, b: 1.25, c: [true, false, 'x<y'], d: { '@date': '2026-01-02T03:04:05Z' }, e: { '@data': 'AAEC' }, f: {}, g: [] };
    assert.deepStrictEqual(parsePlist(writePlist(value)), value);
  });

  // ---------------------------------------------------------------- compiling and importing fonts
  await test('ttf: a compiled font reads back with the same glyphs, widths, characters, names and kerning', () => {
    for (const [label, font] of [['regular', regularOf()], ['bold', boldOf()], ['serif', readUfo(SERIF)]]) {
      const result = compileTtf(font, { now: new Date(0) });
      assert.deepStrictEqual(result.warnings, []);
      assert.deepStrictEqual(result.tables, ['GDEF', 'GPOS', 'OS/2', 'cmap', 'gasp', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
      const back = readTtf(Buffer.from(result.bytes), 'x.ttf');
      assert.deepStrictEqual(back.glyphOrder, font.glyphOrder);
      assert.deepStrictEqual(back.warnings, []);
      assert.strictEqual(back.info.familyName, font.info.familyName);
      assert.strictEqual(back.info.styleName, font.info.styleName);
      assert.strictEqual(back.info.other.openTypeOS2WeightClass, label === 'bold' ? 700 : 400);
      const expected = fea.expandKerning(font);
      for (const name of font.glyphOrder) {
        const a = font.glyphs[name]; const b = back.glyphs[name];
        assert.strictEqual(b.width, a.width, `${name}: width`);
        assert.deepStrictEqual(b.unicodes, a.unicodes, `${name}: unicodes`);
        assert.deepStrictEqual(b.components.map((c) => [c.base, ...c.transform]), a.components.map((c) => [c.base, ...c.transform]), `${name}: components`);
        assert.strictEqual(b.contours.length, a.contours.length, `${name}: contours`);
        const x = model.glyphBounds(font, name); const y = model.glyphBounds(back, name);
        if (x) for (const k of ['xMin', 'yMin', 'xMax', 'yMax']) assert.ok(Math.abs(x[k] - y[k]) <= 1.01, `${name}: ${k} ${x[k]} ≠ ${y[k]}`);
        // cubic sources run counter-clockwise outside, TrueType clockwise: the direction must have been turned
        if (a.contours.length) assert.ok(Math.sign(model.contourArea(a.contours[0])) === -Math.sign(model.contourArea(b.contours[0])), `${name}: direction`);
        for (const [right, v] of expected.get(name) || []) assert.strictEqual(back.kerning[name][right], v, `${name} ${right}`);
      }
      // an imported font is quadratic already: compiling it again must give back the very same outlines
      const again = readTtf(Buffer.from(compileTtf(back, { now: new Date(0) }).bytes), 'y.ttf');
      for (const name of back.glyphOrder) assert.deepStrictEqual(again.glyphs[name].contours, back.glyphs[name].contours, name);
      assert.deepStrictEqual(again.kerning, back.kerning);
    }
  });

  await test('ttf: checksums, curve conversion, features and colour tables', () => {
    const font = readUfo(SANS);
    add(font, { ...blank('f_i'), contours: [square(0, 0, 100, 100)] });
    add(font, { ...blank('a.sc'), contours: [square(0, 0, 100, 100)] });
    add(font, { ...blank('acutecomb', [0x301], 0), contours: [square(0, 520, 60, 600)], anchors: [{ name: '_top', x: 30, y: 500 }] });
    font.lib['org.lionfoundry.palette'] = ['#cf874b', '#7b6f9f80'];
    font.lib['org.lionfoundry.colorGlyphs'] = { O: [{ glyph: 'O', color: 0 }, { glyph: 'o', color: 1 }, { glyph: 'nope', color: 0 }] };
    const { bytes, tables, glyphOrder } = compileTtf(font);
    for (const tag of ['GSUB', 'GPOS', 'GDEF', 'COLR', 'CPAL']) assert.ok(tables.includes(tag), tag);
    const buf = Buffer.from(bytes);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 4) sum = (sum + buf.readUInt32BE(i)) >>> 0;
    assert.strictEqual(sum, 0xB1B0AFBA, 'whole-file checksum');
    const table = (tag) => { for (let i = 0; i < buf.readUInt16BE(4); i++) { const at = 12 + i * 16; if (buf.toString('latin1', at, at + 4) === tag) return buf.subarray(buf.readUInt32BE(at + 8), buf.readUInt32BE(at + 8) + buf.readUInt32BE(at + 12)); } return null; };
    assert.strictEqual(table('head').length, 54);
    assert.strictEqual(table('OS/2').length, 96);
    assert.strictEqual(table('maxp').readUInt16BE(4), glyphOrder.length);
    const colr = table('COLR'); const cpal = table('CPAL');
    assert.deepStrictEqual([colr.readUInt16BE(2), colr.readUInt16BE(12)], [1, 2], 'one colour glyph with two layers (the unknown one is left out)');
    assert.deepStrictEqual([...cpal.subarray(14, 22)], [0x4b, 0x87, 0xcf, 0xff, 0x9f, 0x6f, 0x7b, 0x80], 'colours are stored blue, green, red, alpha');
    const gsub = table('GSUB');
    assert.ok(gsub.includes(Buffer.from('liga')) && gsub.includes(Buffer.from('smcp')));
    assert.ok(table('GPOS').includes(Buffer.from('mark')) && table('GPOS').includes(Buffer.from('kern')));

    // a quarter circle: every quadratic piece stays within the tolerance of the cubic
    const p0 = [100, 0]; const c1 = [100, 55.2]; const c2 = [55.2, 100]; const p3 = [0, 100];
    const quads = cubicToQuadratics(p0, c1, c2, p3, 0.5);
    assert.ok(quads.length >= 2 && quads.length <= 4, `${quads.length} pieces`);
    let from = p0;
    for (const [cx, cy, x, y] of quads) {
      for (const t of [0.25, 0.5, 0.75]) {
        const u = 1 - t; const qx = u * u * from[0] + 2 * u * t * cx + t * t * x; const qy = u * u * from[1] + 2 * u * t * cy + t * t * y;
        assert.ok(Math.abs(Math.hypot(qx, qy) - 100) < 0.6, `radius ${Math.hypot(qx, qy)}`);
      }
      from = [x, y];
    }
    assert.deepStrictEqual(from, p3);
    assert.strictEqual(MAC_NAMES.length, 258);
    assert.throws(() => readTtf(Buffer.from('OTTO' + '\0'.repeat(20), 'latin1')), /unsupportedCff/);

    // many kerning pairs: the positioning table switches to 32-bit offsets and still reads back
    const big = readUfo(SANS);
    const names = big.glyphOrder.filter((n) => n !== '.notdef');
    big.kerning = {}; big.groups = {};
    for (const l of names) { big.kerning[l] = {}; for (const r of names) big.kerning[l][r] = -((l.length + r.length) % 9) - 1; }
    const heavy = readTtf(Buffer.from(compileTtf(big).bytes), 'big.ttf');
    assert.strictEqual(Object.values(heavy.kerning).reduce((n, row) => n + Object.keys(row).length, 0), names.length * names.length);
    assert.strictEqual(heavy.kerning.A.V, big.kerning.A.V);
  });

  await test('woff2: the web font holds the same tables, compressed', () => {
    const ttf = Buffer.from(compileTtf(readUfo(SANS)).bytes);
    const woff = ttfToWoff2(ttf);
    assert.strictEqual(woff.toString('latin1', 0, 4), 'wOF2');
    assert.strictEqual(woff.readUInt32BE(8), woff.length);
    assert.strictEqual(woff.readUInt16BE(12), ttf.readUInt16BE(4));
    assert.ok(woff.length < ttf.length * 0.7, `${woff.length} of ${ttf.length} bytes`);
    // walk the table directory, then unpack the data and compare each table with the original
    let at = 48; const entries = [];
    const KNOWN = { 0: 'cmap', 1: 'head', 2: 'hhea', 3: 'hmtx', 4: 'maxp', 5: 'name', 6: 'OS/2', 7: 'post', 10: 'glyf', 11: 'loca', 17: 'gasp', 26: 'GDEF', 27: 'GPOS', 28: 'GSUB' };
    for (let i = 0; i < woff.readUInt16BE(12); i++) {
      const flags = woff[at++]; let length = 0; let b;
      do { b = woff[at++]; length = (length << 7) | (b & 0x7F); } while (b & 0x80);
      entries.push({ tag: KNOWN[flags & 0x3F], length, version: flags >> 6 });
    }
    const data = zlib.brotliDecompressSync(woff.subarray(at, at + woff.readUInt32BE(20)));
    assert.strictEqual(entries.findIndex((e) => e.tag === 'loca'), entries.findIndex((e) => e.tag === 'glyf') + 1);
    let offset = 0;
    for (const e of entries) {
      assert.ok(e.tag, 'known table');
      assert.strictEqual(e.version, e.tag === 'glyf' || e.tag === 'loca' ? 3 : 0);
      let original = null;
      for (let i = 0; i < ttf.readUInt16BE(4); i++) { const p = 12 + i * 16; if (ttf.toString('latin1', p, p + 4) === e.tag) original = ttf.subarray(ttf.readUInt32BE(p + 8), ttf.readUInt32BE(p + 8) + ttf.readUInt32BE(p + 12)); }
      assert.ok(original.equals(data.subarray(offset, offset + e.length)), e.tag);
      offset += e.length;
    }
    assert.strictEqual(offset, data.length);
  });

  // ---------------------------------------------------------------- scripts, command line, server
  await test('scripts: JavaScript changes a copy of the font; errors and endless loops are contained', async () => {
    const font = readUfo(SANS);
    const res = await run({ language: 'javascript', font, selection: ['A', 'nope'], code: `
      print(font.length, font.selection.join(), font.A.leftMargin, font['A'].width, font.has('nope'));
      for (const g of font.selectedGlyphs) g.leftMargin += 10;
      const copy = font.newGlyph('A.alt'); copy.copyFrom('A').moveBy(5, 0); copy.appendAnchor('x', 1, 2);
      font.kerning.set('A', 'A.alt', -12); font.info.note = 'scripted'; font.removeGlyph('B');
      print(font.kerning.get('A', 'A.alt'), [...font].length);` });
    assert.strictEqual(res.error, undefined);
    assert.strictEqual(res.output, `114 A 16 ${font.glyphs.A.width} false\n-12 114`);
    assert.strictEqual(res.font.glyphs.A.width, font.glyphs.A.width + 10);
    assert.ok(res.font.glyphs['A.alt'].anchors.some((a) => a.name === 'x') && !res.font.glyphs.B && !res.font.glyphOrder.includes('B'));
    assert.strictEqual(res.font.info.note, 'scripted');
    assert.ok(font.glyphs.B && font.info.note === undefined, 'the font given to the script is not touched');
    const bad = await run({ language: 'javascript', font, code: 'print("before"); font.nothing.width = 1' });
    assert.ok(/Cannot set/.test(bad.error) && bad.output === 'before' && bad.font === undefined);
    const outside = await run({ language: 'javascript', font, code: 'print(typeof require, typeof process, typeof fetch)' });
    assert.strictEqual(outside.output, 'undefined undefined undefined', 'a script gets no file or network helpers');
  });

  await test('scripts: Python gets the same object model (skipped when Python is not installed)', async () => {
    const font = readUfo(SANS);
    const res = await run({ language: 'python', font, selection: ['A'], code: [
      'print(len(font), font.selection, font["A"].leftMargin, "nope" in font)',
      'for g in font.selectedGlyphs:', '    g.leftMargin += 10',
      'c = font.newGlyph("A.alt"); c.appendComponent("A", (5, 0)); c.width = font["A"].width',
      'font.kerning[("A", "A.alt")] = -12; font.info.note = "scripted"; font.removeGlyph("B")',
      'print(font.kerning[("A", "A.alt")], len(font), [round(v) for v in font["O"].bounds])'].join('\n') });
    if (res.error === 'pythonMissing') { console.log('   (Python 3 not found: skipped)'); return; }
    assert.strictEqual(res.error, undefined);
    const o = model.glyphBounds(font, 'O');
    assert.strictEqual(res.output.trim(), `114 ['A'] 16 False\n-12 114 [${o.xMin}, ${o.yMin}, ${o.xMax}, ${o.yMax}]`);
    assert.strictEqual(res.font.glyphs.A.width, font.glyphs.A.width + 10);
    assert.deepStrictEqual(res.font.glyphs['A.alt'].components, [{ base: 'A', transform: [1, 0, 0, 1, 5, 0] }]);
    assert.ok(!res.font.glyphs.B && res.font.info.note === 'scripted');
    const bad = await run({ language: 'python', font, code: 'print("before")\nx = 1 / 0' });
    assert.ok(/ZeroDivisionError/.test(bad.error) && bad.output === 'before\n' && bad.font === undefined);
  });

  await test('command line: info, validate, shape, export, convert, run; nothing is overwritten', () => {
    const cli = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'cli.js'), ...args], { encoding: 'utf8' }); return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null }; };
    assert.strictEqual(cli('info', SANS).out.summary.glyphs, 114);
    const famDir = path.join(tmp, 'family-out');
    const fam = cli('export-family', SANS, famDir);
    assert.deepStrictEqual(fam.out.styles.map((x) => [x.style, x.weight, x.file]), [['Regular', 400, 'LionFoundryExampleSans-Regular.ttf'], ['Medium', 500, 'LionFoundryExampleSans-Medium.ttf'], ['SemiBold', 600, 'LionFoundryExampleSans-SemiBold.ttf'], ['Bold', 700, 'LionFoundryExampleSans-Bold.ttf']]);
    assert.deepStrictEqual(fs.readdirSync(famDir).sort(), ['LionFoundryExampleSans.css', 'ttf', 'woff2']);
    assert.strictEqual(fs.readdirSync(path.join(famDir, 'woff2')).length, 4);
    assert.strictEqual(readTtf(fs.readFileSync(path.join(famDir, 'ttf', 'LionFoundryExampleSans-Medium.ttf')), 'm.ttf').info.styleName, 'Medium');
    assert.strictEqual(cli('export-family', SANS, famDir).status, 1, 'a folder that exists is never written into');
    assert.deepStrictEqual(cli('info', SANS, '--weight', 'Bold').out.weights, [{ name: 'Regular', location: 400, italic: false, active: false }, { name: 'Bold', location: 700, italic: false, active: true }]);
    assert.ok(cli('shape', SANS, 'H', '--weight', 'bold').out.width !== cli('shape', SANS, 'H').out.width);
    assert.ok(/no weight named/.test(cli('info', SANS, '--weight', 'Thin').out.error));
    const boldTtf = path.join(tmp, 'cli-bold.ttf');
    cli('export', SANS, boldTtf, '--weight', 'Bold');
    assert.deepStrictEqual([readTtf(fs.readFileSync(boldTtf), 'b.ttf').info.styleName, readTtf(fs.readFileSync(boldTtf), 'b.ttf').info.other.openTypeOS2WeightClass], ['Bold', 700]);
    assert.deepStrictEqual(cli('validate', SANS).out.counts.error, 0);
    assert.strictEqual(cli('shape', SANS, 'AV').out.width, readUfo(SANS).glyphs.A.width * 2 - 70);
    assert.strictEqual(cli('shape', SANS, 'AV', '--off', 'kern').out.width, readUfo(SANS).glyphs.A.width * 2);
    const ttf = path.join(tmp, 'cli.ttf');
    assert.strictEqual(cli('export', SANS, ttf).out.glyphs, 114);
    const twice = cli('export', SANS, ttf);
    assert.ok(twice.status === 1 && /already exists/.test(twice.out.error));
    assert.strictEqual(cli('info', ttf).out.summary.glyphs, 114, 'a .ttf can be read too');
    const ufo = path.join(tmp, 'cli.ufo');
    assert.strictEqual(cli('convert', ttf, ufo).out.written, 114);
    assert.strictEqual(readUfo(ufo).glyphs.A.width, readUfo(SANS).glyphs.A.width);
    const script = path.join(tmp, 's.js');
    fs.writeFileSync(script, 'for (const g of font) g.width += 7; print("ok");');
    const ran = cli('run', SANS, script, '--out', path.join(tmp, 'ran.ufo'));
    assert.ok(ran.out.ok && ran.out.output === 'ok');
    assert.strictEqual(readUfo(path.join(tmp, 'ran.ufo')).glyphs.A.width, readUfo(SANS).glyphs.A.width + 7);
    assert.strictEqual(cli('nonsense', SANS).status, 2);
  });

  await test('server for AI agents: lists its tools, answers calls, stays inside its folder', () => {
    const requests = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'shape_text', arguments: { path: 'examples/LionFoundryExampleSans.ufo', text: 'AV' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'describe_font', arguments: { path: os.tmpdir() } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'export_font', arguments: { path: 'examples/LionFoundryExampleSans.ufo', output: path.join(tmp, 'outside.ttf') } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'validate_font', arguments: { path: 'examples/LionFoundryExampleSerif-Regular.ufo' } } },
      { jsonrpc: '2.0', id: 7, method: 'nope' },
    ];
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'mcp-server.js'), ROOT], { input: requests.map((x) => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8' });
    const replies = new Map(r.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((m) => [m.id, m]));
    assert.strictEqual(replies.size, 7, 'a notification gets no answer');
    assert.strictEqual(replies.get(1).result.serverInfo.name, 'lionfoundry');
    assert.strictEqual(replies.get(1).result.protocolVersion, '2025-06-18');
    assert.deepStrictEqual(replies.get(2).result.tools.map((t) => t.name), ['describe_font', 'list_glyphs', 'get_glyph', 'validate_font', 'list_features', 'shape_text', 'export_font', 'export_family', 'run_script']);
    assert.ok(replies.get(2).result.tools.every((t) => t.inputSchema.type === 'object' && t.description.length > 20));
    assert.strictEqual(JSON.parse(replies.get(3).result.content[0].text).glyphs[1].name, 'V');
    assert.ok(replies.get(4).result.isError && /outside the folder/.test(replies.get(4).result.content[0].text));
    assert.ok(replies.get(5).result.isError && !fs.existsSync(path.join(tmp, 'outside.ttf')), 'no file is written outside the working folder');
    assert.strictEqual(JSON.parse(replies.get(6).result.content[0].text).counts.error, 0);
    assert.strictEqual(replies.get(7).error.code, -32601);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `${failed} of ${count} tests failed` : `${count} tests passed`);
  process.exit(failed ? 1 : 0);
})();
