// SPDX-License-Identifier: Apache-2.0
// Run with node --experimental-vm-modules tools/test-detailcraft-restart.mjs.
// Execute the actual adapter; only OS/RPC boundaries are replaced. No process is signaled.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as util from 'node:util';
import path from 'node:path';
const source=await readFile(new URL('./detailcraft-mcp.mjs',import.meta.url),'utf8');
const parser=await readFile(new URL('./native-app-process.mjs',import.meta.url),'utf8');
const initial=[1,2].map(n=>({app:'detailcraft',window:'detailcraft:same.json',studioLabel:'app-detailcraft-'+n,assistants:true,allowed:['read']}));
async function exercise(options={}) {
 const log={rpc:[],commands:[],signals:[]};let clock=0,infos=0,terminated=false,changed=false;
 const windows=structuredClone(initial);
 const inventory=()=>{
  if(!changed)return options.initialWindows??windows;
  if(options.change==='permission')return windows.map((w,i)=>i?{...w,allowed:[]}:w);
  return [...windows,{app:'cadcraft',window:'new',studioLabel:'app-new',assistants:false,allowed:[]}];
 };
 const context=vm.createContext({URL,JSON,Error,Number,Object,Array,Set,Promise,Date:{now:()=>clock},AbortSignal:{timeout:()=>undefined},setTimeout:fn=>{clock+=100;fn();},process:{env:{CADCRAFT_STUDIO_APP:'/safe/SteleFab.app'},stdin:{},stdout:{write:()=>{}},kill:(pid,signal)=>{log.signals.push({pid,signal});assert.equal(pid,4242);if(signal==='SIGTERM'){terminated=true;return true;}assert.equal(signal,0);if(terminated)throw new Error('gone');return true;}},fetch:async(url,opts)=>{
  assert.equal(url,'http://127.0.0.1:1234/mcp');const msg=JSON.parse(opts.body);log.rpc.push(msg.params);const name=msg.params.name;let data;
  if(name==='studio_windows_list')data={windows:inventory()};
  else {assert.equal(name,'detail_app_info');assert(initial.some(w=>w.studioLabel===msg.params.arguments.window),'use unique native labels, not colliding document aliases');infos++;if(options.at==='second-info'&&infos===3)changed=true;data={unsaved:options.dirtyAt===infos,busy:null};}
  return{ok:true,status:200,headers:{get:()=>null},json:async()=>({result:{structuredContent:data}})};
 }});
 const exec=(cmd,args,cb)=>{log.commands.push({cmd,args});let stdout='';if(cmd==='/bin/ps'){if(options.at==='ps')changed=true;stdout='4242 /safe/SteleFab.app/Contents/MacOS/SteleFab --app=detailcraft';}if(cmd==='/usr/libexec/PlistBuddy')stdout='com.getcadcraft.studio';cb(null,stdout,'');};
 exec[util.promisify.custom]=async(cmd,args)=>new Promise((resolve,reject)=>exec(cmd,args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
 const mocks={'node:fs/promises':{readFile:async()=>JSON.stringify({url:'http://127.0.0.1:1234/mcp',token:'MOCK-ONLY'}),access:async()=>{},realpath:async p=>p},'node:os':{homedir:()=>'/mock'},'node:path':{default:path},'node:child_process':{execFile:exec},'node:util':{promisify:util.promisify},'node:readline':{createInterface:()=>({on:()=>{}})}};
 const module=new vm.SourceTextModule(source+'\nexport {handle};',{context});
 await module.link(async spec=>{if(spec==='./native-app-process.mjs')return new vm.SourceTextModule(parser,{context});const values=mocks[spec];assert(values,'unexpected dependency '+spec);return new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});});await module.evaluate();
 let result,error;try{result=await module.namespace.handle({method:'tools/call',id:1,params:{name:'detail_restart',arguments:{}}});}catch(e){error=e.message;}
 return{result,error,log};
}
for(const options of [{at:'ps'},{at:'second-info'},{at:'ps',change:'permission'}]){
 const r=await exercise(options);assert.match(r.error??'',/windows|Model changed/i,'changed inventory must refuse restart');assert.equal(r.log.signals.length,0,'no signal for unseen/changed windows');assert(!r.log.commands.some(c=>c.cmd==='/usr/bin/open'),'no launch after refused restart');
}
for(const dirtyAt of [1,3]){const r=await exercise({dirtyAt});assert.match(r.error??'',/Save all|Model changed/);assert.equal(r.log.signals.length,0);}
const unsafe=await exercise({initialWindows:[{app:'cadcraft',window:'other',assistants:false,allowed:[]}]});assert.match(unsafe.error??'',/windows/);assert.equal(unsafe.log.signals.length,0);
const clean=await exercise();assert.equal(clean.error,undefined);assert.deepEqual(clean.log.signals,[{pid:4242,signal:'SIGTERM'},{pid:4242,signal:0}]);assert.equal(clean.log.rpc.filter(c=>c.name==='studio_windows_list').length,3);assert.equal(clean.log.rpc.filter(c=>c.name==='detail_app_info').length,4);assert(clean.log.commands.some(c=>c.cmd==='/usr/bin/open'),'unchanged clean windows still restart');
console.log('Restart inventory: late/new/unreadable windows and dirty rechecks refuse without signaling; stable native-label windows restart. No real OS calls.');
