/* SPDX-License-Identifier: Apache-2.0 */
/**
 * connect-ai.js — Studio › Connect your AI (AC.2, docs/AI-CONNECT-SPEC.md § 6). Finds the AI apps on this computer, says in plain
 * words what it would add to each one's settings, shows the exact text, and writes it only after the person presses Yes.
 * Disconnect takes the one entry out again. The list and the writers are clients.mjs (one source, shared with `cadcraft-mcp setup`);
 * the file access is Studio's native `connect` commands, which only touch those settings files (desktop-shell connect.rs).
 *
 *   mountConnectAi({ box, desk, relay, t, el, say })      → { render() }
 */
import { CLIENTS, TEST_PROMPT, detect, plan, apply, remove, card } from './clients.mjs';

export function mountConnectAi({ box, desk, relay = null, t, el, say }) {
  const io = {
    exists: (p) => desk.connect.exists(p), read: (p) => desk.connect.read(p), write: (p, s) => desk.connect.write(p, s),
    rename: (a, b) => desk.connect.rename(a, b), mkdirp: (p) => desk.connect.mkdirp(p), which: (c) => desk.connect.which(c),
    run: (c, a) => desk.connect.run(c, a),
  };
  let env = null, rows = [], open = null, busy = false;
  const copy = (text) => el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', onclick: async () => {
    try { await navigator.clipboard.writeText(text); say(t('connectai.copied')); } catch { say(t('connectai.copyfailed'), 'error'); }
  } }, t('assist.copy'));

  async function scan() {
    env = await desk.connect.env();
    env.now = () => Date.now();
    rows = [];
    for (const c of CLIENTS) {
      let d;
      try { d = await detect(c, env, io); } catch (e) { d = { found: false, why: String(e && e.message || e), configured: false }; }
      rows.push({ c, d });
    }
  }

  async function act(fn, done) {
    if (busy) return;
    busy = true;
    try { await fn(); say(done); } catch (e) { say(t('connectai.failed', { why: String(e && e.message || e).slice(0, 200) }), 'error'); }
    busy = false; open = null;
    await render();
  }

  /** "Check the connection": the hub's answer without any AI (the four steps). */
  async function check() {
    const steps = [];
    let st = {};
    try { st = await desk.control.server(); } catch { st = {}; }
    steps.push([t('connectai.step.running'), !!st.running]);
    steps.push([t('connectai.step.token'), !!st.token]);
    const wins = relay ? relay.windows().filter((w) => w.enabled) : [];
    steps.push([t('connectai.step.apps'), wins.length > 0]);
    return steps;
  }

  async function render() {
    if (!desk || !desk.connect) { box.hidden = true; return; }
    box.hidden = false;
    const body = box.querySelector('[data-connectai-body]');
    try { await scan(); } catch { body.replaceChildren(el('p', {}, t('connectai.unavailable'))); return; }
    const list = el('ul', { class: 'studio-connectai-list' }, ...rows.map(({ c, d }) => {
      const state = !d.found ? t('connectai.notfound') : d.configured ? t('connectai.connected') : t('connectai.found');
      const kids = [el('div', { class: 'studio-connectai-head' }, el('strong', {}, c.name), ' ', el('span', { class: 'studio-muted', 'data-connectai-state': c.id }, state))];
      if (!d.found) kids.push(el('a', { href: c.install, target: '_blank', rel: 'noopener', class: 'studio-hint' }, t('connectai.install', { name: c.name })));
      else if (d.configured) kids.push(el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', 'data-connectai-disconnect': c.id,
        onclick: () => act(() => remove(c, env, io), t('connectai.disconnected', { name: c.name })) }, t('connectai.disconnect')));
      else kids.push(el('button', { type: 'button', class: 'studio-btn studio-btn-sm', 'data-connectai-connect': c.id,
        onclick: async () => { try { open = { c, p: await plan(c, env, io) }; } catch (e) { say(t('connectai.failed', { why: String(e && e.message || e).slice(0, 200) }), 'error'); } await render(); } }, t('connectai.connect')));
      if (open && open.c.id === c.id) {
        const text = open.p.cli ? open.p.command : open.p.after;
        kids.push(el('div', { class: 'studio-connectai-confirm' },
          el('p', {}, t('connectai.will', { name: c.name, file: open.p.path || open.p.command }) + (c.restart ? ' ' + t('connectai.restart', { name: c.name }) : '')),
          el('pre', { class: 'studio-assist-pre', 'data-connectai-diff': true }, text),
          el('div', { class: 'studio-btnrow' },
            el('button', { type: 'button', class: 'studio-btn', 'data-connectai-yes': c.id, onclick: () => act(() => apply(c, env, io), t('connectai.done', { name: c.name })) }, t('connectai.yes')),
            el('button', { type: 'button', class: 'studio-btn studio-btn-line', onclick: () => { open = null; render(); } }, t('connectai.no')))));
      }
      kids.push(el('details', { class: 'studio-connectai-card' }, el('summary', {}, t('connectai.paste')),
        el('pre', { class: 'studio-assist-pre' }, card(c, env).paste), copy(card(c, env).paste)));
      return el('li', { class: 'studio-connectai-row' }, ...kids);
    }));
    const result = el('ul', { class: 'studio-connectai-check', 'data-connectai-check': true });
    body.replaceChildren(
      el('p', {}, t('connectai.lead')), list,
      el('div', { class: 'studio-assist-block' },
        el('div', { class: 'studio-assist-head' }, el('strong', {}, t('connectai.test')), copy(TEST_PROMPT)),
        el('pre', { class: 'studio-assist-pre' }, TEST_PROMPT)),
      el('div', { class: 'studio-btnrow' },
        el('button', { type: 'button', class: 'studio-btn studio-btn-line', 'data-connectai-check-btn': true, onclick: async () => {
          const steps = await check();
          result.replaceChildren(...steps.map(([label, okay]) => el('li', {}, (okay ? '✓ ' : '✗ ') + label)));
        } }, t('connectai.check')),
        el('button', { type: 'button', class: 'studio-btn studio-btn-line', 'data-connectai-disconnect-all': true, disabled: !rows.some((r) => r.d.configured),
          onclick: () => act(async () => { for (const { c, d } of rows) if (d.configured) await remove(c, env, io); }, t('connectai.disconnected.all')) }, t('connectai.disconnect.all'))),
      result,
      relay ? clientsList() : '');
  }

  function clientsList() {
    const cl = relay.clients ? relay.clients() : [];
    if (!cl.length) return el('p', { class: 'studio-hint' }, t('connectai.noclients'));
    return el('div', {}, el('strong', {}, t('connectai.recent')), el('ul', {}, ...cl.map((c) => el('li', {}, c.name + ' · ' + t('connectai.calls', { n: c.calls }) + ' ',
      el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', onclick: () => { relay.block(c.name); say(t('connectai.blocked', { name: c.name })); render(); } }, t('connectai.disconnect'))))));
  }

  return { render };
}
