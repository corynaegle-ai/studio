/* SPDX-License-Identifier: Apache-2.0 */
/**
 * window-drag.js — drag between apps in an app window (0.8 EG.78; protocol and rules in drag.js). window.js makes one per
 * window and gives it to app code as `window.cadcraftStudio.drag`:
 *
 *   drag.start(event, { name, files: [{ kind: 'item', file }, { kind: 'mesh', file }], meta })   inside a `dragstart` handler:
 *       sets the drag's data now, writes the files to the hand-off store, tells the other windows (`drag.offer`); `dragend`
 *       with no drop leaves the offer on the other windows' shelves for ten minutes ("Place it here")
 *   drag.offer({ name, files, meta })                  the same without a drag (a "Send to…" button): shelf only
 *   drag.accept({ item: handler, mesh: handler })      what this app takes, in its order of preference; the handler gets
 *       { file, kind, from, name, meta, point: { u, v, clientX, clientY } | null, offer } and returns undefined or a short
 *       status line; it may throw (the shelf says why). `point` is null when the offer was placed from the shelf's button.
 *   drag.pending()                                     offers this window could take now (newest first)
 *
 * The shelf: a small chip at the bottom of the window while another app's offer is live and this app accepts one of its forms:
 * "<name> from <App>", [Place it here] (then a click on the drawing) and [Not now]. It is a plain element with
 * data-studio-drag-shelf; nothing is drawn while there is no offer, and nothing at all unless the app called accept().
 */
import { MIME, Shelf, cleanOffer, chooseKind, offerJson, dropPoint } from './drag.js';
import { putHandoff, takeHandoff, dropHandoff, newHandoffId } from './handoff.js';

const NAMES = { cadcraft: 'CadCraft', bimcraft: 'BimCraft', modelcraft: 'ModelCraft', markupcraft: 'MarkupCraft', takeoffcraft: 'TakeoffCraft', civilcraft: 'CivilCraft', detailcraft: 'SteleFab', partcraft: 'PartCraft' };
const appName = (slug) => NAMES[slug] || slug;

export function createDrag({ doc = document, win = window, channel, app, T = (k) => k, fill = (s) => s }) {
  const shelf = new Shelf();
  const own = new Map();            // offer id → { offer, ids[] } this window made
  let accepts = null;               // { kind: handler } (insertion order = preference)
  let el = null, armed = null;      // the shelf element; the offer waiting for a click on the drawing
  const word = (k, v) => fill(T(k), v);

  function make({ name, files, meta }) {
    const list = (files || []).filter((f) => f && f.file && ['item', 'mesh'].includes(f.kind));
    const ids = list.map(() => newHandoffId());
    const offer = cleanOffer({ id: 'd-' + newHandoffId().slice(0, 12), from: app, name, meta: meta || {}, at: Date.now(),
      kinds: list.map((f, i) => ({ kind: f.kind, id: ids[i], fileName: f.file.name || '', bytes: f.file.size || 0 })) });
    if (!offer) return null;
    const written = Promise.all(list.map((f, i) => putHandoff(ids[i], f.file, app))).catch(() => {});
    own.set(offer.id, { offer, ids, written });
    shelf.add(offer);
    channel.post('drag.offer', offer);
    return offer;
  }

  async function discard(id) {   // an offer nobody took
    const o = own.get(id); if (!o) return;
    own.delete(id);
    await o.written;
    for (const rid of o.ids) { try { await dropHandoff(rid); } catch { /* gone */ } }
  }

  async function takeInto(offer, point) {
    if (!accepts) return;
    const k = chooseKind(offer, Object.keys(accepts));
    if (!k) return;
    try {
      const got = await takeHandoff(k.id, undefined, { waitMs: 4000 });
      if (!got) throw new Error(word('window.drag.gone'));
      const status = await accepts[k.kind]({ file: got.file, kind: k.kind, from: offer.from, name: offer.name, meta: offer.meta, point, offer });
      shelf.remove(offer.id);
      channel.post('drag.taken', { id: offer.id });
      say(typeof status === 'string' && status ? status : word('window.drag.placed', { what: offer.name }), false);
    } catch (e) {
      say(word('window.drag.failed', { what: offer.name, why: (e && e.message) || '' }), true);
    }
    paint();
  }

  // ---- the shelf
  let note = null;
  function say(text, bad) { note = { text, bad: !!bad }; paint(); win.setTimeout(() => { if (note && note.text === text) { note = null; paint(); } }, 6000); }
  function paint() {
    const list = accepts ? shelf.forAccepts(Object.keys(accepts), Date.now(), app) : [];
    if (!list.length && !note && !armed) { if (el) { el.remove(); el = null; } return; }
    if (!el) {
      el = doc.createElement('div');
      el.setAttribute('data-studio-drag-shelf', '');
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:2147483000;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;max-width:min(40rem,calc(100vw - 2rem));padding:.5rem .75rem;background:var(--sheet,#fff);color:var(--ink,#111);border:1px solid var(--ink,#111);font:inherit;font-size:.9rem';
      doc.body.appendChild(el);
    }
    el.replaceChildren();
    const add = (tag, text, props = {}) => { const n = doc.createElement(tag); n.textContent = text; for (const [k, v] of Object.entries(props)) n.setAttribute(k, v); el.appendChild(n); return n; };
    if (armed) { add('span', word('window.drag.click')); const b = add('button', word('window.drag.dismiss'), { type: 'button', 'data-studio-drag-cancel': '' }); b.onclick = () => { armed = null; paint(); }; return; }
    if (note && !list.length) { add('span', note.text, note.bad ? { 'data-studio-drag-error': '' } : {}); return; }
    const o = list[0];
    add('span', word('window.drag.offer', { what: o.name, app: appName(o.from) }));
    const place = add('button', word('window.drag.place'), { type: 'button', 'data-studio-drag-place': o.id }); place.onclick = () => { armed = o; paint(); };
    const no = add('button', word('window.drag.dismiss'), { type: 'button', 'data-studio-drag-dismiss': o.id }); no.onclick = () => { shelf.remove(o.id); paint(); };
    if (note) add('span', note.text, note.bad ? { 'data-studio-drag-error': '' } : {});
  }

  // ---- channel
  channel.on('drag.offer', (d, env) => { if (env.from === channel.id) return; if (shelf.add(d)) paint(); });
  channel.on('drag.taken', (d) => { if (d && typeof d.id === 'string') { shelf.remove(d.id); discard(d.id); paint(); } });   // the other forms of an offer nobody will take now
  channel.on('drag.end', (d) => { if (d && typeof d.id === 'string') { shelf.remove(d.id); paint(); } });

  // ---- dropping (HTML5): where the platform carries a drag between windows
  const hasOurs = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes(MIME));
  doc.addEventListener('dragover', (e) => { if (accepts && hasOurs(e)) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch { /* read-only */ } } }, true);
  doc.addEventListener('drop', (e) => {
    if (!accepts || !hasOurs(e)) return;
    e.preventDefault();
    let offer = null;
    try { offer = cleanOffer(JSON.parse(e.dataTransfer.getData(MIME))); } catch { offer = null; }
    if (!offer || offer.from === app) return;
    const main = doc.querySelector('main') || doc.body;
    takeInto(offer, dropPoint(e.clientX, e.clientY, main.getBoundingClientRect()));
  }, true);

  // ---- the shelf's second step: a click on the drawing
  doc.addEventListener('click', (e) => {
    if (!armed || (el && el.contains(e.target))) return;
    e.preventDefault(); e.stopPropagation();
    const o = armed; armed = null;
    const main = doc.querySelector('main') || doc.body;
    takeInto(o, dropPoint(e.clientX, e.clientY, main.getBoundingClientRect()));
  }, true);
  win.setInterval(() => { if (el || shelf.m.size) paint(); }, 30000);

  return Object.freeze({
    accept(handlers) {
      const h = {}; for (const k of ['item', 'mesh']) if (handlers && typeof handlers[k] === 'function') h[k] = handlers[k];
      accepts = Object.keys(h).length ? h : null; paint();
      return () => { accepts = null; paint(); };
    },
    start(event, spec) {
      const offer = make(spec);
      if (!offer || !event || !event.dataTransfer) return null;
      try {
        event.dataTransfer.setData(MIME, offerJson(offer));
        event.dataTransfer.setData('text/plain', offer.name);
        event.dataTransfer.effectAllowed = 'copy';
      } catch { /* the browser refused: the shelf still has it */ }
      return offer.id;
    },
    offer(spec) { const o = make(spec); return o ? o.id : null; },
    end(id) { channel.post('drag.end', { id }); shelf.remove(id); return discard(id); },
    pending() { return accepts ? shelf.forAccepts(Object.keys(accepts), Date.now(), app) : []; },
  });
}
