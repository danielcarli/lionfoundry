/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Edits that work on the segments of a contour: find the spot of an outline nearest to a position,
// add a point there without changing the shape, remove a point keeping the curve as close as it can
// be, and turn a handle to a given direction.
// A contour is seen here as a path: a start point and a list of segments { offs: [handles], to: point }.
import { isOn, isClosed, deletePoints, reverseContour } from './fontModel.js';

/** The contour as { closed, start, segs }, sharing the point arrays of the contour; null when it has no on-curve point. */
export function toPath(contour) {
  const n = contour.length;
  const first = contour.findIndex(isOn);
  if (first < 0) return null;
  const closed = isClosed(contour);
  const segs = [];
  let offs = [];
  const count = closed ? n : n - first - 1;
  for (let k = 1; k <= count; k++) {
    const p = contour[(first + k) % n];
    if (isOn(p)) { segs.push({ offs, to: p }); offs = []; } else offs.push(p);
  }
  return { closed, start: contour[first], segs };
}

/** The contour of a path (a closed one starts with its start point). */
export function fromPath(path) {
  const out = [path.start];
  path.segs.forEach((seg, i) => {
    out.push(...seg.offs);
    if (!(path.closed && i === path.segs.length - 1)) out.push(seg.to);
  });
  return out;
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** The control points of a segment that starts at `from`, or null for a kind of curve that is not handled. */
function controls(from, seg) {
  if (seg.offs.length === 0) return [from, seg.to];
  if (seg.offs.length === 1) return [from, seg.offs[0], seg.to];
  if (seg.offs.length === 2 && seg.to[2] === 'curve') return [from, seg.offs[0], seg.offs[1], seg.to];
  return null; // quadratic runs with implied points
}

function pointAt(c, t) {
  let pts = c;
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => lerp(pts[i], p, t));
  return pts[0];
}

/** Both halves of a Bézier of any degree cut at t: [left controls, right controls]. */
function split(c, t) {
  const left = [c[0]]; const right = [c[c.length - 1]];
  let pts = c;
  while (pts.length > 1) {
    pts = pts.slice(1).map((p, i) => lerp(pts[i], p, t));
    left.push(pts[0]); right.unshift(pts[pts.length - 1]);
  }
  return [left, right];
}

function length(c) {
  let len = 0; let prev = c[0];
  for (let i = 1; i <= 16; i++) { const p = pointAt(c, i / 16); len += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
  return len;
}

/**
 * The spot on the outline of a glyph (its own contours) nearest to a position.
 * @returns {{contour: number, segment: number, t: number, x: number, y: number, distance: number}|null}
 */
export function nearestOnOutline(glyph, x, y) {
  let best = null;
  glyph.contours.forEach((contour, ci) => {
    const path = toPath(contour);
    if (!path) return;
    let from = path.start;
    path.segs.forEach((seg, si) => {
      const c = controls(from, seg);
      from = seg.to;
      if (!c) return;
      const dist = (t) => { const p = pointAt(c, t); return Math.hypot(p[0] - x, p[1] - y); };
      // a coarse walk along the segment, then a finer look around the best step
      let t = 0; let d = Infinity;
      const steps = c.length === 2 ? 1 : 24;
      if (c.length === 2) {
        const vx = c[1][0] - c[0][0]; const vy = c[1][1] - c[0][1];
        const len2 = vx * vx + vy * vy;
        t = len2 ? Math.max(0, Math.min(1, ((x - c[0][0]) * vx + (y - c[0][1]) * vy) / len2)) : 0;
        d = dist(t);
      } else {
        for (let i = 0; i <= steps; i++) { const di = dist(i / steps); if (di < d) { d = di; t = i / steps; } }
        let lo = Math.max(0, t - 1 / steps); let hi = Math.min(1, t + 1 / steps);
        for (let i = 0; i < 24; i++) { const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3; if (dist(a) < dist(b)) hi = b; else lo = a; }
        t = (lo + hi) / 2; d = dist(t);
      }
      if (!best || d < best.distance) { const p = pointAt(c, t); best = { contour: ci, segment: si, t, x: p[0], y: p[1], distance: d }; }
    });
  });
  return best;
}

const off = (p) => [Math.round(p[0]), Math.round(p[1]), 'offcurve'];

/**
 * Adds an on-curve point on a segment, at t (0–1) along it. The shape stays the same, but for the
 * rounding of the new points to whole units.
 * @returns {{contour: Array, index: number}|null} the new contour and where the new point is in it
 */
export function insertPoint(contour, segment, t) {
  const path = toPath(contour);
  if (!path || !path.segs[segment]) return null;
  const seg = path.segs[segment];
  const from = segment === 0 ? path.start : path.segs[segment - 1].to;
  const c = controls(from, seg);
  if (!c) return null;
  const tt = Math.max(0.02, Math.min(0.98, t));
  const [left, right] = split(c, tt);
  const m = left[left.length - 1];
  const point = [Math.round(m[0]), Math.round(m[1]), c.length === 2 ? 'line' : seg.to[2]];
  if (c.length > 2) point.push(1); // on a curve the new point is smooth: its two handles are on one line
  const first = { offs: left.slice(1, -1).map(off), to: point };
  const second = { offs: right.slice(1, -1).map(off), to: seg.to };
  path.segs.splice(segment, 1, first, second);
  const out = fromPath(path);
  return { contour: out, index: out.indexOf(point) };
}

/**
 * Removes an on-curve point and joins its two segments into one that follows the old curve as closely
 * as one curve can (the outer handles are kept in direction and stretched).
 * @returns the new contour, or null when nothing is left of it
 */
export function removePoint(contour, index) {
  const target = contour[index];
  if (!target || !isOn(target)) return deletePoints(contour, [index]);
  let path = toPath(contour);
  if (!path) return contour;
  const ons = path.segs.length + (path.closed ? 0 : 1);
  if (ons <= 2) return null;
  if (path.closed && path.start === target) {
    // make another point the start, so that the one to remove sits between two segments
    const firstSeg = path.segs.shift();
    path.segs.push(firstSeg);
    path = { closed: true, start: firstSeg.to, segs: path.segs };
  }
  if (!path.closed && path.start === target) {
    const next = path.segs.shift();
    next.to[2] = 'move'; next.to.length = 3;
    return fromPath({ closed: false, start: next.to, segs: path.segs });
  }
  const k = path.segs.findIndex((s) => s.to === target);
  if (k === path.segs.length - 1) { path.segs.pop(); return fromPath(path); } // the end of an open contour
  const a = path.segs[k]; const b = path.segs[k + 1];
  const p0 = k === 0 ? path.start : path.segs[k - 1].to;
  const ca = controls(p0, a); const cb = controls(target, b);
  if (!ca || !cb) return deletePoints(contour, [index]);
  let merged;
  if (ca.length === 2 && cb.length === 2) merged = { offs: [], to: b.to };
  else {
    // both sides as cubic curves; undoing a cut at t stretches the outer handles by 1/t and 1/(1-t)
    const cubic = (c) => (c.length === 4 ? c : c.length === 3
      ? [c[0], lerp(c[0], c[1], 2 / 3), lerp(c[2], c[1], 2 / 3), c[2]]
      : [c[0], lerp(c[0], c[1], 1 / 3), lerp(c[0], c[1], 2 / 3), c[1]]);
    const qa = cubic(ca); const qb = cubic(cb);
    const la = length(qa); const lb = length(qb);
    const t = Math.max(0.05, Math.min(0.95, la / ((la + lb) || 1)));
    const h1 = [qa[0][0] + (qa[1][0] - qa[0][0]) / t, qa[0][1] + (qa[1][1] - qa[0][1]) / t];
    const h2 = [qb[3][0] + (qb[2][0] - qb[3][0]) / (1 - t), qb[3][1] + (qb[2][1] - qb[3][1]) / (1 - t)];
    b.to[2] = 'curve';
    merged = { offs: [off(h1), off(h2)], to: b.to };
  }
  path.segs.splice(k, 2, merged);
  return fromPath(path);
}

/** The on-curve point a handle belongs to: [index, point], or null. */
export function handleAnchor(contour, index) {
  const n = contour.length;
  const closed = isClosed(contour);
  for (const dir of [-1, 1]) {
    const j = closed ? (index + dir + n) % n : index + dir;
    if (contour[j] && isOn(contour[j])) return [j, contour[j]];
  }
  return null;
}

/** Direction of a handle seen from its point, in degrees (0 = to the right, 90 = up), or null. */
export function handleAngle(contour, index) {
  const anchor = handleAnchor(contour, index);
  if (!anchor) return null;
  const dx = contour[index][0] - anchor[1][0]; const dy = contour[index][1] - anchor[1][1];
  if (!dx && !dy) return null;
  return ((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360;
}

const TARGETS = { h: [0, 180], v: [90, 270], d: [45, 135, 225, 315] };

/**
 * Turns a handle around its point, keeping its length: 'h' horizontal, 'v' vertical, 'd' the nearest
 * 45° diagonal, or a number of degrees (the handle stays on its side — 30 also means 210 — unless `exact`).
 * @returns {boolean} whether the handle moved
 */
export function alignHandle(contour, index, mode, exact = false) {
  const anchor = handleAnchor(contour, index);
  const current = handleAngle(contour, index);
  if (!anchor || current === null || contour[index][2] !== 'offcurve') return false;
  // a typed angle names a direction of the line the handle lies on; `exact` takes it as the side too
  const turn = (a) => ((a % 360) + 360) % 360;
  const targets = typeof mode === 'number' ? (exact ? [turn(mode)] : [turn(mode), turn(mode + 180)]) : TARGETS[mode];
  if (!targets) return false;
  const apart = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const angle = targets.reduce((best, a) => (apart(a, current) < apart(best, current) ? a : best));
  const p = anchor[1]; const h = contour[index];
  const len = Math.hypot(h[0] - p[0], h[1] - p[1]);
  const rad = angle * Math.PI / 180;
  // exact right angles should not pick up rounding noise
  const cos = angle % 180 === 90 ? 0 : Math.cos(rad); const sin = angle % 180 === 0 ? 0 : Math.sin(rad);
  const x = Math.round(p[0] + cos * len); const y = Math.round(p[1] + sin * len);
  if (x === h[0] && y === h[1]) return false;
  h[0] = x; h[1] = y;
  return true;
}

/** A position pulled onto the nearest ray from `origin` at a multiple of `step` degrees (for Shift while dragging a handle). */
export function constrainToAngles(origin, x, y, step = 45) {
  const dx = x - origin[0]; const dy = y - origin[1];
  if (!dx && !dy) return [x, y];
  const angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / step) * step;
  const rad = angle * Math.PI / 180;
  const cos = Math.abs(angle) % 180 === 90 ? 0 : Math.cos(rad); const sin = angle % 180 === 0 ? 0 : Math.sin(rad);
  const len = dx * cos + dy * sin;
  return [origin[0] + cos * len, origin[1] + sin * len];
}

// ---------------------------------------------------------------- structure (what interpolation needs to agree)
const closed = (contour) => contour.length > 0 && contour[0][2] !== 'move';
const signedArea = (contour) => {
  let area = 0;
  for (let i = 0; i < contour.length; i++) { const a = contour[i]; const b = contour[(i + 1) % contour.length]; area += a[0] * b[1] - b[0] * a[1]; }
  return area / 2;
};
const reversed = (contour) => (closed(contour) ? reverseContour(contour) : contour);

/** Makes the point at `index` (on the curve) the first of a closed contour. The shape does not change. */
export function setStartPoint(contour, index) {
  if (!closed(contour) || !contour[index] || contour[index][2] === 'offcurve' || index === 0) return contour;
  return [...contour.slice(index), ...contour.slice(0, index)];
}

function inside(point, contour) {
  let hit = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i]; const b = contour[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/**
 * Winds the outer shapes counter-clockwise and the counters (shapes inside another) clockwise, which is
 * what font formats expect of cubic drawings. Returns how many contours were turned.
 */
export function correctDirections(glyph) {
  let turned = 0;
  glyph.contours = glyph.contours.map((c, i) => {
    if (!closed(c) || c.length < 3) return c;
    const depth = glyph.contours.filter((other, j) => j !== i && closed(other) && other.length >= 3 && inside(c[0], other)).length;
    const area = signedArea(c);
    const wrong = depth % 2 === 0 ? area < 0 : area > 0;
    if (wrong) { turned++; return reversed(c); }
    return c;
  });
  return turned;
}

/**
 * Reorders the contours of `glyph`, turns them and moves their start points so that its structure
 * follows `reference` (the same glyph in another weight) — what has to agree for a weight in between
 * to be calculated. Nothing is redrawn: when the two do not have the same contours with the same
 * points, it returns null.
 * @returns {{ contours: Array, changed: boolean } | null}
 */
export function matchStructure(glyph, reference) {
  if (glyph.contours.length !== reference.contours.length) return null;
  const norm = (g) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
    for (const c of g.contours) for (const p of c) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const w = Math.max(1, x1 - x0); const hgt = Math.max(1, y1 - y0);
    return (p) => [(p[0] - x0) / w, (p[1] - y0) / hgt];
  };
  const na = norm(glyph); const nb = norm(reference);
  const used = new Set();
  const out = [];
  let changed = false;
  for (let r = 0; r < reference.contours.length; r++) {
    const ref = reference.contours[r];
    const target = ref.map(nb);
    let best = null;
    glyph.contours.forEach((c, ci) => {
      if (used.has(ci) || c.length !== ref.length) return;
      const variants = closed(c) && closed(ref) ? [c, reversed(c)] : [c];
      variants.forEach((v, vi) => {
        const starts = closed(v) && closed(ref) ? v.map((_, i) => i) : [0];
        for (const start of starts) {
          let cost = 0; let ok = true;
          for (let k = 0; k < ref.length && ok; k++) {
            const p = v[(start + k) % v.length];
            if (p[2] !== ref[k][2]) { ok = false; break; }
            const q = na(p);
            cost += (q[0] - target[k][0]) ** 2 + (q[1] - target[k][1]) ** 2;
          }
          if (ok && (!best || cost < best.cost - 1e-9)) best = { cost, ci, contour: start ? [...v.slice(start), ...v.slice(0, start)] : v, moved: ci !== r || vi > 0 || start > 0 };
        }
      });
    });
    if (!best) return null;
    used.add(best.ci);
    out.push(best.contour);
    if (best.moved) changed = true;
  }
  return { contours: out, changed };
}
