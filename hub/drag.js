/* SPDX-License-Identifier: Apache-2.0 */
/* i18n-ignore-file — protocol and state only; window-drag.js words the shelf. */
/**
 * drag.js — drag something from one app to another (0.8 EG.78, studio_PART_2). DOM-free; test/test-drag.mjs drives it.
 *
 * A source app (PartCraft: a part) OFFERS what it is dragging in one or more forms — `item` (a library item, format 1, JSON:
 * BimCraft places and schedules it), `mesh` (an OBJ: ModelCraft places it as a group) — and each form is a file in the shared
 * hand-off store (handoff.js, same IndexedDB the apps' own hand-off uses, nothing uploaded). The offer travels on the window
 * channel (channel.js, type `drag.offer`) and, where the platform allows it, in the drag's dataTransfer (MIME below) so a drop
 * on another window needs nothing else. A target app ACCEPTS kinds in its own order of preference; the first form of the offer
 * that it accepts is taken (read and deleted from the store) and handed to its handler with where it was dropped.
 *
 * Where HTML5 drag-and-drop between two windows does not work (the desktop shell's separate web views are not proven to carry it),
 * the same offer sits on a SHELF in every other window for OFFER_TTL, and one click ("Place it here", then a click on the
 * drawing) takes it: same offer, same handlers.
 *
 *   cleanOffer(raw) → offer | null              the checked form of an offer from the channel or a drag
 *   chooseKind(offer, accepts) → { kind, id, … } | null   the first of accepts (preference order) the offer has
 *   class Shelf     add(offer, now), get(id, now), remove(id), live(now), forAccepts(accepts, now), prune(now)
 */

export const MIME = 'application/x-cadcraft-drag';
export const OFFER_TTL = 10 * 60 * 1000;
export const KINDS = ['item', 'mesh'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OFFER_ID = /^[a-z0-9-]{4,60}$/;
const APP = /^[a-z][a-z0-9-]{0,30}$/;

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

/** An offer from outside (a channel message, a dataTransfer): checked, or null. Names are text, never markup. */
export function cleanOffer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && OFFER_ID.test(raw.id) ? raw.id : null;
  const from = typeof raw.from === 'string' && APP.test(raw.from) ? raw.from : null;
  if (!id || !from || !Array.isArray(raw.kinds)) return null;
  const seen = new Set(), kinds = [];
  for (const k of raw.kinds.slice(0, 8)) {
    if (!k || typeof k !== 'object' || !KINDS.includes(k.kind) || seen.has(k.kind)) continue;
    const rid = typeof k.id === 'string' && UUID.test(k.id.toLowerCase()) ? k.id.toLowerCase() : null;
    if (!rid) continue;
    seen.add(k.kind);
    const bytes = Number.isFinite(k.bytes) && k.bytes >= 0 ? Math.floor(k.bytes) : 0;
    kinds.push({ kind: k.kind, id: rid, fileName: text(k.fileName, 120), bytes });
  }
  if (!kinds.length) return null;
  const meta = raw.meta && typeof raw.meta === 'object' ? sanitizeMeta(raw.meta) : {};
  return { id, from, name: text(raw.name, 120) || from, kinds, meta, at: Number.isFinite(raw.at) ? raw.at : 0 };
}

// meta = a few plain facts the source wants the target to show or use (a part number, a unit): strings/numbers/booleans only.
function sanitizeMeta(m) {
  const out = {};
  for (const [k, v] of Object.entries(m).slice(0, 12)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = text(v, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** The first of `accepts` (the target's own order of preference) that the offer carries. */
export function chooseKind(offer, accepts) {
  if (!offer || !Array.isArray(offer.kinds) || !Array.isArray(accepts)) return null;
  for (const a of accepts) { const k = offer.kinds.find((x) => x.kind === a); if (k) return k; }
  return null;
}

/** What the offers are, for the dataTransfer: small, and never the files. */
export function offerJson(offer) { return JSON.stringify({ id: offer.id, from: offer.from, name: offer.name, kinds: offer.kinds, meta: offer.meta, at: offer.at }); }

/** The offers a window has heard of (its own included). They expire after OFFER_TTL or when the source says `drag.end`. */
export class Shelf {
  constructor() { this.m = new Map(); }
  add(offer, now = Date.now()) { const o = cleanOffer(offer); if (!o) return null; o.heard = now; this.m.set(o.id, o); this.prune(now); return o; }
  get(id, now = Date.now()) { const o = this.m.get(id); if (!o) return null; if (now - o.heard > OFFER_TTL) { this.m.delete(id); return null; } return o; }
  remove(id) { return this.m.delete(id); }
  prune(now = Date.now()) { for (const [k, o] of this.m) if (now - o.heard > OFFER_TTL) this.m.delete(k); }
  live(now = Date.now()) { this.prune(now); return [...this.m.values()].sort((a, b) => b.heard - a.heard); }
  /** Newest first, only those with a form this window accepts, and never this window's own. */
  forAccepts(accepts, now = Date.now(), ownApp = '') { return this.live(now).filter((o) => o.from !== ownApp && chooseKind(o, accepts)); }
}

/** A drop point from a pointer event's client coordinates and the target element's rectangle: 0..1 across and down. */
export function dropPoint(clientX, clientY, rect) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0) || ![clientX, clientY].every(Number.isFinite)) return null;
  const u = (clientX - rect.left) / rect.width, v = (clientY - rect.top) / rect.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, clientX, clientY };
}
