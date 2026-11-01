#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * browser-drag.mjs — drag between apps (0.8 EG.78) in a real browser, on the packed suite: two app windows of one origin
 * (PartCraft offers, BimCraft takes). Covers the shelf path (offer → chip → Place it here → click on the drawing) and the
 * drop path (dragstart carries the offer in the dataTransfer, a drop on the other window takes it). Dragging between two
 * real desktop windows is a hand check (it depends on the platform's web view).
 *   CADCRAFT_SITE=<site> node test/browser-drag.mjs [--suite <folder>]
 */
import path from 'node:path';
import { chromium, serve, SUITE, ok, section, done } from './lib.mjs';

const i = process.argv.indexOf('--suite');
const suite = path.resolve(i > 0 ? process.argv[i + 1] : SUITE('dev'));
const srv = await serve(suite);
const browser = await chromium();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const errors = [];
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(e.message)); });
const ready = async (p, app) => { await p.goto(srv.url + 'apps/' + app + '/index.html'); await p.waitForFunction(() => window.cadcraftStudio && window.cadcraftStudio.drag, null, { timeout: 30000 }); };
try {
  section('Drag between apps (EG.78): two windows, one origin');
  const A = await ctx.newPage(), B = await ctx.newPage();
  await ready(A, 'partcraft'); await ready(B, 'bimcraft');
  ok(true, 'both windows carry window.cadcraftStudio.drag');
  await B.evaluate(() => { window.__got = []; window.cadcraftStudio.drag.accept({ item: async (d) => { window.__got.push({ name: d.name, kind: d.kind, from: d.from, text: await d.file.text(), point: d.point }); return 'Placed ' + d.name; } }); });

  const mk = (txt) => A.evaluate(async (t) => ({ id: window.cadcraftStudio.drag.offer({ name: 'Bracket', files: [{ kind: 'item', file: new File([t], 'bracket.ccitem') }], meta: { n: 1 } }) }), txt);
  const o1 = await mk('item-one');
  ok(!!o1.id, 'PartCraft makes an offer (shelf only)');
  await B.waitForSelector('[data-studio-drag-shelf] [data-studio-drag-place]', { timeout: 8000 }).catch(() => {});
  const chip = await B.textContent('[data-studio-drag-shelf]').catch(() => '');
  ok(/Bracket/.test(chip) && /PartCraft/.test(chip), 'BimCraft shows the chip: "' + chip.trim().slice(0, 60) + '"');
  ok(!(await A.$('[data-studio-drag-shelf]')), 'the offering window shows no chip for its own offer');
  await B.click('[data-studio-drag-place]');
  ok(!!(await B.$('[data-studio-drag-cancel]')), 'Place it here waits for a click on the drawing');
  await B.mouse.click(500, 400);
  await B.waitForFunction(() => window.__got.length === 1, null, { timeout: 8000 }).catch(() => {});
  const g1 = await B.evaluate(() => window.__got[0]);
  ok(g1 && g1.text === 'item-one' && g1.kind === 'item' && g1.from === 'partcraft', 'the click took the very file PartCraft offered');
  ok(g1 && g1.point && typeof g1.point.u === 'number', 'a click gives the handler a point on the drawing');
  await A.waitForTimeout(300);
  ok(await A.evaluate(() => new Promise((res) => { const q = indexedDB.open('cadcraft-handoff'); q.onsuccess = () => { const c = q.result.transaction('files').objectStore('files').count(); c.onsuccess = () => res(c.result === 0); }; })), 'the hand-off store is empty again');

  // the drop path: dragstart carries the offer; replay it as a drop on BimCraft
  await A.evaluate(() => { document.addEventListener('dragstart', (e) => { window.cadcraftStudio.drag.start(e, { name: 'Plate', files: [{ kind: 'item', file: new File(['item-two'], 'plate.ccitem') }] }); }, { once: true }); });
  const payload = await A.evaluate(() => { const dt = new DataTransfer(); const ev = new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); return { mime: dt.getData('application/x-cadcraft-drag'), types: [...dt.types] }; });
  ok(payload.types.includes('application/x-cadcraft-drag') && /Plate/.test(payload.mime), 'dragstart puts the offer in the dataTransfer');
  await B.evaluate((json) => { const dt = new DataTransfer(); dt.setData('application/x-cadcraft-drag', json); for (const t of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); }, payload.mime);
  await B.waitForFunction(() => window.__got.length === 2, null, { timeout: 8000 }).catch(() => {});
  const g2 = await B.evaluate(() => window.__got[1]);
  ok(g2 && g2.text === 'item-two' && g2.name === 'Plate', 'a drop on BimCraft took the file');
  await B.waitForSelector('[data-studio-drag-shelf]', { timeout: 3000 }).catch(() => {});
  ok(/Placed Plate/.test(await B.textContent('[data-studio-drag-shelf]').catch(() => '')), 'the window says what happened ("Placed Plate")');

  // not an app that takes it: ModelCraft with no accept() shows nothing
  const C = await ctx.newPage(); await ready(C, 'modelcraft');
  await A.evaluate(() => window.cadcraftStudio.drag.offer({ name: 'Other', files: [{ kind: 'item', file: new File(['x'], 'o.ccitem') }] }));
  await C.waitForTimeout(700);
  ok(!(await C.$('[data-studio-drag-shelf]')), 'an app that did not call accept() gets no chip');
  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
} finally { await browser.close(); await srv.close(); }
done();
