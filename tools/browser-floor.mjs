// SPDX-License-Identifier: Apache-2.0
// SU.1061 (0.8): the oldest browser / web view the shipped suite can run in, MEASURED from the code.
//   node tools/browser-floor.mjs <suite folder> [--json out.json]     needs acorn + @mdn/browser-compat-data (npm i, not shipped)
// Two floors, kept apart:
//  - SYNTAX: every .js file is parsed; each syntax feature found is looked up in MDN's compatibility data. An older engine
//    fails to parse the file, so this floor is hard — below it nothing starts.
//  - APIS: a curated list of web APIs named in the code (text match). A name guarded by `typeof X` / `'X' in` in the same file
//    is listed as guarded and does not set the floor. Text matching can over-count (a method with the same name on another
//    object), so this floor is "at most this old"; it is never read as a promise about an engine nobody ran.
// Neither floor is a test in an old browser. The result says which engine versions the code asks for.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(process.env.FLOOR_DEPS ? path.join(process.env.FLOOR_DEPS, 'x.js') : import.meta.url);
const acorn = require('acorn');
const bcd = require('@mdn/browser-compat-data');

const root = process.argv[2];
if (!root) { console.error('usage: node browser-floor.mjs <suite folder> [--json out.json]'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const ENGINES = ['chrome', 'firefox', 'safari'];   // Edge / WebView2 / Android WebView = Chromium; WKWebView / iOS = Safari

const get = (p) => p.split('.').reduce((o, k) => o && o[k], bcd);
function since(featurePath) {
  const c = get(featurePath)?.__compat;
  if (!c) return null;
  const out = {};
  for (const e of ENGINES) {
    let s = c.support?.[e];
    if (Array.isArray(s)) s = s.find((x) => !x.prefix && !x.alternative_name && !x.flags) || s[0];
    let v = s?.version_added;
    if (v === true) v = '1'; if (v === false || v == null) { out[e] = 999; continue; }
    out[e] = parseFloat(String(v).replace('≤', '')) || 0;
  }
  return out;
}

// syntax -> BCD path
const SYN = {
  optional_chaining: 'javascript.operators.optional_chaining', nullish: 'javascript.operators.nullish_coalescing',
  logical_assign: 'javascript.operators.nullish_coalescing_assignment', class_fields: 'javascript.classes.public_class_fields',
  private_fields: 'javascript.classes.private_class_fields', private_methods: 'javascript.classes.private_class_methods',
  static_block: 'javascript.classes.static_initialization_blocks', private_in: 'javascript.classes.private_class_fields_in',
  top_level_await: 'javascript.operators.await.top_level', import_meta: 'javascript.operators.import_meta',
  dynamic_import: 'javascript.operators.import', bigint: 'javascript.builtins.BigInt', numeric_sep: 'javascript.grammar.numeric_separators',
  for_await: 'javascript.statements.for_await_of', object_spread: 'javascript.operators.spread.spread_in_object_literals',
  optional_catch: 'javascript.statements.try_catch.optional_catch_binding', re_lookbehind: 'javascript.regular_expressions.lookbehind_assertion',
  re_named: 'javascript.regular_expressions.named_capturing_group', re_dotall: 'javascript.builtins.RegExp.dotAll',
  re_unicode_prop: 'javascript.regular_expressions.unicode_character_class_escape', re_indices: 'javascript.builtins.RegExp.hasIndices',
  re_v: 'javascript.builtins.RegExp.unicodeSets', exponent: 'javascript.operators.exponentiation',
};
// APIs -> [regex, BCD path]
const API = [
  ['Array.prototype.at', /\.at\(\s*-?\d/, 'javascript.builtins.Array.at'], ['Object.hasOwn', /Object\.hasOwn\(/, 'javascript.builtins.Object.hasOwn'],
  ['structuredClone', /\bstructuredClone\(/, 'api.structuredClone'], ['Array.findLast', /\.findLast(Index)?\(/, 'javascript.builtins.Array.findLast'],
  ['String.replaceAll', /\.replaceAll\(/, 'javascript.builtins.String.replaceAll'], ['Array.toSorted', /\.(toSorted|toReversed|toSpliced)\(/, 'javascript.builtins.Array.toSorted'],
  ['Object.groupBy', /\b(Object|Map)\.groupBy\(/, 'javascript.builtins.Object.groupBy'], ['Promise.withResolvers', /Promise\.withResolvers\(/, 'javascript.builtins.Promise.withResolvers'],
  ['Set methods', /\.(union|intersection|difference|symmetricDifference|isSubsetOf)\(/, 'javascript.builtins.Set.union'],
  ['AbortSignal.any', /AbortSignal\.any\(/, 'api.AbortSignal.any_static'], ['AbortSignal.timeout', /AbortSignal\.timeout\(/, 'api.AbortSignal.timeout_static'],
  ['crypto.randomUUID', /\.randomUUID\(/, 'api.Crypto.randomUUID'], ['OffscreenCanvas', /\bOffscreenCanvas\b/, 'api.OffscreenCanvas'],
  ['WebGL2', /['"]webgl2['"]/, 'api.WebGL2RenderingContext'], ['WebGPU', /navigator\.gpu\b/, 'api.GPU'],
  ['SharedArrayBuffer', /\bSharedArrayBuffer\b/, 'javascript.builtins.SharedArrayBuffer'], ['CompressionStream', /\b(Compression|Decompression)Stream\b/, 'api.CompressionStream'],
  ['File System Access', /\bshowOpenFilePicker\b|\bshowSaveFilePicker\b/, 'api.Window.showOpenFilePicker'], ['Intl.Segmenter', /Intl\.Segmenter/, 'javascript.builtins.Intl.Segmenter'],
  ['ResizeObserver', /\bResizeObserver\b/, 'api.ResizeObserver'], ['IntersectionObserver', /\bIntersectionObserver\b/, 'api.IntersectionObserver'],
  ['Pointer events', /\bpointerdown\b/, 'api.Element.pointerdown_event'], ['Web Locks', /navigator\.locks\b/, 'api.LockManager'],
  ['BroadcastChannel', /\bBroadcastChannel\b/, 'api.BroadcastChannel'], ['IndexedDB', /\bindexedDB\b/, 'api.indexedDB'],
  ['WebAssembly', /\bWebAssembly\b/, 'webassembly.api'], 
  ['Service worker', /serviceWorker\b/, 'api.ServiceWorker'], ['ES modules in workers', /type:\s*['"]module['"]/, 'api.Worker.Worker.options_type_parameter'],
  ['CSS :has()', /:has\(/, 'css.selectors.has'], ['CSS container queries', /@container\b/, 'css.at-rules.container'], ['CSS nesting', /&\s*[.:]\w/, null],
  ['Array.fromAsync', /Array\.fromAsync\(/, 'javascript.builtins.Array.fromAsync'], ['Float16Array', /\bFloat16Array\b/, 'javascript.builtins.Float16Array'],
  ['Clipboard async', /navigator\.clipboard\b/, 'api.Clipboard'], ['Fullscreen', /requestFullscreen\b/, 'api.Element.requestFullscreen'],
];
for (const a of API) { a.push(a[2] ? since(a[2]) : null); if (a[2] && !a[3]) throw new Error('BCD path missing for ' + a[0]); }
const synSince = Object.fromEntries(Object.entries(SYN).map(([k, p]) => [k, since(p)]));
for (const [k, v] of Object.entries(synSince)) if (!v) throw new Error('BCD path missing for ' + k);

const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (/\.m?js$/.test(e.name)) files.push(f); } })(root);

const synHits = {}, apiHits = {}, apiGuarded = {}, unparsed = [];
const note = (m, k, f) => { (m[k] ||= new Set()).add(path.relative(root, f)); };
function scanSyntax(ast, f) {
  (function visit(n) {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'ChainExpression': note(synHits, 'optional_chaining', f); break;
      case 'LogicalExpression': if (n.operator === '??') note(synHits, 'nullish', f); break;
      case 'AssignmentExpression': if (['??=', '||=', '&&='].includes(n.operator)) note(synHits, 'logical_assign', f); if (n.operator === '**=') note(synHits, 'exponent', f); break;
      case 'PropertyDefinition': note(synHits, 'class_fields', f); if (n.key.type === 'PrivateIdentifier') note(synHits, 'private_fields', f); break;
      case 'MethodDefinition': if (n.key.type === 'PrivateIdentifier') note(synHits, 'private_methods', f); break;
      case 'StaticBlock': note(synHits, 'static_block', f); break;
      case 'BinaryExpression': if (n.left.type === 'PrivateIdentifier') note(synHits, 'private_in', f); if (n.operator === '**') note(synHits, 'exponent', f); break;
      case 'AwaitExpression': if (!n.__inFn) note(synHits, '_await', f); break;
      case 'MetaProperty': if (n.meta.name === 'import') note(synHits, 'import_meta', f); break;
      case 'ImportExpression': note(synHits, 'dynamic_import', f); break;
      case 'ForOfStatement': if (n.await) note(synHits, 'for_await', f); break;
      case 'SpreadElement': case 'ExperimentalSpreadProperty': break;
      case 'ObjectExpression': if (n.properties.some((p) => p.type === 'SpreadElement')) note(synHits, 'object_spread', f); break;
      case 'CatchClause': if (!n.param) note(synHits, 'optional_catch', f); break;
      case 'Literal':
        if (n.bigint) note(synHits, 'bigint', f);
        if (typeof n.raw === 'string' && /^[0-9][0-9a-fx.]*_[0-9]/i.test(n.raw)) note(synHits, 'numeric_sep', f);
        if (n.regex) {
          const { pattern: p, flags: fl } = n.regex;
          if (/\(\?<[=!]/.test(p)) note(synHits, 're_lookbehind', f); if (/\(\?<[A-Za-z_$]/.test(p)) note(synHits, 're_named', f);
          if (/\\[pP]\{/.test(p)) note(synHits, 're_unicode_prop', f);
          if (fl.includes('s')) note(synHits, 're_dotall', f); if (fl.includes('d')) note(synHits, 're_indices', f); if (fl.includes('v')) note(synHits, 're_v', f);
        }
        break;
    }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === 'string') visit(v); }
  })(ast);
}
// top-level await: an AwaitExpression with no enclosing function
function hasTopLevelAwait(ast) {
  let found = false;
  (function visit(n, inFn) {
    if (!n || typeof n.type !== 'string' || found) return;
    const fn = inFn || /Function/.test(n.type);
    if (n.type === 'AwaitExpression' && !inFn) { found = true; return; }
    if (n.type === 'ForOfStatement' && n.await && !inFn) { found = true; return; }
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach((x) => visit(x, fn)); else if (v && typeof v.type === 'string') visit(v, fn); }
  })(ast, false);
  return found;
}
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let ast = null;
  for (const sourceType of ['module', 'script']) {
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true }); if (sourceType === 'module' && hasTopLevelAwait(ast)) note(synHits, 'top_level_await', f); break; } catch { ast = null; }
  }
  if (!ast) { unparsed.push(path.relative(root, f)); } else { scanSyntax(ast, f); }
  for (const [name, re, , v] of API) {
    if (!v || !re.test(src)) continue;
    const bare = name.replace(/^.*\./, '');
    const guarded = new RegExp(`typeof\\s+${bare}\\b|['"]${bare}['"]\\s+in\\b|\\b${bare}\\s*\\?\\?|\\b${bare}\\s*&&|if\\s*\\(\\s*!?\\s*(window\\.|self\\.|globalThis\\.)?${bare}\\b`).test(src);
    note(guarded ? apiGuarded : apiHits, name, f);
  }
}
if (synHits._await) { delete synHits._await; }
const floor = (names, table) => {
  const out = Object.fromEntries(ENGINES.map((e) => [e, { v: 0, by: '' }]));
  for (const n of names) for (const e of ENGINES) { const v = table(n)?.[e]; if (v != null && v > out[e].v) out[e] = { v, by: n }; }
  return out;
};
const synFloor = floor(Object.keys(synHits), (n) => synSince[n]);
const apiTable = Object.fromEntries(API.map((a) => [a[0], a[3]]));
const apiFloor = floor(Object.keys(apiHits), (n) => apiTable[n]);
const result = {
  suite: root, files: files.length, unparsed,
  syntax: { floor: synFloor, found: Object.fromEntries(Object.entries(synHits).map(([k, v]) => [k, { files: v.size, since: synSince[k] }])) },
  apis: { floor: apiFloor, named: Object.fromEntries(Object.entries(apiHits).map(([k, v]) => [k, { files: v.size, since: apiTable[k], example: [...v][0] }])), guarded: Object.fromEntries(Object.entries(apiGuarded).map(([k, v]) => [k, { files: v.size, since: apiTable[k] }])) },
  bcd: bcd.__meta?.version,
};
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
const line = (t, fl) => console.log(`${t.padEnd(8)} ` + ENGINES.map((e) => `${e} ${fl[e].v}${fl[e].by ? ` (${fl[e].by})` : ''}`).join(' · '));
console.log(`${files.length} files, ${unparsed.length} not parsed, MDN data ${result.bcd}`);
line('syntax', synFloor); line('apis', apiFloor);
if (unparsed.length) console.log('not parsed:', unparsed.slice(0, 10).join(', '));
