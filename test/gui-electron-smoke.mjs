// Runs OUR minimal Electron fixture. Never launches or controls installed Codex.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { buildCodexPayload } from '../bin/lib/codex.js';
const t3 = process.env.ARTL_TEST_TARGET === 't3';
const require = createRequire(import.meta.url), electron = require('electron');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-own-electron-'));
const host = path.join(folder, 'rasta'), runtime = path.join(folder, 'runtime');
fs.mkdirSync(host); fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
const result = path.join(folder, 'result.json'), calls = path.join(folder, 'calls.jsonl');
const sentinel = path.join(folder, 'original-main.cjs');
try {
    for (const name of ['main.cjs', 'bridge.cjs', 'preload.cjs']) fs.copyFileSync(new URL(`../bin/host/${name}`, import.meta.url), path.join(host, name));
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'rasta-fixture', version: '1.0.0', main: 'rasta/main.cjs' }));
    fs.writeFileSync(path.join(host, 'host.json'), JSON.stringify({ app: '/Applications/Rasta Fixture.app', runtime, target: t3 ? 't3' : 'codex', originalMain: 'original-main.cjs' }));
    fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
    fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const action=process.argv[process.argv.indexOf('--rpc')+1];fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(action)+String.fromCharCode(10));
const operation=fs.existsSync(${JSON.stringify(calls + '.prepared')})?{phase:'ready-to-install',progress:1}:null;
const release=fs.existsSync(${JSON.stringify(calls + '.release')})?JSON.parse(fs.readFileSync(${JSON.stringify(calls + '.release')},'utf8')):{available:true,supported:true,phase:'available',releaseConfigured:true,release:{agentVersion:'2.1.0'}};
if(action==='prepare')fs.writeFileSync(${JSON.stringify(calls + '.prepared')},'yes');
console.log(JSON.stringify({ok:true,value:action==='status'?{running:!!operation,operation,update:release}:action==='check'?release:action==='fonts'?{selected:'vazir',fonts:[],active:null}:{id:'fixture'}}));`);
    fs.writeFileSync(path.join(folder, 'vendor-preload.cjs'), `require('electron').contextBridge.exposeInMainWorld('vendorPreloadSentinel','unchanged');`);
    fs.writeFileSync(path.join(folder, 'payload.js'), buildCodexPayload({ all: [], fa: [], en: [] }));
    let html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div data-markdown-text-style="assistant-message"><p>متن آزمایشی فارسی</p></div><script src="app://-/payload.js"></script></body></html>';
    if (t3) html = html.replace('<div data-markdown-text-style="assistant-message"><p>', '<div class="messages-timeline-scroll"><div data-timeline-row-kind="message" data-message-role="assistant" data-message-id="reply-1"><div class="chat-markdown"><p>').replace('</p></div><script', '</p></div></div></div><script');
    let fixtureCode = `const {app,BrowserWindow,protocol}=require('electron');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setPath('userData',path.join(__dirname,'profile'));app.dock?.hide();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
protocol.handle('app',request=>new Response(new URL(request.url).pathname==='/payload.js'?fs.readFileSync(path.join(__dirname,'payload.js')):${JSON.stringify(html)},{headers:{'content-type':new URL(request.url).pathname==='/payload.js'?'text/javascript':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"}}));
const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(__dirname,'vendor-preload.cjs')}});
const errors=[];win.webContents.on('console-message',(_event,details)=>{if(details?.level==='error')errors.push(details.message)});
await win.loadURL('app://-/index.html');
for(let n=0;n<100;n++){if(await win.webContents.executeJavaScript("!!document.getElementById('artl-update-install')"))break;await pause(100)}
assert.equal(await win.webContents.executeJavaScript('vendorPreloadSentinel'),'unchanged');
assert.deepEqual(await win.webContents.executeJavaScript('Object.keys(rastaNative).sort()'),['cancel','check','fonts','importFont','open','prepare','repair','restore','selectFont','setAppearance','status']);
for(let n=0;n<50;n++){if(await win.webContents.executeJavaScript("document.getElementById('artl-update-install').disabled===false"))break;await pause(100)}
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),false);
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-widget-panel').getAttribute('aria-hidden')"),'true');
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').getBoundingClientRect().width > 0"),true,'update dot is visible while the panel is closed');
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger').getAttribute('aria-label')"),'Rasta settings: Rasta 2.1.0 update available');
await win.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger').click()");
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),false,'opening settings does not acknowledge an uninstalled update');
await win.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger').click()");
const setRelease=async value=>{
fs.writeFileSync(${JSON.stringify(calls + '.release')},JSON.stringify(value));
await win.webContents.executeJavaScript("document.getElementById('artl-update-check').click()");
for(let n=0;n<50;n++){if(await win.webContents.executeJavaScript("!document.getElementById('artl-update-check').disabled"))return;await pause(100)}
throw new Error('Update check did not finish');
};
await setRelease({available:false,releaseError:'fixture offline'});
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),false,'a transient check failure retains the known update');
await setRelease({available:false,supported:true,release:null});
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),true,'dot clears when no update remains');
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-widget-trigger').getAttribute('aria-label')"),'Rasta settings');
await setRelease({available:true,supported:true,release:{agentVersion:'2.1.0'}});
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),false,'new release restores the dot without reopening settings');
for(let n=0;n<30;n++){if(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"ready"'))break;await pause(100)}
assert.ok(fs.readFileSync(${JSON.stringify(calls)},'utf8').includes('"ready"'),'preload confirms only after the RTL trigger is mounted');
await win.webContents.executeJavaScript("document.getElementById('artl-update-install').click()");
for(let n=0;n<50;n++){if(await win.webContents.executeJavaScript("document.getElementById('artl-update-check').disabled"))break;await pause(100)}
assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('#artl-update-cancel').length"),0);
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-notice').hidden"),true);
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-update-badge').hidden"),true,'active installation owns update progress');
const embedded=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});await embedded.loadURL('app://-/document.html');
assert.equal(await embedded.webContents.executeJavaScript('typeof window.rastaNative'),'undefined');
await embedded.loadURL('app://-/index.html?initialRoute=/spotlight');
assert.equal(await embedded.webContents.executeJavaScript('typeof window.rastaNative'),'undefined');
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:true,errors}));app.exit(0);
}).catch(error=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({ok:false,error:error.stack}));app.exit(1)});`;
    if (t3) fixtureCode = fixtureCode.replaceAll("scheme:'app'", "scheme:'t3code'").replaceAll("protocol.handle('app'", "protocol.handle('t3code'").replaceAll('app://-', 't3code://app').replace("win.loadURL('t3code://app/index.html')", "win.loadURL('t3code://app/local/thread-1')").replace("t3code://app/index.html?initialRoute=/spotlight", "t3code://embed/index.html");
    if (t3) fixtureCode = fixtureCode.replace("await win.webContents.executeJavaScript(\"document.getElementById('artl-update-install').click()\");", `assert.equal(await win.webContents.executeJavaScript("document.querySelectorAll('.artl-message-direction-control').length"),1);
await win.webContents.executeJavaScript("document.querySelector('.artl-message-direction-control button').click()");await pause(100);
await win.webContents.executeJavaScript("[...document.querySelectorAll('.artl-message-direction-menu button')].find(el=>el.textContent==='LTR').click()");await pause(100);
assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.chat-markdown p')).direction"),'ltr');
await win.reload(); await pause(300);
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-message-direction-control button').getAttribute('data-direction')"),'ltr');
await win.loadURL('t3code://app/local/thread-2');await pause(300);
assert.equal(await win.webContents.executeJavaScript("document.querySelector('.artl-message-direction-control button').getAttribute('data-direction')"),'default');
await win.webContents.executeJavaScript("document.getElementById('artl-update-install').click()");`);
    fs.writeFileSync(sentinel, fixtureCode);
    const original = fs.readFileSync(sentinel);
    const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [folder], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stderr.on('data', bytes => { log = (log + bytes).slice(-5000); }); child.stdout.resume();
    const timeout = setTimeout(() => child.kill('SIGTERM'), 30000);
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }); clearTimeout(timeout);
    const value = fs.existsSync(result) ? JSON.parse(fs.readFileSync(result)) : null;
    assert.equal(exit, 0, JSON.stringify(value) + log);
    assert.equal(value.ok, true); assert.deepEqual(fs.readFileSync(sentinel), original);
    assert.ok(fs.readFileSync(calls, 'utf8').includes('"prepare"'));
    console.log('PASS: Electron 42 registered preload, vendor preload and main preserved, fixed IPC, widget update badge/button, external Install approval state and auxiliary-window isolation.');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
