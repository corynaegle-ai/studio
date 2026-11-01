/* SPDX-License-Identifier: Apache-2.0 */
/**
 * activity-card.js — Studio › What your assistants did (0.8 AC.13, oltl-ac_PART_3; docs/AI-TRUST-SPEC.md). One plain-words list across every
 * window: what each assistant read, ran and changed, by app and file, newest first, filtered, and exported (CSV, JSON, text) for firms that need
 * an audit trail. A change names its undo step and its file's history; the person takes the step back in that app's own window.
 *
 *   mountActivity({ box, log, t, el, doc }) → { render() }
 *     box  holds an element with [data-activity-body]; log is the one createActivityLog() (ai-activity.js) the hub gives createControlRelay.
 * Nothing here stores anything: the list lives in the hub page for the session, as the log keeps it (bounded, arguments cut, no results).
 */
export function mountActivity({ box, log, t, el, doc = document }) {
  let kind = 'all';
  const body = () => box.querySelector('[data-activity-body]');

  function download(format) {
    const x = log.export(format, { kind });
    const url = URL.createObjectURL(new Blob([x.text], { type: x.type }));
    const a = doc.createElement('a'); a.href = url; a.download = x.name; doc.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function row(entry) {
    const w = log.words(entry), l = log.link(entry);
    const bits = [el('span', { class: 'studio-act-text', 'data-activity-text': true }, w.text)];
    if (l.canUndo) bits.push(el('span', { class: 'studio-hint', 'data-activity-undo': true }, t('activity.undo', { step: l.undo })));
    if (l.document) bits.push(el('span', { class: 'studio-hint', 'data-activity-file': true }, t('activity.file', { file: l.document + (l.version ? ' (' + l.version + ')' : '') })));
    return el('li', { class: 'studio-act-row', 'data-activity-row': w.kind || '' }, el('time', { class: 'studio-hint' }, String(entry.time || '').replace('T', ' ').slice(0, 19)), ' ', ...bits);
  }

  function render() {
    const b = body(); if (!b) return;
    const rows = log.list({ kind });
    const sel = el('select', { class: 'form-select select-cc', 'data-activity-filter': true, 'aria-label': t('activity.filter'),
      onchange: (e) => { kind = e.target.value; render(); } },
      ...['all', 'changes', 'reads'].map((k) => el('option', { value: k, selected: k === kind ? true : null }, t('activity.kind.' + k))));
    b.replaceChildren(
      el('p', {}, t('activity.lead')),
      el('div', { class: 'studio-btnrow' }, sel,
        ...['csv', 'json', 'txt'].map((f) => el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-activity-export': f, disabled: rows.length ? null : true, onclick: () => download(f) }, t('activity.export.' + f)))),
      rows.length ? el('ul', { class: 'studio-act-list' }, ...rows.slice(0, 200).map(row)) : el('p', { class: 'studio-hint', 'data-activity-none': true }, t('activity.none')));
  }

  log.on(() => render());
  return { render };
}
