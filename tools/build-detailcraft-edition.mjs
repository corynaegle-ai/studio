import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);const opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const source=path.resolve(opt('--source','cadcraft-detailcraft'));
const suite=path.resolve(opt('--suite','cadcraft-studio/out/studio-suite/v0.8.1'));
const out=path.resolve(opt('--out','work/runtime-integration/build-'+new Date().toISOString().replace(/[:.]/g,'-')));
const version=opt('--version','dev');const php=process.env.PHP_BIN||'/opt/homebrew/bin/php';
if(fs.existsSync(out))throw Error('Output exists; use a fresh --out directory: '+out);
fs.mkdirSync(out,{recursive:true});
const snapshot=path.join(out,'source');fs.mkdirSync(snapshot);
for(const f of ['app','devshell','LICENSE','NOTICE','PROVENANCE.md','TRADEMARKS.md'])fs.cpSync(path.join(source,f),path.join(snapshot,f),{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const recovered=[];
// Upstream0.8.1 standalone source omits this shared-shell file despite edition.mjs requiring it.
for(const rel of ['assets/js/app-lang-boot.js']){
 const dest=path.join(snapshot,'devshell/site',rel);
 if(!fs.existsSync(dest)){
  const from=path.join(suite,rel);const bytes=fs.readFileSync(from);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
  recovered.push({file:'devshell/site/'+rel,from,sha256:sha(bytes),reason:'Required by upstream edition.mjs but omitted from standalone source checkout; reused licensed bundled0.8.1 shared-shell implementation.'});
 }
}
const kit=JSON.parse(fs.readFileSync(path.join(snapshot,'devshell/edition/kit.json'),'utf8'));
for(const [lib,spec] of Object.entries(kit.shell)){
 const dest=path.join(snapshot,'devshell/site',spec.from,'current');
 if(!fs.existsSync(dest)){
  const from=path.join(suite,'assets/vendor',lib,spec.version);
  fs.cpSync(from,dest,{recursive:true});
  recovered.push({file:'devshell/site/'+spec.from+'/current/',from,reason:'Required pinned shared-shell dependency missing from standalone source; reused existing licensed suite version.'});
 }
}
// Pinned official shared-shell modules omitted from the0.8.1 standalone source and bundle.
const support=path.join(path.dirname(fileURLToPath(import.meta.url)),'detailcraft-build-support');
const supportManifest=JSON.parse(fs.readFileSync(path.join(support,'provenance.json'),'utf8'));
for(const entry of supportManifest.files){
 const bytes=fs.readFileSync(path.join(support,entry.name));if(sha(bytes)!==entry.sha256)throw Error('Build support hash mismatch: '+entry.name);
 const dest=path.join(snapshot,'devshell/site/assets/js',entry.name);
 if(!fs.existsSync(dest)){fs.writeFileSync(dest,bytes);recovered.push({file:'devshell/site/assets/js/'+entry.name,from:entry.url,sha256:entry.sha256,reason:'Pinned unmodified official Apache-2.0 shared-shell module required by source imports.'});}
}
const packer=path.join(snapshot,'devshell/edition.mjs');let packerCode=fs.readFileSync(packer,'utf8');
const copyNeedle="'assets/js/app-lang-boot.js'";
if(packerCode.split(copyNeedle).length!==2)throw Error('Upstream packer copy list changed; review snapshot patch');
packerCode=packerCode.replace(copyNeedle,"'assets/js/app-devices-ui.js', 'assets/js/app-devices.js', 'assets/js/app-devices-studio.js', 'assets/js/app-addons-account.js', "+copyNeedle);
fs.writeFileSync(packer,packerCode);recovered.push({file:'devshell/edition.mjs',reason:'Snapshot-only copy-list correction: include device UI and its dependency modules plus optional add-on account module referenced by app-fields.js.'});
// Preserve recovery provenance above, then rebrand only recovered shared-shell presentation strings.
for(const entry of recovered){const rel=entry.file;if(!rel?.startsWith('devshell/site/assets/js/')||!rel.endsWith('.js'))continue;const p=path.join(snapshot,rel);if(!fs.existsSync(p))continue;const old=fs.readFileSync(p,'utf8'),next=old.replaceAll('DetailCraft','SteleFab');if(next!==old){entry.presentationPatch={from:'DetailCraft',to:'SteleFab',sourceSha256:sha(Buffer.from(old)),resultSha256:sha(Buffer.from(next))};fs.writeFileSync(p,next);}}
const inputs={};function walk(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const rel=prefix+entry.name;const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p,rel+'/');else inputs[rel]=sha(fs.readFileSync(p));}}
walk(snapshot);
const git=(argv)=>{const r=spawnSync('git',['-C',source,...argv],{encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
fs.writeFileSync(path.join(out,'source-working-tree.patch'),(git(['diff','--binary'])||'')+'\n');
const record={source,sourceHead:git(['rev-parse','HEAD']),sourceStatus:git(['status','--short']),snapshot,version,php,recovered,inputs,sourcePatch:'source-working-tree.patch'};
fs.writeFileSync(path.join(out,'build-inputs.json'),JSON.stringify(record,null,2)+'\n');
const r=spawnSync(process.execPath,[path.join(snapshot,'devshell/edition.mjs'),'--version',version,'--out',path.join(out,'edition'),'--offline'],{encoding:'utf8',env:{...process.env,PHP_BIN:php},maxBuffer:16<<20});
fs.writeFileSync(path.join(out,'edition-build.log'),(r.stdout||'')+(r.stderr||''));
console.log((r.stdout||'')+(r.stderr||''));
if(r.status!==0)process.exit(r.status||1);
console.log('Build record: '+path.join(out,'build-inputs.json'));
