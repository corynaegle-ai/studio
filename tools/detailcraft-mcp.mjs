#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// stdio adapter for Studio's authenticated loopback MCP server. No npm dependencies.
import { readFile, access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { nativeAppProcesses } from './native-app-process.mjs';

const run = promisify(execFile);
const connectFile = process.env.CADCRAFT_CONNECT_FILE || path.join(homedir(), 'Library/Application Support/CadCraft Studio/connect.json');
const appPath = process.env.CADCRAFT_STUDIO_APP;
let connection, session, initializeParams;
const launchTool = {
  name: 'detail_launch',
  description: 'Launch or focus the local SteleFab steel detailing app in the native desktop app. Uses the configured desktop app; preserves open documents.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const restartTool = {
  name: 'detail_restart',
  description: 'Restart the configured signed local development app. Refuses unless every open app window is SteleFab, permits assistants to read, and has saved work. Rechecks immediately before stopping the exact Studio process. Does not open model files; use detail_model_open after restart.',
  inputSchema: {type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
};
async function callLocal(name, args = {}) {
  const response = await post({jsonrpc:'2.0',id:'lifecycle-'+name,method:'tools/call',params:{name,arguments:args}});
  if (response?.error || response?.result?.isError) throw new Error('Lifecycle preflight refused: ' + name);
  const data=response?.result?.structuredContent;
  if (!data) throw new Error('Lifecycle preflight returned no structured data: ' + name);
  return data;
}
async function restart() {
  if (!appPath) throw new Error('Set CADCRAFT_STUDIO_APP to the signed development app.');
  const candidate = await realpath(appPath);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',candidate]);
  const label = w => w.studioLabel || w.window;
  const readWindows = async () => {
    const windows = (await callLocal('studio_windows_list')).windows;
    if (!Array.isArray(windows) || !windows.length || windows.some(w=>w.app!=='detailcraft' || !w.assistants || !w.allowed?.includes('read') || typeof label(w)!=='string' || !label(w)) || new Set(windows.map(label)).size!==windows.length) throw new Error('Restart requires only uniquely identified readable SteleFab windows.');
    return windows;
  };
  const windows = await readWindows();
  const inventory = JSON.stringify(windows.map(label).sort());
  const unchangedWindows = async () => {
    const current = await readWindows();
    if (JSON.stringify(current.map(label).sort())!==inventory) throw new Error('Open windows changed before restart; retry after saving all models.');
    return current;
  };
  for (const w of windows) {
    // Document aliases can change or collide; the native label identifies this window.
    const info=await callLocal('detail_app_info',{window:w.studioLabel || w.window});
    if(info.unsaved || info.busy) throw new Error('Save all models and finish modeling before restart.');
  }
  const processes=nativeAppProcesses((await run('/bin/ps',['-axo','pid=,command='])).stdout);
  if(processes.length!==1) throw new Error('Restart requires exactly one Studio process.');
  const [,pid,bundle]=processes[0];
  const identity=(await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',bundle+'/Contents/Info.plist'])).stdout.trim();
  if(identity!=='com.getcadcraft.studio') throw new Error('Unexpected Studio application identity.');
  // No model operation is replayed. A fresh connection is established only after the old process exits.
  for (const w of await unchangedWindows()) {const i=await callLocal('detail_app_info',{window:label(w)});if(i.unsaved || i.busy)throw new Error('Model changed before restart.');}
  // Also catch a window opened or made unreadable during the second document checks.
  await unchangedWindows();
  process.kill(Number(pid),'SIGTERM');
  const deadline=Date.now()+7000;
  for (;;) {
    let alive=true; try{process.kill(Number(pid),0);}catch{alive=false;}
    if(!alive)break;
    if(Date.now()>deadline)throw new Error('Studio did not exit; no forced kill or launch performed.');
    await new Promise(r=>setTimeout(r,100));
  }
  session=undefined;
  await launch();
  return {restarted:true,app:candidate,previousApp:bundle,modelsSaved:true};
}

async function launch() {
  if (!appPath) throw new Error('Set CADCRAFT_STUDIO_APP to the SteleFab .app path.');
  await access(appPath);
  await run('/usr/bin/open', ['-a', appPath, '--args', '--app=detailcraft']);
}

async function readConnection() {
  const next = JSON.parse(await readFile(connectFile, 'utf8'));
  const url = new URL(next.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/mcp' || url.search || url.username || url.password) {
    throw new Error('Studio connect.json must name its local HTTP /mcp endpoint.');
  }
  if (typeof next.token !== 'string' || !next.token) throw new Error('Studio has no connection token.');
  if (connection?.url !== next.url || connection?.token !== next.token) session = undefined;
  connection = next;
}

async function post(message) {
  const response = await fetch(connection.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(125000),
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error(`Studio returned HTTP ${response.status}. Check SteleFab Settings > Assistants. The operation was not retried.`);
  session = response.headers.get('mcp-session-id') || session;
  return response.status === 202 || response.status === 204 ? null : response.json();
}

async function initialize(message, autoLaunch = true) {
  // Only initialization is retried; an edit is never silently replayed.
  let launched = false;
  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      await readConnection();
      const answer = await post(message);
      if (answer?.result) answer.result.instructions += '\nFocus on steel detailing in SteleFab. detail_launch opens the desktop app. Geometry coordinates and lengths are millimetres; use explicit window IDs when multiple models are open. Use detail_pdf_export to write steel drawing sets, assembly sheets or single-part shop drawings directly to an allowed .pdf path, with optional paper and mm/ft-in labels. In the current desktop build, edit previews restore geometry but can mark the document unsaved; avoid previews on a clean user document unless that side effect is acceptable.';
      return answer;
    } catch {
      if (!autoLaunch || Date.now() >= deadline) throw new Error('Cannot reach SteleFab. Open SteleFab and enable SteleFab Settings > Assistants (read, edit, save, export).');
      if (!launched) { await launch(); launched = true; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

async function handle(message) {
  if (message.method === 'initialize') {
    initializeParams = message.params;
    return initialize(message);
  }
  if (message.method === 'tools/call' && message.params?.name === restartTool.name) {
    if(Object.keys(message.params.arguments || {}).length) throw new Error('detail_restart takes no arguments.');
    await readConnection();
    return {jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:JSON.stringify(await restart())}]}};
  }
  if (message.method === 'tools/call' && message.params?.name === launchTool.name) {
    if (Object.keys(message.params.arguments || {}).length) throw new Error('detail_launch takes no arguments.');
    await launch();
    return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'SteleFab launch requested. Use studio_windows_list to find the open model.' }] } };
  }
  await readConnection();
  if (!session && initializeParams) {
    await initialize({ jsonrpc: '2.0', id: 'bridge-reconnect', method: 'initialize', params: initializeParams });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }
  const answer = await post(message);
  if (message.method === 'tools/list' && answer?.result?.tools) answer.result.tools.push(launchTool,restartTool);
  return answer;
}

let queue = Promise.resolve();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  queue = queue.then(async () => {
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }) + '\n'); return; }
    try {
      const answer = await handle(message);
      if (answer && message.id !== undefined) process.stdout.write(JSON.stringify(answer) + '\n');
    } catch (error) {
      // No connection file contents, bearer token, or HTTP request bodies in logs.
      if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } }) + '\n');
    }
  });
});
lines.on('close', async () => {
  await queue;
  if (session && connection) {
    try { await fetch(connection.url, { method: 'DELETE', signal: AbortSignal.timeout(2000), headers: { Authorization: `Bearer ${connection.token}`, 'Mcp-Session-Id': session } }); } catch { /* Studio may already be closed. */ }
  }
});
