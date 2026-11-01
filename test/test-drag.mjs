#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// test-drag.mjs — EG.78: drag between apps. The offer protocol (drag.js), the hand-off store's take/drop (handoff.js, against a
// small in-memory IndexedDB), and a source window and a target window talking over a fake channel (window-drag.js, against a
// small fake DOM).   node test/test-drag.mjs
import path from 'node:path';
import { STUDIO, ok, section, done } from './lib.mjs';

const D = await import(path.join(STUDIO, 'hub/drag.js'));
const H = await import(path.join(STUDIO, 'hub/handoff.js'));
const W = await import(path.join(STUDIO, 'hub/window-drag.js'));
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';

section('The offer (EG.78)');
{
  const good = { id: 'd-abc123', from: 'partcraft', name: ' Pump P-101 ', kinds: [{ kind: 'item', id: U1, fileName: 'pump.ccitem.json', bytes: 1200 }, { kind: 'mesh', id: U2, fileName: 'pump.obj', bytes: 9000 }], meta: { partNumber: 'P-101', n: 3, deep: { x: 1 }, 'bad key': 1 }, at: 5 };
  const o = D.cleanOffer(good);
  ok(o && o.name === 'Pump P-101' && o.kinds.length === 2 && o.meta.partNumber === 'P-101' && o.meta.n === 3 && !('deep' in o.meta) && !('bad key' in o.meta), 'a good offer; name trimmed; meta keeps plain facts only');
  ok(D.cleanOffer(null) === null && D.cleanOffer({}) === null && D.cleanOffer({ ...good, kinds: [] }) === null, 'junk → null');
  ok(D.cleanOffer({ ...good, id: 'x' }) === null && D.cleanOffer({ ...good, from: 'Part Craft' }) === null, 'bad id or app → null');
  ok(D.cleanOffer({ ...good, kinds: [{ kind: 'exe', id: U1 }, { kind: 'item', id: 'not-a-uuid' }] }) === null, 'unknown kind or non-uuid record id dropped');
  ok(D.cleanOffer({ ...good, kinds: [good.kinds[0], good.kinds[0]] }).kinds.length === 1, 'a kind listed twice counts once');
  ok(D.cleanOffer({ ...good, name: '<img src=x onerror=alert(1)>\u0007' }).name === '<img src=x onerror=alert(1)>', 'control characters out; markup stays text (the shelf uses textContent)');
  ok(D.chooseKind(o, ['mesh', 'item']).kind === 'mesh' && D.chooseKind(o, ['item', 'mesh']).kind === 'item' && D.chooseKind(o, ['dxf']) === null, 'the target\'s order of preference decides');
  ok(JSON.parse(D.offerJson(o)).kinds[0].id === U1 && !D.offerJson(o).includes('file":'), 'offerJson carries ids, never files');
  const s = new D.Shelf();
  ok(s.add(o, 1000) && s.live(1000).length === 1 && s.add({ nope: 1 }) === null, 'shelf adds checked offers only');
  ok(s.forAccepts(['item'], 1000, 'bimcraft').length === 1 && s.forAccepts(['item'], 1000, 'partcraft').length === 0 && s.forAccepts(['dxf'], 1000, 'x').length === 0, 'forAccepts: only forms this app takes, never its own');
  ok(s.live(1000 + D.OFFER_TTL + 1).length === 0, 'an offer expires after ten minutes');
  const p = D.dropPoint(150, 250, { left: 100, top: 200, width: 200, height: 100 });
  ok(p.u === 0.25 && p.v === 0.5 && D.dropPoint(10, 10, { left: 100, top: 200, width: 200, height: 100 }) === null && D.dropPoint(1, 1, null) === null, 'dropPoint is 0..1 across the drawing area, null outside');
}

// ---- a small in-memory IndexedDB (open / createObjectStore / transaction / put get delete openCursor)
function fakeIdb() {
  const dbs = new Map();
  const req = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }); return r; };
  return {
    open(name) {
      const r = {};
      queueMicrotask(() => {
        let d = dbs.get(name);
        if (!d) { d = { stores: new Map() }; dbs.set(name, d); r.result = dbDouble(d); r.onupgradeneeded && r.onupgradeneeded(); }
        r.result = dbDouble(d); r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
  function dbDouble(d) {
    return {
      createObjectStore(n) { d.stores.set(n, new Map()); return {}; },
      close() {},
      transaction(n) {
        const m = d.stores.get(n), t = {};
        let pending = 0;
        const done = () => { if (!pending) queueMicrotask(() => t.oncomplete && t.oncomplete()); };
        const wrap = (fn) => { pending++; const r = {}; queueMicrotask(() => { r.result = fn(); r.onsuccess && r.onsuccess(); pending--; queueMicrotask(done); }); return r; };
        t.objectStore = () => ({
          put: (v, k) => wrap(() => { m.set(k, v); }),
          get: (k) => wrap(() => m.get(k)),
          delete: (k) => wrap(() => { m.delete(k); }),
          openCursor: () => wrap(() => null),
        });
        queueMicrotask(() => queueMicrotask(done));
        return t;
      },
    };
  }
}

section('The hand-off store: take and drop');
{
  const idb = fakeIdb();
  const f = { name: 'pump.ccitem.json', size: 3 };
  await H.putHandoff(U1, f, 'partcraft', idb);
  const got = await H.takeHandoff(U1, idb);
  ok(got && got.file === f && got.from === 'partcraft', 'take returns the file and who sent it');
  ok(await H.takeHandoff(U1, idb) === null, 'and it is gone after one take');
  ok(await H.takeHandoff('nope', idb) === null && await H.takeHandoff(undefined, idb) === null, 'a bad id → null');
  await H.putHandoff(U2, f, 'partcraft', idb); await H.dropHandoff(U2, idb);
  ok(await H.takeHandoff(U2, idb) === null, 'drop removes an untaken record');
  setTimeout(() => H.putHandoff(U1, f, 'partcraft', idb), 150);
  ok((await H.takeHandoff(U1, idb, { waitMs: 1500 })) !== null, 'take can wait for the source to finish writing');
}

// ---- two windows over one fake channel and one fake store
const bus = [];
function fakeChannel(id) {
  const fns = new Map();
  const ch = { id, post(type, data) { for (const o of bus) if (o !== ch) o._deliver(type, data, { from: id, type }); }, on(type, fn) { if (!fns.has(type)) fns.set(type, []); fns.get(type).push(fn); return () => {}; }, _deliver(type, data, env) { for (const fn of fns.get(type) || []) fn(data, env); } };
  bus.push(ch); return ch;
}
function fakeDom() {
  const mk = (tag) => ({ tag, children: [], attrs: {}, style: {}, text: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parent = this; return c; }, replaceChildren() { this.children = []; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }, contains(t) { return t === this || this.children.some((c) => c.contains && c.contains(t)); }, set textContent(v) { this.text = v; }, get textContent() { return this.text; } });
  const listeners = {};
  const body = mk('body'), main = mk('main'); main.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 });
  return { body, main, createElement: mk, querySelector: (s) => (s === 'main' ? main : null), addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, fire: (t, e) => (listeners[t] || []).forEach((fn) => fn(e)), all() { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; walk(body); return out; } };
}
const win = { setTimeout: (fn) => 0, setInterval: () => 0, clearTimeout() {} };
const words = { 'window.drag.offer': '{what} from {app}', 'window.drag.place': 'Place it here', 'window.drag.dismiss': 'Not now', 'window.drag.click': 'Click where it goes.', 'window.drag.placed': '{what} placed.', 'window.drag.failed': 'Could not place {what}: {why}', 'window.drag.gone': 'Gone.' };
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? m : v[k]));
// the window code reads the store through handoff.js, which uses globalThis.indexedDB
globalThis.indexedDB = fakeIdb();

section('A part dragged from PartCraft to BimCraft (EG.78)');
{
  const dA = fakeDom(), dB = fakeDom();
  const A = W.createDrag({ doc: dA, win, channel: fakeChannel('partcraft-1'), app: 'partcraft', T: (k) => words[k], fill });
  const B = W.createDrag({ doc: dB, win, channel: fakeChannel('bimcraft-1'), app: 'bimcraft', T: (k) => words[k], fill });
  const itemFile = { name: 'pump.ccitem.json', size: 100 }, meshFile = { name: 'pump.obj', size: 900 };
  const got = [];
  B.accept({ item: async (x) => { got.push(x); return 'Pump placed as item 7.'; }, mesh: async () => 'mesh' });
  ok(B.pending().length === 0 && !dB.all().some((n) => n.attrs['data-studio-drag-shelf'] !== undefined), 'nothing on the shelf before an offer');
  const dt = { data: {}, types: [], setData(k, v) { this.data[k] = v; this.types.push(k); }, getData(k) { return this.data[k]; } };
  const id = A.start({ dataTransfer: dt }, { name: 'Pump P-101', files: [{ kind: 'mesh', file: meshFile }, { kind: 'item', file: itemFile }], meta: { partNumber: 'P-101' } });
  ok(id && dt.types.includes(D.MIME) && dt.data['text/plain'] === 'Pump P-101', 'start sets the drag\'s data');
  ok(B.pending().length === 1 && B.pending()[0].from === 'partcraft', 'BimCraft\'s shelf hears the offer over the channel');
  const shelfEl = dB.all().find((n) => n.attrs['data-studio-drag-shelf'] !== undefined);
  ok(shelfEl && shelfEl.children.some((c) => c.text === 'Pump P-101 from PartCraft') && shelfEl.children.some((c) => c.text === 'Place it here'), 'the shelf says what and from where');
  ok(A.pending().length === 0, 'the source\'s own window shows nothing');
  // the HTML5 drop on BimCraft's drawing
  let prevented = 0;
  dB.fire('dragover', { dataTransfer: dt, preventDefault() { prevented++; } });
  ok(prevented === 1, 'dragover with our data is allowed');
  dB.fire('drop', { dataTransfer: dt, clientX: 250, clientY: 125, preventDefault() { prevented++; } });
  await new Promise((r) => setTimeout(r, 50));
  ok(got.length === 1 && got[0].kind === 'item' && got[0].file === itemFile && got[0].name === 'Pump P-101' && got[0].meta.partNumber === 'P-101' && got[0].point.u === 0.25 && got[0].point.v === 0.25, 'the drop reaches the app\'s item handler with the file, meta and where (0..1)');
  ok(B.pending().length === 0, 'the offer leaves the shelf once taken');
  ok(dB.all().some((n) => n.text === 'Pump placed as item 7.'), 'the app\'s status line is shown');
  await new Promise((r) => setTimeout(r, 30));
  ok((await Promise.all(JSON.parse(dt.data[D.MIME]).kinds.map((k) => H.takeHandoff(k.id)))).every((x) => x === null), 'the taken file, and the form nobody took, are out of the store');
}

section('The shelf\'s button (where the drag does not carry)');
{
  const dA = fakeDom(), dB = fakeDom();
  const A = W.createDrag({ doc: dA, win, channel: fakeChannel('partcraft-2'), app: 'partcraft', T: (k) => words[k], fill });
  const B = W.createDrag({ doc: dB, win, channel: fakeChannel('modelcraft-2'), app: 'modelcraft', T: (k) => words[k], fill });
  const got = [];
  B.accept({ mesh: async (x) => { got.push(x); } });
  const mesh = { name: 'p.obj', size: 5 };
  const id = A.offer({ name: 'Bracket', files: [{ kind: 'item', file: { name: 'b.json', size: 1 } }, { kind: 'mesh', file: mesh }] });
  ok(id && B.pending().length === 1, 'an offer without a drag reaches the shelf (ModelCraft takes the mesh form)');
  const place = dB.all().find((n) => n.attrs['data-studio-drag-place']);
  place.onclick();
  ok(dB.all().some((n) => n.text === 'Click where it goes.'), 'Place it here → asks for a click on the drawing');
  dB.fire('click', { target: dB.main, clientX: 500, clientY: 250, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 50));
  ok(got.length === 1 && got[0].kind === 'mesh' && got[0].file === mesh && got[0].point.u === 0.5 && got[0].point.v === 0.5, 'the click places it there');
  ok(dB.all().some((n) => n.text === 'Bracket placed.'), 'the default status says it was placed');
}

section('Refusals and failures');
{
  const dA = fakeDom(), dB = fakeDom(), dC = fakeDom();
  const A = W.createDrag({ doc: dA, win, channel: fakeChannel('partcraft-3'), app: 'partcraft', T: (k) => words[k], fill });
  const B = W.createDrag({ doc: dB, win, channel: fakeChannel('bimcraft-3'), app: 'bimcraft', T: (k) => words[k], fill });
  const C = W.createDrag({ doc: dC, win, channel: fakeChannel('cadcraft-3'), app: 'cadcraft', T: (k) => words[k], fill });
  B.accept({ item: async () => { throw new Error('no storey is open'); } });
  A.offer({ name: 'Valve', files: [{ kind: 'item', file: { name: 'v.json', size: 1 } }] });
  ok(B.pending().length === 1 && C.pending().length === 0 && !dC.all().some((n) => n.attrs['data-studio-drag-shelf'] !== undefined), 'an app that accepts nothing shows nothing');
  dB.all().find((n) => n.attrs['data-studio-drag-place']).onclick();
  dB.fire('click', { target: dB.main, clientX: 1, clientY: 1, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 50));
  ok(dB.all().some((n) => n.attrs['data-studio-drag-error'] !== undefined && /no storey is open/.test(n.text)), 'a handler that throws → the shelf says why');
  let dropped = 0;
  dB.fire('drop', { dataTransfer: { types: ['text/plain'], getData: () => '' }, preventDefault() { dropped++; } });
  dB.fire('drop', { dataTransfer: { types: [D.MIME], getData: () => '{"not":"an offer"}' }, preventDefault() { dropped++; } });
  ok(dropped === 1, 'a foreign drop is left alone; a broken offer is swallowed without a placement');
  const own = [];
  const A2 = W.createDrag({ doc: fakeDom(), win, channel: fakeChannel('partcraft-4'), app: 'partcraft', T: (k) => words[k], fill });
  A2.accept({ item: async (x) => own.push(x) });
  const dt = { data: {}, types: [], setData(k, v) { this.data[k] = v; this.types.push(k); }, getData(k) { return this.data[k]; } };
  const d2 = fakeDom();
  const A3 = W.createDrag({ doc: d2, win, channel: fakeChannel('partcraft-5'), app: 'partcraft', T: (k) => words[k], fill });
  A3.accept({ item: async (x) => own.push(x) });
  A3.start({ dataTransfer: dt }, { name: 'X', files: [{ kind: 'item', file: { name: 'x.json', size: 1 } }] });
  d2.fire('drop', { dataTransfer: dt, clientX: 1, clientY: 1, preventDefault() {} });
  await new Promise((r) => setTimeout(r, 30));
  ok(own.length === 0, 'dropping on the same app\'s own window does nothing');
  const gone = A.end(A.offer({ name: 'Q', files: [{ kind: 'item', file: { name: 'q.json', size: 1 } }] }));
  await gone;
  ok(!B.pending().some((o) => o.name === 'Q'), 'end() clears it everywhere');
}
done();
