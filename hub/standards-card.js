/* SPDX-License-Identifier: Apache-2.0 */
/**
 * standards-card.js — Studio › Firm standards (0.8 AC.14, studio_PART_3; docs/AI-TRUST-SPEC.md § 5). The firm writes its house rules (or
 * imports a file), Studio shows the cleaned text WHOLE with what was cut, and keeps the file only after the person presses "Keep these rules".
 * Every AI the person connects then reads them (the hub gives them as the resource cadcraft://standards/firm and in front of every starter).
 *
 *   standardsStore(storage) → { get(), set(json), remove() }    the kept file (cleaned) in localStorage `cadcraft.firm-standards`
 *   mountStandards({ box, t, el, say, storage, doc }) → { render(), store }
 *
 * The cleaning and the limits are ai-standards.js (one source). A file from someone else is the risk, so nothing is kept unseen, it is cut at
 * 48 KB, and the firm / revision / date stay on it. The file never widens a permission: apps check that at call time.
 */
import { cleanStandards, standardsText, exampleStandards, LIMITS } from './ai-standards.js';

const KEY = 'cadcraft.firm-standards';

export function standardsStore(storage = globalThis.localStorage) {
  return {
    get() {
      try { const raw = storage.getItem(KEY); if (!raw) return null; return cleanStandards(raw).standards; } catch { return null; }
    },
    set(standards) { try { storage.setItem(KEY, JSON.stringify(standards)); return true; } catch { return false; } },
    remove() { try { storage.removeItem(KEY); } catch { /* none */ } },
  };
}

export function mountStandards({ box, t, el, say, storage = globalThis.localStorage, doc = document }) {
  const store = standardsStore(storage);
  let draft = '', review = null;
  const body = () => box.querySelector('[data-standards-body]');

  function check(text) {
    const r = cleanStandards(text);
    review = { text, standards: r.standards, problems: r.problems };
    return review;
  }
  function render() {
    const b = body(); if (!b) return;
    const kept = store.get();
    const rows = [el('p', {}, t('standards.lead'))];
    if (kept) {
      rows.push(el('div', { 'data-standards-kept': true },
        el('strong', {}, t('standards.kept', { firm: kept.firm || '?', revision: kept.revision || '-', updated: kept.updated || '-' })),
        el('details', {}, el('summary', {}, t('standards.show')), el('pre', { class: 'studio-assist-pre', 'data-standards-kept-text': true }, standardsText(kept))),
        el('div', { class: 'studio-btnrow' },
          el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-standards-edit': true, onclick: () => { draft = JSON.stringify(kept, null, 2); review = null; render(); } }, t('standards.edit')),
          el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-standards-export': true, onclick: () => download(kept) }, t('standards.export')),
          el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-standards-remove': true, onclick: () => { store.remove(); review = null; say(t('standards.removed')); render(); } }, t('standards.remove')))));
    } else rows.push(el('p', { class: 'studio-hint', 'data-standards-none': true }, t('standards.none')));
    const ta = el('textarea', { class: 'form-control', rows: '8', 'data-standards-text': true, 'aria-label': t('standards.text'), spellcheck: 'false' });
    ta.value = draft;
    ta.addEventListener('input', () => { draft = ta.value; });
    const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-standards-file': true });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > LIMITS.bytes) { check('x'.repeat(LIMITS.bytes + 1)); render(); return; }
      draft = await f.text(); review = null; check(draft); render();
    });
    rows.push(el('div', {}, ta, file));
    rows.push(el('div', { class: 'studio-btnrow' },
      el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-standards-example': true, onclick: () => { draft = JSON.stringify(exampleStandards(), null, 2); review = null; render(); } }, t('standards.example')),
      el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-standards-import': true, onclick: () => file.click() }, t('standards.import')),
      el('button', { type: 'button', class: 'studio-btn studio-btn-sm', 'data-standards-review': true, onclick: () => { check(draft); render(); } }, t('standards.review'))));
    if (review) {
      const r = review;
      rows.push(el('div', { class: 'studio-connectai-confirm', 'data-standards-review-box': true },
        r.problems.length ? el('ul', { 'data-standards-problems': true }, ...r.problems.map((p) => el('li', {}, p))) : null,
        r.standards ? [el('p', {}, t('standards.will', { firm: r.standards.firm || '?', revision: r.standards.revision || '-', updated: r.standards.updated || '-' })),
          el('pre', { class: 'studio-assist-pre', 'data-standards-preview': true }, standardsText(r.standards)),
          el('div', { class: 'studio-btnrow' },
            el('button', { type: 'button', class: 'studio-btn', 'data-standards-keep': true, onclick: () => { if (store.set(r.standards)) { say(t('standards.saved')); draft = ''; review = null; } else say(t('standards.failed'), 'error'); render(); } }, t('standards.keep')),
            el('button', { type: 'button', class: 'studio-btn studio-btn-line', onclick: () => { review = null; render(); } }, t('standards.no')))] : null));
    }
    b.replaceChildren(...rows);
  }
  function download(s) {
    try {
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
      a.download = 'firm-standards.json';
      doc.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { say(t('standards.failed'), 'error'); }
  }
  return { render, store };
}
