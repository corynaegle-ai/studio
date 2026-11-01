// SPDX-License-Identifier: Apache-2.0
// Custom edition of the suite packer (0.8 AL.18): config checks, logo checks, bundling into a fake suite folder, the signed manifest, the page script's
// seeding rules. Light: no PHP, no editions, a throwaway key. Run: node test/test-custom.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as C from '../pack/custom.mjs';
import { seedPlan, pageKey } from '../pack/custom-boot.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n')[0]); } };
const ctx = { slugs: ['cadcraft', 'bimcraft', 'partcraft'], unitOk: (k, id) => (k === 'length' && ['mm', 'm', 'ft'].includes(id)) };
const good = { format: 'cadcraft-custom-build', version: 1, id: 'acme-architects', organisation: 'Acme Architects', seats: 25, apps: ['cadcraft', 'bimcraft'],
  branding: { accent: '#C0392B', logo: 'logo.svg' }, defaults: { space: 'paper', units_star: { length: 'mm' }, addons_on: ['hvac'] },
  addons: [{ id: 'maker-pack', version: '1.2.0' }], sso: { team: 'acme' } };

t('a good config passes and is normalised', () => { const r = C.checkConfig(good, ctx); assert.deepEqual(r.errors, []); assert.equal(r.cfg.id, 'acme-architects'); assert.equal(r.cfg.addons[0].version, '1.2.0'); });
t('defaults fill in', () => { const r = C.checkConfig({ format: C.FORMAT, version: 1, id: 'xx', organisation: 'Xx Co' }, ctx); assert.equal(r.cfg.defaults.space, 'system'); assert.equal(r.cfg.apps, null); });
const bad = (patch, re) => t('refused: ' + JSON.stringify(patch).slice(0, 60), () => { const r = C.checkConfig({ ...good, ...patch }, ctx); assert.ok(r.errors.some((e) => re.test(e)), r.errors.join('|')); });
bad({ id: 'A_b' }, /id:/); bad({ organisation: 'x' }, /organisation:/); bad({ organisation: 'A <b> Co' }, /organisation:/);
bad({ organisation: 'CadCraft Gold Partners' }, /our name/); bad({ seats: 0 }, /seats/); bad({ apps: ['nope'] }, /unknown app/);
bad({ branding: { accent: 'red' } }, /accent/); bad({ branding: { logo: '../x.png' } }, /logo/); bad({ branding: { colour: 1 } }, /unknown key/);
bad({ defaults: { language: 'es' } }, /not supported/); bad({ defaults: { regulation_packs: ['x'] } }, /not supported/); bad({ defaults: { space: 'blue' } }, /space/);
bad({ defaults: { units_star: { length: 'parsec' } } }, /not a length unit/); bad({ addons: [{ id: 'Bad Id' }] }, /each needs an id/); bad({ addons: [{ id: 'ok-id', version: '1' }] }, /x\.y\.z/);
bad({ sso: { team: 'A B' } }, /sso\.team/); bad({ sso: { team: 'acme', secret: 1 } }, /sso: unknown/); bad({ product_name: 'My CAD' }, /unknown key/); bad({ format: 'x' }, /format/);
bad({ updates: 'public' }, /updates:/); bad({ updates: { endpoint: 'http://feed.example/x' } }, /updates\.endpoint/); bad({ updates: { endpoint: 'https://feed.example/x', key: 1 } }, /updates: unknown key/); bad({ updates: { endpoint: 'https://feed.example/x"; echo hi' } }, /updates\.endpoint/);
t('updates: device management by default, or the organisation\'s own https feed', () => {
  assert.equal(C.checkConfig(good, ctx).cfg.updates, 'device-management');
  assert.deepEqual(C.checkConfig({ ...good, updates: { endpoint: 'https://feed.acme.example/u/{{target}}/{{current_version}}' } }, ctx).cfg.updates, { endpoint: 'https://feed.acme.example/u/{{target}}/{{current_version}}' });
});
t('not an object', () => assert.ok(C.checkConfig([], ctx).errors.length));

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
t('logo: png ok, junk refused', () => { assert.equal(C.checkLogo(png, 'a.png'), null); assert.match(C.checkLogo(Buffer.from('GIF89a'), 'a.png'), /not a PNG/); });
t('logo: plain svg ok', () => assert.equal(C.checkLogo(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#c00"/></svg>'), 'a.svg'), null));
for (const [n, svg] of [['script', '<svg><script>alert(1)</script></svg>'], ['handler', '<svg onload="x()"></svg>'], ['external image', '<svg><image href="https://evil/x.png"/></svg>'],
  ['css url', '<svg><rect style="fill:url(https://e/x)"/></svg>'], ['foreignObject', '<svg><foreignObject/></svg>'], ['doctype', '<!DOCTYPE svg><svg/>'], ['javascript:', '<svg><a href="javascript:1"/></svg>']]) {
  t('logo refused: svg with ' + n, () => assert.ok(C.checkLogo(Buffer.from(svg), 'a.svg')));
}
t('logo: over 100 KB', () => assert.match(C.checkLogo(Buffer.concat([png, Buffer.alloc(101 * 1024)]), 'a.png'), /100 KB/));
t('the line puts our name first', () => assert.equal(C.lineFor('Acme Architects'), 'CadCraft Studio for Acme Architects'));

// ---- a fake suite folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-custom-'));
const mkSuite = () => {
  const d = path.join(tmp, 'suite-' + Math.random().toString(36).slice(2, 7));
  const write = (r, c) => { fs.mkdirSync(path.dirname(path.join(d, r)), { recursive: true }); fs.writeFileSync(path.join(d, r), c); };
  write('index.html', '<html><head><script type="application/json" id="studio-suite">{"offline":{"key":"studio/hub","page":"./","urls":["hub/hub.js"]}}</script></head><body></body></html>');
  for (const s of ['cadcraft', 'bimcraft']) {
    write(`apps/${s}/index.html`, `<html><head><script type="application/json" id="cc-offline">{"urls":["assets/js/x.js"],"key":"studio/${s}"}</script></head><body></body></html>`);
    write(`apps/${s}/assets/apps/${s}/0.7/addons/index.json`, JSON.stringify({ addons: s === 'cadcraft' ? ['hvac'] : [] }));
  }
  write('release.json', '{}');
  return d;
};
const cfg = C.checkConfig(good, ctx).cfg;
const plan = (d) => ({ apps: ['cadcraft', 'bimcraft'], build: '0.7', firstParty: { cadcraft: new Set(['hvac']), bimcraft: new Set() }, logoBytes: Buffer.from('<svg viewBox="0 0 1 1"/>'), logoName: 'logo.svg',
  addonsPlan: [{ id: 'maker-pack', version: '1.2.0', first_party: false, apps: ['cadcraft'], files: { 'addon.json': Buffer.from('{"id":"maker-pack"}'), 'lib/a.js': Buffer.from('export default 1') } }] });
const d1 = mkSuite();
const data = C.applyCustom(d1, cfg, plan(d1));
t('custom.json written with the line, sso url and bundled list', () => { assert.equal(data.line, 'CadCraft Studio for Acme Architects'); assert.equal(data.sso.url, 'https://getcadcraft.com/sso?team=acme'); assert.deepEqual(data.addons, [{ id: 'maker-pack', version: '1.2.0', first_party: false, apps: ['cadcraft'] }]); });
t('the add-on is inside the app that takes it and in its index', () => {
  assert.equal(fs.readFileSync(path.join(d1, 'apps/cadcraft/assets/apps/cadcraft/0.7/addons/maker-pack/lib/a.js'), 'utf8'), 'export default 1');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d1, 'apps/cadcraft/assets/apps/cadcraft/0.7/addons/index.json'), 'utf8')).addons, ['hvac', 'maker-pack']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d1, 'apps/bimcraft/assets/apps/bimcraft/0.7/addons/index.json'), 'utf8')).addons, []);
});
t('pages name the boot script; offline lists carry the custom files', () => {
  assert.match(fs.readFileSync(path.join(d1, 'index.html'), 'utf8'), /src="custom\/boot\.js"/);
  const a = fs.readFileSync(path.join(d1, 'apps/cadcraft/index.html'), 'utf8');
  assert.match(a, /src="\.\.\/\.\.\/custom\/boot\.js"/);
  assert.ok(JSON.parse(/id="cc-offline">([\s\S]*?)<\/script>/.exec(a)[1]).urls.includes('custom/boot.js'));
  assert.ok(JSON.parse(/id="studio-suite">([\s\S]*?)<\/script>/.exec(fs.readFileSync(path.join(d1, 'index.html'), 'utf8'))[1]).offline.urls.includes('custom/custom.json'));
});
t('the logo is copied', () => assert.ok(fs.existsSync(path.join(d1, 'custom/logo.svg'))));
const refuse = (name, mutate, re) => t('refused: ' + name, () => { const d = mkSuite(); const p = plan(d); mutate(p, d); assert.throws(() => C.applyCustom(d, cfg, p), re); });
refuse('add-on for an app not in the build', (p) => { p.addonsPlan[0].apps = ['partcraft']; }, /none of those/);
refuse('app without a loader index', (p, d) => { fs.rmSync(path.join(d, 'apps/cadcraft/assets/apps/cadcraft/0.7/addons/index.json')); }, /no bundled add-on loader/);
refuse('escaping file path', (p) => { p.addonsPlan[0].files['../../evil.js'] = Buffer.from('x'); }, /bad file path/);
refuse('default-on add-on that is nowhere', (p) => { p.firstParty.cadcraft = new Set(); }, /addons_on/);

// ---- the signed manifest
const priv = path.join(tmp, 'key', 'k.key'), pub = path.join(tmp, 'k.pub');
C.createKey(priv, pub);
t('a key is made once, never replaced', () => { assert.throws(() => C.createKey(priv, pub), /refusing/); assert.equal(fs.statSync(priv).mode & 0o777, 0o600); });
const kid = C.signTree(d1, cfg.id, '0.7', fs.readFileSync(priv));
t('verifies as signed', () => { const v = C.verifyTree(d1, fs.readFileSync(pub)); assert.deepEqual(v.problems, []); assert.equal(kid, C.keyId(fs.readFileSync(pub))); });
t('the manifest lists every file but itself', () => {
  const m = JSON.parse(fs.readFileSync(path.join(d1, 'custom/MANIFEST.json'), 'utf8'));
  assert.ok(m.files.some((f) => f.path === 'custom/custom.json')); assert.ok(!m.files.some((f) => f.path.startsWith('custom/MANIFEST')));
});
const tamper = (name, fn, re) => t('detects: ' + name, () => { const d = mkSuite(); C.applyCustom(d, cfg, plan(d)); C.signTree(d, cfg.id, '0.7', fs.readFileSync(priv)); fn(d); const v = C.verifyTree(d, fs.readFileSync(pub)); assert.equal(v.ok, false); assert.match(v.problems.join('|'), re); });
tamper('a changed file', (d) => fs.appendFileSync(path.join(d, 'apps/cadcraft/assets/apps/cadcraft/0.7/addons/maker-pack/lib/a.js'), ' '), /changed:/);
tamper('a removed file', (d) => fs.rmSync(path.join(d, 'custom/boot.js')), /missing:/);
tamper('an added file', (d) => fs.writeFileSync(path.join(d, 'extra.js'), 'x'), /not in the manifest/);
tamper('an edited manifest', (d) => { const f = path.join(d, 'custom/MANIFEST.json'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('0.7', '0.8')); }, /signature does not match/);
tamper('a swapped custom.json', (d) => fs.writeFileSync(path.join(d, 'custom/custom.json'), '{}'), /changed:/);
t('another key does not verify', () => { const p2 = path.join(tmp, 'k2.key'), q2 = path.join(tmp, 'k2.pub'); C.createKey(p2, q2); assert.equal(C.verifyTree(d1, fs.readFileSync(q2)).ok, false); });
t('no manifest = not good', () => assert.equal(C.verifyTree(mkSuite(), fs.readFileSync(pub)).ok, false));

// ---- the page script
const store = (o = {}) => (k) => (k in o ? o[k] : null);
const D = { defaults: { space: 'paper', units_star: { length: 'mm' }, addons_on: ['hvac', 'piping'] } };
t('seeds theme, units and add-ons on a first run', () => { const p = Object.fromEntries(seedPlan(D, 'cadcraft', store())); assert.equal(p['cc-space'], 'paper'); assert.deepEqual(JSON.parse(p['cc-units']), { v: 1, on: {}, star: { length: 'mm' } }); assert.deepEqual(JSON.parse(p['cc-addons:cadcraft']).on, { hvac: true, piping: true }); });
t('a person\'s own choices win', () => { const p = seedPlan(D, 'cadcraft', store({ 'cc-space': 'model', 'cc-units': '{}', 'cc-addons:cadcraft': JSON.stringify({ off: { hvac: 'x' }, on: { piping: true } }) })); assert.deepEqual(p, []); });
t('the hub gets no add-on keys', () => assert.ok(!seedPlan(D, 'hub', store()).some(([k]) => k.startsWith('cc-addons'))));
t('system theme is not written', () => assert.ok(!seedPlan({ defaults: { space: 'system' } }, 'hub', store()).length));
t('page key from the path', () => { assert.equal(pageKey('/studio/apps/cadcraft/index.html'), 'cadcraft'); assert.equal(pageKey('/studio/'), 'hub'); });
t('desktop plan: updates are decided (never our public Studio)', () => {
  const dm = C.desktopPlan(C.checkConfig(good, ctx).cfg, '0.8'); assert.match(dm, /edition=custom/); assert.match(dm, /never updated from our public Studio/);
  const own = C.desktopPlan(C.checkConfig({ ...good, updates: { endpoint: 'https://feed.acme.example/u' } }, ctx).cfg, '0.8'); assert.match(own, /CC_UPDATE_ENDPOINT='https:\/\/feed\.acme\.example\/u'/); assert.doesNotMatch(own, /edition=custom/);
});
t('desktop plan names the commands and says nothing was run', () => { const x = C.desktopPlan(cfg, '0.7'); assert.match(x, /node build\.mjs studio --edition/); assert.match(x, /MSIX_WEB_PUBLISHER/); assert.match(x, /None of this was run/); });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
