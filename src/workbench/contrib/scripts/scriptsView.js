/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// "Scripts" view: write a script in JavaScript or Python, run it on the open font, read what it
// printed. A script works on a copy of the font; what it changed comes back as ONE step in the undo
// history, so any script can be undone with Ctrl+Z. Nothing is written to disk by running a script.
import { h, setChildren } from '../../../base/browser/dom.js';
import { icon } from '../../../base/browser/icons.js';
import { ViewPane } from '../../browser/viewPane.js';
import { t, tn } from '../../../base/common/nls.js';

const STATE_KEY = 'lionfoundry.scripts';
const SECTIONS = ['info', 'glyphOrder', 'glyphs', 'groups', 'kerning', 'features', 'lib'];

/** Starting points, in both languages. The comments are part of the lesson, so they follow the interface language. */
const EXAMPLES = {
  javascript: {
    report: () => `// ${t('scripts.example.report')}\nprint(font.info.familyName, font.info.styleName, '—', font.length, 'glyphs');\nfor (const glyph of font) {\n  if (glyph.unicode !== null && !glyph.contours.length && !glyph.components.length) print('empty:', glyph.name);\n}\n`,
    spacing: () => `// ${t('scripts.example.spacing')}\nfor (const glyph of font) {\n  if (glyph.leftMargin === null) continue;\n  glyph.leftMargin += 10;\n  glyph.rightMargin += 10;\n}\nprint('done');\n`,
    slant: () => `// ${t('scripts.example.slant')}\nfor (const glyph of font.selectedGlyphs) {\n  const copy = font.newGlyph(glyph.name + '.slant');\n  copy.copyFrom(glyph).skewBy(12);\n  print('created', copy.name);\n}\n`,
    kerning: () => `// ${t('scripts.example.kerning')}\nfor (const [left, right, value] of font.kerning.pairs()) {\n  print(left, right, value);\n}\nfont.kerning.scaleBy(1.1);\n`,
  },
  python: {
    report: () => `# ${t('scripts.example.report')}\nprint(font.info.familyName, font.info.styleName, "-", len(font), "glyphs")\nfor glyph in font:\n    if glyph.unicode is not None and not glyph.contours and not glyph.components:\n        print("empty:", glyph.name)\n`,
    spacing: () => `# ${t('scripts.example.spacing')}\nfor glyph in font:\n    if glyph.leftMargin is None:\n        continue\n    glyph.leftMargin += 10\n    glyph.rightMargin += 10\nprint("done")\n`,
    slant: () => `# ${t('scripts.example.slant')}\nfor glyph in font.selectedGlyphs:\n    copy = font.newGlyph(glyph.name + ".slant")\n    copy.appendComponent(glyph.name)\n    copy.width = glyph.width\n    copy.skewBy(12)\n    print("created", copy.name)\n`,
    kerning: () => `# ${t('scripts.example.kerning')}\nfor pair, value in font.kerning.items():\n    print(pair, value)\nfont.kerning.scaleBy(1.1)\n`,
  },
};

export class ScriptsView extends ViewPane {
  state = { language: 'javascript', code: {} };
  #running = false;

  constructor(services) {
    super(services, 'scripts');
    try { Object.assign(this.state, JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); } catch { /* defaults */ }
    if (!this.state.code || typeof this.state.code !== 'object') this.state.code = {};
    this.language = h('select.input.input-sm', { 'aria-label': t('scripts.language'), 'data-field': 'language', onchange: (e) => { this.#store(); this.state.language = e.target.value; this.#load(); } },
      h('option', { value: 'javascript' }, 'JavaScript'), h('option', { value: 'python' }, 'Python'));
    this.examples = h('select.input.input-sm', { 'aria-label': t('scripts.examples'), onchange: (e) => { if (e.target.value) { this.editor.value = EXAMPLES[this.state.language][e.target.value](); this.#store(); e.target.value = ''; } } },
      h('option', { value: '' }, t('scripts.examples')), Object.keys(EXAMPLES.javascript).map((id) => h('option', { value: id }, t('scripts.example.' + id))));
    this.runButton = h('button.btn.btn-primary.btn-sm', { 'data-action': 'run', title: 'Ctrl+Enter', onclick: () => this.run() }, h('span', { html: icon('play', 14) }), t('scripts.run'));
    this.editor = h('textarea.code-editor.script-editor', { spellcheck: 'false', 'aria-label': t('scripts.code'), oninput: () => this.#store(),
      onkeydown: (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run(); } else if (e.key === 'Tab') {
          e.preventDefault();
          const el = e.target; const at = el.selectionStart;
          el.setRangeText(this.state.language === 'python' ? '    ' : '  ', at, el.selectionEnd, 'end');
          this.#store();
        }
      } });
    this.output = h('pre.script-output', { 'aria-live': 'polite' });
    this.status = h('span.muted.small');
    this.element.append(
      h('div.view-toolbar', this.language, this.examples, this.runButton, this.status, h('span.toolbar-spacer'), h('span.muted.small', t('scripts.undoHint'))),
      h('div.split-view.scripts-layout',
        h('div.split-main.script-main', this.editor, h('h3', t('scripts.output')), this.output),
        h('aside.split-side', h('h2', t('scripts.reference')), h('p.muted.small', t('scripts.referenceLead')), h('pre.code-block.reference', this.#reference()))));
    this.language.value = this.state.language;
    this.#load();
    this.fonts.onDidChangeFont(() => this.invalidate());
  }

  #reference() {
    return [
      'font.info.familyName', 'font.keys()            // glyph names', 'font["A"]              // a glyph', 'font.selectedGlyphs',
      'font.newGlyph(name)', 'font.removeGlyph(name)', 'font.groups', 'font.features',
      '', 'glyph.name  glyph.width', 'glyph.unicode  glyph.unicodes', 'glyph.leftMargin  glyph.rightMargin', 'glyph.bounds',
      'glyph.contours  glyph.components  glyph.anchors', 'glyph.moveBy · scaleBy · rotateBy · skewBy', 'glyph.appendAnchor · appendComponent', 'glyph.guidelines · appendGuideline', 'glyph.clear()  glyph.round()',
      '', '// JavaScript', 'font.kerning.get(l, r) · set(l, r, v) · pairs()', 'glyph.moveBy(dx, dy)', 'print(...)',
      '', '# Python', 'font.kerning[(l, r)] = v', 'glyph.moveBy((dx, dy))', 'print(...)',
    ].join('\n');
  }

  #store() {
    this.state.code[this.state.language] = this.editor.value;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch { /* storage unavailable */ }
  }

  #load() {
    const lang = this.state.language;
    this.editor.value = this.state.code[lang] ?? EXAMPLES[lang].report();
    this.#store();
  }

  render() { /* the view keeps its own state */ }

  async run() {
    const { fonts } = this;
    if (this.#running || !fonts.hasFont) return;
    this.#running = true;
    this.runButton.disabled = true;
    this.status.textContent = t('scripts.running');
    this.output.classList.remove('error');
    const f = fonts.font;
    const started = performance.now();
    let res;
    try {
      res = await this.host.runScript({ language: this.state.language, code: this.editor.value, selection: fonts.selected ? [fonts.selected] : [],
        font: Object.fromEntries(SECTIONS.map((k) => [k, f[k]])) });
    } catch (err) { res = { output: '', error: String(err && err.message) }; }
    this.#running = false;
    this.runButton.disabled = false;
    const ms = Math.round(performance.now() - started);
    if (!res || res.error) {
      const message = res && res.error === 'pythonMissing' ? t('scripts.error.pythonMissing') : res && res.error === 'timeout' ? t('scripts.error.timeout') : (res && res.error) || t('scripts.error.unknown');
      this.output.classList.add('error');
      setChildren(this.output, [res && res.output ? res.output + '\n' : '', message]);
      this.status.textContent = t('scripts.failed');
      this.element.dataset.result = 'error';
      return;
    }
    const before = new Set(f.glyphOrder);
    const changed = fonts.edit(t('undo.script'), { all: true }, (font) => { for (const k of SECTIONS) font[k] = res.font[k]; });
    setChildren(this.output, res.output || t('scripts.noOutput'));
    this.status.textContent = changed ? t('scripts.changed', { ms }) : t('scripts.unchanged', { ms });
    this.element.dataset.result = changed ? 'changed' : 'unchanged';
    if (changed) {
      const added = fonts.font.glyphOrder.filter((n) => !before.has(n)).length;
      this.notifications.info(t('scripts.applied') + (added ? ' ' + tn('scripts.added', added) : ''), 6000, { label: t('common.undo'), run: () => fonts.undo() });
    }
  }
}
