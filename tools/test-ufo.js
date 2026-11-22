/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Tests of the parts that have no interface: the XML/plist/GLIF reader, the UFO reader on the two
// example typefaces, the outline geometry and the kerning lookup.
// Usage: node tools/test-ufo.js   (exit code 1 when something fails)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseXml, parsePlist } = require('../src/platform/project/node/xml');
const { readUfo, parseGlif, summarize, isUfo } = require('../src/platform/project/node/ufoReader');

const ROOT = path.join(__dirname, '..');
let failed = 0;
let count = 0;
async function test(name, fn) {
  count++;
  try { await fn(); console.log('✓', name); } catch (err) { failed++; console.log('✗', name, '\n  ', err.message); }
}

(async () => {
  const geo = await import('../src/base/common/glyphPath.js');

  await test('xml: elements, attributes, entities, comments', () => {
    const doc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b/>t&#233;xt<c y=\'z\'>in</c></a>');
    assert.strictEqual(doc.name, 'a');
    assert.strictEqual(doc.attrs.x, '1 & 2');
    assert.strictEqual(doc.children.length, 2);
    assert.strictEqual(doc.text, 'téxt');
    assert.strictEqual(doc.children[1].attrs.y, 'z');
    assert.throws(() => parseXml('<a><b></a>'));
  });

  await test('plist: dict, array, numbers, booleans', () => {
    const v = parsePlist('<plist version="1.0"><dict><key>a</key><integer>3</integer><key>b</key><array><real>1.5</real><true/><string>s</string></array></dict></plist>');
    assert.deepStrictEqual(v, { a: 3, b: [1.5, true, 's'] });
  });

  await test('glif: advance, unicode, contours, components, anchors (formats 1 and 2)', () => {
    const g = parseGlif('<glyph name="x" format="2"><advance width="500"/><unicode hex="0078"/><anchor x="1" y="2" name="top"/>'
      + '<outline><contour><point x="0" y="0" type="line"/><point x="10" y="0"/><point x="10" y="10" type="curve" smooth="yes"/></contour>'
      + '<component base="a" xOffset="20" yScale="2"/></outline></glyph>');
    assert.strictEqual(g.width, 500);
    assert.deepStrictEqual(g.unicodes, [0x78]);
    assert.deepStrictEqual(g.contours[0][1], [10, 0, 'offcurve']);
    assert.deepStrictEqual(g.contours[0][2], [10, 10, 'curve', 1]);
    assert.deepStrictEqual(g.components[0], { base: 'a', transform: [1, 0, 0, 2, 20, 0] });
    assert.deepStrictEqual(g.anchors, [{ name: 'top', x: 1, y: 2 }]);
    const old = parseGlif('<glyph name="y" format="1"><outline><contour><point x="5" y="6" type="move" name="top"/></contour></outline></glyph>');
    assert.deepStrictEqual(old.anchors, [{ name: 'top', x: 5, y: 6 }]);
    assert.strictEqual(old.contours.length, 0);
  });

  await test('geometry: lines, cubics, quadratics with implied points, open contours', () => {
    const sq = geo.contourCommands([[0, 0, 'line'], [10, 0, 'line'], [10, 10, 'line'], [0, 10, 'line']]);
    assert.strictEqual(geo.commandsToSvg(sq), 'M0 0L10 0L10 10L0 10L0 0Z');
    const cubic = geo.contourCommands([[0, 0, 'curve'], [10, 0, 'offcurve'], [20, 10, 'offcurve'], [20, 20, 'curve'], [0, 20, 'line']]);
    assert.deepStrictEqual(cubic[1], ['C', 10, 0, 20, 10, 20, 20]);
    // offcurves before the first on-curve point belong to the closing segment
    const wrapped = geo.contourCommands([[5, 0, 'offcurve'], [10, 0, 'offcurve'], [10, 10, 'curve'], [0, 10, 'line'], [0, 0, 'line']]);
    assert.deepStrictEqual(wrapped[0], ['M', 10, 10]);
    assert.deepStrictEqual(wrapped[wrapped.length - 2], ['C', 5, 0, 10, 0, 10, 10]);
    const quad = geo.contourCommands([[0, 0, 'offcurve'], [10, 0, 'offcurve'], [10, 10, 'offcurve'], [0, 10, 'offcurve']]);
    assert.deepStrictEqual(quad[0], ['M', 0, 5]);
    assert.strictEqual(quad.filter((c) => c[0] === 'Q').length, 4);
    const open = geo.contourCommands([[0, 0, 'move'], [10, 10, 'line']]);
    assert.strictEqual(geo.commandsToSvg(open), 'M0 0L10 10');
  });

  await test('geometry: exact bounds of a curve (extrema, not handles)', () => {
    // a quarter circle bulging past its end points would be wrong if handles were measured
    const b = geo.commandsBounds([['M', 0, 0], ['C', 0, 100, 100, 100, 100, 0]]);
    assert.strictEqual(b.xMin, 0); assert.strictEqual(b.xMax, 100);
    assert.strictEqual(b.yMin, 0); assert.strictEqual(Math.round(b.yMax), 75);
    assert.strictEqual(geo.commandsBounds([]), null);
  });

  await test('geometry: component transforms compose in order', () => {
    const font = { glyphs: {
      dot: { contours: [[[0, 0, 'line'], [10, 0, 'line'], [10, 10, 'line']]], components: [] },
      two: { contours: [], components: [{ base: 'dot', transform: [2, 0, 0, 2, 100, 0] }] },
      nest: { contours: [], components: [{ base: 'two', transform: [1, 0, 0, 1, 0, 50] }] },
      loop: { contours: [], components: [{ base: 'loop', transform: [1, 0, 0, 1, 0, 0] }] },
    } };
    assert.deepStrictEqual(geo.commandsBounds(geo.glyphCommands(font, 'two')), { xMin: 100, yMin: 0, xMax: 120, yMax: 20 });
    assert.deepStrictEqual(geo.commandsBounds(geo.glyphCommands(font, 'nest')), { xMin: 100, yMin: 50, xMax: 120, yMax: 70 });
    assert.deepStrictEqual(geo.glyphCommands(font, 'loop'), []);
  });

  await test('kerning: glyph pairs win over group pairs', () => {
    const kern = geo.createKerner({
      groups: { 'public.kern1.A': ['A', 'Aacute'], 'public.kern2.V': ['V', 'W'] },
      kerning: { 'public.kern1.A': { 'public.kern2.V': -70, W: -40 }, Aacute: { V: -10 } },
    });
    assert.strictEqual(kern('A', 'V'), -70);
    assert.strictEqual(kern('A', 'W'), -40);      // group–glyph beats group–group
    assert.strictEqual(kern('Aacute', 'V'), -10); // glyph–glyph beats everything
    assert.strictEqual(kern('A', 'A'), 0);
  });

  for (const name of ['LionFoundryExampleSans.ufo', 'LionFoundryExampleSerif-Regular.ufo']) {
    await test(`example: ${name}`, () => {
      const dir = path.join(ROOT, 'examples', name);
      assert.ok(isUfo(dir));
      const font = readUfo(dir);
      const s = summarize(font);
      assert.strictEqual(font.format, 'ufo3');
      assert.strictEqual(font.warnings.length, 0, JSON.stringify(font.warnings.slice(0, 3)));
      assert.strictEqual(s.glyphs, 114);
      assert.strictEqual(s.unitsPerEm, 1000);
      assert.ok(s.kerningPairs >= 10 && s.groups >= 6);
      assert.strictEqual(font.glyphOrder[0], '.notdef');
      // every letter the Portuguese sample needs is there and has an outline
      for (const ch of 'ÀÁÂÃÇÉÊÍÓÔÕÚàáâãçéêíóôõúAZaz09') {
        const g = Object.values(font.glyphs).find((x) => x.unicodes.includes(ch.codePointAt(0)));
        assert.ok(g, `missing ${ch}`);
        assert.ok(geo.commandsBounds(geo.glyphCommands(font, g.name)), `empty ${g.name}`);
      }
      // composites are components placed by anchors, not copies
      assert.strictEqual(font.glyphs.aacute.contours.length, 0);
      assert.deepStrictEqual(font.glyphs.aacute.components.map((c) => c.base), ['a', 'acute']);
      // side bearings are positive and the outline stays inside the advance width for plain letters
      for (const n of ['H', 'O', 'n', 'o']) {
        const b = geo.commandsBounds(geo.glyphCommands(font, n));
        assert.ok(b.xMin > 0 && b.xMax < font.glyphs[n].width, `${n}: ${b.xMin}..${b.xMax} in ${font.glyphs[n].width}`);
      }
      assert.strictEqual(geo.createKerner(font)('A', 'V') < 0, true);
    });
  }

  await test('reader: refuses what is not a UFO, reports broken glyphs instead of failing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lionfoundry-test-'));
    try {
      assert.throws(() => readUfo(tmp), /not a UFO/);
      const ufo = path.join(tmp, 'Broken.ufo');
      fs.mkdirSync(path.join(ufo, 'glyphs'), { recursive: true });
      fs.writeFileSync(path.join(ufo, 'metainfo.plist'), '<plist><dict><key>formatVersion</key><integer>3</integer></dict></plist>');
      fs.writeFileSync(path.join(ufo, 'glyphs', 'contents.plist'), '<plist><dict><key>a</key><string>a.glif</string><key>b</key><string>b.glif</string><key>c</key><string>../c.glif</string></dict></plist>');
      fs.writeFileSync(path.join(ufo, 'glyphs', 'a.glif'), '<glyph name="a" format="2"><advance width="100"/><outline><component base="zz"/></outline></glyph>');
      fs.writeFileSync(path.join(ufo, 'glyphs', 'b.glif'), '<glyph name="b"><outline>');
      const font = readUfo(ufo);
      assert.deepStrictEqual(Object.keys(font.glyphs), ['a']);
      assert.deepStrictEqual(font.warnings.map((w) => w.code).sort(), ['badFileName', 'missingComponent', 'unreadableGlyph']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(failed ? `${failed} of ${count} tests failed` : `${count} tests passed`);
  process.exit(failed ? 1 : 0);
})();
