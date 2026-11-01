// SPDX-License-Identifier: Apache-2.0
/**
 * custom.mjs — the suite packer's custom edition ("CadCraft Studio for <Organisation>"; 0.8 AL.18, docs/0.8-ADDON-LIBRARY-SPEC.md § 12.2).
 * suite.mjs --custom <config.json> builds the usual suite and then calls applyCustom() here: the organisation's name beside ours, its
 * add-ons inside the binary (first-party ones switched on, outside makers' ones bundled when the maker allowed it), its defaults, a link to
 * its sign-in (team SSO on getcadcraft.com), and a signed manifest of every file.
 *
 * Config (format cadcraft-custom-build, version 1; unknown keys are refused):
 *   id                 slug, 2–39 characters [a-z0-9-]
 *   organisation       the name shown after "CadCraft Studio for " — never instead of ours
 *   seats              how many people (the bundling statement for paid items is per seat)
 *   apps               optional subset of the lineup (default: all)
 *   branding           { accent: "#rrggbb", logo: "<png or svg next to the config, ≤ 100 KB>" }
 *   defaults           { space: paper|model|system, units_star: { length: "mm", … } (ids of lib/units/unit-table.js),
 *                        addons_on: [first-party add-on ids switched on at first run] }
 *   addons             [{ id, version? }]  Library add-ons bundled into the build (outside makers' only with their bundling licence)
 *   sso                { team: "<team slug>" }  the sign-in link points at getcadcraft.com/sso?team=<slug> (Team Cloud Plan, owner sets it up)
 *   updates            "device-management" (default: the desktop build asks our feed with edition=custom, which always answers 204 "nothing newer", so the
 *                      organisation's own tools update it) or { endpoint: "https://…" } (its own feed, set as CC_UPDATE_ENDPOINT). Never our public Studio.
 * Not here (said, never faked): regulation-pack and language defaults (the suite has no seeding path for them yet), platform code signing
 * (Authenticode / Apple notarisation: docs/guides/custom-builds/), the desktop installers (custom/desktop plan written beside the build).
 *
 * Signing: Ed25519 over custom/MANIFEST.json (sha256 + size of every other file). The private key lives OUTSIDE the repo
 * (CC_HOME/secrets/custom-build-signing.key, 0600; `node pack/custom.mjs --create-key`); its public half is studio/pack/custom-build-signing.pub.
 * This proves the folder is as the packer left it; it is not an operating-system signature.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const FORMAT = 'cadcraft-custom-build';
export const MANIFEST_FORMAT = 'cadcraft-custom-manifest';
const KEYS = new Set(['format', 'version', 'id', 'organisation', 'seats', 'apps', 'branding', 'defaults', 'addons', 'sso', 'updates']);
const MAX_LOGO = 100 * 1024;

/** Validate a config object. `ctx` = { slugs: [app slugs], unitOk: (kind, id) => bool }. Returns { cfg, errors }. */
export function checkConfig(raw, ctx = {}) {
  const errors = [];
  const bad = (m) => errors.push(m);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { cfg: null, errors: ['the config must be a JSON object'] };
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) bad(`unknown key "${k}"`);
  if (raw.format !== FORMAT) bad(`format must be "${FORMAT}"`);
  if (raw.version !== 1) bad('version must be 1');
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}$/.test(raw.id)) bad('id: 2–39 characters, a–z, 0–9 and -');
  const org = typeof raw.organisation === 'string' ? raw.organisation.trim() : '';
  if (org.length < 2 || org.length > 80 || /[<>&"\u0000-\u001f]/.test(org)) bad('organisation: 2–80 characters, no < > & " or control characters');
  if (/\bcad\s*craft\b/i.test(org)) bad('organisation: our name is shown beside yours; do not put it in yours');
  if (raw.seats !== undefined && !(Number.isInteger(raw.seats) && raw.seats >= 1 && raw.seats <= 100000)) bad('seats: a whole number from 1 to 100000');
  let apps = null;
  if (raw.apps !== undefined) {
    if (!Array.isArray(raw.apps) || !raw.apps.length) bad('apps: a non-empty list of app slugs');
    else for (const s of raw.apps) if (ctx.slugs && !ctx.slugs.includes(s)) bad(`apps: unknown app "${s}"`);
    apps = Array.isArray(raw.apps) ? [...new Set(raw.apps)] : null;
  }
  const br = raw.branding ?? {};
  if (typeof br !== 'object' || Array.isArray(br)) bad('branding must be an object');
  else {
    for (const k of Object.keys(br)) if (!['accent', 'logo'].includes(k)) bad(`branding: unknown key "${k}"`);
    if (br.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(br.accent)) bad('branding.accent: #rrggbb');
    if (br.logo !== undefined && (typeof br.logo !== 'string' || !/^[A-Za-z0-9._-]+\.(png|svg)$/.test(br.logo))) bad('branding.logo: a .png or .svg file name next to the config');
  }
  const df = raw.defaults ?? {};
  if (typeof df !== 'object' || Array.isArray(df)) bad('defaults must be an object');
  else {
    for (const k of Object.keys(df)) if (!['space', 'units_star', 'addons_on'].includes(k)) bad(`defaults: "${k}" is not supported (regulation packs and language have no seeding path yet)`);
    if (df.space !== undefined && !['paper', 'model', 'system'].includes(df.space)) bad('defaults.space: paper, model or system');
    if (df.units_star !== undefined) {
      if (typeof df.units_star !== 'object' || Array.isArray(df.units_star)) bad('defaults.units_star: an object kind → unit id');
      else for (const [kind, id] of Object.entries(df.units_star)) if (ctx.unitOk && !ctx.unitOk(kind, id)) bad(`defaults.units_star: "${id}" is not a ${kind} unit`);
    }
    if (df.addons_on !== undefined && (!Array.isArray(df.addons_on) || df.addons_on.some((i) => typeof i !== 'string' || !/^[a-z][a-z0-9.-]{1,63}$/.test(i)))) bad('defaults.addons_on: a list of add-on ids');
  }
  if (raw.addons !== undefined) {
    if (!Array.isArray(raw.addons)) bad('addons: a list');
    else for (const a of raw.addons) {
      if (!a || typeof a.id !== 'string' || !/^[a-z][a-z0-9.-]{1,63}$/.test(a.id)) bad('addons: each needs an id');
      else if (a.version !== undefined && !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]*)?$/.test(a.version)) bad(`addons: "${a.id}" version must be x.y.z`);
      for (const k of Object.keys(a || {})) if (!['id', 'version'].includes(k)) bad(`addons: unknown key "${k}"`);
    }
  }
  if (raw.sso !== undefined) {
    if (!raw.sso || typeof raw.sso !== 'object' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(raw.sso.team || '')) bad('sso.team: the team\'s address name (slug)');
    for (const k of Object.keys(raw.sso || {})) if (k !== 'team') bad(`sso: unknown key "${k}"`);
  }
  let updates = 'device-management';
  if (raw.updates !== undefined) {
    if (raw.updates === 'device-management') updates = 'device-management';
    else if (raw.updates && typeof raw.updates === 'object' && !Array.isArray(raw.updates)) {
      for (const k of Object.keys(raw.updates)) if (k !== 'endpoint') bad(`updates: unknown key "${k}"`);
      if (typeof raw.updates.endpoint !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/[^\s"'`$\\]*$/.test(raw.updates.endpoint)) bad('updates.endpoint: an https address (the feed answers Tauri\'s update checks)');
      else updates = { endpoint: raw.updates.endpoint };
    } else bad('updates: "device-management" or { endpoint: "https://…" }');
  }
  if (errors.length) return { cfg: null, errors };
  return { cfg: { id: raw.id, organisation: org, seats: raw.seats ?? null, apps, branding: { accent: br.accent ?? null, logo: br.logo ?? null },
    defaults: { space: df.space ?? 'system', units_star: df.units_star ?? {}, addons_on: df.addons_on ?? [] },
    addons: (raw.addons ?? []).map((a) => ({ id: a.id, version: a.version ?? null })), sso: raw.sso ? { team: raw.sso.team } : null, updates }, errors };
}

/** A logo file: PNG by its signature, SVG with nothing that runs or loads (no script, event handlers, foreignObject, external references). */
export function checkLogo(bytes, name) {
  if (bytes.length > MAX_LOGO) return 'the logo is over 100 KB';
  if (/\.png$/.test(name)) return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? null : 'not a PNG file';
  const t = bytes.toString('utf8');
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t)) return 'not an SVG file';
  if (/<\s*(script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|javascript:|data:text|<!ENTITY|<!DOCTYPE/i.test(t)) return 'the SVG has something that can run; use a plain drawing';
  if (/(href|src)\s*=\s*["'](?!#)/i.test(t) || /url\(\s*["']?(?!#)/i.test(t) || /@import/i.test(t)) return 'the SVG refers to a file outside itself';
  return null;
}

/** The sentence every custom page shows: our name first, theirs after it. */
export const lineFor = (organisation) => `CadCraft Studio for ${organisation}`;

// ---------------------------------------------------------------- signing

export function createKey(privFile, pubFile) {
  if (fs.existsSync(privFile)) throw new Error(`${privFile} exists; refusing to replace a signing key`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(privFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(privFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
}
export const keyId = (pubPem) => crypto.createHash('sha256').update(crypto.createPublicKey(pubPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join('/')];
});
const SELF = new Set(['custom/MANIFEST.json', 'custom/MANIFEST.sig']);

/** MANIFEST.json for a folder: every file but itself and its signature, sorted, with sha256 and size. */
export function buildManifest(dest, id, build, kid) {
  const files = walk(dest).filter((r) => !SELF.has(r)).sort().map((r) => {
    const b = fs.readFileSync(path.join(dest, r));
    return { path: r, sha256: crypto.createHash('sha256').update(b).digest('hex'), bytes: b.length };
  });
  return { format: MANIFEST_FORMAT, version: 1, id, build, key_id: kid, files };
}

export function signTree(dest, id, build, privPem) {
  const priv = crypto.createPrivateKey(privPem);
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
  const text = JSON.stringify(buildManifest(dest, id, build, keyId(pub)), null, 1) + '\n';
  fs.writeFileSync(path.join(dest, 'custom/MANIFEST.json'), text);
  fs.writeFileSync(path.join(dest, 'custom/MANIFEST.sig'), crypto.sign(null, Buffer.from(text), priv).toString('base64') + '\n');
  return keyId(pub);
}

/** Check a folder against its signature and the trusted public key. → { ok, problems[] } */
export function verifyTree(dest, pubPem) {
  const problems = [];
  let text, sig;
  try { text = fs.readFileSync(path.join(dest, 'custom/MANIFEST.json')); sig = Buffer.from(fs.readFileSync(path.join(dest, 'custom/MANIFEST.sig'), 'utf8').trim(), 'base64'); }
  catch { return { ok: false, problems: ['no custom/MANIFEST.json or MANIFEST.sig'] }; }
  const pub = crypto.createPublicKey(pubPem);
  if (!crypto.verify(null, text, pub, sig)) return { ok: false, problems: ['the signature does not match the manifest, or it was made by another key'] };
  const m = JSON.parse(text.toString('utf8'));
  if (m.format !== MANIFEST_FORMAT || m.key_id !== keyId(pubPem)) problems.push('the manifest names another key');
  const listed = new Set();
  for (const f of m.files || []) {
    listed.add(f.path);
    if (f.path.includes('..') || path.isAbsolute(f.path)) { problems.push(`bad path ${f.path}`); continue; }
    const p = path.join(dest, f.path);
    if (!fs.existsSync(p)) { problems.push(`missing: ${f.path}`); continue; }
    const b = fs.readFileSync(p);
    if (b.length !== f.bytes || crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) problems.push(`changed: ${f.path}`);
  }
  for (const r of walk(dest)) if (!SELF.has(r) && !listed.has(r)) problems.push(`not in the manifest: ${r}`);
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------- the build

const BOOT = new URL('./custom-boot.js', import.meta.url);

/**
 * Turn a finished suite folder into the organisation's. `plan` = { apps: [slug], build, addonsPlan: [{id, version, first_party, files: {path: Buffer}, apps: [slug], manifest}],
 * firstParty: {slug: Set(ids bundled already)}, logoBytes, logoName }. Returns the public custom.json object.
 * Throws on anything that would ship half-built (an add-on an app cannot carry, a first-party id the build lacks).
 */
export function applyCustom(dest, cfg, plan) {
  const custom = path.join(dest, 'custom');
  fs.mkdirSync(custom, { recursive: true });
  const bundled = [];
  for (const a of plan.addonsPlan) {
    const targets = plan.apps.filter((s) => (a.apps || []).includes(s));
    if (!targets.length) throw new Error(`add-on ${a.id} is for ${(a.apps || []).join(', ') || 'no app'}; none of those is in this build`);
    for (const slug of targets) {
      const adir = path.join(dest, 'apps', slug, 'assets/apps', slug, plan.build, 'addons');
      const idx = path.join(adir, 'index.json');
      if (!fs.existsSync(idx)) throw new Error(`${slug} ${plan.build} has no bundled add-on loader (addons/index.json): ${a.id} cannot go inside it`);
      for (const [rel, bytes] of Object.entries(a.files)) {
        if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`add-on ${a.id}: bad file path ${rel}`);
        const to = path.join(adir, a.id, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.writeFileSync(to, bytes);
      }
      const list = JSON.parse(fs.readFileSync(idx, 'utf8'));
      if (!list.addons.includes(a.id)) { list.addons.push(a.id); fs.writeFileSync(idx, JSON.stringify(list, null, 2) + '\n'); }
    }
    bundled.push({ id: a.id, version: a.version, first_party: a.first_party, apps: targets });
  }
  for (const id of cfg.defaults.addons_on) {
    const have = plan.apps.filter((s) => plan.firstParty[s]?.has(id) || plan.addonsPlan.some((a) => a.id === id && (a.apps || []).includes(s)));
    if (!have.length) throw new Error(`defaults.addons_on: "${id}" is not bundled in any app of this build`);
  }
  let logo = null;
  if (plan.logoBytes) { logo = 'logo' + path.extname(plan.logoName); fs.writeFileSync(path.join(custom, logo), plan.logoBytes); }
  const data = {
    format: FORMAT, version: 1, id: cfg.id, organisation: cfg.organisation, line: lineFor(cfg.organisation), build: plan.build,
    accent: cfg.branding.accent, logo, defaults: cfg.defaults, addons: bundled,
    sso: cfg.sso ? { team: cfg.sso.team, url: `https://getcadcraft.com/sso?team=${encodeURIComponent(cfg.sso.team)}` } : null,
    updates: cfg.updates,
    apps: plan.apps,
  };
  fs.writeFileSync(path.join(custom, 'custom.json'), JSON.stringify(data, null, 2) + '\n');
  fs.copyFileSync(BOOT, path.join(custom, 'boot.js'));
  // Every page names the boot script (relative, so the folder works anywhere); offline lists carry the three files.
  const names = ['custom/custom.json', 'custom/boot.js', ...(logo ? ['custom/' + logo] : [])];
  const tag = (depth) => `  <meta name="cc-custom" content="${cfg.id}">\n  <script type="module" src="${'../'.repeat(depth)}custom/boot.js"></script>\n</head>`;
  const pages = [['index.html', 0], ...plan.apps.map((s) => [`apps/${s}/index.html`, 2])];
  for (const [rel, depth] of pages) {
    const p = path.join(dest, rel);
    let html = fs.readFileSync(p, 'utf8');
    if (!html.includes('</head>')) throw new Error(`${rel}: no </head>`);
    html = html.replace('</head>', tag(depth));
    if (rel === 'index.html') {
      html = html.replace('"offline":{"key":"studio/hub","page":"./","urls":[', (m) => m + names.map((n) => JSON.stringify(n)).join(',') + ',');
    } else {
      html = html.replace(/(<script type="application\/json" id="cc-offline">)([\s\S]*?)(<\/script>)/, (all, a, j, b) => {
        const d = JSON.parse(j); d.urls = [...new Set([...(d.urls || []), ...names])]; return a + JSON.stringify(d).replace(/</g, '\\u003c') + b;
      });
    }
    fs.writeFileSync(p, html);
  }
  return data;
}

/**
 * The desktop side of a custom build, as text for whoever runs it (the packer does not run desktop-shell: its builds are heavy and need the
 * signing material). Commands are the ones in desktop-shell/README.md, msix/PACK.md and SIGNING.md; nothing here is run or signed by us.
 */
export function desktopPlan(cfg, build) {
  const id = cfg.id;
  return `# Desktop builds for ${lineFor(cfg.organisation)} (${build})

Written by pack/suite.mjs --custom. The browser folder is \`studio-suite-custom/${id}/v${build}/\` (signed: \`node pack/custom.mjs --verify <folder>\`).
The desktop packages are built from that same folder, so they carry the same add-ons, defaults and sign-in link. **None of this was run by the packer.**

## Windows installer and Linux packages
\`\`\`
cd desktop-shell     # CADCRAFT_SITE, CADCRAFT_STUDIO and CADCRAFT_SHELL exported as its README says
node build.mjs studio --edition <the folder above> --target windows
node build.mjs studio --edition <the folder above> --target linux
\`\`\`
Windows files are signed through \`CC_SIGN_COMMAND\` (SIGNING.md). Until a signing profile is set the installer is unsigned and Windows says so.

## MSIX for Intune or a software centre
Identity is the organisation's, not ours, and the package must be signed by a certificate its devices trust:
\`\`\`
export MSIX_WEB_IDENTITY_NAME=<Publisher.Name, e.g. ${id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ /g, '')}.CadCraftStudio>
export MSIX_WEB_PUBLISHER="<the signing certificate's subject, the whole CN=… string>"
export MSIX_WEB_PUBLISHER_DISPLAY="${cfg.organisation.replace(/"/g, '')}"
export CC_MSIX_SIGN_COMMAND='<a command that signs %1 with that certificate>'
node build.mjs studio --edition <the folder above> --msix
\`\`\`
Microsoft's pages say the Publisher in the manifest must match the certificate's subject, that Windows requires a signature that chains to a
root the device trusts, and that Intune needs the version string in the manifest raised for each update (see docs/guides/custom-builds/intune-msix.md).

## Updates (decided 2026-10-29)
${cfg.updates === 'device-management'
  ? `A custom build is never updated from our public Studio. Build it with
\`export CC_UPDATE_ENDPOINT='https://getcadcraft.com/api/v1/updates/{{target}}/{{arch}}/{{current_version}}?app={slug}&edition=custom'\`
(the feed answers 204, "nothing newer", for edition=custom). The organisation updates the package with its own tools (Intune raises the MSIX version string).`
  : `The organisation runs its own update feed: \`export CC_UPDATE_ENDPOINT='${cfg.updates.endpoint}'\` before the build (https only; Tauri's update JSON, signed with the updater key of that build, desktop-shell SIGNING.md § Updates).`}
Write which of the two you chose in the build notes.

## Phones and tablets
iPad, iPhone and Android packages go through each store's private routes; the guides in docs/guides/custom-builds/ say which steps Apple's and
Google's own pages state and which they do not.
`;
}

// CLI: node pack/custom.mjs --create-key [--key <file>] | --verify <dir> [--pub <file>] | --check <config.json>
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const HERE = path.dirname(new URL(import.meta.url).pathname);
  const PUB = opt('--pub', path.join(HERE, 'custom-build-signing.pub'));
  const KEY = opt('--key', path.join(process.env.CC_HOME || '/var/www/CADCRAFT', 'secrets', 'custom-build-signing.key'));
  if (argv.includes('--create-key')) { createKey(KEY, PUB); console.log(`key ${KEY} (0600, keep it outside every repo); public half ${PUB} (commit it)`); }
  else if (opt('--verify')) {
    const r = verifyTree(path.resolve(opt('--verify')), fs.readFileSync(PUB));
    console.log(r.ok ? 'signature good; every file as signed' : 'NOT GOOD:\n  ' + r.problems.join('\n  '));
    process.exit(r.ok ? 0 : 1);
  } else if (opt('--check')) {
    const { errors } = checkConfig(JSON.parse(fs.readFileSync(opt('--check'), 'utf8')), {});
    console.log(errors.length ? 'config problems:\n  ' + errors.join('\n  ') : 'config ok (app and unit names are checked when the suite is built)');
    process.exit(errors.length ? 1 : 0);
  } else { console.error('usage: custom.mjs --create-key | --verify <dir> [--pub f] | --check <config.json>'); process.exit(2); }
}
