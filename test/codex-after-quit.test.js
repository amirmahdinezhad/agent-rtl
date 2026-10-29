import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { runInstallJob, queueAfterQuit, readInstallStatus, installerRunning, installJobPaths, requestCodexQuit } from '../bin/lib/codex-after-quit.js';
import { isCodexRunning } from '../bin/lib/codex-native.js';

function harness() {
    let time = 0;
    const events = [], phases = [], abort = new AbortController();
    const job = { version: 1, stage: { bundle: { app: '/Applications/Codex.app' } }, deadline: 10000 };
    const options = { now: () => time, pause: async ms => { time += ms; }, signal: abort.signal,
        commit: () => { events.push('install'); return { originalLogicPreserved: true }; },
        open: app => events.push(`open ${app}`), cleanup: () => events.push('cleanup'),
        confirmOpen: async () => {}, rollback: () => events.push('restore original'),
        report: status => phases.push(status.phase) };
    return { job, options, events, phases, abort };
}

describe('one-time installation after Codex quits', () => {
    it('normally quits the exact native bundle and confirms exit before committing', { skip: process.platform !== 'darwin' }, async () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artl-normal-quit-')));
        const app = path.join(dir, 'Quit Fixture.app'), executable = path.join(app, 'Contents/MacOS/Fixture');
        const bundle = { app, executable };
        try {
            fs.mkdirSync(path.dirname(executable), { recursive: true });
            const source = path.join(dir, 'fixture.m');
            fs.writeFileSync(source, `#import <AppKit/AppKit.h>
@interface FixtureDelegate : NSObject <NSApplicationDelegate> @end
@implementation FixtureDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [@"ready" writeToFile:NSProcessInfo.processInfo.arguments[1] atomically:YES encoding:NSUTF8StringEncoding error:nil];
}
@end
int main(void) { @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    FixtureDelegate *delegate = [FixtureDelegate new]; [NSApp setDelegate:delegate];
    [NSApp run];
} return 0; }`);
            execFileSync('/usr/bin/xcrun', ['clang', source, '-framework', 'AppKit', '-o', executable], { stdio: 'pipe' });
            const plist = path.join(app, 'Contents/Info.plist');
            fs.writeFileSync(plist, JSON.stringify({ CFBundleExecutable: 'Fixture', CFBundleIdentifier: `dev.rasta.quit-test.${process.pid}`,
                CFBundlePackageType: 'APPL', LSUIElement: true }));
            execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist], { stdio: 'pipe' });
            execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
            const readyFile = path.join(dir, 'ready');
            execFileSync('/usr/bin/open', ['-n', app, '--args', readyFile], { stdio: 'pipe' });
            for (let i = 0; i < 80 && !fs.existsSync(readyFile); i++) await delay(100);
            assert.ok(fs.existsSync(readyFile), 'native test app must finish launching before requesting quit');
            assert.equal(isCodexRunning(bundle), true);
            const phases = [];
            const job = { version: 1, stage: { bundle }, quitAfterMs: 100, deadline: Date.now() + 10000 };
            const result = await runInstallJob(job, { report: status => phases.push(status.phase),
                quit: target => assert.equal(requestCodexQuit(target), 'requested'),
                commit: () => { assert.equal(isCodexRunning(bundle), false); return {}; },
                open: () => {}, confirmOpen: async () => {}, cleanup: () => {} });
            assert.equal(result, 'complete');
            assert.ok(phases.includes('quitting'));
            assert.equal(isCodexRunning(bundle), false);
        } finally {
            try { requestCodexQuit(app); } catch {}
            const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
            for (const row of processes.split('\n')) {
                const match = row.trim().match(/^(\d+) (.+)$/);
                if (match?.[2] === executable) try { process.kill(Number(match[1]), 'SIGTERM'); } catch {}
            }
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('survives shutdown of the launching app and all its descendants', { skip: process.platform !== 'darwin' }, async () => {
        const stateHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artl-parent-exit-')));
        const saved = process.env.ARTL_CODEX_STATE_HOME;
        let parent, fakeApp;
        try {
            process.env.ARTL_CODEX_STATE_HOME = stateHome;
            const app = path.join(stateHome, 'Codex.app');
            const executable = path.join(app, 'Contents/MacOS/Codex');
            const staging = path.join(stateHome, '.rasta-stage-fixture');
            fs.mkdirSync(path.dirname(executable), { recursive: true });
            fs.copyFileSync('/bin/sleep', executable);
            fs.mkdirSync(staging);
            // Stay alive through slower launchd startup; the worker still times out after 4 seconds.
            fakeApp = spawn(executable, ['30'], { stdio: 'ignore' });
            const moduleUrl = new URL('../bin/lib/codex-after-quit.js', import.meta.url).href;
            const stage = { bundle: { app }, staging, stagedApp: path.join(staging, 'Stage.app') };
            parent = spawn(process.execPath, ['--input-type=module', '-e', `
                import { queueAfterQuit } from ${JSON.stringify(moduleUrl)};
                const status = await queueAfterQuit(${JSON.stringify(stage)}, { timeoutMs: 4000 });
                console.log(JSON.stringify(status));
                setInterval(() => {}, 1000);
            `], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
            const queued = await new Promise((resolve, reject) => {
                let output = '', errors = '';
                const timer = setTimeout(() => reject(new Error(`Installer did not start: ${errors}`)), 6000);
                parent.stderr.on('data', chunk => { errors += chunk; });
                parent.stdout.on('data', chunk => {
                    output += chunk;
                    if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
                });
                parent.on('error', error => { clearTimeout(timer); reject(error); });
            });
            assert.equal(queued.phase, 'waiting-for-quit');
            const workerParent = Number(execFileSync('/bin/ps', ['-p', String(queued.pid), '-o', 'ppid='], { encoding: 'utf8' }).trim());
            // Codex can terminate its complete descendant tree on quit; a
            // detached process group alone does not move a child out of it.
            assert.equal(workerParent, 1, 'launchd must own the installer before the app quits');
            const processes = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' })
                .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
            const descendants = new Set([parent.pid]);
            for (let changed = true; changed;) {
                changed = false;
                for (const [pid, ppid] of processes) if (descendants.has(ppid) && !descendants.has(pid)) { descendants.add(pid); changed = true; }
            }
            for (const pid of [...descendants].reverse()) try { process.kill(pid, 'SIGTERM'); } catch {}
            await delay(250);
            assert.equal(installerRunning(), true, 'installer must remain alive after app shutdown');
            assert.equal(readInstallStatus().phase, 'waiting-for-quit');
            for (let i = 0; i < 100 && (readInstallStatus()?.phase !== 'timed-out' || installerRunning()); i++) await delay(50);
            assert.equal(readInstallStatus().phase, 'timed-out', JSON.stringify(readInstallStatus()));
            assert.equal(installerRunning(), false);
            assert.equal(fs.existsSync(staging), false);
            assert.equal(fs.existsSync(path.join(stateHome, 'Library/LaunchAgents')), false);
            assert.equal(fs.existsSync(installJobPaths().plist), false);
            assert.throws(() => execFileSync('/bin/launchctl', ['print', `${queued.launch.domain}/${queued.launch.label}`], { stdio: 'ignore' }));
        } finally {
            parent?.kill('SIGTERM'); fakeApp?.kill('SIGTERM');
            const status = readInstallStatus();
            if (installerRunning(status)) {
                process.kill(status.pid, 'SIGTERM');
                for (let i = 0; i < 50 && installerRunning(status); i++) await delay(50);
            }
            if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
            fs.rmSync(stateHome, { recursive: true, force: true });
        }
    });

    it('waits through a quick reopen, installs once after stable exit, and reopens only the original app', async () => {
        const h = harness(); let calls = 0;
        h.options.running = () => [true, false, true, false, false, false, false][calls++] ?? false;
        assert.equal(await runInstallJob(h.job, h.options), 'complete');
        assert.ok(calls >= 7, 'a quick restart resets the stable-exit timer');
        assert.deepEqual(h.events, ['install', 'open /Applications/Codex.app', 'cleanup']);
        assert.deepEqual(h.phases, ['waiting-for-quit', 'installing', 'reopening', 'complete']);
    });

    it('requests a normal quit once after the countdown, then waits for exit before installation', async () => {
        const h = harness(); h.job.quitAfterMs = 2000;
        let requested = false, remaining = 2;
        h.options.quit = app => { assert.equal(app, h.job.stage.bundle.app); requested = true; h.events.push('normal quit'); };
        h.options.running = () => !requested || remaining-- > 0;
        assert.equal(await runInstallJob(h.job, h.options), 'complete');
        assert.deepEqual(h.events, ['normal quit', 'install', 'open /Applications/Codex.app', 'cleanup']);
        assert.deepEqual(h.phases, ['waiting-for-quit', 'quitting', 'waiting-for-quit', 'installing', 'reopening', 'complete']);
    });

    it('leaves reopening to the user in manual restart mode', async () => {
        const h = harness(); h.job.reopen = false; h.options.running = () => false;
        h.options.confirmOpen = async () => { throw new Error('Manual mode must not check startup'); };
        assert.equal(await runInstallJob(h.job, h.options), 'complete');
        assert.deepEqual(h.events, ['install', 'cleanup']);
        assert.deepEqual(h.phases, ['waiting-for-quit', 'installing', 'complete']);
    });

    it('does not quit or install if a restart request is cancelled during the countdown', async () => {
        const h = harness(); h.job.quitAfterMs = 2000;
        h.options.pause = async () => { h.abort.abort(); };
        h.options.quit = () => h.events.push('normal quit');
        await assert.rejects(runInstallJob(h.job, h.options), { name: 'AbortError' });
        assert.deepEqual(h.events, ['cleanup']);
    });

    it('stops without installing if macOS rejects the normal quit request', async () => {
        const h = harness(); h.job.quitAfterMs = 0;
        h.options.quit = () => { throw new Error('Quit request refused'); };
        await assert.rejects(runInstallJob(h.job, h.options), /Quit request refused/);
        assert.deepEqual(h.events, ['cleanup']);
        assert.equal(h.phases.at(-1), 'failed');
    });

    it('times out without changing Codex or leaving a permanent worker/staging copy', async () => {
        const h = harness(); h.job.deadline = 1000; h.options.running = () => true;
        assert.equal(await runInstallJob(h.job, h.options), 'timed-out');
        assert.deepEqual(h.events, ['cleanup']);
        assert.deepEqual(h.phases, ['waiting-for-quit', 'timed-out']);
    });

    it('reports the exact blocking processes without logging process arguments', async () => {
        const h = harness(); const statuses = [];
        h.job.deadline = 1000; h.options.running = () => true;
        h.options.blockers = () => [{ pid: 123, parent: 1, executable: 'Contents/MacOS/Codex' }];
        h.options.report = value => statuses.push({ ...value });
        assert.equal(await runInstallJob(h.job, h.options), 'timed-out');
        assert.deepEqual(statuses.at(-1).blockingProcesses, h.options.blockers());
        assert.equal(statuses.filter(status => status.phase === 'waiting-for-quit').length, 2, 'unchanged blockers are not logged on every poll');
        assert.deepEqual(h.events, ['cleanup']);
    });

    it('cancels a pending installation without installing or opening an app', async () => {
        const h = harness(); h.options.running = () => { h.abort.abort(); return true; };
        await assert.rejects(runInstallJob(h.job, h.options), { name: 'AbortError' });
        assert.deepEqual(h.events, ['cleanup']);
        assert.equal(h.phases.at(-1), 'cancelled');
    });

    it('does not reopen a failed installation and still removes its staging files', async () => {
        const h = harness(); h.options.running = () => false;
        h.options.commit = () => { throw new Error('Original app changed during preparation'); };
        await assert.rejects(runInstallJob(h.job, h.options), /Original app changed/);
        assert.deepEqual(h.events, ['cleanup']);
        assert.deepEqual(h.phases, ['waiting-for-quit', 'installing', 'failed']);
    });

    it('restores and reopens the original app if the patched app fails to start', async () => {
        const h = harness(); h.options.running = () => false;
        h.options.confirmOpen = async () => { throw new Error('App did not open'); };
        assert.equal(await runInstallJob(h.job, h.options), 'rolled-back');
        assert.deepEqual(h.events, ['install', 'open /Applications/Codex.app', 'restore original', 'open /Applications/Codex.app', 'cleanup']);
        assert.equal(h.phases.at(-1), 'rolled-back');
    });

    it('starts a real one-time worker that times out, exits, and preserves the original app', { skip: process.platform !== 'darwin' }, async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-install-once-'));
        const saved = process.env.ARTL_CODEX_STATE_HOME;
        try {
            process.env.ARTL_CODEX_STATE_HOME = home;
            const app = path.join(home, 'Original Codex.app');
            const staging = path.join(home, '.rasta-stage-fixture');
            fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
            fs.writeFileSync(path.join(app, 'Contents/sentinel'), 'original app bytes');
            fs.mkdirSync(staging);
            const stage = { bundle: { app }, staging, stagedApp: path.join(staging, 'Stage.app') };
            const queued = await queueAfterQuit(stage, { timeoutMs: 1000 });
            assert.ok(['waiting-for-quit', 'timed-out'].includes(queued.phase));
            for (let i = 0; i < 60 && (readInstallStatus()?.phase !== 'timed-out' || installerRunning()); i++) await delay(50);
            assert.equal(readInstallStatus().phase, 'timed-out', JSON.stringify(readInstallStatus()));
            assert.equal(installerRunning(), false);
            assert.equal(fs.existsSync(staging), false);
            assert.equal(fs.readFileSync(path.join(app, 'Contents/sentinel'), 'utf8'), 'original app bytes');
            assert.equal(fs.existsSync(path.join(home, 'Library/LaunchAgents')), false);
        } finally {
            if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
