/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Operations on the filled shape of contours, done on the curves themselves (nothing is turned into
// polygons, so the curves stay curves): remove overlap, union, subtract, intersect and the knife.
//
// The method is the one most editors use. Every segment is cut where it crosses another one; each
// piece is then kept or dropped by looking at the shape on its two sides (a piece is part of the new
// outline when the result is filled on one side and empty on the other) and turned so that the filled
// side is on its left; the pieces are finally joined again, at each crossing taking the next piece
// that keeps the filled side on the left. Contours the operation does not cut and keeps whole are
// returned as they were (same points, same start point).
//
// Also here: adding points at the extremes of curves, and tidying up a contour.
import { isOn, isClosed, reverseContour, contourArea } from './fontModel.js';
import { toPath, fromPath } from './outlineEdit.js';

const T_EPS = 1e-7;      // parameters this close to 0 or 1 are the ends of a segment
const NEAR = 1e-3;       // points this close (font units) are the same point
const FLAT = 0.002;      // a curve is treated as a line when its handles are this close to its chord
const SIDE = 2e-4;       // how far beside a piece the two sides are looked at (thin slivers are a few hundredths wide)

// ---------------------------------------------------------------- Bézier helpers (lines and cubics)

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function pointAt(c, t) {
  if (c.length === 2) return lerp(c[0], c[1], t);
  const mt = 1 - t;
  const a = mt * mt * mt; const b = 3 * mt * mt * t; const d = 3 * mt * t * t; const e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

function splitAt(c, t) {
  if (c.length === 2) { const m = lerp(c[0], c[1], t); return [[c[0], m], [m, c[1]]]; }
  const ab = lerp(c[0], c[1], t); const bc = lerp(c[1], c[2], t); const cd = lerp(c[2], c[3], t);
  const abc = lerp(ab, bc, t); const bcd = lerp(bc, cd, t); const m = lerp(abc, bcd, t);
  return [[c[0], ab, abc, m], [m, bcd, cd, c[3]]];
}

/** The part of a segment between two parameters. */
function subSegment(c, t0, t1) {
  if (t0 <= T_EPS && t1 >= 1 - T_EPS) return c.map((p) => [p[0], p[1]]);
  let part = c;
  if (t1 < 1 - T_EPS) part = splitAt(part, t1)[0];
  if (t0 > T_EPS) part = splitAt(part, t0 / t1)[1];
  return part;
}

const reversed = (c) => [...c].reverse();
const same = (a, b) => Math.abs(a[0] - b[0]) < NEAR && Math.abs(a[1] - b[1]) < NEAR;

function bbox(c) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of c) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1 };
}

function isFlat(c) {
  if (c.length === 2) return true;
  const [a, , , d] = c;
  const dx = d[0] - a[0]; const dy = d[1] - a[1]; const len = Math.hypot(dx, dy);
  const dist = (p) => (len < 1e-12 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len);
  return dist(c[1]) <= FLAT && dist(c[2]) <= FLAT;
}

/** The direction leaving a segment's start (toward a point a little along it, which also tells curves that leave on the same tangent apart). */
function leaving(c) {
  const p = pointAt(c, 0.04);
  return [p[0] - c[0][0], p[1] - c[0][1]];
}

/** Values of t in (0, 1) where one coordinate of a cubic has a zero derivative. */
function extremes(c, axis) {
  if (c.length !== 4) return [];
  const p0 = c[0][axis]; const p1 = c[1][axis]; const p2 = c[2][axis]; const p3 = c[3][axis];
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3); const b = 6 * (p0 - 2 * p1 + p2); const d = 3 * (p1 - p0);
  return quadRoots(a, b, d).filter((t) => t > 1e-9 && t < 1 - 1e-9);
}

function quadRoots(a, b, c) {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
}

/** Parameters in [0, 1) where coordinate `axis` of a segment equals v (bisection on the monotone parts). */
function solveAxis(c, axis, v) {
  const f = (t) => pointAt(c, t)[axis] - v;
  const cuts = [0, ...extremes(c, axis).sort((x, y) => x - y), 1];
  const out = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    let lo = cuts[k]; let hi = cuts[k + 1];
    let flo = f(lo); const fhi = f(hi);
    if (flo === 0) { out.push(lo); continue; }
    if (flo * fhi > 0) continue;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2; const fm = f(mid);
      if (fm === 0) { lo = hi = mid; break; }
      if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
    }
    const t = (lo + hi) / 2;
    if (t < 1) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- reading contours as segments

/**
 * The segments of a closed contour as plain Bézier controls (lines and cubics; quadratic runs become
 * cubics), each with the point it ends at. Null for an open contour or one that cannot be read.
 */
function contourSegments(contour) {
  if (!isClosed(contour)) return null;
  const path = toPath(contour);
  if (!path || !path.segs.length) return null;
  const segs = [];
  let from = path.start;
  for (const seg of path.segs) {
    const p0 = [from[0], from[1]];
    if (!seg.offs.length) segs.push({ c: [p0, [seg.to[0], seg.to[1]]], from, to: seg.to });
    else if (seg.to[2] === 'curve' && seg.offs.length === 2) segs.push({ c: [p0, [seg.offs[0][0], seg.offs[0][1]], [seg.offs[1][0], seg.offs[1][1]], [seg.to[0], seg.to[1]]], from, to: seg.to });
    else if (seg.to[2] === 'qcurve') {
      // a TrueType run: implied on-curve points halfway between handles; each quadratic is an exact cubic
      const offs = seg.offs.map((p) => [p[0], p[1]]);
      let start = p0;
      offs.forEach((q, i) => {
        const end = i === offs.length - 1 ? [seg.to[0], seg.to[1]] : lerp(q, offs[i + 1], 0.5);
        segs.push({ c: [start, lerp(start, q, 2 / 3), lerp(end, q, 2 / 3), end], from: i === 0 ? from : null, to: i === offs.length - 1 ? seg.to : null });
        start = end;
      });
    } else return null;
    from = seg.to;
  }
  return segs.filter((s) => !(s.c.length === 2 && same(s.c[0], s.c[1])));
}

// ---------------------------------------------------------------- where segments cross

function lineHit(a, b, slack = 0) {
  const rx = a[1][0] - a[0][0]; const ry = a[1][1] - a[0][1];
  const sx = b[1][0] - b[0][0]; const sy = b[1][1] - b[0][1];
  const den = rx * sy - ry * sx;
  const qx = b[0][0] - a[0][0]; const qy = b[0][1] - a[0][1];
  if (Math.abs(den) < 1e-12 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const u = (qx * sy - qy * sx) / den; const v = (qx * ry - qy * rx) / den;
  const lo = -1e-9 - slack; const hi = 1 + 1e-9 + slack;
  if (u < lo || u > hi || v < lo || v > hi) return null;
  return [u, v];
}

function derivAt(c, t) {
  if (c.length === 2) return [c[1][0] - c[0][0], c[1][1] - c[0][1]];
  const mt = 1 - t;
  return [0, 1].map((k) => 3 * mt * mt * (c[1][k] - c[0][k]) + 6 * mt * t * (c[2][k] - c[1][k]) + 3 * t * t * (c[3][k] - c[2][k]));
}

/** Newton steps on A(ta) = B(tb), from a first guess; null when it does not settle on a meeting point. */
function refine(a, b, ta, tb) {
  for (let i = 0; i < 8; i++) {
    const pa = pointAt(a, ta); const pb = pointAt(b, tb);
    const fx = pa[0] - pb[0]; const fy = pa[1] - pb[1];
    if (Math.hypot(fx, fy) < 1e-9) break;
    const da = derivAt(a, ta); const db = derivAt(b, tb);
    const det = da[0] * -db[1] - da[1] * -db[0];
    if (Math.abs(det) < 1e-12) break;
    ta -= (fx * -db[1] - fy * -db[0]) / det;
    tb -= (da[0] * fy - da[1] * fx) / det;
  }
  if (!(ta >= -1e-6 && ta <= 1 + 1e-6 && tb >= -1e-6 && tb <= 1 + 1e-6)) return null;
  ta = Math.max(0, Math.min(1, ta)); tb = Math.max(0, Math.min(1, tb));
  const pa = pointAt(a, ta); const pb = pointAt(b, tb);
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.01 ? [ta, tb] : null;
}

/** Lines that lie on each other: the ends of each that fall inside the other. */
function collinearHits(a, b) {
  const rx = a[1][0] - a[0][0]; const ry = a[1][1] - a[0][1]; const len2 = rx * rx + ry * ry;
  const sx = b[1][0] - b[0][0]; const sy = b[1][1] - b[0][1]; const len2b = sx * sx + sy * sy;
  if (!len2 || !len2b) return [];
  const off = Math.abs((b[0][0] - a[0][0]) * ry - (b[0][1] - a[0][1]) * rx) / Math.sqrt(len2);
  const cross = Math.abs(rx * sy - ry * sx) / Math.sqrt(len2 * len2b);
  if (off > NEAR || cross > 1e-9) return [];
  const onA = (p) => ((p[0] - a[0][0]) * rx + (p[1] - a[0][1]) * ry) / len2;
  const onB = (p) => ((p[0] - b[0][0]) * sx + (p[1] - b[0][1]) * sy) / len2b;
  const out = [];
  for (const p of b) { const t = onA(p); if (t > -1e-9 && t < 1 + 1e-9) out.push([Math.max(0, Math.min(1, t)), onB(p) < 0.5 ? 0 : 1]); }
  for (const p of a) { const t = onB(p); if (t > -1e-9 && t < 1 + 1e-9) out.push([onA(p) < 0.5 ? 0 : 1, Math.max(0, Math.min(1, t))]); }
  return out;
}

/** Parameter pairs [ta, tb] where two segments meet. */
function crossings(ca, cb) {
  if (ca.length === 2 && cb.length === 2) {
    const hit = lineHit(ca, cb);
    return hit ? [hit.map((v) => Math.max(0, Math.min(1, v)))] : collinearHits(ca, cb);
  }
  const hits = [];
  let budget = 4000;
  const walk = (a, a0, a1, b, b0, b1, depth) => {
    if (--budget < 0) return;
    const ba = bbox(a); const bb = bbox(b);
    if (ba.x1 < bb.x0 - NEAR || bb.x1 < ba.x0 - NEAR || ba.y1 < bb.y0 - NEAR || bb.y1 < ba.y0 - NEAR) return;
    const fa = isFlat(a); const fb = isFlat(b);
    if ((fa && fb) || depth > 48) {
      const la = [a[0], a[a.length - 1]]; const lb = [b[0], b[b.length - 1]];
      // a little slack at the ends: a shallow crossing can fall just outside both chords
      const hit = lineHit(la, lb, 0.25);
      if (hit) {
        const guess = [a0 + (a1 - a0) * hit[0], b0 + (b1 - b0) * hit[1]];
        const fine = refine(ca, cb, Math.max(0, Math.min(1, guess[0])), Math.max(0, Math.min(1, guess[1])));
        if (fine) hits.push(fine);
      }
      return;
    }
    if (!fa) {
      const [l, r] = splitAt(a, 0.5); const am = (a0 + a1) / 2;
      if (!fb) {
        const [bl, br] = splitAt(b, 0.5); const bm = (b0 + b1) / 2;
        walk(l, a0, am, bl, b0, bm, depth + 1); walk(l, a0, am, br, bm, b1, depth + 1);
        walk(r, am, a1, bl, b0, bm, depth + 1); walk(r, am, a1, br, bm, b1, depth + 1);
      } else { walk(l, a0, am, b, b0, b1, depth + 1); walk(r, am, a1, b, b0, b1, depth + 1); }
    } else {
      const [bl, br] = splitAt(b, 0.5); const bm = (b0 + b1) / 2;
      walk(a, a0, a1, bl, b0, bm, depth + 1); walk(a, a0, a1, br, bm, b1, depth + 1);
    }
  };
  walk(ca, 0, 1, cb, 0, 1, 0);
  // the same crossing found from neighbouring pieces
  const out = [];
  for (const h of hits.sort((x, y) => x[0] - y[0])) {
    const p = pointAt(ca, h[0]);
    if (!out.some((o) => { const q = pointAt(ca, o[0]); return Math.hypot(p[0] - q[0], p[1] - q[1]) < NEAR * 5; })) out.push(h);
  }
  if (budget < 0 || out.length > 12) return []; // curves lying on each other: they meet everywhere, and are told apart later
  return out;
}

// ---------------------------------------------------------------- the filled shape

/** Winding number of a set of segments around a point (a ray to +x). */
function winding(segs, x, y0) {
  // the ray is moved by a tiny odd amount, so that it never runs exactly through a point of the
  // outline (points are on whole units), where two segments would both count it
  const y = y0 + 1.2345e-5;
  let w = 0;
  for (const s of segs) {
    const b = s.box;
    if (y < b.y0 || y > b.y1 || b.x1 < x) continue;
    const c = s.c;
    if (c.length === 2) {
      const [p, q] = c;
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) {
        const xi = p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]);
        if (xi > x) w += q[1] > p[1] ? 1 : -1;
      }
      continue;
    }
    for (const t of solveAxis(c, 1, y)) {
      const p = pointAt(c, t);
      if (p[0] <= x) continue;
      const a = pointAt(c, Math.max(0, t - 1e-4)); const d = pointAt(c, Math.min(1, t + 1e-4));
      const dy = d[1] - a[1];
      if (dy > 0) w += 1; else if (dy < 0) w -= 1;
    }
  }
  return w;
}

// ---------------------------------------------------------------- the general operation

/**
 * @param {Array} contours all the contours of the glyph
 * @param {object} op
 *   groups: contour index → 'a' | 'b' (contours not listed are left alone)
 *   inside: (wa, wb) => boolean — whether a point with these winding numbers is filled in the result
 *   cut: [[x0, y0], [x1, y1]] | null — the line of the knife
 * @returns {{contours: Array, changed: boolean}}
 */
function operate(contours, { groups, inside, cut = null }) {
  const segs = [];
  const parsed = new Map();
  for (const [ci, group] of groups) {
    const list = contourSegments(contours[ci]);
    if (!list || !list.length) continue;
    parsed.set(ci, list);
    list.forEach((s, si) => segs.push({ ...s, ci, si, group, box: bbox(s.c), splits: [] }));
  }
  if (!segs.length) return { contours, changed: false };
  const cutSeg = cut ? { c: [[...cut[0]], [...cut[1]]], ci: -1, si: 0, group: 'cut', box: bbox(cut), splits: [] } : null;
  const all = cutSeg ? [...segs, cutSeg] : segs;

  // 1. where the segments cross
  const addSplit = (s, t, p) => { if (t > T_EPS && t < 1 - T_EPS && !same(p, s.c[0]) && !same(p, s.c[s.c.length - 1])) s.splits.push({ t, p }); };
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]; const b = all[j];
      if (a.box.x1 < b.box.x0 - NEAR || b.box.x1 < a.box.x0 - NEAR || a.box.y1 < b.box.y0 - NEAR || b.box.y1 < a.box.y0 - NEAR) continue;
      for (const [ta, tb] of crossings(a.c, b.c)) {
        // the point both pieces will share: an end of one segment when the crossing is there
        let p;
        if (ta <= T_EPS) p = a.c[0]; else if (ta >= 1 - T_EPS) p = a.c[a.c.length - 1];
        else if (tb <= T_EPS) p = b.c[0]; else if (tb >= 1 - T_EPS) p = b.c[b.c.length - 1];
        else { const pa = pointAt(a.c, ta); const pb = pointAt(b.c, tb); p = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]; }
        if (same(p, a.c[0])) p = a.c[0]; else if (same(p, a.c[a.c.length - 1])) p = a.c[a.c.length - 1];
        addSplit(a, ta, p); addSplit(b, tb, p);
      }
    }
  }

  // 2. the pieces
  const pieces = [];
  for (const s of all) {
    const ts = s.splits.sort((x, y) => x.t - y.t).filter((sp, k, arr) => k === 0 || (sp.t - arr[k - 1].t > 1e-7 && !same(sp.p, arr[k - 1].p)));
    const stops = [{ t: 0, p: s.c[0] }, ...ts, { t: 1, p: s.c[s.c.length - 1] }];
    for (let k = 0; k < stops.length - 1; k++) {
      const c = subSegment(s.c, stops[k].t, stops[k + 1].t);
      c[0] = stops[k].p; c[c.length - 1] = stops[k + 1].p;
      if (c.length === 2 && same(c[0], c[1])) continue;
      if (c.length === 4 && same(c[0], c[3]) && same(c[1], c[0]) && same(c[2], c[0])) continue;
      pieces.push({ c, seg: s, t0: stops[k].t, t1: stops[k + 1].t, whole: stops.length === 2 });
    }
  }

  // 3. which pieces are outline, and which way they go
  const groupA = segs.filter((s) => s.group === 'a'); const groupB = segs.filter((s) => s.group === 'b');
  const filled = (p) => inside(winding(groupA, p[0], p[1]), winding(groupB, p[0], p[1]));
  const edges = [];
  const seen = new Set();
  const keyOf = (c) => c.map((p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`).join(' ');
  for (const piece of pieces) {
    const m = pointAt(piece.c, 0.5);
    const a = pointAt(piece.c, 0.49); const b = pointAt(piece.c, 0.51);
    let dx = b[0] - a[0]; let dy = b[1] - a[1];
    let len = Math.hypot(dx, dy);
    if (len < 1e-12) { dx = piece.c[piece.c.length - 1][0] - piece.c[0][0]; dy = piece.c[piece.c.length - 1][1] - piece.c[0][1]; len = Math.hypot(dx, dy) || 1; }
    const nx = -dy / len * SIDE; const ny = dx / len * SIDE;
    const left = filled([m[0] + nx, m[1] + ny]); const right = filled([m[0] - nx, m[1] - ny]);
    if (piece.seg.group === 'cut') {
      // the knife: where it runs through the shape, it becomes the edge of the two parts
      if (left && right) { edges.push({ ...piece, dir: 1, cut: true }); edges.push({ ...piece, c: reversed(piece.c), dir: -1, cut: true }); }
      continue;
    }
    if (left === right) continue;
    const c = left ? piece.c : reversed(piece.c);
    const key = keyOf(c);
    if (seen.has(key)) continue; // the same edge twice (contours lying on each other)
    seen.add(key);
    edges.push({ ...piece, c, dir: left ? 1 : -1 });
  }

  // 4. contours kept whole come back as they were
  const byContour = new Map();
  for (const ci of parsed.keys()) byContour.set(ci, { pieces: 0, kept: [], cut: false });
  for (const piece of pieces) if (piece.seg.ci >= 0) { const e = byContour.get(piece.seg.ci); e.pieces++; if (!piece.whole) e.cut = true; }
  for (const e of edges) if (!e.cut && e.seg.ci >= 0) byContour.get(e.seg.ci).kept.push(e);
  const result = new Map(); // contour index → contour, or null when it is dropped
  const rebuild = [];
  for (const [ci, info] of byContour) {
    const dirs = new Set(info.kept.map((e) => e.dir));
    if (!info.cut && info.kept.length === info.pieces && dirs.size === 1) result.set(ci, dirs.has(1) ? contours[ci] : reverseContour(contours[ci]));
    else if (!info.kept.length && !info.cut) result.set(ci, null);
    else { result.set(ci, null); rebuild.push(...info.kept); }
  }
  rebuild.push(...edges.filter((e) => e.cut));

  // 5. joining the pieces again
  const vkey = (p) => `${Math.round(p[0] / NEAR)},${Math.round(p[1] / NEAR)}`;
  const out = new Map();
  for (const e of rebuild) { const k = vkey(e.c[0]); if (!out.has(k)) out.set(k, []); out.get(k).push(e); }
  const used = new Set();
  const faces = [];
  for (const first of rebuild) {
    if (used.has(first)) continue;
    const face = [];
    let e = first;
    for (let guard = 0; guard < rebuild.length + 1; guard++) {
      face.push(e); used.add(e);
      const end = e.c[e.c.length - 1];
      const back = (() => { const p = pointAt(e.c, 0.96); return [p[0] - end[0], p[1] - end[1]]; })();
      // the next piece: the first one clockwise from the way back, which keeps the filled side on the left
      let best = null; let bestAngle = Infinity;
      for (const o of out.get(vkey(end)) || []) {
        if (o !== first && used.has(o)) continue;
        const d = leaving(o.c);
        let ang = Math.atan2(back[0] * d[1] - back[1] * d[0], back[0] * d[0] + back[1] * d[1]); // counter-clockwise from the way back
        ang = (2 * Math.PI - ang) % (2 * Math.PI);
        if (ang < 1e-9) ang = 2 * Math.PI;
        if (ang < bestAngle) { bestAngle = ang; best = o; }
      }
      if (!best || best === first) break;
      e = best;
    }
    if (face.length && same(face[face.length - 1].c[face[face.length - 1].c.length - 1], face[0].c[0])) faces.push(face);
  }

  // a piece that does not close a face means the shape was not understood: change nothing
  const inFaces = faces.reduce((n, f) => n + f.length, 0);
  if (inFaces !== rebuild.length) return { contours, changed: false, failed: true };

  // 6. back to points
  const origStarts = new Set();
  for (const ci of parsed.keys()) if (contours[ci].length) origStarts.add(vkey(contours[ci].find(isOn)));
  const built = faces.map((face) => toContour(face, origStarts)).filter(Boolean);

  const next = [];
  let placed = false;
  const firstGroup = Math.min(...parsed.keys());
  contours.forEach((contour, ci) => {
    if (ci === firstGroup && !placed) { placed = true; if (result.has(ci) && result.get(ci)) next.push(result.get(ci)); next.push(...built); return; }
    if (!result.has(ci)) next.push(contour);
    else if (result.get(ci)) next.push(result.get(ci));
  });
  const changed = next.length !== contours.length || next.some((c, i) => c !== contours[i]);
  return { contours: changed ? next : contours, changed };
}

/** One closed face (pieces in order) as a contour of points. */
function toContour(face, origStarts) {
  // pieces of one old segment that follow each other become one again
  const merged = [];
  for (const e of face) {
    const last = merged[merged.length - 1];
    if (last && last.seg === e.seg && !e.cut && !last.cut && last.dir === e.dir
      && ((e.dir === 1 && Math.abs(last.t1 - e.t0) < 1e-9) || (e.dir === -1 && Math.abs(last.t0 - e.t1) < 1e-9))) {
      const t0 = Math.min(last.t0, e.t0); const t1 = Math.max(last.t1, e.t1);
      const c = subSegment(e.seg.c, t0, t1);
      // the shared ends keep their exact points (forward: last then e; backward: e then last)
      if (t0 > T_EPS) c[0] = e.dir === 1 ? last.c[0] : e.c[e.c.length - 1];
      if (t1 < 1 - T_EPS) c[c.length - 1] = e.dir === 1 ? e.c[e.c.length - 1] : last.c[0];
      merged[merged.length - 1] = { ...e, c: e.dir === 1 ? c : reversed(c), t0, t1 };
    } else merged.push({ ...e });
  }
  // round to whole units, the way every point in the editor is
  let segs = merged.map((e) => ({ c: e.c.map((p) => [Math.round(p[0]), Math.round(p[1])]), e }));
  for (let k = 0; k < segs.length; k++) segs[k].c[0] = segs[(k - 1 + segs.length) % segs.length].c[segs[(k - 1 + segs.length) % segs.length].c.length - 1];
  segs = segs.filter((s) => !(s.c.length === 2 && same(s.c[0], s.c[1])) && !(s.c.length === 4 && s.c.every((p) => same(p, s.c[0]))));
  // a point in the middle of a straight line is not needed
  for (let changed = true; changed && segs.length > 2;) {
    changed = false;
    for (let k = 0; k < segs.length; k++) {
      const a = segs[k]; const b = segs[(k + 1) % segs.length];
      if (a.c.length !== 2 || b.c.length !== 2) continue;
      const [p, q] = a.c; const r = b.c[1];
      const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
      const dot = (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1]);
      if (Math.abs(cross) <= 0.5 * Math.hypot(r[0] - p[0], r[1] - p[1]) && dot > 0) {
        segs.splice(k, 1); b.c[0] = p; changed = true; break;
      }
    }
  }
  if (segs.length < 2 && !(segs.length === 1 && segs[0].c.length === 4)) return null;
  // start where an old contour started, else at the lowest point on the left
  let start = segs.findIndex((s) => origStarts.has(`${Math.round(s.c[0][0] / NEAR)},${Math.round(s.c[0][1] / NEAR)}`));
  if (start < 0) {
    start = 0;
    segs.forEach((s, k) => { const p = s.c[0]; const b = segs[start].c[0]; if (p[1] < b[1] || (p[1] === b[1] && p[0] < b[0])) start = k; });
  }
  segs = [...segs.slice(start), ...segs.slice(0, start)];
  const points = [];
  segs.forEach((s, k) => {
    const prev = segs[(k - 1 + segs.length) % segs.length];
    const type = prev.c.length === 2 ? 'line' : 'curve';
    // the point that starts this segment ends the one before it: its type is that segment's
    const p = s.c[0];
    const pt = [p[0], p[1], type];
    const inDir = prev.c.length === 4 ? [p[0] - prev.c[2][0], p[1] - prev.c[2][1]] : [p[0] - prev.c[0][0], p[1] - prev.c[0][1]];
    const outDir = [s.c[1][0] - p[0], s.c[1][1] - p[1]];
    const li = Math.hypot(...inDir); const lo = Math.hypot(...outDir);
    if ((prev.c.length === 4 || s.c.length === 4) && li > 0 && lo > 0 && Math.abs(inDir[0] * outDir[1] - inDir[1] * outDir[0]) / (li * lo) < 0.02 && inDir[0] * outDir[0] + inDir[1] * outDir[1] > 0) pt.push(1);
    points.push(pt);
    if (s.c.length === 4) points.push([s.c[1][0], s.c[1][1], 'offcurve'], [s.c[2][0], s.c[2][1], 'offcurve']);
  });
  if (Math.abs(contourArea(points)) < 1 && points.length < 4) return null;
  return points;
}

// ---------------------------------------------------------------- the operations

const closedIndices = (contours, pick = () => true) => contours.map((c, i) => i).filter((i) => isClosed(contours[i]) && contours[i].length > 1 && pick(i));

/** Joins the shapes that overlap, so that only the outline of what is filled is left. */
export function removeOverlap(contours, only = null) {
  const groups = new Map(closedIndices(contours, (i) => !only || only.has(i)).map((i) => [i, 'a']));
  return operate(contours, { groups, inside: (wa) => wa !== 0 });
}

/** The selected contours (b) with the others (a): 'union', 'subtract' (b taken out of a) or 'intersect'. */
export function booleanOp(contours, selected, kind) {
  if (kind === 'union') return removeOverlap(contours, selected);
  const groups = new Map(closedIndices(contours).map((i) => [i, selected.has(i) ? 'b' : 'a']));
  const inside = kind === 'subtract' ? (wa, wb) => wa !== 0 && wb === 0 : (wa, wb) => wa !== 0 && wb !== 0;
  return operate(contours, { groups, inside });
}

/** Cuts the shapes a line runs through into closed parts. */
export function knife(contours, p0, p1) {
  const line = [p0, p1];
  const crossed = closedIndices(contours, (i) => {
    const segs = contourSegments(contours[i]);
    return !!segs && segs.some((s) => crossings(s.c, line).length > 0);
  });
  if (!crossed.length) return { contours, changed: false };
  const groups = new Map(crossed.map((i) => [i, 'a']));
  return operate(contours, { groups, inside: (wa) => wa !== 0, cut: line });
}

// ---------------------------------------------------------------- extremes

/** The t values (0–1) of the horizontal and vertical extremes of a cubic segment, away from its ends. */
export function segmentExtremes(c, minDistance = 2) {
  if (c.length !== 4) return [];
  const ts = [...extremes(c, 0), ...extremes(c, 1)].sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    const p = pointAt(c, t);
    if (Math.hypot(p[0] - c[0][0], p[1] - c[0][1]) < minDistance || Math.hypot(p[0] - c[3][0], p[1] - c[3][1]) < minDistance) continue;
    if (out.length && Math.abs(out[out.length - 1] - t) < 1e-4) continue;
    out.push(t);
  }
  return out;
}

/** The controls of segment `index` of a contour (lines and cubics only). */
export function segmentControls(contour, index) {
  const path = toPath(contour);
  if (!path || !path.segs[index]) return null;
  const seg = path.segs[index];
  const from = index === 0 ? path.start : path.segs[index - 1].to;
  if (!seg.offs.length) return [[from[0], from[1]], [seg.to[0], seg.to[1]]];
  if (seg.offs.length === 2 && seg.to[2] === 'curve') return [[from[0], from[1]], [seg.offs[0][0], seg.offs[0][1]], [seg.offs[1][0], seg.offs[1][1]], [seg.to[0], seg.to[1]]];
  return null;
}

/** Puts on-curve points at the horizontal and vertical extremes of every curve. The shape stays, but for rounding. */
export function addExtremes(contour) {
  const path = toPath(contour);
  if (!path) return { contour, added: 0 };
  let added = 0;
  const segs = [];
  let from = path.start;
  for (const seg of path.segs) {
    const c = seg.offs.length === 2 && seg.to[2] === 'curve' ? [from, seg.offs[0], seg.offs[1], seg.to].map((p) => [p[0], p[1]]) : null;
    const ts = c ? segmentExtremes(c) : [];
    if (!ts.length) { segs.push(seg); from = seg.to; continue; }
    let rest = c; let done = 0;
    for (const t of ts) {
      const [left, right] = splitAt(rest, (t - done) / (1 - done));
      const on = [Math.round(left[3][0]), Math.round(left[3][1]), 'curve', 1];
      segs.push({ offs: [left[1], left[2]].map((p) => [Math.round(p[0]), Math.round(p[1]), 'offcurve']), to: on });
      rest = right; done = t; added++;
    }
    segs.push({ offs: [rest[1], rest[2]].map((p) => [Math.round(p[0]), Math.round(p[1]), 'offcurve']), to: seg.to });
    from = seg.to;
  }
  if (!added) return { contour, added: 0 };
  return { contour: fromPath({ ...path, segs }), added };
}

// ---------------------------------------------------------------- duplicates and tidying

/** Indices of on-curve points that sit on the point before them (a segment of no length). */
export function duplicatePoints(contour) {
  const on = [];
  contour.forEach((p, i) => { if (isOn(p)) on.push(i); });
  const out = [];
  const closed = isClosed(contour);
  for (let k = closed ? 0 : 1; k < on.length; k++) {
    const i = on[k]; const j = on[(k - 1 + on.length) % on.length];
    if (i === j) continue;
    const a = contour[i]; const b = contour[j];
    if (a[0] !== b[0] || a[1] !== b[1]) continue;
    // the handles in between must be on the point too, or the segment has a shape
    let flat = true;
    for (let m = (j + 1) % contour.length; m !== i; m = (m + 1) % contour.length) if (contour[m][0] !== a[0] || contour[m][1] !== a[1]) flat = false;
    if (flat) out.push(i);
  }
  return out;
}

/**
 * Tidies a contour without changing its shape: removes points that sit on the one before, points in
 * the middle of a straight line, and handles of curves that are straight lines or have no length.
 * @returns {{contour: Array|null, removed: number}}
 */
export function tidyContour(contour) {
  const path = toPath(contour);
  if (!path) return { contour, removed: 0 };
  let removed = 0;
  let segs = path.segs.map((s) => ({ offs: s.offs.map((p) => [...p]), to: [...s.to] }));
  const startOf = (k) => (k === 0 ? (path.closed ? segs[segs.length - 1].to : path.start) : segs[k - 1].to);
  // curves that are straight: handles on the chord, between the ends; or handles on their own points
  segs.forEach((s, k) => {
    if (s.offs.length !== 2 || s.to[2] !== 'curve') return;
    const a = startOf(k); const b = s.to;
    const retracted = s.offs[0][0] === a[0] && s.offs[0][1] === a[1] && s.offs[1][0] === b[0] && s.offs[1][1] === b[1];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
    const onChord = len > 0 && s.offs.every((h) => {
      const along = ((h[0] - a[0]) * dx + (h[1] - a[1]) * dy) / (len * len);
      return Math.abs((h[0] - a[0]) * dy - (h[1] - a[1]) * dx) / len < 0.5 && along >= -1e-9 && along <= 1 + 1e-9;
    });
    if (retracted || onChord) { removed += 2; s.offs = []; s.to[2] = 'line'; if (s.to.length > 3) s.to[3] = 0; }
  });
  // segments of no length
  for (let k = segs.length - 1; k >= 0 && segs.length > 1; k--) {
    const s = segs[k]; const a = startOf(k);
    if (s.to[0] === a[0] && s.to[1] === a[1] && s.offs.every((h) => h[0] === a[0] && h[1] === a[1])) {
      removed += 1 + s.offs.length;
      if (path.closed && k === segs.length - 1) { segs.pop(); } else segs.splice(k, 1);
    }
  }
  // points in the middle of a straight line
  for (let again = true; again && segs.length > 2;) {
    again = false;
    for (let k = 0; k < segs.length; k++) {
      if (!path.closed && k === segs.length - 1) break;
      const s = segs[k]; const n = segs[(k + 1) % segs.length];
      if (s.offs.length || n.offs.length) continue;
      const a = startOf(k); const b = s.to; const c = n.to;
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) <= 0.5 * Math.hypot(c[0] - a[0], c[1] - a[1]) && dot > 0 && !b[4]) {
        if (path.closed && k === segs.length - 1) {
          // the point is where the contour starts: the start moves to the next point
          segs.splice(k, 1);
          path.start = segs[segs.length - 1].to;
          // the closing segment now reaches the old second point
        } else segs.splice(k, 1);
        removed++; again = true; break;
      }
    }
  }
  if (!removed) return { contour, removed: 0 };
  if (path.closed) {
    const last = segs[segs.length - 1].to;
    const out = fromPath({ closed: true, start: last, segs });
    return { contour: out.length > 1 ? out : null, removed };
  }
  const out = fromPath({ ...path, segs });
  return { contour: out.length > 1 ? out : null, removed };
}

/** A rectangle or an ellipse filling the box from (x0, y0) to (x1, y1), counter-clockwise (an outer contour). */
export function primitive(kind, x0, y0, x1, y1) {
  const l = Math.round(Math.min(x0, x1)); const r = Math.round(Math.max(x0, x1));
  const b = Math.round(Math.min(y0, y1)); const t = Math.round(Math.max(y0, y1));
  if (kind !== 'ellipse') return [[l, b, 'line'], [r, b, 'line'], [r, t, 'line'], [l, t, 'line']];
  const cx = (l + r) / 2; const cy = (b + t) / 2; const kx = (r - l) / 2 * 0.5523; const ky = (t - b) / 2 * 0.5523;
  const R = (v) => Math.round(v);
  return [
    [R(cx), b, 'curve', 1], [R(cx + kx), b, 'offcurve'], [r, R(cy - ky), 'offcurve'],
    [r, R(cy), 'curve', 1], [r, R(cy + ky), 'offcurve'], [R(cx + kx), t, 'offcurve'],
    [R(cx), t, 'curve', 1], [R(cx - kx), t, 'offcurve'], [l, R(cy + ky), 'offcurve'],
    [l, R(cy), 'curve', 1], [l, R(cy - ky), 'offcurve'], [R(cx - kx), b, 'offcurve'],
  ];
}

/** A copy of a font whose glyphs have no overlapping contours (for exporting). */
export function fontWithoutOverlaps(font) {
  const glyphs = {};
  for (const [name, g] of Object.entries(font.glyphs)) {
    const closed = g.contours.filter((c) => isClosed(c)).length;
    const r = closed > 1 ? removeOverlap(g.contours) : null;
    glyphs[name] = r && r.changed ? { ...g, contours: r.contours } : g;
  }
  return { ...font, glyphs };
}

/** Where a line crosses the contours: [{ t, p }] sorted along the line (t from 0 at a to 1 at b). */
export function lineCrossings(contours, a, b) {
  const line = [a, b];
  const out = [];
  for (const c of contours) {
    const segs = contourSegments(c);
    if (!segs) continue;
    for (const s of segs) for (const [tl] of crossings(line, s.c)) out.push({ t: tl, p: pointAt(line, tl) });
  }
  out.sort((x, y) => x.t - y.t);
  return out.filter((x, i) => i === 0 || Math.hypot(x.p[0] - out[i - 1].p[0], x.p[1] - out[i - 1].p[1]) > 0.01);
}

export const _internal = { crossings, winding, pointAt, contourSegments };
