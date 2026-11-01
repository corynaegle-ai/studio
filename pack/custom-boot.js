// SPDX-License-Identifier: Apache-2.0
/*
 * custom-boot.js — the page side of a custom build ("CadCraft Studio for <Organisation>"; 0.8 AL.18). The packer (pack/custom.mjs) copies it to
 * custom/boot.js beside custom/custom.json and names it in the hub and in every app page. It does three small things, all from custom.json
 * (written by the packer, signed with the rest of the folder), nothing from the network:
 *   1. exposes window.ccCustom = { id, organisation, line, sso, addons } for the shell and the hub;
 *   2. the first time a page runs: seeds the organisation's defaults where the person has not chosen yet — theme (cc-space), the starred
 *      units (cc-units), the first-party add-ons switched on (cc-addons:<app>) — each only when that key is unset; a person's own choice always wins;
 *   3. a small label in the corner: our name first, theirs after it, and a link to the organisation's sign-in (team SSO on getcadcraft.com).
 * Text goes in with textContent only; the accent is checked as #rrggbb again here. No eval, no innerHTML.
 */
const base = new URL('./', import.meta.url);
const store = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
const get = (k) => { try { return store ? store.getItem(k) : null; } catch { return null; } };
const set = (k, v) => { try { store && store.setItem(k, v); } catch { /* storage blocked */ } };

/** Which page this is: an app's slug from its folder, else the hub. */
export const pageKey = (pathname) => (/\/apps\/([a-z0-9-]+)\//.exec(pathname) || [])[1] || 'hub';

/** The defaults to write for this page: [[key, value], …], only for keys the person has not set. `read` = a key → stored text or null. */
export function seedPlan(d, key, read) {
  const out = [];
  const df = d.defaults || {};
  if (df.space && df.space !== 'system' && !read('cc-space')) out.push(['cc-space', df.space]);
  if (df.units_star && Object.keys(df.units_star).length && !read('cc-units')) out.push(['cc-units', JSON.stringify({ v: 1, on: {}, star: df.units_star })]);
  if (key !== 'hub' && Array.isArray(df.addons_on) && df.addons_on.length) {
    let cur = {};
    try { cur = JSON.parse(read('cc-addons:' + key) || '{}') || {}; } catch { cur = {}; }
    const on = { ...(cur.on || {}) };
    let changed = false;
    for (const id of df.addons_on) if (!(id in on) && !(cur.off && id in cur.off)) { on[id] = true; changed = true; }
    if (changed) out.push(['cc-addons:' + key, JSON.stringify({ ...cur, on })]);
  }
  return out;
}

async function main() {
  let d;
  try { d = await (await fetch(new URL('custom.json', base), { cache: 'no-cache' })).json(); } catch { return; }
  if (!d || d.format !== 'cadcraft-custom-build' || typeof d.id !== 'string') return;
  window.ccCustom = Object.freeze({ id: d.id, organisation: d.organisation, line: d.line, sso: d.sso || null, addons: d.addons || [] });
  const key = pageKey(location.pathname);
  const flag = 'cc-custom:' + d.id + ':' + key;
  if (!get(flag)) {
    for (const [k, v] of seedPlan(d, key, get)) set(k, v);
    set(flag, '1');
  }
  if (!document.body) await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  const bar = document.createElement('div');
  bar.setAttribute('data-cc-custom', d.id);
  const accent = /^#[0-9a-fA-F]{6}$/.test(d.accent || '') ? d.accent : 'currentColor';
  bar.style.cssText = 'position:fixed;right:.5rem;bottom:.5rem;z-index:60;display:flex;gap:.5rem;align-items:center;padding:.25rem .625rem;'
    + 'font:500 .75rem/1.2 system-ui,sans-serif;background:var(--sheet,#fff);color:var(--ink,#17202b);border:1px solid ' + accent + ';border-radius:2px;max-width:calc(100vw - 1rem)';
  if (d.logo) { const im = document.createElement('img'); im.src = new URL(d.logo, base).href; im.alt = ''; im.style.cssText = 'height:1rem;width:auto'; bar.append(im); }
  const t = document.createElement('span'); t.textContent = d.line; bar.append(t);
  if (d.sso && typeof d.sso.url === 'string' && d.sso.url.startsWith('https://')) {
    const a = document.createElement('a');
    a.href = d.sso.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Sign in with your organization';
    a.style.cssText = 'color:inherit;text-decoration:underline';
    bar.append(a);
  }
  document.body.append(bar);
}
if (typeof document !== 'undefined') main();
