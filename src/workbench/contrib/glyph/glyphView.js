/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Glyph" view: one glyph on a canvas with its points and handles, metric lines, components and
// anchors, and a panel to measure and change it.
//   Select tool (V): click or drag a box to select, drag to move, arrows to nudge, Delete to remove,
//                    double-click a point to switch it between corner and smooth.
//   Pen tool (P):    click for a straight point, drag for a curve point, click the first point to close.
//   Add point (+):   click on the outline to put a point there; the shape does not change.
//   Remove point (−): click a point to take it out; the curve is kept as close as one curve can be.
// Handles: Shift while dragging keeps a handle horizontal, vertical or at 45°; with a handle (or its point)
//          selected, Shift+H, Shift+V and Shift+D turn it horizontal, vertical or to the nearest 45°, and
//          Shift+A asks for an angle.
// Reference lines: each glyph can have its own horizontal, vertical and diagonal lines (UFO guidelines).
// Magnet (M): while something is dragged or drawn, it is pulled onto the metric lines and reference
//             lines near it. Switching the magnet on or off never moves what is already there.
// Wheel zooms; Space + drag (or the middle or right button) moves the view.
import { h, setChildren, cssVar } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { contourCommands, glyphCommands, drawCommands, glyphStats, applyTransform } from '../../../base/common/glyphPath.js';
import * as model from '../../../base/common/fontModel.js';
import { snapPoint, distanceToLine, lineKind, newGuideline } from '../../../base/common/snap.js';
import { nearestOnOutline, insertPoint, removePoint, alignHandle, handleAngle, handleAnchor, constrainToAngles, setStartPoint, correctDirections, matchStructure } from '../../../base/common/outlineEdit.js';
import { siblingWeights } from '../../../base/common/weights.js';
import { incompatibility } from '../../../base/common/interpolate.js';
import { COLOR_GLYPHS_KEY, PALETTE_KEY } from '../../../base/common/ttfWriter.js';
import { formatUnicode, formatUnits } from '../../../base/common/format.js';
import { ViewPane } from '../../browser/viewPane.js';
import { formDialog } from '../../browser/dialogs.js';
import { t, tn } from '../../../base/common/nls.js';

const OPTIONS_KEY = 'lionfoundry.glyph.options';
const TOGGLES = [
  { id: 'fill', icon: 'fill' },
  { id: 'points', icon: 'points' },
  { id: 'metrics', icon: 'ruler' },
  { id: 'anchors', icon: 'anchor' },
  { id: 'guides', icon: 'guides' },
  { id: 'weights', icon: 'family' }, // the other weights behind the one being drawn (only in a project that has them)
];
const TOOLS = [{ id: 'select', icon: 'cursor', key: 'V' }, { id: 'pen', icon: 'pen', key: 'P' }, { id: 'scale', icon: 'scale', key: 'S' }, { id: 'add', icon: 'pointAdd', key: '+' }, { id: 'remove', icon: 'pointRemove', key: '−' }];
const HIT = 7; // pixels
const BOX_PAD = 10; // pixels between the selection and the box drawn around it
const SNAP = 8; // pixels: how near a line has to be for the magnet to pull
const GUIDE_KINDS = [['h', 'guideH'], ['v', 'guideV'], ['d', 'guideD']];

export class GlyphView extends ViewPane {
  options = { fill: true, points: true, metrics: true, anchors: true, guides: true, snap: true };
  tool = 'select';
  /** Selected points ("contour,index"), anchors, components and reference lines (by index). */
  sel = { points: new Set(), anchors: new Set(), components: new Set(), guides: new Set() };
  #scale = 0.5; // screen pixels per font unit
  #ox = 0;      // screen position of the glyph origin (x = 0, baseline)
  #oy = 0;
  #fitted = false;
  #frame = 0;
  #space = false;
  #marquee = null;
  #pen = { contour: -1, out: null };
  /** The lines that are holding what is being dragged (shown highlighted). */
  #snapped = [];
  #scratch = document.createElement('canvas').getContext('2d');
  #scaleRef = null;  // the point a scale is made from, when one was set with the scale tool (font units)
  #scaleInfo = null; // { sx, sy } while something is being scaled

  constructor(services) {
    super(services, 'glyph');
    try { Object.assign(this.options, JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')); } catch { /* defaults */ }

    this.title = h('div.glyph-title');
    this.tools = h('div.toggle-group', { role: 'group', 'aria-label': t('glyph.tools') });
    this.snapToggle = h('div.toggle-group');
    this.toggles = h('div.toggle-group', { role: 'group', 'aria-label': t('glyph.show') });
    this.zoomLabel = h('span.zoom-label');
    this.canvas = h('canvas.glyph-canvas', { tabindex: '0', 'aria-label': t('views.glyph') });
    this.stage = h('div.glyph-stage', this.canvas);
    this.panel = h('aside.glyph-panel');
    const button = (name, label, onclick) => h('button.icon-button', { title: label, 'aria-label': label, html: icon(name, 16), onclick });
    this.element.append(
      h('div.view-toolbar',
        button('chevronLeft', t('glyph.previous'), () => this.fonts.step(-1)),
        this.title,
        button('chevronRight', t('glyph.next'), () => this.fonts.step(1)),
        h('span.toolbar-sep'),
        this.tools,
        this.snapToggle,
        h('span.toolbar-spacer'),
        this.toggles,
        h('span.toolbar-sep'),
        button('zoomOut', t('glyph.zoomOut'), () => this.#zoomBy(1 / 1.25)),
        this.zoomLabel,
        button('zoomIn', t('glyph.zoomIn'), () => this.#zoomBy(1.25)),
        button('fit', t('glyph.fit'), () => { this.#fit(); this.#draw(); })),
      h('div.glyph-layout', this.stage, this.panel));

    this.#renderTools();
    this.#renderSnap();
    this.#renderToggles();
    this.#bindCanvas();
    new ResizeObserver(() => { if (this.visible) { if (!this.#fitted) this.#fit(); this.#draw(); } }).observe(this.stage);
    this.fonts.onDidChangeFont(() => { this.#fitted = false; this.#clearSelection(); this.invalidate(); });
    this.fonts.onDidChangeSelection(() => { this.#fitted = false; this.#clearSelection(); this.invalidate(); });
    this.fonts.onDidEdit(() => { this.#pruneSelection(); this.invalidate(); });
    this.fonts.onDidChangeWeight(() => { this.#clearSelection(); this.invalidate(); });
    this.layout.onDidChangeTheme(() => { if (this.visible) this.#draw(); });
  }

  get glyph() { return this.fonts.glyph(this.fonts.selected); }

  render() {
    const glyph = this.glyph;
    setChildren(this.title, glyph
      ? [h('span.glyph-title-name', glyph.name), glyph.unicodes.length ? h('span.glyph-title-code', glyph.unicodes.map(formatUnicode).join(' ')) : null]
      : t('glyph.none'));
    this.#renderToggles();
    this.#renderPanel(glyph);
    if (!this.#fitted) this.#fit();
    this.#draw();
  }

  setTool(id) {
    this.tool = id;
    this.#pen = { contour: -1, out: null };
    this.canvas.dataset.tool = id;
    this.#renderTools();
    this.#draw();
  }

  #renderTools() {
    setChildren(this.tools, TOOLS.map((tool) => h('button.toggle', {
      'aria-pressed': String(this.tool === tool.id), title: `${t('glyph.tool.' + tool.id + '.title')} (${tool.key})`, 'data-tool': tool.id,
      class: `toggle${this.tool === tool.id ? ' active' : ''}`, onclick: () => { this.setTool(tool.id); this.canvas.focus(); },
    }, h('span', { html: icon(tool.icon, 14) }), h('span.toggle-text.tool-text', t('glyph.tool.' + tool.id)))));
  }

  /** The magnet. It only acts while something is dragged or drawn: switching it never moves anything. */
  setSnap(on) {
    this.options.snap = !!on;
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options)); } catch { /* storage unavailable */ }
    this.#renderSnap();
  }

  #renderSnap() {
    setChildren(this.snapToggle, h('button.toggle', {
      'aria-pressed': String(!!this.options.snap), title: `${t('glyph.snap.title')} (M)`, 'data-action': 'snap',
      class: `toggle${this.options.snap ? ' active' : ''}`, onclick: () => { this.setSnap(!this.options.snap); this.canvas.focus(); },
    }, h('span', { html: icon('magnet', 14) }), h('span.toggle-text.tool-text', t('glyph.snap'))));
  }

  #renderToggles() {
    setChildren(this.toggles, TOGGLES.filter((tg) => tg.id !== 'weights' || this.fonts.hasWeights).map((tg) => h('button.toggle', {
      'aria-pressed': String(!!this.options[tg.id]), title: t('glyph.toggle.' + tg.id), 'aria-label': t('glyph.toggle.' + tg.id), 'data-toggle': tg.id,
      class: `toggle${this.options[tg.id] ? ' active' : ''}`,
      onclick: () => {
        this.options[tg.id] = !this.options[tg.id];
        try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options)); } catch { /* storage unavailable */ }
        this.#renderToggles();
        this.#draw();
      },
    }, h('span', { html: icon(tg.icon, 14) }), h('span.toggle-text', t('glyph.toggle.' + tg.id)))));
  }

  // ---------------------------------------------------------------- selection
  #clearSelection() {
    this.sel.points.clear(); this.sel.anchors.clear(); this.sel.components.clear(); this.sel.guides.clear();
    this.#pen = { contour: -1, out: null };
    this.#scaleRef = null;
  }

  #pruneSelection() {
    const g = this.glyph;
    if (!g) { this.#clearSelection(); return; }
    for (const key of [...this.sel.points]) { const [c, i] = key.split(',').map(Number); if (!g.contours[c] || !g.contours[c][i]) this.sel.points.delete(key); }
    for (const i of [...this.sel.anchors]) if (!g.anchors[i]) this.sel.anchors.delete(i);
    for (const i of [...this.sel.components]) if (!g.components[i]) this.sel.components.delete(i);
    for (const i of [...this.sel.guides]) if (!(g.guidelines || [])[i]) this.sel.guides.delete(i);
    if (!g.contours[this.#pen.contour] || model.isClosed(g.contours[this.#pen.contour])) this.#pen = { contour: -1, out: null };
  }

  get #selectionSize() { return this.sel.points.size + this.sel.anchors.size + this.sel.components.size + this.sel.guides.size; }
  #selectedPoints() { const g = this.glyph; return [...this.sel.points].map((k) => k.split(',').map(Number)).filter(([c, i]) => g.contours[c] && g.contours[c][i]); }

  /** Changes the open glyph as one undoable step. */
  #edit(label, fn, extra = {}) {
    const g = this.glyph;
    if (!g) return;
    this.fonts.edit(t('undo.' + label), { glyphs: [g.name], ...extra }, (font) => fn(font.glyphs[g.name], font));
  }

  // ---------------------------------------------------------------- panel
  #renderPanel(glyph) {
    const { fonts } = this;
    if (!glyph) { setChildren(this.panel); return; }
    const b = fonts.shape(glyph.name).bounds;
    const stats = glyphStats(glyph);
    const char = glyph.unicodes.length ? String.fromCodePoint(glyph.unicodes[0]) : '';
    const row = (label, value) => [h('dt', label), h('dd', value)];
    const field = (id, label, value, apply, { disabled = false } = {}) => h('label.num-field', h('span', label),
      h('input.input.input-sm', { type: 'number', step: '1', value: value === null || value === undefined ? '' : String(value), disabled, 'data-field': id,
        onchange: (e) => { if (e.target.value !== '') apply(Number(e.target.value)); } }));
    const action = (id, label, run, opts = {}) => h('button.btn.btn-secondary.btn-sm', { 'data-action': id, onclick: run, disabled: !!opts.disabled, title: opts.title }, label);

    const pts = this.#selectedPoints();
    const one = pts.length === 1 && !this.sel.anchors.size && !this.sel.components.size && !this.sel.guides.size ? glyph.contours[pts[0][0]][pts[0][1]] : null;
    const handles = this.#handleTargets();
    const angleOf = ([c, i]) => { const a = handleAngle(glyph.contours[c], i); return a === null ? null : Math.round(a * 10) / 10; };
    const guides = glyph.guidelines || [];
    // the reference line whose values can be typed: the only thing selected
    const guideIndex = this.sel.guides.size === 1 && this.#selectionSize === 1 ? [...this.sel.guides][0] : -1;
    const guide = guides[guideIndex] || null;
    const setGuide = (fn) => this.#edit('guide', (g) => fn(g.guidelines[guideIndex]));
    const describe = (g) => (lineKind(g) === 'h' ? `y ${formatUnits(g.y)}` : lineKind(g) === 'v' ? `x ${formatUnits(g.x)}` : `${formatUnits(g.x)}, ${formatUnits(g.y)} · ${Math.round((g.angle || 0) * 10) / 10}°`);
    const target = pts.length ? tn('glyph.transform.points', pts.length) : t('glyph.transform.glyph');
    const values = {};
    const tf = (id, label, value) => h('label.num-field', h('span', label), h('input.input.input-sm', { type: 'number', step: 'any', value: String(value), 'data-field': id, oninput: (e) => { values[id] = Number(e.target.value); } }));
    Object.assign(values, { dx: 0, dy: 0, scale: 100, rotate: 0, skew: 0 });
    const layers = this.#colorLayers(glyph.name);
    const palette = fonts.font.lib[PALETTE_KEY] || [];
    const siblings = siblingWeights(fonts.font);

    setChildren(this.panel,
      h('div.panel-glyph', h('span.panel-char', { 'aria-hidden': 'true' }, char.trim() ? char : '∅'), h('div',
        h('div.panel-name', glyph.name),
        h('div.muted.small', t('categories.' + fonts.category(glyph.name))))),

      h('h3', t('glyph.section.metrics')),
      h('div.field-grid',
        field('width', t('glyph.width'), glyph.width, (v) => this.#edit('metrics', (g) => { g.width = Math.max(0, Math.round(v)); })),
        field('lsb', t('glyph.lsb'), b ? Math.round(b.xMin) : null, (v) => this.#edit('metrics', (g, font) => model.setLeftMargin(font, g, v)), { disabled: !b }),
        field('rsb', t('glyph.rsb'), b ? Math.round(glyph.width - b.xMax) : null, (v) => this.#edit('metrics', (g, font) => model.setRightMargin(font, g, v)), { disabled: !b })),
      h('p.muted.small', b ? t('glyph.boundsValue', { w: formatUnits(Math.round(b.xMax - b.xMin)), h: formatUnits(Math.round(b.yMax - b.yMin)) }) : t('glyph.empty')),

      this.#selectionSize ? [
        h('h3', t('glyph.section.selection')),
        h('p.muted.small', [pts.length ? tn('glyph.selected.points', pts.length) : null, this.sel.anchors.size ? tn('glyph.selected.anchors', this.sel.anchors.size) : null,
          this.sel.components.size ? tn('glyph.selected.components', this.sel.components.size) : null,
          this.sel.guides.size ? tn('glyph.selected.guides', this.sel.guides.size) : null].filter(Boolean).join(' · ')),
        one ? h('div.field-grid',
          field('px', 'x', one[0], (v) => this.#edit('movePoints', (g) => { g.contours[pts[0][0]][pts[0][1]][0] = Math.round(v); })),
          field('py', 'y', one[1], (v) => this.#edit('movePoints', (g) => { g.contours[pts[0][0]][pts[0][1]][1] = Math.round(v); }))) : null,
        h('div.btn-wrap',
          one && one[2] !== 'offcurve' && model.isClosed(glyph.contours[pts[0][0]]) ? action('startPoint', t('glyph.action.startPoint'), () => this.#startHere(pts[0]), { disabled: pts[0][1] === 0, title: t('glyph.action.startPointTitle') }) : null,
          action('smooth', t('glyph.action.smooth'), () => this.#toggleSmooth(), { disabled: !pts.some(([c, i]) => glyph.contours[c][i][2] !== 'offcurve') }),
          action('delete', t('common.delete'), () => this.#deleteSelection())),
        handles.length ? [
          h('p.muted.small.handle-label', t('glyph.handle.label')),
          h('div.btn-wrap',
            action('handleH', t('glyph.handle.h'), () => this.#alignHandles('h'), { title: `${t('glyph.handle.hTitle')} (Shift+H)` }),
            action('handleV', t('glyph.handle.v'), () => this.#alignHandles('v'), { title: `${t('glyph.handle.vTitle')} (Shift+V)` }),
            action('handleD', '45°', () => this.#alignHandles('d'), { title: `${t('glyph.handle.dTitle')} (Shift+D)` }),
            action('handleA', t('glyph.handle.a'), () => this.#askHandleAngle(), { title: `${t('glyph.handle.aTitle')} (Shift+A)` })),
          one && one[2] === 'offcurve' ? h('div.field-grid', field('handleAngle', t('glyph.guide.angle'), angleOf(pts[0]), (v) => this.#alignHandles(v, true))) : null,
        ] : null,
      ] : null,

      siblings.length ? [
        h('h3', t('glyph.section.weights')),
        siblings.map((w) => {
          const other = w.glyphs[glyph.name];
          const reason = incompatibility(glyph, other);
          // the same points in another order or starting elsewhere can be interpolated, but the shape twists on the way
          const twisted = !reason && other && !!(matchStructure(glyph, other) || {}).changed;
          const fixable = twisted || ['contours', 'points', 'pointTypes'].includes(reason);
          return h('div.weight-row', { 'data-weight': w.id, 'data-compatible': String(!reason && !twisted) },
            h('div.weight-row-head', h('strong', w.name), h('span', { class: reason || twisted ? 'warn small' : 'muted small' }, reason ? t('family.reason.' + reason) : twisted ? t('glyph.weights.twisted') : t('glyph.weights.compatible'))),
            h('div.btn-wrap',
              fixable ? action('match', t('glyph.weights.match'), () => this.#match(w), { title: t('glyph.weights.matchTitle', { name: w.name }) }) : null,
              action('copyFrom', t('glyph.weights.copyFrom'), () => this.#copyFrom(w), { disabled: !w.glyphs[glyph.name], title: t('glyph.weights.copyFromTitle', { name: w.name }) })));
        }),
      ] : null,

      h('h3', t('glyph.section.transform')),
      h('p.muted.small', t('glyph.transform.target', { target })),
      h('div.transform-rows',
        h('div.transform-row', tf('dx', 'x', 0), tf('dy', 'y', 0), action('move', t('glyph.transform.move'), () => this.#transform(model.translation(values.dx || 0, values.dy || 0)))),
        h('div.transform-row', tf('scale', '%', 100), action('scale', t('glyph.transform.scale'), () => this.#transform((c) => model.scaling((values.scale || 100) / 100, (values.scale || 100) / 100, c[0], c[1])))),
        h('div.transform-row', tf('rotate', '°', 0), action('rotate', t('glyph.transform.rotate'), () => this.#transform((c) => model.rotation(values.rotate || 0, c[0], c[1])))),
        h('div.transform-row', tf('skew', '°', 0), action('skew', t('glyph.transform.skew'), () => this.#transform(() => model.skewing(values.skew || 0)))),
        h('div.btn-wrap',
          action('flipH', t('glyph.transform.flipH'), () => this.#transform((c) => model.scaling(-1, 1, c[0], c[1]))),
          action('flipV', t('glyph.transform.flipV'), () => this.#transform((c) => model.scaling(1, -1, c[0], c[1]))))),

      h('h3', t('glyph.section.outline')),
      h('dl.info-list.info-numbers',
        row(t('glyph.contours'), String(stats.contours)),
        row(t('glyph.onCurve'), String(stats.onCurve)),
        row(t('glyph.offCurve'), String(stats.offCurve))),
      h('div.btn-wrap',
        action('reverse', t('glyph.action.reverse'), () => this.#reverse(), { disabled: !glyph.contours.length, title: t('glyph.action.reverseTitle') }),
        action('directions', t('glyph.action.directions'), () => this.#directions(), { disabled: !glyph.contours.length, title: t('glyph.action.directionsTitle') })),

      h('h3', t('glyph.section.components')),
      glyph.components.length ? h('div.chip-list', glyph.components.map((c) => h('button.chip', { title: t('glyph.goTo', { name: c.base }), onclick: () => fonts.select(c.base) }, c.base))) : null,
      h('div.btn-wrap',
        action('addComponent', t('glyph.action.addComponent'), () => this.#addComponent()),
        action('decompose', t('glyph.action.decompose'), () => this.#edit('decompose', (g, font) => model.decompose(font, g)), { disabled: !glyph.components.length })),

      h('h3', t('glyph.section.anchors')),
      glyph.anchors.length ? h('dl.info-list.info-numbers', glyph.anchors.map((a) => row(a.name || '—', `${formatUnits(a.x)}, ${formatUnits(a.y)}`))) : null,
      h('div.btn-wrap', action('addAnchor', t('glyph.action.addAnchor'), () => this.#addAnchor())),

      h('h3', t('glyph.section.guides')),
      guides.length
        ? h('div.layer-list', guides.map((g, i) => h('div.layer-row.guide-row', { class: `layer-row guide-row${this.sel.guides.has(i) ? ' selected' : ''}`, 'data-guide': String(i) },
          h('button.guide-pick', { title: t('glyph.guide.select'), onclick: () => { this.#clearSelection(); this.sel.guides.add(i); this.render(); } },
            h('span.guide-kind', { 'data-kind': lineKind(g) }), h('span.layer-name', g.name ? `${g.name} · ${describe(g)}` : describe(g))),
          h('button.icon-button', { title: t('common.delete'), html: icon('close', 12), onclick: () => { this.sel.guides.clear(); this.#edit('guide', (gl) => { gl.guidelines.splice(i, 1); }); } }))))
        : h('p.muted.small', t('glyph.guides.none')),
      guide ? h('div.field-grid',
        lineKind(guide) !== 'h' ? field('guideX', 'x', guide.x, (v) => setGuide((g) => { g.x = Math.round(v); })) : null,
        lineKind(guide) !== 'v' ? field('guideY', 'y', guide.y, (v) => setGuide((g) => { g.y = Math.round(v); })) : null,
        lineKind(guide) === 'd' ? field('guideAngle', t('glyph.guide.angle'), guide.angle || 0, (v) => setGuide((g) => { g.angle = ((v % 360) + 360) % 360; })) : null) : null,
      guide ? h('label.num-field', h('span', t('glyph.guide.name')), h('input.input.input-sm', { type: 'text', value: guide.name || '', spellcheck: 'false', 'data-field': 'guideName',
        onchange: (e) => setGuide((g) => { if (e.target.value.trim()) g.name = e.target.value.trim(); else delete g.name; }) })) : null,
      h('div.btn-wrap', GUIDE_KINDS.map(([kind, id]) => action(id, t('glyph.action.' + id), () => this.#addGuide(kind), { title: t('glyph.action.guideTitle') }))),

      h('h3', t('glyph.section.color')),
      layers.length
        ? h('div.layer-list', layers.map((layer, i) => h('div.layer-row',
          h('span.swatch', { style: { background: layer.color === 0xFFFF ? 'var(--text-primary)' : palette[layer.color] || 'transparent' } }),
          h('span.layer-name', layer.glyph),
          h('button.icon-button', { title: t('common.delete'), html: icon('close', 12), onclick: () => this.#setColorLayers(layers.filter((_, k) => k !== i)) }))))
        : h('p.muted.small', t('glyph.color.none')),
      h('div.btn-wrap', action('addLayer', t('glyph.action.addLayer'), () => this.#addColorLayer())),

      h('p.panel-note', t('glyph.editNote')));
  }

  // ---------------------------------------------------------------- actions
  #transform(make) {
    const g = this.glyph;
    if (!g) return;
    const pts = this.#selectedPoints();
    // the centre the scale, rotation and mirror turn around: of the selection, or of the glyph
    let box = null;
    if (pts.length) {
      box = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
      for (const [c, i] of pts) { const p = g.contours[c][i]; box.xMin = Math.min(box.xMin, p[0]); box.xMax = Math.max(box.xMax, p[0]); box.yMin = Math.min(box.yMin, p[1]); box.yMax = Math.max(box.yMax, p[1]); }
    } else box = this.fonts.shape(g.name).bounds;
    const centre = box ? [Math.round((box.xMin + box.xMax) / 2), Math.round((box.yMin + box.yMax) / 2)] : [0, 0];
    const matrix = typeof make === 'function' ? make(centre) : make;
    const targets = [...this.#targets().points.keys()]; // the handles of the selected points go with them
    this.#edit('transform', (glyph) => {
      if (pts.length) {
        for (const k of targets) { const [c, i] = k.split(',').map(Number); const p = glyph.contours[c][i]; const [x, y] = applyTransform(matrix, p[0], p[1]); p[0] = Math.round(x); p[1] = Math.round(y); }
      } else model.transformGlyph(glyph, matrix);
    });
  }

  #reverse() {
    const selected = new Set(this.#selectedPoints().map(([c]) => c));
    this.#edit('reverse', (g) => { g.contours = g.contours.map((c, i) => (!selected.size || selected.has(i) ? model.reverseContour(c) : c)); });
    this.sel.points.clear();
    this.render();
  }

  // ---------------------------------------------------------------- structure and clipboard
  /** Makes the selected point the first of its contour (weights are interpolated point by point, from the first). */
  #startHere([c, i]) {
    this.#edit('startPoint', (g) => { g.contours[c] = setStartPoint(g.contours[c], i); });
    this.sel.points.clear(); this.sel.points.add(`${c},0`);
    this.render();
  }

  #directions() {
    let turned = 0;
    this.sel.points.clear();
    this.#edit('reverse', (g) => { turned = correctDirections(g); });
    this.notifications.info(turned ? tn('glyph.directions.turned', turned) : t('glyph.directions.fine'), 5000);
  }

  /** Reorders and turns the contours so that they follow the same glyph in another weight. The shape stays. */
  #match(weight) {
    const g = this.glyph;
    const res = matchStructure(g, weight.glyphs[g.name]);
    if (!res) { this.notifications.warn(t('glyph.weights.noMatch', { name: weight.name }), 9000); return; }
    this.sel.points.clear();
    this.#edit('match', (glyph) => { glyph.contours = res.contours; });
    this.notifications.info(t('glyph.weights.matched', { name: weight.name }), 5000);
  }

  /** Replaces the drawing of this glyph with the one of another weight (a starting point to redraw). */
  #copyFrom(weight) {
    const other = weight.glyphs[this.glyph.name];
    if (!other) return;
    this.#clearSelection();
    this.#edit('copyFrom', (g) => {
      const copy = JSON.parse(JSON.stringify(other));
      g.contours = copy.contours; g.components = copy.components; g.anchors = copy.anchors; g.width = copy.width;
    });
  }

  /** Copies the contours that have something selected, the selected components and anchors — or, with nothing selected, the whole glyph. */
  #copy(cut) {
    const g = this.glyph;
    if (!g) return;
    const contours = new Set(this.#selectedPoints().map(([c]) => c));
    const comps = new Set(this.sel.components); const anchors = new Set(this.sel.anchors);
    const some = contours.size + comps.size + anchors.size > 0;
    const count = some
      ? this.fonts.copy({ contours: g.contours.filter((_, i) => contours.has(i)), components: g.components.filter((_, i) => comps.has(i)), anchors: g.anchors.filter((_, i) => anchors.has(i)) })
      : this.fonts.copyGlyph(g.name);
    if (!count) return;
    if (cut) {
      this.#clearSelection();
      this.#edit('cut', (glyph) => {
        glyph.contours = some ? glyph.contours.filter((_, i) => !contours.has(i)) : [];
        glyph.components = some ? glyph.components.filter((_, i) => !comps.has(i)) : [];
        glyph.anchors = some ? glyph.anchors.filter((_, i) => !anchors.has(i)) : [];
      });
    } else this.#renderPanel(g);
    this.notifications.info(t(cut ? 'glyph.cutDone' : 'glyph.copyDone'), 2500);
  }

  #paste() {
    const g = this.glyph;
    if (!g) return;
    if (!this.fonts.clipboard) { this.notifications.info(t('glyph.pasteEmpty'), 4000); return; }
    const range = this.fonts.pasteInto(g.name);
    if (!range) return;
    this.#clearSelection();
    const now = this.glyph;
    for (let c = range.from; c < range.from + range.count; c++) (now.contours[c] || []).forEach((_, i) => this.sel.points.add(`${c},${i}`));
    this.setTool('select');
    this.render();
  }

  #toggleSmooth() {
    const pts = this.#selectedPoints();
    this.#edit('smooth', (g) => {
      for (const [c, i] of pts) { const p = g.contours[c][i]; if (p[2] === 'offcurve') continue; if (p[3]) p.length = 3; else p[3] = 1; }
    });
  }

  #deleteSelection() {
    const g = this.glyph;
    if (!g || !this.#selectionSize) return;
    const byContour = new Map();
    for (const [c, i] of this.#selectedPoints()) { if (!byContour.has(c)) byContour.set(c, []); byContour.get(c).push(i); }
    const anchors = new Set(this.sel.anchors); const components = new Set(this.sel.components); const guides = new Set(this.sel.guides);
    this.#clearSelection();
    this.#edit('delete', (glyph) => {
      glyph.contours = glyph.contours.map((contour, ci) => {
        const picks = byContour.get(ci);
        if (!picks) return contour;
        // points on the curve are taken out one by one, each time joining the curve around them;
        // handles that are still there afterwards are retracted (their segment becomes a line)
        const ons = picks.filter((i) => model.isOn(contour[i])).map((i) => contour[i]);
        const offs = picks.filter((i) => !model.isOn(contour[i])).map((i) => contour[i]);
        let c = contour;
        for (const p of ons) { if (!c) break; const i = c.indexOf(p); if (i >= 0) c = removePoint(c, i); }
        const left = c ? offs.map((p) => c.indexOf(p)).filter((i) => i >= 0) : [];
        return left.length ? model.deletePoints(c, left) : c;
      }).filter(Boolean);
      glyph.anchors = glyph.anchors.filter((_, i) => !anchors.has(i));
      glyph.components = glyph.components.filter((_, i) => !components.has(i));
      if (guides.size) glyph.guidelines = (glyph.guidelines || []).filter((_, i) => !guides.has(i));
    });
  }

  #selectAll() {
    const g = this.glyph;
    this.sel.points.clear();
    g.contours.forEach((c, ci) => c.forEach((_, i) => this.sel.points.add(`${ci},${i}`)));
    this.#draw();
  }

  /** A new reference line through the middle of what is on screen; it comes selected, ready to be dragged or typed. */
  #addGuide(kind) {
    const g = this.glyph;
    if (!g) return;
    const rect = this.stage.getBoundingClientRect();
    const [x, y] = this.#toFont(rect.width / 2, rect.height / 2);
    if (!this.options.guides) { this.options.guides = true; this.#renderToggles(); }
    // only the selection changes: a path being drawn with the pen goes on
    this.sel.points.clear(); this.sel.anchors.clear(); this.sel.components.clear(); this.sel.guides.clear();
    this.sel.guides.add((g.guidelines || []).length);
    this.#edit('guide', (glyph) => { (glyph.guidelines ||= []).push(newGuideline(kind, x, y)); });
  }

  // ---- reference lines and the magnet
  /** Every line that is on screen and can hold a point: metric lines, the advance, the glyph's and the font's reference lines. */
  #referenceLines(glyph) {
    const lines = [];
    if (this.options.metrics) {
      const m = this.fonts.metrics;
      for (const y of [m.ascender, m.capHeight, m.xHeight, 0, m.descender]) if (y !== null && y !== undefined) lines.push({ y, metric: true });
      lines.push({ x: 0, metric: true }, { x: glyph.width, metric: true });
    }
    if (this.options.guides) {
      (glyph.guidelines || []).forEach((g, i) => lines.push({ ...g, guide: i }));
      const shared = this.fonts.font.info.other && this.fonts.font.info.other.guidelines;
      if (Array.isArray(shared)) for (const g of shared) if (g && (typeof g.x === 'number' || typeof g.y === 'number')) lines.push({ x: g.x, y: g.y, angle: g.angle, name: g.name, shared: true });
    }
    return lines;
  }

  /**
   * A position in font units, pulled onto the reference lines near it when the magnet is on
   * (Alt switches it off for one move). The result is always on the unit grid.
   */
  #snap(x, y, ev, skipGuides = false) {
    this.#snapped = [];
    const glyph = this.glyph;
    if (!this.options.snap || (ev && ev.altKey) || !glyph) return [Math.round(x), Math.round(y)];
    const lines = this.#referenceLines(glyph).filter((l) => !(skipGuides && l.guide !== undefined));
    const res = snapPoint(x, y, lines, SNAP / this.#scale);
    this.#snapped = res.hits.map((i) => lines[i]);
    return [Math.round(res.x), Math.round(res.y)];
  }

  async #addComponent() {
    const g = this.glyph;
    const res = await formDialog({
      title: t('glyph.dialog.component.title'), confirmLabel: t('common.add'),
      fields: [{ id: 'base', label: t('glyph.dialog.component.base'), value: '', hint: t('glyph.dialog.component.hint') }],
      validate: (v) => (!this.fonts.glyph(v.base.trim()) ? t('glyph.dialog.unknownGlyph', { name: v.base.trim() })
        : v.base.trim() === g.name || model.usersOf(this.fonts.font, g.name).includes(v.base.trim()) ? t('glyph.dialog.component.loop') : null),
    });
    if (!res) return;
    this.#edit('addComponent', (glyph) => { glyph.components.push({ base: res.base.trim(), transform: [1, 0, 0, 1, 0, 0] }); if (!glyph.contours.length && glyph.components.length === 1) glyph.width = this.fonts.glyph(res.base.trim()).width; });
  }

  async #addAnchor() {
    const g = this.glyph;
    const b = this.fonts.shape(g.name).bounds;
    const m = this.fonts.metrics;
    const res = await formDialog({
      title: t('glyph.dialog.anchor.title'), confirmLabel: t('common.add'),
      fields: [
        { id: 'name', label: t('glyph.dialog.anchor.name'), value: 'top', hint: t('glyph.dialog.anchor.hint') },
        { id: 'x', label: 'x', type: 'number', value: b ? Math.round((b.xMin + b.xMax) / 2) : Math.round(g.width / 2) },
        { id: 'y', label: 'y', type: 'number', value: b ? Math.round(b.yMax) : m.capHeight || m.ascender },
      ],
      validate: (v) => (!/^_?[A-Za-z][A-Za-z0-9_.]*$/.test(v.name.trim()) ? t('glyph.dialog.anchor.badName') : null),
    });
    if (!res) return;
    this.#edit('addAnchor', (glyph) => { glyph.anchors.push({ name: res.name.trim(), x: Math.round(res.x || 0), y: Math.round(res.y || 0) }); });
  }

  // colour layers live in the font lib and become COLR/CPAL on export
  #colorLayers(name) { const all = this.fonts.font.lib[COLOR_GLYPHS_KEY]; return (all && Array.isArray(all[name]) && all[name]) || []; }

  #setColorLayers(layers) {
    const name = this.glyph.name;
    this.fonts.edit(t('undo.color'), { sections: ['lib'] }, (font) => {
      const all = (font.lib[COLOR_GLYPHS_KEY] ||= {});
      if (layers.length) all[name] = layers; else delete all[name];
      if (!Object.keys(all).length) delete font.lib[COLOR_GLYPHS_KEY];
    });
  }

  async #addColorLayer() {
    const { fonts } = this;
    const palette = fonts.font.lib[PALETTE_KEY] || [];
    if (!palette.length) { this.notifications.info(t('glyph.color.noPalette')); this.layout.openView('info'); return; }
    const res = await formDialog({
      title: t('glyph.dialog.layer.title'), message: t('glyph.dialog.layer.message'), confirmLabel: t('common.add'),
      fields: [
        { id: 'glyph', label: t('glyph.dialog.layer.glyph'), value: this.glyph.name },
        { id: 'color', label: t('glyph.dialog.layer.color'), type: 'select', value: '0', options: [...palette.map((c, i) => [String(i), `${i + 1} · ${c}`]), ['65535', t('glyph.dialog.layer.textColor')]] },
      ],
      validate: (v) => (!fonts.glyph(v.glyph.trim()) ? t('glyph.dialog.unknownGlyph', { name: v.glyph.trim() }) : null),
    });
    if (res) this.#setColorLayers([...this.#colorLayers(this.glyph.name), { glyph: res.glyph.trim(), color: Number(res.color) }]);
  }

  // ---------------------------------------------------------------- canvas interaction
  #toFont(px, py) { return [(px - this.#ox) / this.#scale, (this.#oy - py) / this.#scale]; }

  /** What is under a screen position: a point, an anchor or a component of the glyph. */
  #hit(px, py) {
    const g = this.glyph;
    if (!g) return null;
    const near = (x, y) => Math.abs(this.#ox + x * this.#scale - px) <= HIT && Math.abs(this.#oy - y * this.#scale - py) <= HIT;
    if (this.options.points) {
      // handles are tested first: they are the small ones, and may sit over their point
      for (const off of [true, false]) {
        for (let c = g.contours.length - 1; c >= 0; c--) {
          for (let i = 0; i < g.contours[c].length; i++) {
            const p = g.contours[c][i];
            if ((p[2] === 'offcurve') === off && near(p[0], p[1])) return { kind: 'point', c, i };
          }
        }
      }
    }
    if (this.options.anchors) for (let i = 0; i < g.anchors.length; i++) if (near(g.anchors[i].x, g.anchors[i].y)) return { kind: 'anchor', i };
    const [fx, fy] = this.#toFont(px, py);
    if (this.options.guides) {
      const guides = g.guidelines || [];
      for (let i = guides.length - 1; i >= 0; i--) if (distanceToLine(guides[i], fx, fy) * this.#scale <= 5) return { kind: 'guide', i };
    }
    for (let i = g.components.length - 1; i >= 0; i--) {
      const path = new Path2D();
      drawCommands(path, glyphCommands(this.fonts.font, g.components[i].base, g.components[i].transform, 1, [g.name]));
      if (this.#scratch.isPointInPath(path, fx, fy, 'nonzero')) return { kind: 'component', i };
    }
    return null;
  }

  #bindCanvas() {
    const c = this.canvas;
    c.dataset.tool = this.tool;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.#zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      c.setPointerCapture(e.pointerId);
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left; const py = e.clientY - rect.top;
      if (e.button !== 0 || this.#space) this.#startPan(e);
      else if (this.tool === 'pen') this.#penDown(e, px, py);
      else if (this.tool === 'add') this.#addDown(px, py);
      else if (this.tool === 'remove') this.#removeDown(px, py);
      else {
        const handle = this.#boxHandleAt(px, py);
        if (handle) this.#boxDown(px, py, handle);
        else if (this.tool === 'scale') this.#scaleToolDown(px, py);
        else this.#selectDown(e, px, py);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const rect = c.getBoundingClientRect();
      const handle = this.#boxHandleAt(e.clientX - rect.left, e.clientY - rect.top);
      c.style.cursor = handle ? handle.cursor : '';
    });
    c.addEventListener('dblclick', (e) => {
      const rect = c.getBoundingClientRect();
      const hit = this.#hit(e.clientX - rect.left, e.clientY - rect.top);
      if (this.tool === 'pen') { this.#pen = { contour: -1, out: null }; this.#draw(); return; }
      if (hit && hit.kind === 'point') { this.sel.points = new Set([`${hit.c},${hit.i}`]); this.#toggleSmooth(); } else if (hit && hit.kind === 'component') this.fonts.select(this.glyph.components[hit.i].base);
      else if (hit && hit.kind === 'guide') { /* a reference line stays selected */ }
      else { this.#fit(); this.#draw(); }
    });
    c.addEventListener('keydown', (e) => this.#onKey(e));
    c.addEventListener('keyup', (e) => { if (e.key === ' ') { this.#space = false; c.classList.remove('can-pan'); } });
    c.addEventListener('blur', () => { this.#space = false; c.classList.remove('can-pan'); });
  }

  #track(move, up) {
    const c = this.canvas;
    const onMove = (ev) => { const rect = c.getBoundingClientRect(); move(ev.clientX - rect.left, ev.clientY - rect.top, ev); };
    const onUp = (ev) => {
      c.removeEventListener('pointermove', onMove); c.removeEventListener('pointerup', onUp); c.removeEventListener('pointercancel', onUp);
      const rect = c.getBoundingClientRect();
      up(ev.clientX - rect.left, ev.clientY - rect.top, ev);
    };
    c.addEventListener('pointermove', onMove); c.addEventListener('pointerup', onUp); c.addEventListener('pointercancel', onUp);
  }

  #startPan(e) {
    let x = e.clientX; let y = e.clientY;
    this.canvas.classList.add('panning');
    this.#track((_px, _py, ev) => { this.#ox += ev.clientX - x; this.#oy += ev.clientY - y; x = ev.clientX; y = ev.clientY; this.#draw(); },
      () => this.canvas.classList.remove('panning'));
  }

  #selectDown(e, px, py) {
    const g = this.glyph;
    if (!g) return;
    const hit = this.#hit(px, py);
    if (!hit) {
      // drag a box around points; a plain click clears the selection
      const add = e.shiftKey;
      this.#marquee = { x0: px, y0: py, x1: px, y1: py };
      this.#track((x, y) => { this.#marquee.x1 = x; this.#marquee.y1 = y; this.#draw(); }, () => {
        const m = this.#marquee; this.#marquee = null;
        if (!add) this.#clearSelection();
        if (Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3) {
          const [ax, ay] = this.#toFont(Math.min(m.x0, m.x1), Math.max(m.y0, m.y1));
          const [bx, by] = this.#toFont(Math.max(m.x0, m.x1), Math.min(m.y0, m.y1));
          const inside = (x, y) => x >= ax && x <= bx && y >= ay && y <= by;
          g.contours.forEach((contour, c) => contour.forEach((p, i) => { if (inside(p[0], p[1])) this.sel.points.add(`${c},${i}`); }));
          g.anchors.forEach((a, i) => { if (inside(a.x, a.y)) this.sel.anchors.add(i); });
        }
        this.render();
      });
      return;
    }
    const set = hit.kind === 'point' ? this.sel.points : hit.kind === 'anchor' ? this.sel.anchors : hit.kind === 'guide' ? this.sel.guides : this.sel.components;
    const key = hit.kind === 'point' ? `${hit.c},${hit.i}` : hit.i;
    if (e.shiftKey) { if (set.has(key)) set.delete(key); else set.add(key); } else if (!set.has(key)) { this.#clearSelection(); set.add(key); }
    this.#renderPanel(g);
    this.#draw();
    if (!set.has(key)) return;

    // what moves: the selection, plus the handles of every selected on-curve point
    const moving = new Map(); // "c,i" → start [x, y]
    for (const [c, i] of this.#selectedPoints()) {
      const contour = g.contours[c]; const n = contour.length;
      moving.set(`${c},${i}`, [contour[i][0], contour[i][1]]);
      if (contour[i][2] === 'offcurve') continue;
      for (const j of [i - 1, i + 1]) {
        const k = model.isClosed(contour) ? (j + n) % n : j;
        if (k >= 0 && k < n && contour[k][2] === 'offcurve' && !moving.has(`${c},${k}`)) moving.set(`${c},${k}`, [contour[k][0], contour[k][1]]);
      }
    }
    const anchors = [...this.sel.anchors].map((i) => [i, g.anchors[i].x, g.anchors[i].y]);
    const comps = [...this.sel.components].map((i) => [i, g.components[i].transform[4], g.components[i].transform[5]]);
    const guides = [...this.sel.guides].map((i) => [i, g.guidelines[i].x, g.guidelines[i].y]);
    const single = this.sel.points.size === 1 && !anchors.length && !comps.length && !guides.length && hit.kind === 'point' && g.contours[hit.c][hit.i][2] === 'offcurve' ? hit : null;
    // the magnet pulls the thing that was grabbed; everything else selected moves along with it
    const grabbed = hit.kind === 'point' ? [g.contours[hit.c][hit.i][0], g.contours[hit.c][hit.i][1]] : hit.kind === 'anchor' ? [g.anchors[hit.i].x, g.anchors[hit.i].y] : null;
    let started = false;
    this.#track((x, y, ev) => {
      let dx = (x - px) / this.#scale; let dy = (py - y) / this.#scale;
      if (!started && Math.abs(x - px) < 3 && Math.abs(y - py) < 3) return;
      if (!started) { started = true; this.fonts.begin(t('undo.movePoints'), { glyphs: [g.name] }); }
      const lock = ev.shiftKey && !single ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null; // Shift keeps the move straight
      if (lock === 'y') dy = 0; else if (lock === 'x') dx = 0;
      if (single && ev.shiftKey) {
        // Shift on a handle keeps it horizontal, vertical or at 45° from its point
        const anchor = handleAnchor(g.contours[single.c], single.i);
        const [tx, ty] = anchor ? constrainToAngles(anchor[1], grabbed[0] + dx, grabbed[1] + dy) : [grabbed[0] + dx, grabbed[1] + dy];
        dx = Math.round(tx) - grabbed[0]; dy = Math.round(ty) - grabbed[1];
        this.#snapped = [];
      } else if (grabbed) {
        // reference lines that move with the selection cannot hold it
        const [tx, ty] = this.#snap(grabbed[0] + dx, grabbed[1] + dy, ev, guides.length > 0);
        dx = tx - grabbed[0]; dy = ty - grabbed[1];
        if (lock === 'y') dy = 0; else if (lock === 'x') dx = 0;
      } else { dx = Math.round(dx); dy = Math.round(dy); }
      for (const [k, [sx, sy]] of moving) { const [c, i] = k.split(',').map(Number); g.contours[c][i][0] = sx + dx; g.contours[c][i][1] = sy + dy; }
      for (const [i, sx, sy] of anchors) { g.anchors[i].x = sx + dx; g.anchors[i].y = sy + dy; }
      for (const [i, sx, sy] of comps) { g.components[i].transform[4] = sx + dx; g.components[i].transform[5] = sy + dy; }
      for (const [i, sx, sy] of guides) { const line = g.guidelines[i]; if (sx !== undefined && sx !== null) line.x = sx + dx; if (sy !== undefined && sy !== null) line.y = sy + dy; }
      if (single) this.#keepSmooth(g.contours[single.c], single.i);
      this.#draw();
    }, () => { this.#snapped = []; if (started) { if (!this.fonts.commit()) this.render(); } else this.#draw(); });
  }

  // ---------------------------------------------------------------- scaling the selection (as in Illustrator)
  /** What a transformation acts on: the selected points with the handles of every selected on-curve point, and the selected anchors. */
  #targets() {
    const g = this.glyph;
    const points = new Map(); // "c,i" → [x, y] as they are now
    if (!g) return { points, anchors: [] };
    for (const [c, i] of this.#selectedPoints()) {
      const contour = g.contours[c]; const n = contour.length;
      points.set(`${c},${i}`, [contour[i][0], contour[i][1]]);
      if (contour[i][2] === 'offcurve') continue;
      for (const j of [i - 1, i + 1]) {
        const k = model.isClosed(contour) ? (j + n) % n : j;
        if (k >= 0 && k < n && contour[k][2] === 'offcurve' && !points.has(`${c},${k}`)) points.set(`${c},${k}`, [contour[k][0], contour[k][1]]);
      }
    }
    return { points, anchors: [...this.sel.anchors].filter((i) => g.anchors[i]).map((i) => [i, g.anchors[i].x, g.anchors[i].y]) };
  }

  /** The box around the selected points and anchors (font units); null with fewer than two of them, or when they are all in one place. */
  #selectionBox() {
    const g = this.glyph;
    if (!g || this.sel.points.size + this.sel.anchors.size < 2) return null;
    const b = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
    const add = (x, y) => { b.xMin = Math.min(b.xMin, x); b.xMax = Math.max(b.xMax, x); b.yMin = Math.min(b.yMin, y); b.yMax = Math.max(b.yMax, y); };
    for (const [c, i] of this.#selectedPoints()) add(g.contours[c][i][0], g.contours[c][i][1]);
    for (const i of this.sel.anchors) if (g.anchors[i]) add(g.anchors[i].x, g.anchors[i].y);
    return b.xMax > b.xMin || b.yMax > b.yMin ? b : null;
  }

  /** The eight handles of the box, on screen: corners scale both ways, sides one way. A side with no size has no handle. */
  #boxHandles() {
    const box = this.options.bbox === false || (this.tool !== 'select' && this.tool !== 'scale') ? null : this.#selectionBox();
    if (!box) return [];
    const left = this.#ox + box.xMin * this.#scale - BOX_PAD; const right = this.#ox + box.xMax * this.#scale + BOX_PAD;
    const top = this.#oy - box.yMax * this.#scale - BOX_PAD; const bottom = this.#oy - box.yMin * this.#scale + BOX_PAD;
    const wide = box.xMax > box.xMin; const tall = box.yMax > box.yMin;
    const out = [];
    for (const fx of [-1, 0, 1]) {
      for (const fy of [-1, 0, 1]) {
        if ((!fx && !fy) || (fx && !wide) || (fy && !tall)) continue;
        out.push({ fx, fy, box, px: fx < 0 ? left : fx > 0 ? right : (left + right) / 2, py: fy > 0 ? top : fy < 0 ? bottom : (top + bottom) / 2,
          cursor: fx && fy ? (fx * fy > 0 ? 'nesw-resize' : 'nwse-resize') : fx ? 'ew-resize' : 'ns-resize' });
      }
    }
    return out;
  }

  #boxHandleAt(px, py) {
    return this.#boxHandles().find((hd) => Math.abs(hd.px - px) <= HIT && Math.abs(hd.py - py) <= HIT) || null;
  }

  /**
   * Drags a scale: `factors(dx, dy, ev)` says, for the movement of the mouse in font units, how much to
   * scale each way and from which point. One undoable step; the points are always calculated from where
   * they started, so nothing drifts. `onClick` is called when the mouse did not move.
   */
  #scaleDrag(px, py, factors, onClick) {
    const g = this.glyph;
    const { points, anchors } = this.#targets();
    let started = false;
    this.#track((x, y, ev) => {
      if (!started && Math.abs(x - px) < 3 && Math.abs(y - py) < 3) return;
      if (!started) { started = true; this.fonts.begin(t('undo.transform'), { glyphs: [g.name] }); }
      const f = factors((x - px) / this.#scale, (py - y) / this.#scale, ev);
      const sx = Math.max(0.01, f.sx); const sy = Math.max(0.01, f.sy); // down to almost nothing, never inside out
      for (const [k, [x0, y0]] of points) { const [c, i] = k.split(',').map(Number); g.contours[c][i][0] = Math.round(f.ax + (x0 - f.ax) * sx); g.contours[c][i][1] = Math.round(f.ay + (y0 - f.ay) * sy); }
      for (const [i, x0, y0] of anchors) { g.anchors[i].x = Math.round(f.ax + (x0 - f.ax) * sx); g.anchors[i].y = Math.round(f.ay + (y0 - f.ay) * sy); }
      this.#scaleInfo = { sx, sy };
      this.#draw();
    }, (x, y) => {
      this.#scaleInfo = null;
      if (started) { if (!this.fonts.commit()) this.render(); } else if (onClick) onClick(x, y); else this.#draw();
    });
  }

  /** A handle of the box: scales from the opposite side (Alt: from the centre; Shift: the same amount both ways). */
  #boxDown(px, py, handle) {
    const { fx, fy, box } = handle;
    const cx = (box.xMin + box.xMax) / 2; const cy = (box.yMin + box.yMax) / 2;
    const hx = fx < 0 ? box.xMin : box.xMax; const hy = fy < 0 ? box.yMin : box.yMax;
    this.#scaleDrag(px, py, (dx, dy, ev) => {
      const ax = ev.altKey || !fx ? cx : fx < 0 ? box.xMax : box.xMin;
      const ay = ev.altKey || !fy ? cy : fy < 0 ? box.yMax : box.yMin;
      let sx = fx ? (hx + dx - ax) / (hx - ax) : 1;
      let sy = fy ? (hy + dy - ay) / (hy - ay) : 1;
      if (ev.shiftKey) { const same = fx && fy ? (Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy) : fx ? sx : sy; sx = same; sy = same; }
      return { sx, sy, ax, ay };
    });
  }

  /**
   * Scale tool (S): drag anywhere to scale what is selected from its centre — or from the point set
   * with a click. Shift keeps the proportions.
   */
  #scaleToolDown(px, py) {
    const box = this.#selectionBox();
    if (!box) { this.notifications.info(t('glyph.scale.needSelection'), 5000); return; }
    const ref = this.#scaleRef || [(box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2];
    const [x0, y0] = this.#toFont(px, py);
    const rx = x0 - ref[0]; const ry = y0 - ref[1];
    const near = 8 / this.#scale; // too close to the reference point that way: that way is left alone
    this.#scaleDrag(px, py, (dx, dy, ev) => {
      let sx = Math.abs(rx) > near ? (rx + dx) / rx : 1;
      let sy = Math.abs(ry) > near ? (ry + dy) / ry : 1;
      if (ev.shiftKey) { const same = Math.hypot(rx + dx, ry + dy) / (Math.hypot(rx, ry) || 1); sx = same; sy = same; }
      return { sx, sy, ax: ref[0], ay: ref[1] };
    }, (x, y) => { this.#scaleRef = this.#toFont(x, y).map(Math.round); this.#draw(); });
  }

  /** Add-point tool: a click on the outline puts a point there, without changing the shape. */
  #addDown(px, py) {
    const g = this.glyph;
    if (!g) return;
    const hit = this.#hit(px, py);
    if (hit && hit.kind === 'point') { this.#clearSelection(); this.sel.points.add(`${hit.c},${hit.i}`); this.render(); return; }
    const [fx, fy] = this.#toFont(px, py);
    const spot = nearestOnOutline(g, fx, fy);
    if (!spot || spot.distance * this.#scale > 9) { this.notifications.info(t('glyph.add.miss'), 3500); return; }
    const res = insertPoint(g.contours[spot.contour], spot.segment, spot.t);
    if (!res) { this.notifications.info(t('glyph.add.unsupported'), 5000); return; }
    this.#clearSelection();
    this.sel.points.add(`${spot.contour},${res.index}`);
    this.#edit('addPoint', (glyph) => { glyph.contours[spot.contour] = res.contour; });
  }

  /** Remove-point tool: a click on a point takes it out and joins the curve; on a handle, it retracts the handle. */
  #removeDown(px, py) {
    const g = this.glyph;
    const hit = g ? this.#hit(px, py) : null;
    if (!hit || hit.kind !== 'point') { this.notifications.info(t('glyph.remove.miss'), 3500); return; }
    this.#clearSelection();
    this.#edit('removePoint', (glyph) => {
      const contour = glyph.contours[hit.c];
      const next = model.isOn(contour[hit.i]) ? removePoint(contour, hit.i) : model.deletePoints(contour, [hit.i]);
      if (next) glyph.contours[hit.c] = next; else glyph.contours.splice(hit.c, 1);
    });
  }

  /** The handles the angle commands act on: the selected handles, and the handles of the selected points. */
  #handleTargets() {
    const g = this.glyph;
    const out = new Map();
    for (const [c, i] of this.#selectedPoints()) {
      const contour = g.contours[c]; const n = contour.length;
      if (!model.isOn(contour[i])) { out.set(`${c},${i}`, [c, i]); continue; }
      for (const j of [i - 1, i + 1]) {
        const k = model.isClosed(contour) ? (j + n) % n : j;
        if (contour[k] && !model.isOn(contour[k])) out.set(`${c},${k}`, [c, k]);
      }
    }
    return [...out.values()];
  }

  /**
   * Turns the handles of the selection: 'h' horizontal, 'v' vertical, 'd' the nearest 45°, or degrees.
   * A handle on the other side of a smooth point follows, to stay on the same line.
   */
  #alignHandles(mode, exact = false) {
    const targets = this.#handleTargets();
    if (!targets.length) { this.notifications.info(t('glyph.handle.none'), 3500); return; }
    const picked = new Set(targets.map(([c, i]) => `${c},${i}`));
    this.#edit('handle', (glyph) => {
      for (const [c, i] of targets) {
        const contour = glyph.contours[c];
        if (!alignHandle(contour, i, mode, exact)) continue;
        const anchor = handleAnchor(contour, i);
        const n = contour.length;
        const other = anchor ? (model.isClosed(contour) ? (2 * anchor[0] - i + n) % n : 2 * anchor[0] - i) : -1;
        if (!picked.has(`${c},${other}`)) this.#keepSmooth(contour, i);
      }
    });
  }

  async #askHandleAngle() {
    const targets = this.#handleTargets();
    if (!targets.length) { this.notifications.info(t('glyph.handle.none'), 3500); return; }
    const current = handleAngle(this.glyph.contours[targets[0][0]], targets[0][1]);
    const res = await formDialog({
      title: t('glyph.dialog.angle.title'), message: t('glyph.dialog.angle.message'), confirmLabel: t('common.ok'),
      fields: [{ id: 'angle', label: t('glyph.guide.angle'), type: 'number', value: current === null ? 0 : Math.round(current * 10) / 10 }],
      validate: (v) => (v.angle === null || !Number.isFinite(v.angle) ? t('glyph.dialog.angle.bad') : null),
    });
    if (res) this.#alignHandles(res.angle);
    this.canvas.focus();
  }

  /** When a handle of a smooth point moves, the opposite handle turns to stay on the same line. */
  #keepSmooth(contour, i) {
    const n = contour.length; const closed = model.isClosed(contour);
    for (const dir of [-1, 1]) {
      const at = closed ? (i + dir + n) % n : i + dir;
      const point = contour[at];
      if (!point || point[2] === 'offcurve' || !point[3]) continue;
      const other = contour[closed ? (at + dir + n) % n : at + dir];
      if (!other || other[2] !== 'offcurve') continue;
      const vx = contour[i][0] - point[0]; const vy = contour[i][1] - point[1];
      const len = Math.hypot(vx, vy);
      if (!len) continue;
      const keep = Math.hypot(other[0] - point[0], other[1] - point[1]);
      other[0] = Math.round(point[0] - vx / len * keep); other[1] = Math.round(point[1] - vy / len * keep);
    }
  }

  #penDown(e, px, py) {
    const g = this.glyph;
    if (!g) return;
    let [x, y] = this.#snap(...this.#toFont(px, py), e);
    const pen = this.#pen;
    let contour = g.contours[pen.contour];
    if (contour && model.isClosed(contour)) contour = null;
    const hit = this.#hit(px, py);
    this.fonts.begin(t('undo.draw'), { glyphs: [g.name] });
    if (contour && hit && hit.kind === 'point' && hit.c === pen.contour && hit.i === 0 && contour.filter(model.isOn).length >= 2) {
      // back on the first point: close the contour
      if (pen.out) { contour.push([pen.out[0], pen.out[1], 'offcurve'], [contour[0][0], contour[0][1], 'offcurve']); contour[0][2] = 'curve'; } else contour[0][2] = 'line';
      this.#pen = { contour: -1, out: null };
      this.fonts.commit();
      return;
    }
    if (e.shiftKey && contour) { // straight up, down or sideways from the previous point
      const last = contour[contour.length - 1];
      if (Math.abs(x - last[0]) > Math.abs(y - last[1])) y = last[1]; else x = last[0];
    }
    if (!contour) { contour = [[x, y, 'move']]; g.contours.push(contour); pen.contour = g.contours.length - 1; pen.out = null; } else if (pen.out) {
      contour.push([pen.out[0], pen.out[1], 'offcurve'], [x, y, 'offcurve'], [x, y, 'curve']);
    } else contour.push([x, y, 'line']);
    pen.out = null;
    const point = contour[contour.length - 1];
    this.sel.anchors.clear(); this.sel.components.clear(); this.sel.guides.clear();
    this.sel.points = new Set([`${pen.contour},${contour.length - 1}`]);
    this.#draw();
    this.#track((mx, my, ev) => {
      if (Math.abs(mx - px) < 4 && Math.abs(my - py) < 4) return;
      // dragging pulls the handles out of the new point (Shift keeps them horizontal, vertical or at 45°)
      let [hx, hy] = this.#toFont(mx, my).map(Math.round);
      if (ev.shiftKey) [hx, hy] = constrainToAngles([x, y], hx, hy).map(Math.round);
      this.#snapped = [];
      const dx = hx - x; const dy = hy - y;
      if (point[2] === 'line') { // the segment that arrives becomes a curve
        const prev = contour[contour.length - 2];
        contour.splice(contour.length - 1, 0, [prev[0], prev[1], 'offcurve'], [x - dx, y - dy, 'offcurve']);
        point[2] = 'curve';
        this.sel.points = new Set([`${pen.contour},${contour.length - 1}`]);
      } else if (point[2] === 'curve') { const inHandle = contour[contour.length - 2]; inHandle[0] = x - dx; inHandle[1] = y - dy; }
      point[3] = 1;
      pen.out = [x + dx, y + dy];
      this.#draw();
    }, () => { this.#snapped = []; this.fonts.commit(); this.#draw(); });
  }

  #onKey(e) {
    const g = this.glyph;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ') { e.preventDefault(); this.#space = true; this.canvas.classList.add('can-pan'); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); if (g) { this.#selectAll(); this.#renderPanel(g); } return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'b') {
      // show or hide the box around the selection (the same keys as in Illustrator)
      e.preventDefault(); e.stopPropagation();
      this.options.bbox = this.options.bbox === false;
      try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options)); } catch { /* storage unavailable */ }
      this.#draw();
      return;
    }
    if (mod && !e.shiftKey && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      if (e.key.toLowerCase() === 'v') this.#paste(); else this.#copy(e.key.toLowerCase() === 'x');
      return;
    }
    if (mod) {
      // zoom moved to Ctrl, so that + and − can pick the add-point and remove-point tools
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.#zoomBy(1.25); } else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.#zoomBy(1 / 1.25); } else if (e.key === '0') { e.preventDefault(); this.#fit(); this.#draw(); }
      return;
    }
    const key = e.key.toLowerCase();
    if (e.shiftKey && !e.altKey && ['h', 'v', 'd', 'a'].includes(key)) {
      // the direction of the handles of the selection
      e.preventDefault();
      if (key === 'a') this.#askHandleAngle(); else this.#alignHandles(key);
      return;
    }
    if (key === 'v') { this.setTool('select'); return; }
    if (key === 'p') { this.setTool('pen'); return; }
    if (key === 's') { this.setTool('scale'); return; }
    if (key === 'm') { this.setSnap(!this.options.snap); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); this.setTool('add'); return; }
    if (e.key === '-' || e.key === '−') { e.preventDefault(); this.setTool('remove'); return; }
    if (e.key === '0') { e.preventDefault(); this.#fit(); this.#draw(); return; }
    if (e.key === 'Escape' || e.key === 'Enter') { this.#clearSelection(); this.render(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.#selectionSize) { e.preventDefault(); this.#deleteSelection(); return; }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (step && this.#selectionSize && g) {
      // with something selected the arrows nudge it; with nothing selected they change glyph (workbench.js)
      e.preventDefault(); e.stopPropagation();
      const k = e.shiftKey ? 10 : 1;
      const pts = this.#selectedPoints(); const anchors = [...this.sel.anchors]; const comps = [...this.sel.components]; const guides = [...this.sel.guides];
      this.#edit('movePoints', (glyph) => {
        const moved = new Set();
        const move = (c, i) => { const id = `${c},${i}`; if (moved.has(id)) return; moved.add(id); glyph.contours[c][i][0] += step[0] * k; glyph.contours[c][i][1] += step[1] * k; };
        for (const [c, i] of pts) {
          const contour = glyph.contours[c]; const n = contour.length;
          move(c, i);
          if (contour[i][2] === 'offcurve') continue;
          for (const j of [i - 1, i + 1]) { const at = model.isClosed(contour) ? (j + n) % n : j; if (contour[at] && contour[at][2] === 'offcurve') move(c, at); }
        }
        for (const i of anchors) { glyph.anchors[i].x += step[0] * k; glyph.anchors[i].y += step[1] * k; }
        for (const i of comps) { glyph.components[i].transform[4] += step[0] * k; glyph.components[i].transform[5] += step[1] * k; }
        for (const i of guides) { const line = glyph.guidelines[i]; if (lineKind(line) !== 'h') line.x += step[0] * k; if (lineKind(line) !== 'v') line.y += step[1] * k; }
      });
    }
  }

  #zoomBy(factor, px, py) {
    const rect = this.stage.getBoundingClientRect();
    const x = px ?? rect.width / 2;
    const y = py ?? rect.height / 2;
    const next = Math.min(40, Math.max(0.02, this.#scale * factor));
    const k = next / this.#scale;
    this.#ox = x - (x - this.#ox) * k;
    this.#oy = y - (y - this.#oy) * k;
    this.#scale = next;
    this.#draw();
  }

  /** Shows the whole glyph: its advance width and the font's vertical extent, with some air around. */
  #fit() {
    const { fonts } = this;
    const glyph = this.glyph;
    const rect = this.stage.getBoundingClientRect();
    if (!glyph || rect.width < 10 || rect.height < 10) return;
    const m = fonts.metrics;
    const top = Math.max(m.ascender, m.capHeight || 0);
    const b = fonts.shape(glyph.name).bounds;
    const yMax = Math.max(top, b ? b.yMax : 0);
    const yMin = Math.min(m.descender, b ? b.yMin : 0);
    const xMin = Math.min(0, b ? b.xMin : 0);
    const xMax = Math.max(glyph.width, b ? b.xMax : 0);
    const pad = 56;
    this.#scale = Math.min((rect.width - pad * 2) / Math.max(1, xMax - xMin), (rect.height - pad * 2) / Math.max(1, yMax - yMin));
    this.#ox = (rect.width - (xMax - xMin) * this.#scale) / 2 - xMin * this.#scale;
    this.#oy = (rect.height - (yMax - yMin) * this.#scale) / 2 + yMax * this.#scale;
    this.#fitted = true;
  }

  #draw() {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#paint());
  }

  #paint() {
    const { fonts, canvas } = this;
    const rect = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const hgt = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== hgt * dpr) {
      canvas.width = w * dpr; canvas.height = hgt * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${hgt}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    this.zoomLabel.textContent = `${Math.round(this.#scale * 100)}%`;
    const glyph = this.glyph;
    if (!glyph) return;

    const colors = {
      text: cssVar('--text-primary'), muted: cssVar('--text-muted'), line: cssVar('--canvas-line'),
      accent: cssVar('--accent'), second: cssVar('--second'), fill: cssVar('--canvas-fill'), bg: cssVar('--bg-editor'), highlight: cssVar('--text-primary'),
      guide: cssVar('--second-text') || cssVar('--second'),
    };
    const sx = (x) => this.#ox + x * this.#scale;
    const sy = (y) => this.#oy - y * this.#scale;
    const font = `11px ${cssVar('--font-mono')}`;

    // metric lines
    if (this.options.metrics) {
      const m = fonts.metrics;
      ctx.lineWidth = 1;
      ctx.font = font;
      ctx.textBaseline = 'bottom';
      const lines = [['ascender', m.ascender], ['capHeight', m.capHeight], ['xHeight', m.xHeight], ['baseline', 0], ['descender', m.descender]];
      for (const [id, y] of lines) {
        if (y === null || y === undefined) continue;
        const py = Math.round(sy(y)) + 0.5;
        ctx.strokeStyle = id === 'baseline' ? colors.muted : colors.line;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.fillStyle = colors.muted;
        ctx.fillText(`${t('glyph.line.' + id)} ${formatUnits(y)}`, 10, py - 3);
      }
      ctx.strokeStyle = colors.line;
      for (const x of [0, glyph.width]) {
        const px = Math.round(sx(x)) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, hgt); ctx.stroke();
      }
      ctx.fillStyle = colors.muted;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      ctx.fillText(formatUnits(glyph.width), (sx(0) + sx(glyph.width)) / 2, Math.min(hgt - 16, sy(fonts.metrics.descender) + 6));
      ctx.textAlign = 'left';
    }

    // reference lines: the glyph's own (dashed), the font's (fainter), and in the highlight colour
    // the ones that are selected or holding what is being dragged
    const far = (w + hgt) * 2;
    const line = (l, color, dash, width = 1) => {
      const kind = lineKind(l);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      if (kind === 'h') { const py = Math.round(sy(l.y)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); } else if (kind === 'v') { const px = Math.round(sx(l.x)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, hgt); } else {
        const a = (l.angle || 0) * Math.PI / 180;
        const px = sx(l.x); const py = sy(l.y);
        ctx.moveTo(px - Math.cos(a) * far, py + Math.sin(a) * far); ctx.lineTo(px + Math.cos(a) * far, py - Math.sin(a) * far);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.options.guides) {
      ctx.font = font; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
      for (const l of this.#referenceLines(glyph)) {
        if (l.metric) continue;
        const selected = l.guide !== undefined && this.sel.guides.has(l.guide);
        line(l, selected ? colors.accent : l.shared ? colors.line : colors.guide, selected ? [] : [6, 4], selected ? 1.6 : 1);
        const kind = lineKind(l);
        if (kind === 'd') { ctx.beginPath(); ctx.arc(sx(l.x), sy(l.y), 3, 0, Math.PI * 2); ctx.fillStyle = selected ? colors.accent : colors.guide; ctx.fill(); }
        if (l.name) { ctx.fillStyle = colors.muted; ctx.fillText(l.name, kind === 'h' ? w - 12 - ctx.measureText(l.name).width : sx(l.x) + 6, kind === 'h' ? sy(l.y) - 3 : kind === 'v' ? 14 : sy(l.y) - 6); }
      }
    }
    for (const l of this.#snapped) line(l, colors.accent, [], 1.6);

    const inFont = (fn) => { ctx.save(); ctx.translate(this.#ox, this.#oy); ctx.scale(this.#scale, -this.#scale); fn(); ctx.restore(); };

    // colour layers, when the glyph has them, are painted first as the finished look
    const layers = this.#colorLayers(glyph.name);
    const palette = fonts.font.lib[PALETTE_KEY] || [];
    if (layers.length && this.options.fill) {
      inFont(() => {
        for (const layer of layers) {
          const path = new Path2D();
          drawCommands(path, glyphCommands(fonts.font, layer.glyph));
          ctx.fillStyle = layer.color === 0xFFFF ? colors.text : palette[layer.color] || colors.text;
          ctx.fill(path, 'nonzero');
        }
      });
    }

    // the same glyph in the other weights, behind the one being drawn
    if (this.options.weights && fonts.hasWeights) {
      inFont(() => {
        ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2 / this.#scale; ctx.strokeStyle = colors.guide;
        for (const w of siblingWeights(fonts.font)) {
          if (!w.glyphs[glyph.name]) continue;
          const path = new Path2D();
          drawCommands(path, glyphCommands({ glyphs: w.glyphs }, glyph.name));
          ctx.stroke(path);
        }
        ctx.globalAlpha = 1;
      });
    }

    // outline: the glyph's own contours and, in the secondary colour, what comes from components
    const own = new Path2D();
    for (const contour of glyph.contours) drawCommands(own, contourCommands(contour));
    const parts = glyph.components.map((comp) => { const p = new Path2D(); drawCommands(p, glyphCommands(fonts.font, comp.base, comp.transform, 1, [glyph.name])); return p; });
    if (this.options.fill && !layers.length) {
      inFont(() => {
        ctx.fillStyle = this.options.points ? colors.fill : colors.text;
        ctx.fill(own, 'nonzero');
        for (const p of parts) ctx.fill(p, 'nonzero');
      });
    }
    const stroke = (path, color, width = 1.4) => inFont(() => { ctx.lineWidth = width / this.#scale; ctx.strokeStyle = color; ctx.stroke(path); });
    if (this.options.points || !this.options.fill) {
      parts.forEach((p, i) => stroke(p, this.sel.components.has(i) ? colors.accent : colors.second, this.sel.components.has(i) ? 2.4 : 1.4));
      stroke(own, colors.text);
    }

    // points and handles of the glyph's own contours
    if (this.options.points) {
      ctx.lineWidth = 1;
      glyph.contours.forEach((contour, ci) => {
        const n = contour.length;
        const closed = contour[0][2] !== 'move';
        ctx.strokeStyle = colors.second;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = contour[i];
          if (p[2] !== 'offcurve') continue;
          for (const j of [i - 1, i + 1]) {
            if (!closed && (j < 0 || j >= n)) continue;
            const q = contour[(j + n) % n];
            if (q[2] === 'offcurve') continue;
            ctx.moveTo(sx(p[0]), sy(p[1])); ctx.lineTo(sx(q[0]), sy(q[1]));
          }
        }
        ctx.stroke();
        for (let i = 0; i < n; i++) {
          const [x, y, type, smooth] = contour[i];
          const px = sx(x); const py = sy(y);
          const selected = this.sel.points.has(`${ci},${i}`);
          const r = selected ? 1.5 : 0;
          ctx.beginPath();
          if (type === 'offcurve') {
            ctx.arc(px, py, 2.6 + r, 0, Math.PI * 2);
            ctx.fillStyle = selected ? colors.highlight : colors.bg; ctx.strokeStyle = selected ? colors.accent : colors.second;
          } else if (smooth) {
            ctx.arc(px, py, 3.6 + r, 0, Math.PI * 2);
            ctx.fillStyle = selected ? colors.highlight : colors.accent; ctx.strokeStyle = selected ? colors.accent : colors.bg;
          } else {
            ctx.rect(px - 3.2 - r, py - 3.2 - r, 6.4 + r * 2, 6.4 + r * 2);
            ctx.fillStyle = selected ? colors.highlight : colors.accent; ctx.strokeStyle = selected ? colors.accent : colors.bg;
          }
          ctx.fill(); ctx.stroke();
        }
        // the first point of each contour gets a ring, so the start and the direction can be read
        const first = contour.find((p) => p[2] !== 'offcurve') || contour[0];
        ctx.beginPath(); ctx.arc(sx(first[0]), sy(first[1]), 7, 0, Math.PI * 2);
        ctx.strokeStyle = colors.accent; ctx.stroke();
      });
      // the handle the pen will use for the next segment
      const penContour = glyph.contours[this.#pen.contour];
      if (this.tool === 'pen' && penContour && this.#pen.out) {
        const last = penContour[penContour.length - 1];
        ctx.strokeStyle = colors.second; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(sx(last[0]), sy(last[1])); ctx.lineTo(sx(this.#pen.out[0]), sy(this.#pen.out[1])); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(sx(this.#pen.out[0]), sy(this.#pen.out[1]), 2.6, 0, Math.PI * 2); ctx.stroke();
      }
    }

    if (this.options.anchors) {
      ctx.font = font;
      ctx.textBaseline = 'middle';
      glyph.anchors.forEach((a, i) => {
        const px = sx(a.x); const py = sy(a.y);
        const selected = this.sel.anchors.has(i);
        const r = selected ? 7 : 5;
        ctx.beginPath();
        ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath();
        ctx.fillStyle = selected ? colors.highlight : colors.second; ctx.fill();
        ctx.strokeStyle = selected ? colors.accent : colors.bg; ctx.stroke();
        ctx.fillStyle = colors.muted;
        ctx.fillText(a.name, px + 9, py);
      });
    }

    // the box around the selection, with its handles; the point the scale tool works from
    const handles = this.#boxHandles();
    this.canvas.dataset.box = '';
    if (handles.length) {
      const xs = handles.map((hd) => hd.px); const ys = handles.map((hd) => hd.py);
      const box = handles[0].box;
      const left = sx(box.xMin) - BOX_PAD; const right = sx(box.xMax) + BOX_PAD; const top = sy(box.yMax) - BOX_PAD; const bottom = sy(box.yMin) + BOX_PAD;
      this.canvas.dataset.box = [left, top, right, bottom].map(Math.round).join(',');
      ctx.lineWidth = 1; ctx.strokeStyle = colors.accent; ctx.setLineDash([]);
      ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(right - left), Math.round(bottom - top));
      ctx.fillStyle = colors.bg;
      for (const hd of handles) { ctx.beginPath(); ctx.rect(Math.round(hd.px) - 3.5, Math.round(hd.py) - 3.5, 7, 7); ctx.fill(); ctx.stroke(); }
      if (this.tool === 'scale') {
        const ref = this.#scaleRef || [(box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2];
        const rx = Math.round(sx(ref[0])) + 0.5; const ry = Math.round(sy(ref[1])) + 0.5;
        ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI * 2); ctx.moveTo(rx - 8, ry); ctx.lineTo(rx + 8, ry); ctx.moveTo(rx, ry - 8); ctx.lineTo(rx, ry + 8); ctx.stroke();
      }
      if (this.#scaleInfo) {
        const pct = (v) => `${Math.round(v * 1000) / 10}%`;
        const label = Math.abs(this.#scaleInfo.sx - this.#scaleInfo.sy) < 0.0005 ? pct(this.#scaleInfo.sx) : `${pct(this.#scaleInfo.sx)} × ${pct(this.#scaleInfo.sy)}`;
        ctx.font = font; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillStyle = colors.accent;
        ctx.fillText(label, Math.min(...xs), Math.min(...ys) - 8);
      }
    }

    if (this.#marquee) {
      const m = this.#marquee;
      ctx.fillStyle = cssVar('--accent-soft') || 'rgba(128,128,128,.15)';
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      const x = Math.min(m.x0, m.x1) + 0.5; const y = Math.min(m.y0, m.y1) + 0.5;
      ctx.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
      ctx.strokeRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
  }
}
