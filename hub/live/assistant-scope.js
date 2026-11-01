// SPDX-License-Identifier: Apache-2.0
/**
 * assistant-scope.js — EG.41 (0.8 round 2, studio_PART_2): an assistant in a Live session works on the sheet or the area
 * it was given, shows where it is working, and every change it makes is named in the activity log. DOM-free; the window
 * (window-live.js) wires it, studio/test/test-assistant-scope.mjs drives it in Node.
 *
 * What an app supplies (all optional, on its live adapter; without them the assistant still joins, and its scope is
 * advisory — the people list says so — because the window can't tell where a step landed):
 *   adapter.where(ops) → { sheet?: string, box?: [x0, y0, x1, y1], cur?: [x, y] } | null
 *       sheet = the sheet / space / storey the ops are on (the same word the adapter's presence uses), box = the extent of
 *       what the ops touch (model units), cur = a point to show as the assistant's cursor (default: the middle of box).
 *
 * A scope is { label, sheet, area } — each part optional (sheet null / area null = any; sheet '' is the app's no-sheet place,
 * CadCraft's Model), an empty scope allows everything. A step that lands outside the
 * scope is taken back on the assistant's client (LiveClient 'refused', reason 'scope') like any refused edit; the person's
 * own steps are never judged. A step whose place is unknown (the adapter has no `where`, or returned null) under a scope
 * that names a sheet or an area is refused too, with reason 'scope-unknown': an unclear edit never slips through.
 */

export const REASONS = Object.freeze({ sheet: 'scope-sheet', area: 'scope-area', unknown: 'scope-unknown', tags: 'scope-tags' });

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const box4 = (b) => Array.isArray(b) && b.length === 4 && b.every(num) ? [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])] : null;

/** A cleaned scope, or null when it restricts nothing. */
export function makeScope(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const sheet = typeof raw.sheet === 'string' ? raw.sheet.slice(0, 200) : null;   // '' is a place too (CadCraft's Model); null = any
  const area = box4(raw.area);
  // EG.42 spike: a discipline = the kinds of thing it may change (the adapter's `where` names them in `tags`: 'mep', 'structure', …)
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.filter((x) => typeof x === 'string' && x && x.length <= 40).slice(0, 8))] : [];
  if (sheet === null && !area && !tags.length) return null;
  const label = typeof raw.label === 'string' ? raw.label.slice(0, 100) : '';
  return { label, sheet, area, tags };
}

/** Where a step landed, from the adapter's `where`; always an object (empty when the app can't say). */
export function locate(adapter, ops) {
  let w = null;
  try { w = adapter && typeof adapter.where === 'function' ? adapter.where(ops) : null; } catch { w = null; }
  if (!w || typeof w !== 'object') return {};
  const box = box4(w.box);
  let cur = Array.isArray(w.cur) && w.cur.length === 2 && w.cur.every(num) ? [w.cur[0], w.cur[1]] : null;
  if (!cur && box) cur = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const tags = Array.isArray(w.tags) ? w.tags.filter((x) => typeof x === 'string') : undefined;
  return { sheet: typeof w.sheet === 'string' ? w.sheet : undefined, box, cur, tags };
}

/** Can this adapter tell where a step landed? (the window shows "Give it a sheet or area" only then) */
export const scopeable = (adapter) => !!adapter && typeof adapter.where === 'function';

const inside = (inner, outer) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

/** null = fine; else one of REASONS. */
export function judge(scope, loc) {
  if (!scope) return null;
  if (scope.sheet !== null) {
    if (!loc || loc.sheet === undefined) return REASONS.unknown;
    if (loc.sheet !== scope.sheet) return REASONS.sheet;
  }
  if (scope.area) {
    if (!loc || !loc.box) return REASONS.unknown;
    if (!inside(loc.box, scope.area)) return REASONS.area;
  }
  if (scope.tags && scope.tags.length) {
    if (!loc || !loc.tags) return REASONS.unknown;
    if (!loc.tags.length || loc.tags.some((x) => !scope.tags.includes(x))) return REASONS.tags;
  }
  return null;
}

/** The words for a scope in the people list: the sheet, the area's size, or the person's own label. */
export function describe(scope) {
  if (!scope) return { kind: 'none' };
  const kinds = [];
  if (scope.sheet !== null) kinds.push('sheet');
  if (scope.area) kinds.push('area');
  if (scope.tags && scope.tags.length) kinds.push('tags');
  return { kind: kinds.join('+'), label: scope.label, sheet: scope.sheet, area: scope.area };
}

/**
 * The assistant's presence: its cursor where it last worked and what it is doing. `base` is the person's own presence shape
 * for the app (the adapter's `presence()` keys are the app's: `sp`, `cur`, `box`, `cmd` for CadCraft); only the keys the app
 * already uses are filled, so the app's drawPresence draws it like anyone's cursor.
 */
export function presenceFor({ loc, tool, name, scope, keys = {} }) {
  const k = { sheet: 'sp', cur: 'cur', box: 'box', cmd: 'cmd', ...keys };
  const p = { assistant: { n: 1, working: true } };
  if (loc && loc.sheet !== undefined) p[k.sheet] = loc.sheet;
  if (loc && loc.cur) p[k.cur] = loc.cur;
  if (scope && scope.area) p[k.box] = scope.area;
  else if (loc && loc.box) p[k.box] = loc.box;
  p[k.cmd] = String(tool || '').slice(0, 60);
  if (name) p.name = String(name).slice(0, 80);
  return p;
}

/**
 * Judge every step an assistant's client takes. `a` is the assistant's LiveClient (host.live.assistant); `person` its person's
 * client, whose adapter knows the app. Wraps a.localChange once. `getScope()` is read per step, so changing the scope takes
 * effect at once. `onStep(step, loc)` runs for steps that passed (the window moves the assistant's cursor there);
 * `onRefuse(reason, step, loc)` for the others. Returns an undo for the wrapper.
 */
export function guardAssistant(a, person, { getScope, onStep = null, onRefuse = null } = {}) {
  const orig = a.localChange.bind(a);
  a.localChange = (step, kind = 'do', of = null) => {
    if (kind !== 'do' || !step || !step.ops) return orig(step, kind, of);
    const loc = locate(person && person.adapter, step.ops);
    const why = judge(getScope ? getScope() : null, loc);
    if (why) {
      const model = person.adapter;
      try { model.apply(step.inverse, 'rollback'); } catch { /* the model is the person's: nothing more to do here */ }
      a.emit('refused', { n: 0, label: step.label, kind, reason: why });
      if (onRefuse) { try { onRefuse(why, step, loc); } catch { /* a listener */ } }
      return null;
    }
    const n = orig(step, kind, of);
    if (onStep) { try { onStep(step, loc); } catch { /* a listener */ } }
    return n;
  };
  return () => { a.localChange = orig; };
}

/**
 * The activity-log entry for a call made while Live was on: what the log (AI-CONNECT-SPEC § 4.2; AC.13) keeps in `live`.
 * `session` is the Live session id, `as` the name the others see, `where` the sheet / area it was given.
 */
export function liveLogFields({ session, as, scope, loc, role }) {
  const out = { session: String(session || '').slice(0, 64), as: String(as || '').slice(0, 80), role: role || 'assistant' };
  if (scope && scope.sheet !== null) out.sheet = scope.sheet;
  if (scope && scope.area) out.area = scope.area;
  if (loc && loc.sheet !== undefined) out.at = loc.sheet;
  return out;
}

/** Tag a control-channel log entry in place with liveLogFields (the entry object is the one host.control.log holds). */
export function tagEntry(entry, fields) {
  if (!entry || typeof entry !== 'object') return entry;
  entry.live = fields;
  return entry;
}
