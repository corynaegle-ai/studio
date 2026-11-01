#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// test-undo-journal.mjs — EG.77 spike: the routed "undo the last thing, wherever it was".   node test/test-undo-journal.mjs
import path from 'node:path';
import { STUDIO, ok, section, done } from './lib.mjs';
const { Journal } = await import(path.join(STUDIO, 'hub/undo-journal.js'));

// fake windows with real undo stacks
function win(id, app) {
  const stack = []; let n = 0;
  return { id, app, stack, edit(label) { stack.push({ step: id + ':' + (++n), label }); const t = stack[stack.length - 1]; return { step: t.step, label, depth: stack.length, kind: 'do' }; },
    undoByHand() { const t = stack.pop(); return { step: t.step, label: t.label, depth: stack.length, kind: 'undo' }; },
    answer(type) { const top = stack[stack.length - 1]; if (type === 'undo.probe') return top ? { depth: stack.length, step: top.step, label: top.label } : { depth: 0, step: null }; stack.pop(); return { ok: true, depth: stack.length }; } };
}
const world = (...ws) => { const m = new Map(ws.map((w) => [w.id, w])); return async (id, type) => (m.has(id) ? m.get(id).answer(type) : null); };

section('The journal across windows (EG.77 spike)');
{
  const cad = win('cadcraft-1', 'cadcraft'), bim = win('bimcraft-1', 'bimcraft'), j = new Journal();
  const rec = (w, e, t) => j.record(w.id, w.app, e, t);
  rec(cad, cad.edit('Line'), 1000); rec(bim, bim.edit('Place pump'), 2000); rec(cad, cad.edit('Move'), 3000);
  ok(j.next(3000).label === 'Move', 'the newest step wherever it was');
  const ask = world(cad, bim);
  let r = await j.undo(ask, 3000);
  ok(r.ok && r.app === 'cadcraft' && r.label === 'Move' && cad.stack.length === 1, 'undo goes to CadCraft and takes its top step');
  r = await j.undo(ask, 3000);
  ok(r.ok && r.app === 'bimcraft' && bim.stack.length === 0, 'the next one is BimCraft\'s step: undo hops between apps in the order the person worked');
  r = await j.undo(ask, 3000);
  ok(r.ok && r.app === 'cadcraft' && cad.stack.length === 0, 'and back to CadCraft\'s first');
  ok((await j.undo(ask, 3000)).why === 'nothing', 'then nothing');
}
section('Never forced');
{
  const cad = win('cadcraft-1', 'cadcraft'), bim = win('bimcraft-1', 'bimcraft'), j = new Journal();
  j.record(cad.id, 'cadcraft', cad.edit('Line'), 1000);
  j.record(bim.id, 'bimcraft', bim.edit('Wall'), 2000);
  bim.edit('Door');   // the person edited in BimCraft and the window did not tell the channel (a missed message)
  const r = await j.undo(world(cad, bim), 3000);
  ok(r.ok && r.app === 'cadcraft' && bim.stack.length === 2, 'a window whose stack moved on is skipped, not undone: the older entry in the other window is used');
  const j2 = new Journal(); const w = win('partcraft-1', 'partcraft');
  j2.record(w.id, 'partcraft', w.edit('Extrude'), 1000);
  const sr = await j2.undo(async () => null, 1000);
  ok(!sr.ok && sr.why === 'nothing', 'a silent window: nothing is undone');
  ok(j2.next(1000) === null, 'a window that does not answer is forgotten');
  const j3 = new Journal(), w3 = win('modelcraft-1', 'modelcraft');
  j3.record(w3.id, 'modelcraft', w3.edit('Box'), 1000);
  ok(j3.next(1000 + 31 * 60 * 1000) === null, 'entries older than 30 minutes are not offered');
  const e = w3.undoByHand(); j3.record(w3.id, 'modelcraft', e, 1500);
  ok(j3.next(1500) === null, 'an undo made in the window takes its entry out');
  const j4 = new Journal(), w4 = win('cadcraft-9', 'cadcraft');
  for (let i = 0; i < 25; i++) j4.record(w4.id, 'cadcraft', w4.edit('s' + i), 1000 + i);
  ok(j4.byWin.get(w4.id).length === 10, 'ten entries per window');
}
done();
