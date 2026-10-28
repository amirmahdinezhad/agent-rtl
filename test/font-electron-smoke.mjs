// Exercise real file input, context isolation, native IPC and persistence on an
// owned Electron app using Codex's app: protocol and restrictive font policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { buildCodexPayload } from '../bin/lib/codex.js';
const t3 = process.env.ARTL_TEST_TARGET === 't3';
const require = createRequire(import.meta.url), electron = require('electron');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-electron-'));
const host = path.join(folder, 'agent-rtl'), runtime = path.join(folder, 'runtime');
fs.mkdirSync(host); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
const result = path.join(folder, 'result.json');
try {
    for (const name of ['main.cjs', 'bridge.cjs', 'preload.cjs']) fs.copyFileSync(new URL(`../bin/host/${name}`, import.meta.url), path.join(host, name));
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'agent-rtl-font-fixture', version: '1.0.0', main: 'agent-rtl/main.cjs' }));
    fs.writeFileSync(path.join(host, 'host.json'), JSON.stringify({ app: '/Applications/Rasta Font Fixture.app', runtime, target: t3 ? 't3' : 'codex', originalMain: 'fixture.cjs' }));
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    const preferencesModule = new URL('../bin/lib/font-preferences.js', import.meta.url).href;
    fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `
const action=process.argv[process.argv.indexOf('--rpc')+1];
(async()=>{
 const fonts=await import(${JSON.stringify(preferencesModule)});
 let value={};
 if(action==='fonts')value=fonts.fontPreferences();
 if(action==='font-import'||action==='font-select'){
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const input=JSON.parse(Buffer.concat(chunks).toString());
  value=action==='font-import'?fonts.importFont(input):fonts.selectFont(input.id);
 }
 console.log(JSON.stringify({ok:true,value}));
})().catch(error=>{console.log(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});`);
    fs.writeFileSync(path.join(folder, 'payload.js'), buildCodexPayload());
    const fontFile = process.env.ARTL_TEST_FONT || new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url).pathname;
    const focusBeforeFile = process.env.ARTL_TEST_PICKER_FOCUS !== '0';
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><aside id="sidebar">گفتگوها</aside><div data-markdown-text-style><p id="message">سلام دنیا Hello world</p></div><script src="app://-/payload.js"></script></body></html>';
    let fixtureCode = `
const {app,BrowserWindow,protocol}=require('electron');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(__dirname,'profile'));app.dock?.hide();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 protocol.handle('app',request=>new Response(new URL(request.url).pathname==='/payload.js'?fs.readFileSync(path.join(__dirname,'payload.js')):${JSON.stringify(html)},{headers:{'Content-Type':new URL(request.url).pathname==='/payload.js'?'text/javascript':'text/html','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"}}));
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
 await win.loadURL('app://-/index.html');
 const evaluate=code=>win.webContents.executeJavaScript(code,true);
 for(let i=0;i<100;i++){if(await evaluate("!!document.querySelector('#artl-font-add') && !document.querySelector('#artl-font-add').disabled"))break;await pause(30)}
 await evaluate("document.querySelector('.artl-widget-trigger').click()");
 win.webContents.debugger.attach('1.3');
 const {root}=await win.webContents.debugger.sendCommand('DOM.getDocument');
 const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#artl-font-file'});
 // A native chooser returns focus before dispatching the real input change.
 if(${JSON.stringify(focusBeforeFile)})await evaluate("window.dispatchEvent(new Event('focus'))");
 const refreshing=await evaluate("document.querySelector('#artl-font-add').disabled");
 await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[${JSON.stringify(fontFile)}]});
 for(let i=0;i<150;i++){const ready=await evaluate("!document.querySelector('#artl-font-add').disabled && (getComputedStyle(document.querySelector('#sidebar')).fontFamily.includes('AgentRTLUser_') || !document.querySelector('.artl-font-error').hidden)");if(ready)break;await pause(30)}
 const state=await evaluate("({secure:isSecureContext,crypto:typeof crypto.subtle,font:getComputedStyle(document.querySelector('#sidebar')).fontFamily,selected:document.querySelector('#artl-app-font').innerText,error:document.querySelector('.artl-font-error').hidden?'':document.querySelector('.artl-font-error').innerText,files:document.querySelector('#artl-font-file').files.length})");
 assert.match(state.font,/AgentRTLUser_/,JSON.stringify({...state,refreshingAtFileSelection:refreshing}));
 const saved=await evaluate("agentRTLNative.fonts().then(value=>({selected:value.selected,count:value.fonts.length,label:value.fonts.find(font=>font.id===value.selected)?.label}))");
 assert.notEqual(saved.selected,'vazir');assert.equal(saved.count,1);
 await win.webContents.debugger.sendCommand('CSS.enable');
 const {nodeId:sidebarNode}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.nodeId,selector:'#sidebar'});
 const {fonts:renderedFonts}=await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode',{nodeId:sidebarNode});
 assert.ok(renderedFonts.some(font=>font.isCustomFont&&font.glyphCount>0&&font.familyName===saved.label),'The imported face must actually render the Persian glyphs.');
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
 for(let i=0;i<150;i++){if(await evaluate("!!document.querySelector('#sidebar') && getComputedStyle(document.querySelector('#sidebar')).fontFamily.includes('AgentRTLUser_')"))break;await pause(30)}
 assert.match(await evaluate("getComputedStyle(document.querySelector('#sidebar')).fontFamily"),/AgentRTLUser_/);
 fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,state}));app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
    if (t3) fixtureCode = fixtureCode.replaceAll("scheme:'app'", "scheme:'t3code'").replaceAll("protocol.handle('app'", "protocol.handle('t3code'").replaceAll('app://-', 't3code://app');
    fs.writeFileSync(path.join(folder, 'fixture.cjs'), fixtureCode);
    const env = { ...process.env, ARTL_CODEX_STATE_HOME: folder }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [folder], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-2500); }); child.stdout.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 20000);
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
    const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
    assert.equal(code, 0, JSON.stringify(value) + log);
    console.log('PASS: Electron app: file import, sandboxed preload, real IPC, immediate custom font rendering and persistence after reload.');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
