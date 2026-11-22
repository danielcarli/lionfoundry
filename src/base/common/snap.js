/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Reference lines and the "magnet": pulls a position onto the reference lines near it.
// A line is { y } (horizontal), { x } (vertical) or { x, y, angle } (through a point, at an angle in
// degrees counter-clockwise from the horizontal) — the three forms of a UFO guideline.

/** 'h', 'v' or 'd' (diagonal). */
export function lineKind(line) {
  if (line.x === undefined || line.x === null) return 'h';
  if (line.y === undefined || line.y === null) return 'v';
  return 'd';
}

/** Unit direction of a diagonal line. */
function direction(line) {
  const a = (Number(line.angle) || 0) * Math.PI / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** Distance from a position to a line, in the units of the position. */
export function distanceToLine(line, x, y) {
  const kind = lineKind(line);
  if (kind === 'h') return Math.abs(y - line.y);
  if (kind === 'v') return Math.abs(x - line.x);
  const [ux, uy] = direction(line);
  return Math.abs((x - line.x) * uy - (y - line.y) * ux);
}

/**
 * The position pulled onto the lines that are within `tolerance` of it.
 * A horizontal and a vertical line can both hold it (a corner). A diagonal holds it alone, or together
 * with one straight line where the two cross.
 * @param {number} x
 * @param {number} y
 * @param {Array<object>} lines
 * @param {number} tolerance how near a line has to be, in the same units
 * @returns {{x: number, y: number, hits: number[]}} the new position and the indexes of the lines that hold it
 */
export function snapPoint(x, y, lines, tolerance) {
  let h = null; let v = null; let d = null;
  lines.forEach((line, i) => {
    const kind = lineKind(line);
    const dist = distanceToLine(line, x, y);
    if (!(dist <= tolerance)) return;
    if (kind === 'h') { if (!h || dist < h.dist) h = { dist, i, line }; } else if (kind === 'v') { if (!v || dist < v.dist) v = { dist, i, line }; } else if (!d || dist < d.dist) d = { dist, i, line };
  });
  let sx = x; let sy = y;
  const hits = [];
  if (h) { sy = h.line.y; hits.push(h.i); }
  if (v) { sx = v.line.x; hits.push(v.i); }
  if (d && !(h && v)) {
    const [ux, uy] = direction(d.line);
    if (!h && !v) {
      // the nearest spot on the diagonal
      const t = (x - d.line.x) * ux + (y - d.line.y) * uy;
      sx = d.line.x + t * ux; sy = d.line.y + t * uy;
      hits.push(d.i);
    } else if (h && Math.abs(uy) > 1e-9) {
      // where the diagonal crosses the horizontal line, when that is close by
      const ix = d.line.x + (h.line.y - d.line.y) / uy * ux;
      if (Math.abs(ix - x) <= tolerance * 3) { sx = ix; hits.push(d.i); }
    } else if (v && Math.abs(ux) > 1e-9) {
      const iy = d.line.y + (v.line.x - d.line.x) / ux * uy;
      if (Math.abs(iy - y) <= tolerance * 3) { sy = iy; hits.push(d.i); }
    }
  }
  return { x: sx, y: sy, hits };
}

/** A new reference line of the given kind through (x, y). */
export function newGuideline(kind, x, y, angle = 45) {
  if (kind === 'h') return { y: Math.round(y) };
  if (kind === 'v') return { x: Math.round(x) };
  return { x: Math.round(x), y: Math.round(y), angle };
}
