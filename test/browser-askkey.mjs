#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * browser-askkey.mjs — Studio › Your own AI model (0.8 AC.11): the hub card in a real browser, with a fake desktop shell (desk.ask.keySet/keyHas/keyDelete)
 * behind it. The shell's real half (ask_keys.rs → the OS credential store) is Rust and is tried on the owner's Windows build. Checks: the card shows
 * provider, model, key, limits; Save sends the key to the shell and clears the field (the page never holds it afterward); the state line follows;
 * Remove asks the shell to forget it; a local address needs no key and hides the key row and the prices; limits are kept checked in localStorage;
 * a shell failure is said in words without the key; the key is in no DOM text, no localStorage, no console message.
 *   node test/browser-askkey.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, serve, STUDIO, ok, section, done } from './lib.mjs';

const SITE = process.env.CADCRAFT_SITE || '/var/www/CADCRAFT/getcadcraft.com';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askkey-'));
fs.cpSync(path.join(STUDIO, 'hub'), path.join(dir, 'hub'), { recursive: true });
fs.copyFileSync(path.join(SITE, 'tools/mcp/byok.mjs'), path.join(dir, 'hub/byok.mjs'));
const srv = await serve(dir);
const browser = await chromium();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); if (/SECRET/.test(m.text())) errors.push('key in console: ' + m.text()); });
await ctx.route(srv.url + '__t.html', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><body><div id="a"></div></body></html>' }));
await page.goto(srv.url + '__t.html');
const words = JSON.parse(fs.readFileSync(path.join(STUDIO, 'hub/lang/en.json'), 'utf8'));
const base = new URL(srv.url).pathname;
try {
  section('Your own AI model (AC.11): the hub card');
  const r = await page.evaluate(async ([base, words]) => {
    const KEY = 'sk-ant-SECRET-9876543210';
    const T = (k, v = {}) => String(words[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => (v[x] === undefined ? m : v[x]));
    const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === 'onclick') n.addEventListener('click', v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); if (k === 'value') n.value = v; if (k === 'selected') n.selected = true; } for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); return n; };
    const shell = { keys: new Map(), calls: [], fail: false };
    const desk = { ask: { keySet: async (n, s) => { shell.calls.push(['set', n, s.length]); if (shell.fail) throw new Error('credential store refused ' + s); shell.keys.set(n, s); }, keyHas: async (n) => shell.keys.has(n), keyDelete: async (n) => { shell.calls.push(['delete', n]); shell.keys.delete(n); } } };
    const C = await import(base + 'hub/ask-key-card.js');
    const store = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, String(v)); } };
    const say = []; const box = el('div'); document.body.append(box);
    const card = C.mountAskKey({ box, desk, store, t: T, el, say: (m, kind) => say.push([m, kind || 'ok']) });
    const wait = (ms = 40) => new Promise((x) => setTimeout(x, ms));
    const q = (s) => box.querySelector(s), out = {};
    await card.render(); await wait();
    out.rows = { provider: !!q('[data-askkey-provider]'), model: !!q('[data-askkey-model]'), key: !!q('[data-askkey-key]'), save: !!q('[data-askkey-save]'), calls: !!q('[data-askkey-calls]'), noBase: !q('[data-askkey-base]') };
    out.state0 = q('[data-askkey-state]').dataset.askkeyState;
    out.keyType = q('[data-askkey-key]').type;
    q('[data-askkey-model]').value = 'claude-sonnet-5-5'; q('[data-askkey-model]').dispatchEvent(new Event('change')); await wait();
    out.priceKnown = !q('[data-askkey-noprice]') && Number(q('[data-askkey-pricein]').value) > 0;
    q('[data-askkey-key]').value = KEY; q('[data-askkey-save]').click(); await wait(80);
    out.afterSave = { state: q('[data-askkey-state]').dataset.askkeyState, field: q('[data-askkey-key]').value, shell: shell.calls.slice(), remove: !!q('[data-askkey-remove]'), said: say.at(-1) };
    out.leak = box.innerHTML.includes('SECRET') || JSON.stringify([...store.m]).includes('SECRET');
    q('[data-askkey-calls]').value = '7'; q('[data-askkey-calls]').dispatchEvent(new Event('change')); await wait();
    q('[data-askkey-dayamount]').value = '-3'; q('[data-askkey-dayamount]').dispatchEvent(new Event('change')); await wait();
    const kept = JSON.parse(store.getItem(C.SETTINGS_KEY));
    out.kept = { calls: kept.caps.callsPerHour, day: kept.caps.dayAmount, model: kept.model, provider: kept.provider };
    q('[data-askkey-remove]').click(); await wait(80);
    out.afterRemove = { state: q('[data-askkey-state]').dataset.askkeyState, shell: shell.calls.at(-1), hasRemove: !!q('[data-askkey-remove]') };
    // another provider: a model on this computer
    q('[data-askkey-provider]').value = 'compatible'; q('[data-askkey-provider]').dispatchEvent(new Event('change')); await wait();
    out.compat = { base: !!q('[data-askkey-base]'), keyRow: !!q('[data-askkey-key]') };
    q('[data-askkey-base]').value = 'http://127.0.0.1:11434/v1'; q('[data-askkey-base]').dispatchEvent(new Event('change')); await wait();
    out.local = { note: !!q('[data-askkey-local]'), keyRow: !!q('[data-askkey-key]'), prices: !!q('[data-askkey-pricein]') };
    q('[data-askkey-base]').value = 'https://example.com/v1'; q('[data-askkey-base]').dispatchEvent(new Event('change')); await wait();
    out.remote = { note: !!q('[data-askkey-local]'), keyRow: !!q('[data-askkey-key]') };
    // the shell refuses
    shell.fail = true; q('[data-askkey-key]').value = KEY; q('[data-askkey-save]').click(); await wait(80);
    out.failed = { said: say.at(-1), leak: JSON.stringify(say).includes('SECRET') };
    return out;
  }, [base, words]);
  ok(r.rows.provider && r.rows.model && r.rows.key && r.rows.save && r.rows.calls && r.rows.noBase, 'the card shows provider, model, key, Save and the calls limit (no address for Anthropic)');
  ok(r.state0 === 'none' && r.keyType === 'password', 'at first no key is stored, and the field is a password field');
  ok(r.priceKnown, 'a model with a published price shows its prices (the default list)');
  ok(r.afterSave.state === 'stored' && r.afterSave.field === '' && r.afterSave.shell.some((c) => c[0] === 'set' && c[1] === 'default' && c[2] === 24) && r.afterSave.remove, 'Save sends the key to the shell, empties the field, and the state line says a key is stored');
  ok(!r.leak, 'the key is in no page text and not in the saved settings');
  ok(r.kept.calls === 7 && r.kept.day === 5 && r.kept.model === 'claude-sonnet-5-5', `limits are kept checked: calls 7 taken, a negative day amount refused (stays ${r.kept.day})`);
  ok(r.afterRemove.state === 'none' && r.afterRemove.shell[0] === 'delete' && !r.afterRemove.hasRemove, 'Remove asks the shell to forget the key');
  ok(r.compat.base && r.compat.keyRow, 'another provider asks for an address and a key');
  ok(r.local.note && !r.local.keyRow && !r.local.prices, 'a local address needs no key and no prices');
  ok(!r.remote.note && r.remote.keyRow, 'a remote address asks for the key again');
  ok(/did not work/.test(r.failed.said[0]) && r.failed.said[1] === 'error' && !r.failed.leak, 'a shell failure is said in words, as an error, without the key: ' + r.failed.said[0].slice(0, 70));
  ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) { ok(false, 'ran to the end: ' + e.message); }
await browser.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true });
done();
