/*---------------------------------------------------------------------------------------------
 *  LionFoundry — Copyright (C) 2026 LionFoundry Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Small dialogs shared by the views: a form, a confirmation, a confirmation with a typed code
// (the Lion family rule for anything that destroys work) and a drop-down menu.
import { h } from '../../base/browser/dom.js';
import { icon } from '../../base/browser/icons.js';
import { t } from '../../base/common/nls.js';

function openDialog(build) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.focus) previous.focus();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
    const dialog = h('div.cm-dialog.form-dialog', { role: 'dialog', 'aria-modal': 'true' });
    const overlay = h('div.cm-overlay', { onmousedown: (e) => { if (e.target === overlay) close(null); } }, dialog);
    const focus = build(dialog, close);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    requestAnimationFrame(() => { if (focus) { focus.focus(); if (focus.select) focus.select(); } });
  });
}

/**
 * A form. fields: [{ id, label, value, type?: 'text'|'number'|'select'|'checkbox', options?: [[value, label]], hint? }]
 * validate(values) may return an error message.
 * @returns {Promise<object|null>} the values by id, or null when cancelled
 */
export function formDialog({ title, message, fields, confirmLabel, validate }) {
  return openDialog((dialog, close) => {
    const inputs = {};
    const error = h('p.field-error', { hidden: true });
    const read = () => Object.fromEntries(fields.map((f) => {
      const el = inputs[f.id];
      return [f.id, f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value];
    }));
    const submit = (e) => {
      e.preventDefault();
      const values = read();
      const problem = validate ? validate(values) : null;
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      close(values);
    };
    const rows = fields.map((f) => {
      let el;
      if (f.type === 'select') el = h('select.input', (f.options || []).map(([value, label]) => h('option', { value, selected: value === f.value }, label)));
      else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!f.value });
      else el = h('input.input', { type: f.type === 'number' ? 'number' : 'text', value: f.value ?? '', step: f.step || 'any', spellcheck: 'false', placeholder: f.placeholder || '' });
      el.dataset.field = f.id;
      inputs[f.id] = el;
      return f.type === 'checkbox'
        ? h('label.check', el, f.label)
        : h('label.field', h('span.field-label', f.label), el, f.hint ? h('p.field-hint', f.hint) : null);
    });
    dialog.append(h('form', { onsubmit: submit },
      h('h2', title),
      message ? h('p.muted', message) : null,
      h('div.form-fields', rows),
      error,
      h('footer.cm-actions',
        h('button.btn.btn-secondary', { type: 'button', onclick: () => close(null) }, t('common.cancel')),
        h('button.btn.btn-primary', { type: 'submit' }, confirmLabel || t('common.ok')))));
    return inputs[fields[0].id];
  });
}

/** @returns {Promise<boolean>} */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return openDialog((dialog, close) => {
    const ok = h(`button.btn.${danger ? 'btn-danger' : 'btn-primary'}`, { onclick: () => close(true) }, confirmLabel || t('common.ok'));
    dialog.append(h('h2', title), h('p', message),
      h('footer.cm-actions', h('button.btn.btn-secondary', { onclick: () => close(null) }, t('common.cancel')), ok));
    return ok;
  }).then(Boolean);
}

/**
 * Confirmation for what cannot be brought back by itself: the person types a 3-character code shown in
 * the dialog, so nothing is destroyed by a stray click or key.
 * @returns {Promise<boolean>}
 */
export function codeDialog({ title, message, confirmLabel }) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(3)), (v) => alphabet[v % alphabet.length]).join('');
  return openDialog((dialog, close) => {
    const input = h('input.input.code-input', { type: 'text', maxlength: '3', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('confirm.code.label') });
    const ok = h('button.btn.btn-danger', { type: 'submit', disabled: true }, confirmLabel || t('common.delete'));
    input.addEventListener('input', () => { ok.disabled = input.value.trim().toUpperCase() !== code; });
    dialog.dataset.code = code;
    dialog.append(h('form', { onsubmit: (e) => { e.preventDefault(); if (!ok.disabled) close(true); } },
      h('h2', title), h('p', message),
      h('p.code-row', t('confirm.code.type'), h('strong.code-value', code)),
      input,
      h('footer.cm-actions', h('button.btn.btn-secondary', { type: 'button', onclick: () => close(null) }, t('common.cancel')), ok)));
    return input;
  }).then(Boolean);
}

/** A drop-down menu under `anchor`. items: [{ label, icon?, run, disabled?, hint? } | null (separator)] */
export function showMenu(anchor, items) {
  document.querySelector('.menu-popup')?.remove();
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); anchor.focus(); } };
  const menu = h('div.menu-popup', { role: 'menu' }, items.map((item) => (item
    ? h('button.menu-item', { role: 'menuitem', disabled: !!item.disabled, onclick: () => { close(); item.run(); } },
      h('span.menu-icon', { html: item.icon ? icon(item.icon, 14) : '' }), h('span.menu-label', item.label), item.hint ? h('span.menu-hint', item.hint) : null)
    : h('div.menu-sep'))));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - m.width - 8, r.left))}px`;
  menu.style.top = `${r.bottom + 4 + m.height > window.innerHeight ? Math.max(8, r.top - m.height - 4) : r.bottom + 4}px`;
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', onKey, true);
  menu.querySelector('button:not(:disabled)')?.focus();
}
