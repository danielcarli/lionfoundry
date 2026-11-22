/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// A small text shaper for the proof view: characters → glyphs, substitutions of the enabled features,
// kerning and mark attachment. It works on the layout plan of features.js, the same one the exporter
// writes to the font, and records every step so the proof can show why a glyph changed.
// Left-to-right text only; it is not HarfBuzz, which is planned to replace it.
import { DEFAULT_ON } from './features.js';

/**
 * @param {object} font the font model
 * @param {object} plan the layout plan (features.js, buildLayout)
 * @param {string} text one line of text
 * @param {{features?: Object<string, boolean>, cmap: (code: number) => string|null}} options
 * @returns {{glyphs: Array<{name, x, y, advance, kern, cluster}>, width: number, steps: Array, missing: number[]}}
 */
export function shape(font, plan, text, { features = {}, cmap }) {
  const on = (tag) => (tag in features ? !!features[tag] : DEFAULT_ON.has(tag));
  const notdef = font.glyphs['.notdef'] ? '.notdef' : null;
  const missing = [];
  let run = [];
  let cluster = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    let name = cmap(code);
    if (!name) { missing.push(code); name = notdef; }
    if (name) run.push({ name, cluster });
    cluster++;
  }

  const steps = [];
  for (const feature of plan.gsub) {
    if (!on(feature.tag)) continue;
    for (const lookup of feature.lookups) {
      if (lookup.type === 'single') {
        for (const item of run) {
          const to = lookup.map[item.name];
          if (to) { steps.push({ feature: feature.tag, type: 'single', from: [item.name], to, cluster: item.cluster }); item.name = to; }
        }
      } else {
        const out = [];
        for (let i = 0; i < run.length;) {
          const hit = lookup.ligatures.find((l) => l.from.every((g, k) => run[i + k] && run[i + k].name === g));
          if (hit) {
            steps.push({ feature: feature.tag, type: 'ligature', from: hit.from, to: hit.to, cluster: run[i].cluster });
            out.push({ name: hit.to, cluster: run[i].cluster });
            i += hit.from.length;
          } else out.push(run[i++]);
        }
        run = out;
      }
    }
  }

  const kernOn = on('kern');
  const markOn = on('mark');
  const glyphs = [];
  let x = 0;
  let base = null; // the last glyph marks can attach to
  for (let i = 0; i < run.length; i++) {
    const { name } = run[i];
    const glyph = font.glyphs[name];
    const mark = markOn ? plan.marks.marks[name] : null;
    if (mark && base && plan.marks.bases[base.name] && plan.marks.bases[base.name][mark.cls]) {
      const a = plan.marks.bases[base.name][mark.cls];
      glyphs.push({ name, x: base.x + a.x - mark.x, y: a.y - mark.y, advance: 0, kern: 0, cluster: run[i].cluster });
      steps.push({ feature: 'mark', type: 'attach', from: [name], to: base.name, cluster: run[i].cluster });
      continue;
    }
    let kern = 0;
    const prev = glyphs.length ? glyphs[glyphs.length - 1] : null;
    if (kernOn && prev && prev.advance) {
      kern = (plan.kerning.get(prev.name) && plan.kerning.get(prev.name).get(name)) || 0;
      if (kern) steps.push({ feature: 'kern', type: 'pair', from: [prev.name, name], value: kern, cluster: run[i].cluster });
    }
    x += kern;
    const item = { name, x, y: 0, advance: glyph.width, kern, cluster: run[i].cluster };
    glyphs.push(item);
    base = item;
    x += glyph.width;
  }
  return { glyphs, width: x, steps, missing };
}
