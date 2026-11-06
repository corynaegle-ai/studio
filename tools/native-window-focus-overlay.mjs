/* SPDX-License-Identifier: Apache-2.0 */
/** Minimal maintained relay/hub overlay. Never writes files or broad-replaces a shared-shell version. */
import crypto from'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const normalize=s=>s.replaceAll('DetailCraft','SteleFab').replaceAll('CadCraft Studio','SteleFab');
const marker=/^  \/\/ BEGIN maintained-native-window-focus\n[\s\S]*?^  \/\/ END maintained-native-window-focus\n/m;
const oldSignature='openApp = null, activityLog = null',newSignature='openApp = null, nativeWindows = null, activityLog = null';
const oldHub='createControlRelay({ channel, activityLog, onDisconnect:',newHub='createControlRelay({ channel, activityLog, nativeWindows: desk.windows || null, onDisconnect:';
const anchor="  d.tool({ name: 'studio_windows_list'";
const replaceOnce=(s,from,to)=>{if(s.split(from).length!==2)throw Error('Native-focus overlay compatibility: expected one maintained anchor');return s.replace(from,to);};
const hostBase=s=>s.replace(marker,'').replace(newSignature,oldSignature),hubBase=s=>s.replace(newHub,oldHub);
export function nativeFocusOverlay({host,hub,sourceHost,sourceHub}){
 const block=sourceHost.match(marker)?.[0];if(!block||!sourceHost.includes(newSignature)||!sourceHub.includes(newHub))throw Error('Native-focus overlay source is incomplete');
 const hb=hostBase(host),sb=hostBase(sourceHost),wb=hubBase(hub),sw=hubBase(sourceHub);
 if(normalize(hb)!==normalize(sb)||normalize(wb)!==normalize(sw))throw Error('Native-focus overlay compatibility: shared-shell source differs outside reviewed focus delta; refuse broad replacement');
 const nextHost=replaceOnce(replaceOnce(hb,oldSignature,newSignature),anchor,block+anchor),nextHub=replaceOnce(wb,oldHub,newHub);
 if(normalize(nextHost)!==normalize(sourceHost)||normalize(nextHub)!==normalize(sourceHub))throw Error('Native-focus overlay result does not match maintained source');
 return{host:nextHost,hub:nextHub,provenance:{kind:'minimal-maintained-native-window-focus',compatibility:'Existing shared-shell source is identical outside focus delta after presentation-only branding normalization',sourceHostSha256:hash(sourceHost),sourceHubSha256:hash(sourceHub),before:{host:hash(host),hub:hash(hub)},after:{host:hash(nextHost),hub:hash(nextHub)}}};
}
