import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const source=path.resolve(process.argv[2]||'cadcraft-detailcraft');
const suite=path.resolve(process.argv[3]||'cadcraft-studio/out/studio-suite/v0.8.1');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'devshell/vendor.json'),'utf8'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
let copied=0,kept=0;const missing=[],rejected=[];
for(const [lib,spec] of Object.entries(manifest.libs))for(const [rel,size,hash] of spec.files){
 const dest=path.join(source,'devshell/vendor',lib,spec.version,rel);
 if(fs.existsSync(dest)){const b=fs.readFileSync(dest);if(b.length===size&&digest(b)===hash){kept++;continue;}}
 const from=path.join(suite,'assets/vendor',lib,spec.version,rel);
 if(!fs.existsSync(from)){missing.push(`${lib}/${spec.version}/${rel}`);continue;}
 const bytes=fs.readFileSync(from);if(bytes.length!==size||digest(bytes)!==hash){rejected.push(`${lib}/${spec.version}/${rel}`);continue;}
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);copied++;
}
console.log(JSON.stringify({source,suite,copied,kept,missing,rejected},null,2));
if(rejected.length)process.exitCode=1;
