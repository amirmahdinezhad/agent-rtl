import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { nativeFixture } from './helpers/native-fixture.js';
import { createCodexArchive, stageNative, commitNative, stageManagedNative, commitManagedNative, discardNativeStage, restoreNative, nativePaths, verifyInstalledNative } from '../bin/lib/codex-native.js';
import { runGUIJob, updatePlan, releaseConfiguration } from '../bin/lib/gui-updates.js';
import { guiPaths, saveJSON, readJSON, activeWorker } from '../bin/lib/gui-runtime.js';

it('adds a separate native bridge while preserving every original JavaScript descriptor and byte', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-host-'));
    try {
        const bundle = await nativeFixture(dir, undefined, false), output = path.join(dir, 'patched.asar');
        const report = createCodexArchive(bundle.archive, output, '// rtl', { host: { app: bundle.app, runtime: '/support/runtime' } });
        assert.equal(report.originalDataHash, report.preservedDataHash);
        assert.equal(JSON.parse(asar.extractFile(output, 'package.json')).main, 'rasta/main.cjs');
        assert.equal(JSON.parse(asar.extractFile(output, 'rasta/host.json')).originalMain, '.vite/build/main.js');
        for (const name of ['.vite/build/main.js', '.vite/build/preload.js', 'webview/assets/original.js']) {
            assert.deepEqual(asar.extractFile(output, name), asar.extractFile(bundle.archive, name));
            const descriptor = header => name.split('/').reduce((node, part) => node.files[part], header);
            assert.deepEqual(descriptor(asar.getRawHeader(output).header), descriptor(asar.getRawHeader(bundle.archive).header));
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('keeps a pristine NEW-version restore backup and rolls back a failed managed swap', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-managed-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    let stage;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const old = await nativeFixture(path.join(dir, 'installed')), next = await nativeFixture(path.join(dir, 'download'), '26.1014.100');
        stage = stageNative(old, { allowLocalSigning: true, payload: '// old rtl' }); commitNative(stage); discardNativeStage(stage); stage = null;
        const before = fs.readFileSync(old.archive), priorState = fs.readFileSync(nativePaths().state), pristine = fs.readFileSync(next.archive);
        const verifySource = () => ({ name: 'fixture' }); // Fixtures are locally signed; production pins the vendor requirement.
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        const rename = fs.renameSync;
        const fault = mock.method(fs, 'renameSync', (from, to) => { if (to === nativePaths().state) throw new Error('simulated state failure'); return rename(from, to); });
        try { assert.throws(() => commitManagedNative(stage, { verifySource }), /simulated state failure/); } finally { fault.mock.restore(); }
        assert.deepEqual(fs.readFileSync(old.archive), before);
        assert.deepEqual(fs.readFileSync(nativePaths().state), priorState);
        assert.deepEqual(fs.readFileSync(next.archive), pristine);
        discardNativeStage(stage); stage = null;
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        assert.throws(() => commitManagedNative(stage, { verifySource, verifyInstalled() { throw new Error('simulated activation failure'); } }), /simulated activation failure/);
        assert.deepEqual(fs.readFileSync(old.archive), before);
        assert.deepEqual(fs.readFileSync(nativePaths().state), priorState);
        assert.deepEqual(fs.readFileSync(next.archive), pristine);
        discardNativeStage(stage); stage = null;
        stage = stageManagedNative(old, next, { payload: '// new rtl', verifySource });
        commitManagedNative(stage, { verifySource }); discardNativeStage(stage); stage = null;
        const state = readJSON(nativePaths().state), backupArchive = path.join(state.backup, 'Contents/Resources/app.asar');
        assert.deepEqual(fs.readFileSync(backupArchive), pristine);
        assert.equal(JSON.parse(asar.extractFile(old.archive, 'package.json')).version, next.version);
        verifyInstalledNative({ ...old, version: next.version });
        assert.equal(restoreNative({ ...old, version: next.version }), true);
        assert.deepEqual(fs.readFileSync(old.archive), pristine, 'restore keeps the updated version, not the displaced old app');
    } finally {
        if (stage) discardNativeStage(stage);
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('waits for manual quit, supports cancellation, and does not commit unsupported releases', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-gui-flow-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), releaseConfiguration().supportedAppVersions[0], false), paths = guiPaths();
        const config = { app: app.app, runtime: dir, agentVersion: '2.0.0' }, folder = path.join(paths.jobs, 'fixture'); fs.mkdirSync(folder, { recursive: true });
        const job = { schema: 1, id: 'fixture', folder, action: 'repair', config };
        let committed = 0, running = 0, discarded = 0, phases = [];
        const overrides = { noUI: true, installEvent: () => {}, removeEvent: () => {}, stage: () => ({ report: {} }), commit: () => { committed++; }, verifyInstalled() {}, discard: () => { discarded++; },
            running: () => ++running < 3, publish: value => phases.push(value.phase) };
        assert.equal(await runGUIJob(job, overrides), 'complete');
        assert.equal(committed, 1); assert.ok(running >= 3); assert.equal(discarded, 1);
        assert.ok(phases.indexOf('waiting-for-quit') < phases.indexOf('installing'));
        phases = []; committed = 0;
        assert.equal(await runGUIJob(job, { ...overrides, publish: value => { phases.push(value.phase); if (value.phase === 'waiting-for-quit') fs.writeFileSync(paths.cancel, 'cancel'); } }), 'cancelled');
        assert.equal(committed, 0); assert.equal(fs.existsSync(paths.cancel), false);
        assert.equal(await runGUIJob(job, { ...overrides, discard() { throw new Error('fixture cleanup denied'); } }), 'complete', 'cleanup failure must not turn a verified installation into a reported failure');
        committed = 0;
        assert.equal(await runGUIJob({ ...job, action: 'prepare' }, { ...overrides, check: async () => ({ available: true, supported: false }) }), 'failed');
        assert.equal(committed, 0);
        fs.mkdirSync(paths.lock); saveJSON(path.join(paths.lock, 'owner.json'), { id: 'starting', createdAt: Date.now() });
        assert.equal(activeWorker(), true, 'startup is reserved before launchd assigns a PID');
        await assert.rejects(runGUIJob({ ...job, folder: '/tmp/foreign' }), /Invalid update job/);
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

for (const setupName of ['Rasta Setup.app']) it(`hands the operation to the authenticated updater from ${setupName}`, { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-handoff-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'handoff'); fs.mkdirSync(folder, { recursive: true });
        const releaseApp = path.join(dir, 'release', setupName), runtime = path.join(releaseApp, 'Contents/Resources/runtime');
        fs.mkdirSync(path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '2.1.0' }));
        fs.symlinkSync(process.execPath, path.join(runtime, 'node'));
        fs.writeFileSync(path.join(runtime, 'bin/gui-service.js'), `const fs=require('fs');const file=process.argv[process.argv.indexOf('--worker')+1];const job=JSON.parse(fs.readFileSync(file));fs.writeFileSync(${JSON.stringify(paths.status)},JSON.stringify({id:job.id,phase:'complete',agentVersion:job.config.agentVersion}));fs.writeFileSync(${JSON.stringify(path.join(folder, 'new-engine-ran'))},'yes');`);
        const zip = path.join(dir, 'release.zip'); execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', releaseApp, zip]);
        const config = { app: app.app, runtime: dir, agentVersion: '2.0.0' };
        const result = await runGUIJob({ schema: 1, id: 'handoff', folder, config, action: 'prepare' }, {
            noUI: true, check: async () => ({ available: true, supported: true, appUpdate: null, release: { agentVersion: '2.1.0', artifact: {} } }),
            download: async (_artifact, file) => fs.copyFileSync(zip, file),
            stage() { throw new Error('The old updater must not stage this release.'); },
        });
        assert.equal(result, 'complete');
        assert.equal(fs.existsSync(path.join(folder, 'new-engine-ran')), true);
        assert.equal(readJSON(paths.status).agentVersion, '2.1.0');
        assert.equal(readJSON(path.join(folder, 'job.json')).config.showWindow, false, 'the existing progress window is reused');
    } finally {
        if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it('requires explicit Install approval before requesting quit, and closes the wizard only on verified success', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-click-install-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'explicit'); fs.mkdirSync(folder, { recursive: true });
        const config = { app: app.app, runtime: dir, agentVersion: '2.2.1', flow: 'download-install' };
        const job = { schema: 1, id: 'explicit', folder, action: 'repair', config };
        const approval = path.join(folder, 'install-request.json');
        let quit = 0, committed = 0, approved = false, result;
        const overrides = { noUI: true, check: async () => ({ available: false, supported: true }), stage: () => ({ report: {} }),
            installEvent: () => {}, discard: () => {}, running: () => !quit,
            quit: target => { assert.equal(target, app.app); assert.equal(approved, true); quit++; },
            commit: () => { assert.equal(quit, 1); committed++; },
            publish: state => {
                result = state;
                if (state.phase === 'ready-to-install') {
                    assert.equal(quit, 0); assert.equal(committed, 0);
                    // A stale window cannot approve this job.
                    saveJSON(approval, { id: 'another-job' });
                    setTimeout(() => { assert.equal(quit, 0); approved = true; saveJSON(approval, { id: job.id }); }, 100);
                }
            } };
        assert.equal(await runGUIJob(job, overrides), 'complete'); assert.equal(committed, 1); assert.equal(result.autoClose, true);
        assert.equal(fs.existsSync(approval), false);
        quit = 0; committed = 0;
        assert.equal(await runGUIJob(job, { ...overrides, publish: state => { if (state.phase === 'ready-to-install') fs.writeFileSync(paths.cancel, 'cancel'); } }), 'cancelled');
        assert.equal(quit, 0); assert.equal(committed, 0);
        assert.equal(await runGUIJob(job, { ...overrides, check: async () => ({ supported: false, requiresAppUpdate: true, targetVersion: '26.9999.1' }), stage: () => { throw new Error('must not stage old Codex'); }, publish: state => { result = state; } }), 'failed');
        assert.match(result.error, /Update Codex.*first/); assert.equal(quit, 0);
        let checks = 0;
        assert.equal(await runGUIJob(job, { ...overrides, check: async () => ++checks === 1 ? { supported: true } : { requiresAppUpdate: true, targetVersion: '26.9999.2' } }), 'failed');
        assert.equal(quit, 0, 'a new official release appearing after download blocks Install before quit');
        assert.equal(await runGUIJob(job, { ...overrides, quit: () => { throw new Error('normal quit refused'); } }), 'failed'); assert.equal(committed, 0);
    } finally { if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved; fs.rmSync(dir, { recursive: true, force: true }); }
});


it('requires the supported T3 version before installing a local candidate', () => {
    const config = { agentVersion: '1.0.2', flow: 'download-launch' };
    const catalog = { target: 't3', supportedAppVersions: ['0.1.4'] };
    const old = updatePlan(config, '0.1.3', null, null, catalog);
    assert.equal(old.requiresAppUpdate, true);
    assert.equal(old.targetVersion, '0.1.4');
    assert.equal(old.supported, false);
    const current = updatePlan(config, '0.1.4', null, null, catalog);
    assert.equal(current.requiresAppUpdate, false);
    assert.equal(current.supported, true);
    const newer = updatePlan(config, '0.1.5', null, null, catalog);
    assert.equal(newer.requiresAppUpdate, false, 'a newer app needs a newer Rasta release, never a downgrade');
    assert.equal(newer.supported, false);
});

it('offers an RTL update dot only for an RTL release and rejects older Codex versions', () => {
    const config = { agentVersion: '2.2.1', flow: 'download-install' };
    const catalog = { supportedAppVersions: ['26.1007.30912', '26.1013.40934'] };
    const latest = updatePlan(config, '26.1013.40934', null, null, catalog);
    assert.equal(latest.available, false); assert.equal(latest.supported, true);
    const old = updatePlan(config, '26.1007.30912', { version: '26.1013.40934' }, null, catalog);
    assert.equal(old.requiresAppUpdate, true); assert.equal(old.supported, false); assert.equal(old.available, false);
    assert.equal(updatePlan(config, '26.1007.30912', null, null, catalog).supported, false, 'old compatibility entries are not offered');
    const release = { agentVersion: '2.2.2', supportedAppVersions: ['26.1013.40934'] };
    const update = updatePlan(config, '26.1013.40934', null, release, catalog);
    assert.equal(update.available, true); assert.equal(update.supported, true);
    assert.equal(updatePlan(config, '26.1014.1', null, release, catalog).supported, false);
});


it('Launch restarts only after approval, and requires the new renderer to confirm startup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-launch-')), saved = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = dir;
    try {
        const app = await nativeFixture(path.join(dir, 'app'), '26.1016.61520', false), paths = guiPaths();
        const folder = path.join(paths.jobs, 'launch'); fs.mkdirSync(folder, { recursive: true });
        const config = { app: app.app, runtime: dir, agentVersion: '2.3.0', flow: 'download-launch' };
        const job = { schema: 1, id: 'launch', folder, action: 'repair', config };
        for (const initiallyRunning of [true, false]) {
            let running = initiallyRunning, committed = false, opened = false, result, quits = 0;
            const overrides = { noUI: true, check: async () => ({supported:true}), stage: () => ({report:{}}), discard() {}, installEvent() {},
                running: () => running, quit: () => { quits++; running = false; },
                commit: () => { assert.equal(running, false); committed = true; },
                open: () => { assert.equal(committed, true); opened = true; running = true; },
                confirmReady: (_bundle, version) => { assert.equal(opened, true); assert.equal(version, '2.3.0'); },
                publish: value => { result = value; if(value.phase === 'ready-to-install') { assert.equal(opened,false); assert.equal(quits,0); saveJSON(path.join(folder,'install-request.json'),{id:job.id}); } } };
            assert.equal(await runGUIJob(job,overrides),'complete'); assert.equal(quits,initiallyRunning?1:0); assert.equal(result.autoClose,true);
            running = initiallyRunning; opened = false; committed = false; quits = 0;
            assert.equal(await runGUIJob(job,{...overrides,confirmReady:()=>{throw new Error('renderer missing')}}),'failed');
            assert.equal(result.installed,true); assert.match(result.error,/renderer missing/);
        }
    } finally { if(saved===undefined)delete process.env.ARTL_CODEX_STATE_HOME;else process.env.ARTL_CODEX_STATE_HOME=saved; fs.rmSync(dir,{recursive:true,force:true}); }
});

it('keeps helper data when restoring the app fails', {skip: os.platform() !== 'darwin'}, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-remove-failure-'));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = dir;
        const app = await nativeFixture(path.join(dir, 'app'), releaseConfiguration().supportedAppVersions[0], false);
        const paths = guiPaths(), folder = path.join(paths.jobs, 'failed-restore'); fs.mkdirSync(folder,{recursive:true});
        const font = path.join(paths.support,'font-preferences.json'); fs.writeFileSync(font,'keep');
        const result = await runGUIJob({schema:1,id:'failed-restore',folder,action:'restore',config:{app:app.app,runtime:dir}}, {
            noUI:true,running:()=>false,restore(){throw new Error('restore denied');},removeEvent(){throw new Error('must not remove events before restore');}
        });
        assert.equal(result,'failed');
        assert.equal(fs.readFileSync(font,'utf8'),'keep');
        assert.match(readJSON(paths.status).error,/restore denied/);
    } finally {
        if(previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME=previous;
        fs.rmSync(dir,{recursive:true,force:true});
    }
});

it('removes silently from the panel without waiting for a window acknowledgement', {skip: os.platform() !== 'darwin'}, async () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artl-silent-remove-')),previous=process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME=dir;
        const app=await nativeFixture(path.join(dir,'app'),releaseConfiguration().supportedAppVersions[0],false);
        const paths=guiPaths(),folder=path.join(paths.jobs,'silent');fs.mkdirSync(folder,{recursive:true});
        let removed=false,finished=false,opened=false;
        const result=await runGUIJob({schema:1,id:'silent',folder,action:'restore',config:{app:app.app,runtime:'/must-not-spawn',flow:'download-launch',silentRestore:true,showWindow:true}}, {
            running:()=>opened,restore:()=>{},removeEvent:()=>{},removeData:()=>{removed=true;},
            open: appPath=>{assert.equal(appPath,app.app);assert.equal(finished,true,'reopen only after all cleanup finishes');opened=true;},
            finishUninstall:async(_job,options)=>{assert.equal(options.waitForWindow,false);finished=true;}
        });
        assert.equal(result,'complete');assert.equal(removed,true);assert.equal(finished,true);assert.equal(opened,true);
        opened=false;
        assert.equal(await runGUIJob({schema:1,id:'silent',folder,action:'restore',config:{app:app.app,runtime:'/must-not-spawn',flow:'download-launch',silentRestore:true}}, {
            running:()=>false,restore:()=>{},removeEvent:()=>{},removeData:()=>{},
            finishUninstall:async()=>{throw new Error('cleanup denied');},open:()=>{opened=true;}
        }),'failed');
        assert.equal(opened,false,'do not reopen before successful cleanup');
    } finally {
        if(previous===undefined)delete process.env.ARTL_CODEX_STATE_HOME;else process.env.ARTL_CODEX_STATE_HOME=previous;
        fs.rmSync(dir,{recursive:true,force:true});
    }
});
