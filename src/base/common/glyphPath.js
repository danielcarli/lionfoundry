/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Pure outline geometry: turns the points of a glyph (UFO point model) into path commands,
// resolves components, measures bounds. No DOM here, so it also runs in tests and tools.
//
// A contour is a list of points [x, y, type, smooth?] where type is
//   'move' (start of an open contour) · 'line' · 'curve' (cubic) · 'qcurve' (quadratic) · 'offcurve' (handle).
// A command is ['M', x, y] · ['L', x, y] · ['C', x1, y1, x2, y2, x, y] · ['Q', x1, y1, x, y] · ['Z'].

const MAX_COMPONENT_DEPTH = 8;
export const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Applies an affine transform [a, b, c, d, e, f] to a point. */
export function applyTransform(t, x, y) {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

/** t2 after t1 (first t1, then t2). */
export function multiply(t1, t2) {
  return [
    t1[0] * t2[0] + t1[1] * t2[2], t1[0] * t2[1] + t1[1] * t2[3],
    t1[2] * t2[0] + t1[3] * t2[2], t1[2] * t2[1] + t1[3] * t2[3],
    t1[4] * t2[0] + t1[5] * t2[2] + t2[4], t1[4] * t2[1] + t1[5] * t2[3] + t2[5],
  ];
}

function segment(out, type, handles, x, y) {
  if (type === 'line' || !handles.length) {
    // handles before a line are invalid in a UFO; they are ignored instead of breaking the outline
    out.push(['L', x, y]);
  } else if (type === 'qcurve') {
    // TrueType-style: on-curve points are implied halfway between consecutive handles
    for (let i = 0; i < handles.length - 1; i++) {
      const [ax, ay] = handles[i];
      const [bx, by] = handles[i + 1];
      out.push(['Q', ax, ay, (ax + bx) / 2, (ay + by) / 2]);
    }
    const [hx, hy] = handles[handles.length - 1];
    out.push(['Q', hx, hy, x, y]);
  } else if (handles.length === 1) {
    out.push(['Q', handles[0][0], handles[0][1], x, y]);
  } else {
    // 'curve': a cubic uses two handles; with more, the first and the last are used
    const a = handles[0];
    const b = handles[handles.length - 1];
    out.push(['C', a[0], a[1], b[0], b[1], x, y]);
  }
}

/** Path commands of one contour. */
export function contourCommands(points) {
  const out = [];
  const n = points.length;
  if (!n) return out;
  if (points[0][2] === 'move') { // open contour
    out.push(['M', points[0][0], points[0][1]]);
    let handles = [];
    for (let i = 1; i < n; i++) {
      const [x, y, type] = points[i];
      if (type === 'offcurve') handles.push([x, y]);
      else { segment(out, type, handles, x, y); handles = []; }
    }
    return out;
  }
  let start = points.findIndex((p) => p[2] !== 'offcurve');
  if (start < 0) {
    // only handles: a closed quadratic curve whose on-curve points are all implied
    const [ax, ay] = points[n - 1];
    const [bx, by] = points[0];
    out.push(['M', (ax + bx) / 2, (ay + by) / 2]);
    for (let i = 0; i < n; i++) {
      const [hx, hy] = points[i];
      const [nx, ny] = points[(i + 1) % n];
      out.push(['Q', hx, hy, (hx + nx) / 2, (hy + ny) / 2]);
    }
    out.push(['Z']);
    return out;
  }
  out.push(['M', points[start][0], points[start][1]]);
  let handles = [];
  for (let k = 1; k <= n; k++) {
    const [x, y, type] = points[(start + k) % n];
    if (type === 'offcurve') handles.push([x, y]);
    else { segment(out, type, handles, x, y); handles = []; }
  }
  out.push(['Z']);
  return out;
}

function transformCommands(cmds, t) {
  if (t === IDENTITY) return cmds;
  return cmds.map((c) => {
    if (c[0] === 'Z') return c;
    const out = [c[0]];
    for (let i = 1; i < c.length; i += 2) out.push(...applyTransform(t, c[i], c[i + 1]));
    return out;
  });
}

/**
 * Path commands of a whole glyph, components included.
 * @param {{glyphs: Object}} font
 * @param {string} name
 */
export function glyphCommands(font, name, transform = IDENTITY, depth = 0, trail = []) {
  const glyph = font.glyphs[name];
  if (!glyph) return [];
  let out = [];
  for (const contour of glyph.contours) out = out.concat(transformCommands(contourCommands(contour), transform));
  if (depth < MAX_COMPONENT_DEPTH) {
    for (const comp of glyph.components) {
      if (trail.includes(comp.base)) continue; // a component that refers back to itself
      out = out.concat(glyphCommands(font, comp.base, multiply(comp.transform, transform), depth + 1, trail.concat(name)));
    }
  }
  return out;
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''));

/** SVG path data ("d" attribute) of a list of commands. */
export function commandsToSvg(cmds) {
  let d = '';
  for (const c of cmds) {
    d += c[0];
    for (let i = 1; i < c.length; i++) d += (i > 1 ? ' ' : '') + fmt(c[i]);
  }
  return d;
}

/** Draws commands into a canvas context or a Path2D. */
export function drawCommands(ctx, cmds) {
  for (const c of cmds) {
    if (c[0] === 'M') ctx.moveTo(c[1], c[2]);
    else if (c[0] === 'L') ctx.lineTo(c[1], c[2]);
    else if (c[0] === 'C') ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === 'Q') ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else ctx.closePath();
  }
}

// extrema of a cubic in one dimension, as parameters t in ]0, 1[
function cubicExtrema(p0, p1, p2, p3) {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const out = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) > 1e-9) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      out.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

const cubicAt = (p0, p1, p2, p3, t) => {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
};

/**
 * Exact bounding box of a list of commands (curves measured at their extrema, not at their handles).
 * @returns {{xMin:number, yMin:number, xMax:number, yMax:number}|null} null when there is no outline
 */
export function commandsBounds(cmds) {
  let xMin = Infinity; let yMin = Infinity; let xMax = -Infinity; let yMax = -Infinity;
  const add = (x, y) => {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  };
  let cx = 0; let cy = 0;
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') { add(c[1], c[2]); cx = c[1]; cy = c[2]; continue; }
    if (c[0] === 'Z') continue;
    let x1; let y1; let x2; let y2; let x; let y;
    if (c[0] === 'C') [, x1, y1, x2, y2, x, y] = c;
    else { // quadratic, raised to a cubic
      const [, qx, qy, ex, ey] = c;
      x1 = cx + (2 / 3) * (qx - cx); y1 = cy + (2 / 3) * (qy - cy);
      x2 = ex + (2 / 3) * (qx - ex); y2 = ey + (2 / 3) * (qy - ey);
      x = ex; y = ey;
    }
    add(x, y);
    for (const t of cubicExtrema(cx, x1, x2, x)) add(cubicAt(cx, x1, x2, x, t), cubicAt(cy, y1, y2, y, t));
    for (const t of cubicExtrema(cy, y1, y2, y)) add(cubicAt(cx, x1, x2, x, t), cubicAt(cy, y1, y2, y, t));
    cx = x; cy = y;
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

/** Counts of a glyph: contours, on-curve points and handles (its own outline, components not included). */
export function glyphStats(glyph) {
  let onCurve = 0;
  let offCurve = 0;
  for (const contour of glyph.contours) {
    for (const p of contour) { if (p[2] === 'offcurve') offCurve++; else onCurve++; }
  }
  return { contours: glyph.contours.length, onCurve, offCurve, components: glyph.components.length };
}

/**
 * Kerning lookup following the UFO 3 rules: glyph–glyph wins over glyph–group and group–glyph,
 * which win over group–group. First-side groups start with "public.kern1.", second-side with "public.kern2.".
 * @returns {(left: string, right: string) => number}
 */
export function createKerner(font) {
  const first = new Map();
  const second = new Map();
  for (const [group, members] of Object.entries(font.groups || {})) {
    const target = group.startsWith('public.kern1.') ? first : group.startsWith('public.kern2.') ? second : null;
    if (!target || !Array.isArray(members)) continue;
    for (const m of members) if (!target.has(m)) target.set(m, group);
  }
  const k = font.kerning || {};
  const get = (l, r) => (l !== undefined && r !== undefined && k[l] && typeof k[l][r] === 'number' ? k[l][r] : undefined);
  return (left, right) => {
    const gl = first.get(left);
    const gr = second.get(right);
    return get(left, right) ?? get(left, gr) ?? get(gl, right) ?? get(gl, gr) ?? 0;
  };
}
