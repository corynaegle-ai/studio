/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file — protocol only. SPIKE (EG.77, studio_PART_2): not mounted anywhere; docs/spikes/EG.77_PART_2.md. */
/**
 * undo-journal.js — one "Undo" for the work across Studio's windows, as a journal of who did what last and a routed undo that is only
 * ever the window's OWN next undo. DOM-free.
 *
 * Each window tells the channel after every step it finishes: `edit.done { step, label, depth, kind }` (`depth` = its undo stack's length
 * after the step; kind 'do' | 'undo' | 'redo'). The journal keeps the newest entry per window and the order between windows. To undo "the last thing I did,
 * wherever it was", Studio takes the newest entry, asks that window to PROBE (`undo.probe` → { depth, label, step }) and only when the window says
 * its stack is exactly as the entry left it does it send `undo.run`. A window that moved on (the person edited there since, or undid by hand) is
 * skipped, never forced: its entry is dropped and the next one is tried. Nothing is undone that is not that window's top step, so the per-window rules each
 * app already has (labels, groups, Live's per-person undo) are untouched. Memory only; ten entries per window.
 *
 *   const j = new Journal();  j.record(winId, app, { step, label, depth, kind }, now)
 *   j.next(now) → entry | null          the newest entry that is not an undo        j.drop(entry)
 *   await j.undo(ask, now) → { ok, win, app, label } | { ok: false, why }   ask(winId, type, data) → Promise<reply | null> (null = no answer in time)
 */
const PER_WINDOW = 10;
const MAX_AGE = 30 * 60 * 1000;

export class Journal {
  constructor() { this.byWin = new Map(); this.seq = 0; }
  record(win, app, e, now = Date.now()) {
    if (!win || !e || typeof e !== 'object') return null;
    const list = this.byWin.get(win) || [];
    if (e.kind === 'undo') {   // an undo made in the window itself takes its newest entry out
      const i = list.map((x) => x.depth).lastIndexOf(e.depth + 1);
      if (i >= 0) list.splice(i, 1);
    } else if (e.kind === 'redo' || !e.kind || e.kind === 'do') {
      list.push({ id: ++this.seq, win, app: String(app || '').slice(0, 30), step: String(e.step ?? '').slice(0, 40), label: String(e.label || '').slice(0, 120), depth: Number(e.depth) || 0, at: now });
      if (list.length > PER_WINDOW) list.shift();
    }
    this.byWin.set(win, list);
    return list[list.length - 1] || null;
  }
  forget(win) { this.byWin.delete(win); }
  next(now = Date.now()) {
    let best = null;
    for (const list of this.byWin.values()) { const e = list[list.length - 1]; if (e && now - e.at <= MAX_AGE && (!best || e.id > best.id)) best = e; }
    return best;
  }
  drop(e) { const l = this.byWin.get(e.win); if (l) { const i = l.indexOf(e); if (i >= 0) l.splice(i, 1); } }
  async undo(ask, now = Date.now()) {
    for (let tries = 0; tries < 8; tries++) {
      const e = this.next(now);
      if (!e) return { ok: false, why: 'nothing' };
      const probe = await ask(e.win, 'undo.probe', { step: e.step });
      if (!probe) { this.forget(e.win); continue; }                                  // the window is gone or silent
      if (probe.depth !== e.depth || (e.step && probe.step !== e.step)) { this.drop(e); continue; }   // it moved on: never force
      const done = await ask(e.win, 'undo.run', { step: e.step });
      if (done && done.ok) { this.drop(e); return { ok: true, win: e.win, app: e.app, label: e.label }; }
      this.drop(e);
    }
    return { ok: false, why: 'moved' };
  }
}
