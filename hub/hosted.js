/* SPDX-License-Identifier: Apache-2.0 */
/**
 * hosted.js — Studio › Connect your AI › "Hosted connector" (0.8 AC.3, studio_PART_3; docs/AI-CONNECT-HOSTED-SPEC.md § 6, § 9, § 10).
 * Lets an AI platform in a browser (claude.ai, ChatGPT…) use Studio through the person's own address on getcadcraft.com. Studio opens ONE
 * outbound WebSocket; nothing listens on this computer. The device token never reaches this page: the website is reached through the
 * shell's own proxy (`desk.cloud.request`, which adds the bearer natively), and the local hub is this page's own dispatcher (`relay.handle`),
 * not an HTTP port. What the platform may do is the website's levels ∩ the cap the person sets here ∩ a yes per session for Save / Export.
 *
 *   hostedFetch({ desk, relay, hubUrl }) → doFetch   the proxy hosted-client.mjs calls instead of fetch
 *   mountHosted({ box, desk, relay, t, el, say, storage }) → { render, client }
 *
 * The cap lives in localStorage `cadcraft.assistants.hosted` = { on, levels, perSessionCalls, askForSaveExport }.
 */
import { createHostedClient, HOSTED_LEVELS } from './hosted-client.mjs';

export const SITE = 'https://getcadcraft.com';
export const HUB_URL = 'studio://hub';
const CAP_KEY = 'cadcraft.assistants.hosted';
export const DEFAULT_CAP = Object.freeze({ on: false, levels: ['read', 'suggest'], perSessionCalls: 2000, askForSaveExport: true });

export function loadCap(storage = globalThis.localStorage) {
  let c = null;
  try { c = JSON.parse(storage.getItem(CAP_KEY) || 'null'); } catch { c = null; }
  if (!c || typeof c !== 'object') return { ...DEFAULT_CAP, levels: [...DEFAULT_CAP.levels] };
  return {
    on: c.on === true,
    levels: HOSTED_LEVELS.filter((l) => Array.isArray(c.levels) && c.levels.includes(l)),
    perSessionCalls: Number.isInteger(c.perSessionCalls) && c.perSessionCalls >= 1 && c.perSessionCalls <= 100000 ? c.perSessionCalls : DEFAULT_CAP.perSessionCalls,
    askForSaveExport: c.askForSaveExport !== false,   // only an explicit false turns the per-session yes off
  };
}
export function saveCap(cap, storage = globalThis.localStorage) { try { storage.setItem(CAP_KEY, JSON.stringify(cap)); } catch { /* private mode */ } }

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** fetch for hosted-client.mjs: the website through the shell's proxy, the local hub in-process. */
export function hostedFetch({ desk, relay, hubUrl = HUB_URL, site = SITE }) {
  return async function doFetch(url, init = {}) {
    const u = String(url);
    if (u === hubUrl) {
      if (!relay) throw new Error('no hub');
      const msg = JSON.parse(String(init.body || 'null'));
      const out = await relay.handle(msg, { id: 'hosted' });
      return answer(200, out === undefined ? null : out);
    }
    if (!u.startsWith(site + '/')) throw new Error('not allowed');
    const x = new URL(u);
    const r = await desk.cloud.request({ method: init.method || 'GET', path: x.pathname + x.search, body: init.body === undefined ? null : init.body, contentType: 'application/json' });
    let j = null;
    try { j = r.json(); } catch { j = null; }
    return answer(r.status, j);
  };
}

export function mountHosted({ box, desk, relay, t, el, say, storage = globalThis.localStorage, WebSocket = globalThis.WebSocket }) {
  if (!desk || !desk.cloud || typeof desk.cloud.request !== 'function') { box.hidden = true; return { render() {}, client: null }; }
  let cap = loadCap(storage);
  let view = null, unavailable = false, pending = null;
  const doFetch = hostedFetch({ desk, relay });
  const client = createHostedClient({
    site: SITE, deviceToken: () => '',   // the token stays native
    hub: () => ({ url: HUB_URL, token: 'in-process' }), cap: () => cap, doFetch, WebSocket, roots: () => [], home: '',
    confirm: ({ level, client: who, tool }) => new Promise((resolve) => { pending = { level, who, tool, resolve }; render(); }),
    onState: () => { setTimeout(render, 0); },
  });
  const api = async (method, body) => {
    const r = await desk.cloud.request({ method, path: '/api/v1/connect/studio/settings', body: method === 'GET' ? null : body });
    let j = null; try { j = r.json(); } catch { j = null; }
    return { status: r.status, data: j && (j.data || j), ok: r.status >= 200 && r.status < 300 && j && j.status !== 'error', message: j && (j.error || j.message) };
  };
  async function refresh() {
    try {
      const r = await api('GET');
      unavailable = !(r.ok && r.data && r.data.enabled);
      view = r.ok ? r.data : null;
    } catch { unavailable = true; view = null; }
  }
  const act = async (body, done) => {
    try {
      const r = await api('POST', body);
      if (!r.ok) throw new Error(r.message || 'failed');
      if (done) say(done);
    } catch (e) { say(t('hosted.failed', { why: String(e && e.message || e).slice(0, 160) }), 'error'); }
    await render(true);
  };
  const setCap = (patch) => {
    cap = { ...cap, ...patch }; saveCap(cap, storage);
    if (cap.on) client.start(); else client.stop();
    return render();
  };

  async function render(reload = true) {
    const body = box.querySelector('[data-hosted-body]');
    if (!body) return;
    if (reload || !view) await refresh();
    const st = client.status ? client.status() : { state: 'off' };
    if (unavailable || !view) {
      body.replaceChildren(el('p', { 'data-hosted-unavailable': true }, t('hosted.unavailable')));
      return;
    }
    const allowed = new Set(view.levels || []);
    const rows = [];
    rows.push(el('p', {}, t('hosted.lead')));
    rows.push(el('label', { class: 'form-check form-switch' }, el('input', { type: 'checkbox', class: 'form-check-input', role: 'switch', 'data-hosted-on': true, checked: cap.on, disabled: !view.allowed || view.staff_off,
      onchange: async (e) => { const on = e.target.checked; await act({ action: on ? 'on' : 'off' }); await setCap({ on }); } }), ' ', t('hosted.on')));
    if (view.staff_off) rows.push(el('p', { class: 'studio-hint', 'data-hosted-staff': true }, t('hosted.staffoff')));
    else if (!view.allowed) rows.push(el('p', { class: 'studio-hint', 'data-hosted-notallowed': true }, t('hosted.notallowed')));
    rows.push(el('div', { class: 'studio-hint', 'data-hosted-state': st.state, role: 'status' }, t('hosted.state.' + (st.state || 'off')) + (st.error ? ' ' + st.error : '')));
    if (view.address) rows.push(el('div', {}, el('strong', {}, t('hosted.address')), ' ', el('code', { 'data-hosted-address': true }, view.address),
      view.universal_address ? el('div', { class: 'studio-hint' }, t('hosted.universal'), ' ', el('code', {}, view.universal_address)) : null));
    rows.push(el('fieldset', { class: 'studio-hosted-levels' }, el('legend', { class: 'h6' }, t('hosted.levels')),
      ...HOSTED_LEVELS.map((l) => el('label', { class: 'form-check' }, el('input', { type: 'checkbox', class: 'form-check-input', 'data-hosted-level': l, checked: cap.levels.includes(l), disabled: !allowed.has(l),
        onchange: (e) => setCap({ levels: HOSTED_LEVELS.filter((x) => (x === l ? e.target.checked : cap.levels.includes(x))) }) }), ' ', t('hosted.level.' + l)))));
    rows.push(el('label', { class: 'form-check' }, el('input', { type: 'checkbox', class: 'form-check-input', 'data-hosted-ask': true, checked: cap.askForSaveExport,
      onchange: (e) => setCap({ askForSaveExport: e.target.checked }) }), ' ', t('hosted.ask')));
    if (pending) {
      const p = pending;
      rows.push(el('div', { class: 'studio-connectai-confirm', 'data-hosted-confirm': true, role: 'alertdialog' },
        el('p', {}, t('hosted.confirm', { client: p.who || '?', level: t('hosted.level.' + p.level), tool: p.tool || '' })),
        el('div', { class: 'studio-btnrow' },
          el('button', { type: 'button', class: 'studio-btn', 'data-hosted-yes': true, onclick: () => { pending = null; p.resolve(true); render(false); } }, t('hosted.confirm.yes')),
          el('button', { type: 'button', class: 'studio-btn studio-btn-line', 'data-hosted-no': true, onclick: () => { pending = null; p.resolve(false); render(false); } }, t('hosted.confirm.no')))));
    }
    const cl = Array.isArray(view.clients) ? view.clients : [];
    rows.push(cl.length ? el('div', {}, el('strong', {}, t('hosted.connected')), el('ul', {}, ...cl.map((c) => el('li', { 'data-hosted-client': c.client_row }, `${c.name || '?'} · ${(c.levels || []).join(', ')} `,
      el('button', { type: 'button', class: 'studio-btn studio-btn-sm studio-btn-line', onclick: () => act({ action: 'disconnect', client_row: c.client_row }, t('hosted.disconnected', { name: c.name || '?' })) }, t('hosted.disconnect')))))) : el('p', { class: 'studio-hint' }, t('hosted.noclients')));
    rows.push(el('div', { class: 'studio-btnrow' },
      el('button', { type: 'button', class: 'studio-btn studio-btn-line', 'data-hosted-rotate': true, onclick: () => act({ action: 'rotate' }, t('hosted.rotated')) }, t('hosted.rotate')),
      el('button', { type: 'button', class: 'studio-btn studio-btn-line', 'data-hosted-revoke': true, disabled: !cl.length, onclick: () => act({ action: 'revoke_all' }, t('hosted.revoked')) }, t('hosted.revoke'))));
    const rec = Array.isArray(view.recent) ? view.recent.slice(0, 8) : [];
    if (rec.length) rows.push(el('details', {}, el('summary', {}, t('hosted.recent')), el('ul', {}, ...rec.map((r) => el('li', {}, `${r.at} · ${r.client} · ${r.tool} · ${r.outcome}`)))));
    body.replaceChildren(...rows);
  }

  if (cap.on) client.start();
  return { render, client };
}
