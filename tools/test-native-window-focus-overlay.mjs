import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {nativeFocusOverlay} from './native-window-focus-overlay.mjs';
const sourceHost=fs.readFileSync(new URL('../../cadcraft-detailcraft/app/host.js',import.meta.url),'utf8'),sourceHub=fs.readFileSync(new URL('../hub/hub.js',import.meta.url),'utf8');
const normalize=s=>s.replaceAll('DetailCraft','SteleFab').replaceAll('CadCraft Studio','SteleFab');
const host=sourceHost.replace(/^  \/\/ BEGIN maintained-native-window-focus\n[\s\S]*?^  \/\/ END maintained-native-window-focus\n/m,'').replace('openApp = null, nativeWindows = null, activityLog = null','openApp = null, activityLog = null');
const hub=sourceHub.replace('createControlRelay({ channel, activityLog, nativeWindows: desk.windows || null, onDisconnect:','createControlRelay({ channel, activityLog, onDisconnect:');
let count=0;
for(const input of [{host,hub},{host:sourceHost,hub:sourceHub},{host:host.replaceAll('SteleFab','DetailCraft'),hub:hub.replaceAll('SteleFab','CadCraft Studio')}]){
 const r=nativeFocusOverlay({...input,sourceHost,sourceHub});assert.equal(normalize(r.host),normalize(sourceHost));assert.equal(normalize(r.hub),normalize(sourceHub));assert.equal(r.provenance.kind,'minimal-maintained-native-window-focus');count+=3;
}
for(const change of [{host:host+'\n// unrelated version change'},{hub:hub.replace('async function','async function /* unrelated API */')},{sourceHost:host},{sourceHub:hub},{host:host.replace("  d.tool({ name: 'studio_windows_list'", "  d.tool({ name: 'different'" )}]){
 assert.throws(()=>nativeFocusOverlay({host,hub,sourceHost,sourceHub,...change}),/compatibility|incomplete/);count++;
}
// Actual previously signed production shared shell, read-only. No bundle writes or staging.
const bundle=process.argv[2];
if(bundle){
 const paths=['host.js','hub.js'].map(n=>`${bundle}/Contents/Resources/app/hub/${n}`),bytes=paths.map(p=>fs.readFileSync(p)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 const actual=nativeFocusOverlay({host:bytes[0].toString(),hub:bytes[1].toString(),sourceHost,sourceHub});assert.equal(normalize(actual.host),normalize(sourceHost));assert.equal(normalize(actual.hub),normalize(sourceHub));
 assert.deepEqual(paths.map(p=>sha(fs.readFileSync(p))),bytes.map(sha));count+=3;
 console.log('Actual signed baseline source compatibility verified read-only; bundle hashes unchanged');
}
console.log(`Native-focus minimal overlay: ${count} assertions passed`);
