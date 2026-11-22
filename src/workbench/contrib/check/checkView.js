/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Check" view: the project guide (how far the font is from being usable, language by language) and
// the list of problems found in the font, each one leading to where it can be fixed.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { checkFont, countByLevel, missingCharacters, CHARSETS } from '../../../base/common/validate.js';
import { addGlyphs } from '../font/glyphActions.js';
import { ViewPane, titled } from '../../browser/viewPane.js';
import { t, tn } from '../../../base/common/nls.js';

const SETS = ['basicLatin', 'portuguese', 'spanish', 'westernEuropean'];
const LEVELS = ['error', 'warning', 'info'];
const MAX_ROWS = 400;

/** The detail of a problem as shown to the person (the data itself keeps identifiers, for tools and agents). */
function detail(problem) {
  if (problem.code === 'notInterpolable') {
    const [weight, reason] = String(problem.detail).split(': ');
    return `${weight}: ${t('family.reason.' + reason)}`;
  }
  if (problem.code !== 'missingCharacters') return String(problem.detail);
  const [set, ...rest] = String(problem.detail).split(': ');
  return `${SETS.includes(set) ? t('charsets.' + set) : set}: ${rest.join(': ')}`;
}

export class CheckView extends ViewPane {
  level = 'all';

  constructor(services) {
    super(services, 'check');
    this.guide = h('div.check-guide');
    this.summary = h('div.check-summary');
    this.list = h('div.check-list');
    this.element.append(h('div.check-body',
      titled('check.guide', t('check.guide'), t('check.guideLead')), this.guide,
      h('h2', t('check.problems')), this.summary, this.list));
    this.fonts.onDidChangeFont(() => this.invalidate());
    this.fonts.onDidEdit(() => this.invalidate());
  }

  render() {
    const { fonts } = this;
    const font = fonts.font;
    if (!font) return;

    // ---- project guide
    const drawn = font.glyphOrder.filter((n) => font.glyphs[n].contours.length || font.glyphs[n].components.length).length;
    const steps = [
      ['names', !!font.info.familyName && !!font.info.styleName, 'info'],
      ['drawn', drawn >= 26, 'font'],
      ['space', font.glyphOrder.some((n) => font.glyphs[n].unicodes.includes(0x20)), 'font'],
      ['basicLatin', missingCharacters(font, 'basicLatin').length === 0, 'font'],
      ['kerning', Object.keys(font.kerning).length > 0, 'proof'],
      ['license', !!font.info.openTypeNameLicense && !!font.info.copyright, 'info'],
    ];
    setChildren(this.guide,
      h('ul.guide-steps', steps.map(([id, done, view]) => h('li', { class: done ? 'done' : 'todo', 'data-step': id },
        h('span.guide-mark', { html: icon(done ? 'check' : 'chevronRight', 14) }),
        h('button.link', { onclick: () => this.layout.openView(view) }, t(`check.step.${id}`))))),
      h('div.coverage', SETS.map((set) => {
        const total = new Set([...CHARSETS[set]]).size;
        const missing = missingCharacters(font, set);
        const pct = Math.round((total - missing.length) / total * 100);
        return h('div.coverage-row', { 'data-set': set, title: missing.length ? t('check.coverage.missing', { list: missing.join(' ') }) : t('check.coverage.complete') },
          h('span.coverage-name', t('charsets.' + set)),
          h('span.coverage-bar', h('span', { style: { width: `${pct}%` } })),
          h('span.coverage-value', `${pct}%`),
          h('span.coverage-missing', missing.length ? missing.slice(0, 40).join(' ') : ''),
          missing.length ? h('button.btn.btn-secondary.btn-sm', { 'data-action': 'complete', title: t('check.coverage.createTitle'), onclick: () => addGlyphs(this, set) }, t('check.coverage.create')) : null);
      })));

    // ---- problems
    const problems = checkFont(font, { charsets: SETS });
    const counts = countByLevel(problems);
    this.element.dataset.errors = String(counts.error);
    const filter = (id, label, n) => h('button.chip', { class: `chip level-${id}${this.level === id ? ' active' : ''}`, 'data-level': id, onclick: () => { this.level = id; this.render(); } }, `${label} · ${n}`);
    setChildren(this.summary,
      filter('all', t('check.level.all'), problems.length),
      LEVELS.map((l) => filter(l, t('check.level.' + l), counts[l])));
    const shown = problems.filter((p) => this.level === 'all' || p.level === this.level);
    shown.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
    setChildren(this.list, shown.length
      ? [h('table.data-table.problem-table', h('tbody', shown.slice(0, MAX_ROWS).map((p) => h('tr', { class: `level-${p.level}`, 'data-code': p.code },
        h('td', h('span.level-dot', { title: t('check.level.' + p.level) })),
        h('td', p.glyph ? h('button.chip', { onclick: () => { fonts.select(p.glyph); this.layout.openView('glyph'); } }, p.glyph) : h('span.muted', t('check.wholeFont'))),
        h('td', t('check.problem.' + p.code), p.detail !== undefined ? h('span.muted', ` — ${detail(p)}`) : null))))),
      shown.length > MAX_ROWS ? h('p.muted', tn('check.more', shown.length - MAX_ROWS)) : null]
      : h('p.check-clean', h('span', { html: icon('check', 16) }), t('check.clean')));
  }
}
