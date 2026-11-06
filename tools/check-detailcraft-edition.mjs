import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);const opt=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
if(!args.includes('--edition'))throw Error('Usage: node check-detailcraft-edition.mjs --edition <directory> [--report <json>]');
const root=path.resolve(opt('--edition'));const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const local=p=>p.split(/[?#]/)[0];
const htmlLinks=[...html.matchAll(/\b(?:src|href)=["'](\.\/?[^"']+)["']/g)].map(m=>m[1]);
const missingHtmlAssets=htmlLinks.filter(u=>!fs.existsSync(path.resolve(root,local(u))));
const files=[];function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p);}}walk(root);
const missingImports=[];const knownOptional=[];
const optional=new Set(['assets/apps/detailcraft/dev/addons.js|./render/engines.js','assets/apps/detailcraft/dev/addons.js|./render/engine-addon.js']);
for(const p of files){const rel=path.relative(root,p).split(path.sep).join('/');const code=fs.readFileSync(p,'utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 for(const m of code.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g)){
  if(fs.existsSync(path.resolve(path.dirname(p),local(m[1]))))continue;
  const issue={file:rel,import:m[1]};
  if(optional.has(rel+'|'+m[1]))knownOptional.push({...issue,reason:'Existing optional render-engine add-on API only supported by ModelCraft/BimCraft; not used by DetailCraft pilot.'});else missingImports.push(issue);
 }
}
const importMap=JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1]||'{}');
const missingImportMap=Object.entries(importMap.imports||{}).filter(([k,v])=>v.startsWith('.')&&!fs.existsSync(path.resolve(root,local(v))));
const result={edition:root,htmlLocalLinks:htmlLinks.length,jsFiles:files.length,missingHtmlAssets,missingImports,missingImportMap,knownOptionalImports:knownOptional,checkScope:'Static literal paths and import-map targets; not a runtime browser test. Dynamic computed imports and network behavior require runtime checks.'};
if(opt('--report'))fs.writeFileSync(path.resolve(opt('--report')),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(missingHtmlAssets.length||missingImports.length||missingImportMap.length)process.exitCode=1;
