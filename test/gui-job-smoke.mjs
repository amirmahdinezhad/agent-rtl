// End-to-end one-time installer job against a small locally signed fixture.
// Does not launch, close or modify the installed Codex app.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixture } from './helpers/native-fixture.js';
import { nativePaths } from '../bin/lib/codex-native.js';
import { fontPaths, importFont, selectFont } from '../bin/lib/font-preferences.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-gui-job-'));
const setup = path.resolve(process.env.ARTL_GUI_OUTPUT || 'dist/Agent RTL Setup.app');
const sourceRuntime = path.join(setup, 'Contents/Resources/runtime');
const runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime);
for (const name of ['bin', 'node', 'agent-rtl-ui', 'node-LICENSE', 'package.json']) fs.cpSync(path.join(sourceRuntime, name), path.join(runtime, name), { recursive: true });
fs.symlinkSync(path.join(sourceRuntime, 'node_modules'), path.join(runtime, 'node_modules'));
// Only the official-feed response is mocked in this owned runtime. Signing,
// staging, launchd, Install approval and the native window execute real code.
const workerFile = path.join(runtime, 'bin/gui-service.js');
const workerSource = fs.readFileSync(workerFile, 'utf8');
assert.ok(workerSource.includes('await runGUIJob(readJSON(file));'));
fs.writeFileSync(workerFile, workerSource.replace('await runGUIJob(readJSON(file));', 'await runGUIJob(readJSON(file), {check: async () => ({available:false,supported:true,appUpdate:null}),open:()=>{},confirmReady:()=>{},confirmRestoredOpen:()=>{}});'));
const node = path.join(runtime, 'node'), service = path.join(runtime, 'bin/gui-service.js');
const env = { ...process.env, ARTL_CODEX_STATE_HOME: dir };
for (const key of Object.keys(env)) if (key.startsWith('CODEX_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
const read = file => JSON.parse(fs.readFileSync(file));
try {
    const executable = path.join(setup, 'Contents/MacOS/Agent RTL Setup');
    const preview = spawn(executable, ['--self-test'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let previewLog = ''; preview.stdout.on('data', bytes => { previewLog += bytes; }); preview.stderr.on('data', bytes => { previewLog += bytes; });
    const previewTimeout = setTimeout(() => preview.kill('SIGTERM'), 10000);
    const previewCode = await new Promise((resolve, reject) => { preview.once('error', reject); preview.once('exit', resolve); }); clearTimeout(previewTimeout);
    assert.equal(previewCode, 0, previewLog); assert.match(previewLog, /native window started/);
    const fonts = fontPaths(dir);
    importFont({ name: 'My font.ttf', data: fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url)).toString('base64') }, fonts);
    const customPreview = spawn(executable, ['--self-test', '--expected-font', 'Vazir-Bold'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let customLog = ''; customPreview.stdout.on('data', bytes => { customLog += bytes; }); customPreview.stderr.on('data', bytes => { customLog += bytes; });
    const customTimeout = setTimeout(() => customPreview.kill('SIGTERM'), 10000);
    const customCode = await new Promise((resolve, reject) => { customPreview.once('error', reject); customPreview.once('exit', resolve); }); clearTimeout(customTimeout);
    assert.equal(customCode, 0, customLog); assert.match(customLog, /native window started with Vazir-Bold/);
    selectFont('vazir', fonts);
    // Native probes share this fixture with later visible install windows.
    // Keep its selected accent Lavender so testing does not flash a green wizard.
    fs.writeFileSync(path.join(nativePaths(dir).support, 'appearance.json'), JSON.stringify({schema:1,theme:'dark',accent:'#ad8cf3'}));
    const appearancePreview = spawnSync(executable, ['--self-test', '--expected-theme', 'dark', '--expected-accent', '#ad8cf3'], { env, encoding: 'utf8', timeout:10000 });
    assert.equal(appearancePreview.status, 0, appearancePreview.stdout + appearancePreview.stderr);

    const catalog = read(path.join(sourceRuntime, 'bin/release-config.json'));
    assert.equal(catalog.supportedAppVersions.length, 1, 'the installer supports only the inspected latest Codex');
    const app = await nativeFixture(path.join(dir, 'app'), catalog.supportedAppVersions[0], true, catalog.target || 'codex'), original = fs.readFileSync(app.archive);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const file = path.join(dir, 'signed.zip'); fs.writeFileSync(file, 'fixture for mapped CryptoKit verifier');
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
    const signature = sign(null, fs.readFileSync(file), privateKey).toString('base64');
    const helper = path.join(runtime, 'agent-rtl-ui');
    execFileSync(helper, ['--verify', file, raw, signature]);
    fs.appendFileSync(file, 'tampered');
    assert.notEqual(spawnSync(helper, ['--verify', file, raw, signature]).status, 0);
    const invoke = (action, id = null) => {
        const result = JSON.parse(execFileSync(node, [service, '--rpc', action, ...(action === 'restore' ? [] : ['--setup']), '--app', app.app, ...(id ? ['--job', id] : [])], { env, encoding: 'utf8' }));
        assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
    };
    const support = nativePaths(dir).support, status = path.join(support, 'gui-status.json');
    for (const action of ['repair', 'restore']) {
        const job = invoke(action); let state, wizard, wizardExit;
        if (action === 'restore') {
            const removal = read(path.join(support,'ui-jobs',job.id,'job.json'));
            assert.equal(removal.config.silentRestore,true,'panel removal never requests a native window');
            assert.equal(removal.config.showWindow,false);
        }
        if (action === 'repair') {
            for (let i=0;i<150;i++) { state=read(status); if (state.phase==='ready-to-install' || state.phase==='failed') break; await delay(100); }
            assert.equal(state.phase, 'ready-to-install', JSON.stringify(state));
            assert.equal(invoke('status').running, true);
            assert.equal(invoke('status').patch, 'not-patched', 'download/preparation does not install');
            wizard=spawn(helper,['--watch',status,path.join(support,'gui-cancel'),app.app,job.id],{env,stdio:'ignore'});
            wizardExit=new Promise(resolve=>wizard.once('exit',resolve));
            const stale=spawnSync(node,[service,'--rpc','install','--setup','--app',app.app,'--job','00000000-0000-0000-0000-000000000000'],{env,encoding:'utf8'});
            assert.notEqual(stale.status,0);
            const direct=spawnSync(node,[service,'--rpc','install','--app',app.app,'--job',job.id],{env,encoding:'utf8'});
            assert.notEqual(direct.status,0,'the renderer cannot approve Install directly');
            invoke('install',job.id);
        }
        for (let i = 0; i < 150; i++) {
            if (action === 'restore' && !fs.existsSync(support)) { state = { phase: 'complete', autoPromptError: null }; break; }
            try { state = read(status); } catch (error) { if (action === 'restore' && error.code === 'ENOENT') { state = {phase:'complete',autoPromptError:null}; break; } throw error; }
            if (state.id === job.id && ['complete', 'failed', 'cancelled'].includes(state.phase)) break;
            await delay(200);
        }
        assert.equal(state.phase, 'complete', JSON.stringify(state));
        if (wizard) {
            const stopped=await Promise.race([wizardExit,delay(5000).then(()=>{wizard.kill('SIGTERM');return 'timeout';})]);
            assert.equal(stopped,0,'native wizard closes automatically after successful installation');
        }
        for (let i = 0; i < 30 && fs.existsSync(path.join(support, 'ui-job.lock')); i++) await delay(100);
        assert.equal(fs.existsSync(path.join(support, 'ui-job.lock')), false);
        assert.equal(fs.existsSync(path.join(support, 'ui-jobs', job.id, 'once.plist')), false);
        const client = JSON.parse(execFileSync(node, [service, '--rpc', 'status', '--app', app.app], { env, encoding: 'utf8' })).value;
        assert.equal(client.running, false);
        assert.equal(client.patch, action === 'repair' ? 'patched-in-app' : 'not-patched');
        assert.equal(Boolean(client.patchCurrent), action === 'repair');
        assert.equal(client.localSupported, true);
        assert.equal(state.autoPromptError, null, 'event prompt installed/removed successfully');
        if (action === 'restore') {
            for (let i = 0; i < 100 && fs.existsSync(support); i++) await delay(100);
            assert.equal(fs.existsSync(support), false, 'removal deletes fonts, settings, runtimes, logs and final status after the wizard exits');
        }
        const agents = path.join(dir, 'Library/LaunchAgents');
        assert.equal(fs.existsSync(agents) ? fs.readdirSync(agents).length : 0, action === 'repair' ? 1 : 0);
    }
    assert.deepEqual(fs.readFileSync(app.archive), original);
    console.log('PASS: native window startup, standalone GUI runtime, native signature verifier, detached one-time launchd install/restore, final signature/integrity checks, explicit Install approval, automatic wizard close, clean lock/plist and no idle worker.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
