#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// test-assistant-scope.mjs — EG.41: an assistant in a Live session works on the sheet or area it was given, shows its
// cursor, and its calls are tagged for the activity log.   node test/test-assistant-scope.mjs
import path from 'node:path';
import { STUDIO, ok, section, done } from './lib.mjs';

const S = await import(path.join(STUDIO, 'hub/live/assistant-scope.js'));

// a stand-in for the person's adapter: ops carry { sp, x, y, w, h }
const adapter = {
  applied: [],
  apply(ops, origin) { this.applied.push({ ops, origin }); },
  where(ops) {
    const o = ops.filter((x) => x && typeof x.x === 'number');
    if (!o.length) return ops.some((x) => x.sp) ? { sheet: ops.find((x) => x.sp).sp } : null;
    return { sheet: o[0].sp, box: [Math.min(...o.map((p) => p.x)), Math.min(...o.map((p) => p.y)), Math.max(...o.map((p) => p.x + p.w)), Math.max(...o.map((p) => p.y + p.h))] };
  },
};
const mkClient = () => {
  const c = { sent: [], events: [], emit(t, d) { this.events.push([t, d]); }, localChange(step) { this.sent.push(step); return this.sent.length; } };
  return c;
};
const step = (ops, label = 'Line') => ({ label, ops, inverse: [{ undo: true }] });

section('A scope (EG.41)');
ok(S.makeScope(null) === null && S.makeScope({}) === null && S.makeScope({ label: 'x' }) === null, 'a scope with no sheet or area restricts nothing → null');
ok(S.makeScope({ sheet: '' }).sheet === '' && S.makeScope({ sheet: '', area: [0,0,1,1] }).area.length === 4, "an empty sheet name is a place (Model), not 'any'");
ok(S.makeScope({ sheet: 'A-101' }).sheet === 'A-101' && S.makeScope({ area: [10, 10, 0, 0] }).area.join() === '0,0,10,10', 'sheet; area corners put in order');
ok(S.makeScope({ area: [0, 0, NaN, 1] }) === null && S.makeScope({ area: [0, 0, 1] }) === null, 'a broken area is dropped');
ok(S.makeScope({ sheet: 's'.repeat(500) }).sheet.length === 200, 'long names are cut');
ok(S.describe(null).kind === 'none' && S.describe(S.makeScope({ sheet: 'a', area: [0, 0, 1, 1] })).kind === 'sheet+area', 'describe');
ok(S.scopeable(adapter) && !S.scopeable({}) && !S.scopeable(null), 'scopeable only with where()');

section('Where a step landed, and the verdict');
const sc = S.makeScope({ sheet: 'A-101', area: [0, 0, 100, 100] });
const L = (ops) => S.locate(adapter, ops);
ok(S.judge(sc, L([{ sp: 'A-101', x: 10, y: 10, w: 5, h: 5 }])) === null, 'inside the sheet and area → fine');
ok(S.judge(sc, L([{ sp: 'A-102', x: 10, y: 10, w: 5, h: 5 }])) === S.REASONS.sheet, 'another sheet → scope-sheet');
ok(S.judge(sc, L([{ sp: 'A-101', x: 90, y: 90, w: 20, h: 5 }])) === S.REASONS.area, 'sticks out of the area → scope-area');
ok(S.judge(sc, L([{ sp: 'A-101' }])) === S.REASONS.unknown, 'no extent under an area → scope-unknown (never slips through)');
ok(S.judge(sc, S.locate({}, [{ x: 1 }])) === S.REASONS.unknown, 'an adapter with no where() under a scope → unknown');
const model = S.makeScope({ sheet: '' });
ok(S.judge(model, { sheet: '' }) === null && S.judge(model, { sheet: 'A-101' }) === S.REASONS.sheet && S.judge(model, {}) === S.REASONS.unknown, 'the Model place: Model fine, a sheet refused, unknown refused');
ok(S.judge(null, {}) === null && S.judge(S.makeScope({ sheet: 'A' }), L([{ sp: 'A', x: 5000, y: 5000, w: 1, h: 1 }])) === null, 'no scope, or a sheet-only scope: the area does not matter');
const lo = L([{ sp: 'A-101', x: 0, y: 0, w: 10, h: 20 }]);
ok(lo.cur.join() === '5,10', 'the cursor defaults to the middle of the extent');
ok(S.locate({ where: () => { throw new Error('x'); } }, []).sheet === undefined, 'a throwing where() is treated as unknown');

section('The guard on the assistant\'s client');
{
  const a = mkClient(), person = { adapter: { ...adapter, applied: [] } };
  person.adapter.where = adapter.where;
  let scope = S.makeScope({ sheet: 'A-101' });
  const passed = [], refused = [];
  const off = S.guardAssistant(a, person, { getScope: () => scope, onStep: (s, l) => passed.push(l), onRefuse: (w) => refused.push(w) });
  ok(a.localChange(step([{ sp: 'A-101', x: 1, y: 1, w: 1, h: 1 }])) === 1 && a.sent.length === 1 && passed.length === 1, 'a step on the right sheet goes through and is reported');
  ok(a.localChange(step([{ sp: 'A-102', x: 1, y: 1, w: 1, h: 1 }])) === null && a.sent.length === 1, 'a step on another sheet is not sent');
  ok(person.adapter.applied.length === 1 && person.adapter.applied[0].origin === 'rollback' && person.adapter.applied[0].ops[0].undo, 'and it is rolled back on the person\'s model');
  ok(a.events.length === 1 && a.events[0][0] === 'refused' && a.events[0][1].reason === 'scope-sheet', "the client says 'refused' with the reason");
  ok(refused.join() === 'scope-sheet', 'onRefuse');
  scope = null;
  ok(a.localChange(step([{ sp: 'A-102', x: 1, y: 1, w: 1, h: 1 }])) === 2, 'clearing the scope takes effect at once');
  ok(a.localChange(step([{ sp: 'A-999' }]), 'undo') === 3, 'undo / redo are not judged');
  off(); scope = S.makeScope({ sheet: 'Z' });
  ok(a.localChange(step([{ sp: 'A-1' }])) === 4, 'off() puts the original back');
}

section('A discipline (EG.42 spike): what kinds of thing it may change');
{
  const ad = { where: (ops) => ({ sheet: 'L1', tags: ops.map((o) => o.tag) }) };
  const mep = S.makeScope({ tags: ['mep', 'electrical', 'mep'] });
  ok(mep.tags.join() === 'mep,electrical' && S.makeScope({ tags: [] }) === null && S.makeScope({ tags: [5, ''] }) === null, 'tags: de-duplicated; empty or junk → no scope');
  ok(S.judge(mep, S.locate(ad, [{ tag: 'mep' }, { tag: 'electrical' }])) === null, 'a step on its own kinds passes');
  ok(S.judge(mep, S.locate(ad, [{ tag: 'mep' }, { tag: 'structure' }])) === S.REASONS.tags, 'one structural element in the step → scope-tags (the whole step is taken back)');
  ok(S.judge(mep, S.locate(ad, [])) === S.REASONS.tags && S.judge(mep, S.locate({ where: () => ({ sheet: 'L1' }) }, [{}])) === S.REASONS.unknown, 'no kinds named → refused; an app that does not name kinds → unknown');
  ok(S.describe(mep).kind === 'tags', 'describe');
}

section('Presence and the log');
{
  const p = S.presenceFor({ loc: { sheet: 'A-101', cur: [3, 4], box: [0, 0, 6, 8] }, tool: 'command_run', name: 'Claude (Ana)', scope: null });
  ok(p.sp === 'A-101' && p.cur.join() === '3,4' && p.box.join() === '0,0,6,8' && p.cmd === 'command_run' && p.name === 'Claude (Ana)' && p.assistant.working, 'cursor, sheet, box and the tool in the app\'s own presence keys');
  ok(S.presenceFor({ loc: { box: [0, 0, 1, 1] }, tool: 't', scope: S.makeScope({ area: [0, 0, 50, 50] }) }).box.join() === '0,0,50,50', 'with an area, the box shown is the area it was given');
  const q = S.presenceFor({ loc: { sheet: 'L1', cur: [1, 2] }, tool: 'x', keys: { sheet: 'storey', cur: 'pt', cmd: 'doing' } });
  ok(q.storey === 'L1' && q.pt.join() === '1,2' && q.doing === 'x' && q.sp === undefined, 'an app with other presence keys');
  const f = S.liveLogFields({ session: 'ab12', as: 'Claude (Ana)', scope: sc, loc: { sheet: 'A-101' } });
  ok(f.session === 'ab12' && f.as === 'Claude (Ana)' && f.sheet === 'A-101' && f.area.length === 4 && f.at === 'A-101' && f.role === 'assistant', 'log fields: session, name, scope, where it worked');
  const e = { tool: 'command_run' }; S.tagEntry(e, f);
  ok(e.live === f && S.tagEntry(null, f) === null, 'tagEntry marks the control log entry in place');
}
done();
