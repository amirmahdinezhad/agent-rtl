import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { nativePaths, isCodexRunning, codexProcesses, commitNative, discardNativeStage, restoreNative } from './codex-native.js';

export function installJobPaths() {
    const { support } = nativePaths();
    return { job: path.join(support, 'codex-install-job.json'),
        status: path.join(support, 'codex-install-status.json'), log: path.join(support, 'codex-install.log'),
        plist: path.join(support, 'codex-install-once.plist') };
}

export function readInstallStatus() {
    try { return JSON.parse(fs.readFileSync(installJobPaths().status, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function installerRunning(status = readInstallStatus()) {
    if (!Number.isInteger(status?.pid) || status.pid < 1) return false;
    try {
        const command = execFileSync('/bin/ps', ['-p', String(status.pid), '-o', 'command='], { encoding: 'utf8' });
        return command.includes(fileURLToPath(new URL('../codex-install-once.js', import.meta.url)))
            && command.includes(installJobPaths().job);
    } catch { return false; }
}

export async function cancelInstallJob() {
    const status = readInstallStatus();
    if (!installerRunning(status)) return false;
    process.kill(status.pid, 'SIGTERM');
    for (let i = 0; i < 50; i++) {
        if (!installerRunning(status)) return true;
        await delay(100);
    }
    throw new Error('The one-time installer is still finishing an operation; retry restore in a moment.');
}

function saveStatus(file, value) {
    const temporary = `${file}.${process.pid}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
}

export async function queueAfterQuit(stage, { timeoutMs = 15 * 60 * 1000, quitAfterMs = null, reopen = true } = {}) {
    if (process.platform !== 'darwin') throw new Error('One-time Codex installation requires macOS.');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30 * 60 * 1000) throw new Error('Invalid one-time installation timeout.');
    if (quitAfterMs !== null && (!Number.isFinite(quitAfterMs) || quitAfterMs < 0 || quitAfterMs > 60000 || quitAfterMs >= timeoutMs)) throw new Error('Invalid normal-quit countdown.');
    if (typeof reopen !== 'boolean' || (!reopen && quitAfterMs !== null)) throw new Error('Manual reopening requires a manual quit.');
    const paths = installJobPaths();
    const previous = readInstallStatus();
    if (previous && ['queued', 'waiting-for-quit', 'quitting', 'installing', 'reopening'].includes(previous.phase)) {
        if (installerRunning(previous)) throw new Error('A one-time Codex installation is already pending.');
    }
    fs.mkdirSync(path.dirname(paths.job), { recursive: true });
    const id = randomUUID(), label = `dev.rasta.install-once.${id}`, domain = `gui/${process.getuid()}`;
    const job = { version: 1, id, stage, deadline: Date.now() + timeoutMs, paths, launch: { label, domain } };
    if (quitAfterMs !== null) job.quitAfterMs = quitAfterMs;
    job.reopen = reopen;
    fs.writeFileSync(paths.job, JSON.stringify(job, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(paths.log, '', { mode: 0o600 });
    // Detached children remain descendants of Codex's managed task process.
    // launchd owns this installer from startup, so quitting Codex cannot stop
    // it. LaunchOnlyOnce removes the loaded job as soon as its process exits.
    // This file is outside LaunchAgents and is deleted by the worker.
    const plist = { Label: label,
        ProgramArguments: [process.execPath, fileURLToPath(new URL('../codex-install-once.js', import.meta.url)), '--job', paths.job],
        RunAtLoad: true, KeepAlive: false, LaunchOnlyOnce: true,
        StandardOutPath: paths.log, StandardErrorPath: paths.log };
    if (process.env.ARTL_CODEX_STATE_HOME) plist.EnvironmentVariables = { ARTL_CODEX_STATE_HOME: process.env.ARTL_CODEX_STATE_HOME };
    fs.writeFileSync(paths.plist, JSON.stringify(plist), { mode: 0o600 });
    saveStatus(paths.status, { id, phase: 'queued', app: stage.bundle.app, deadline: job.deadline, launch: job.launch });
    try {
        execFileSync('/usr/bin/plutil', ['-convert', 'xml1', paths.plist], { stdio: 'pipe' });
        execFileSync('/bin/launchctl', ['bootstrap', domain, paths.plist], { stdio: 'pipe' });
        // Do not release the calling session until the independent worker has
        // loaded its modules and acknowledged this exact installation job.
        for (let i = 0; i < 50; i++) {
            const status = readInstallStatus();
            if (status?.id === id && status.phase !== 'queued') {
                if (['failed', 'cancelled'].includes(status.phase)) throw new Error(status.error);
                return status;
            }
            await delay(100);
        }
        throw new Error('The one-time installer did not start.');
    } catch (error) {
        try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
        fs.rmSync(paths.job, { force: true });
        fs.rmSync(paths.plist, { force: true });
        saveStatus(paths.status, { id, phase: 'failed', app: stage.bundle.app, deadline: job.deadline, error: error.message });
        throw error;
    }
}

// NSRunningApplication requests normal application termination. It does not
// force-kill processes or require scripting another app through Apple Events.
// Match the exact bundle URL so other Codex installations are left alone.
export function requestCodexQuit(app) {
    const script = `function run(argv) {
        ObjC.import('AppKit');
        const target = ObjC.unwrap($.NSURL.fileURLWithPath(argv[0]).URLByResolvingSymlinksInPath.path);
        const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
        for (let i = 0; i < apps.count; i++) {
            const app = apps.objectAtIndex(i);
            if (app.bundleURL.isNil()) continue;
            if (ObjC.unwrap(app.bundleURL.URLByResolvingSymlinksInPath.path) !== target) continue;
            if (!app.terminate) throw new Error('macOS could not send the normal quit request.');
            return 'requested';
        }
        return 'already-closed';
    }`;
    return execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// This worker is bounded, runs once, and exits after installation or timeout.
// It has no login registration, KeepAlive, debugging port or launcher.
export async function runInstallJob(job, options = {}) {
    const running = options.running || isCodexRunning;
    const commit = options.commit || commitNative;
    const cleanup = options.cleanup || discardNativeStage;
    const rollback = options.rollback || restoreNative;
    const open = options.open || (app => execFileSync('/usr/bin/open', [app], { stdio: 'ignore' }));
    const now = options.now || Date.now;
    const pause = options.pause || (ms => delay(ms, undefined, { signal: options.signal }));
    const report = options.report || (value => {
        saveStatus(job.paths.status, value);
        fs.appendFileSync(job.paths.log, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
    });
    const confirmOpen = options.confirmOpen || (async bundle => {
        for (let i = 0; i < 20; i++) {
            if (isCodexRunning(bundle)) {
                await delay(1000);
                if (isCodexRunning(bundle)) return;
            }
            await delay(250);
        }
        throw new Error('The patched Codex app did not remain open.');
    });
    const status = { id: job.id, pid: process.pid, app: job.stage.bundle.app, deadline: job.deadline, launch: job.launch };
    if (job.version !== 1 || !Number.isFinite(job.deadline)) throw new Error('Invalid one-time installation job.');
    let phase = 'waiting-for-quit';
    report({ ...status, phase });
    try {
        if (job.quitAfterMs !== undefined) {
            if (!Number.isFinite(job.quitAfterMs) || job.quitAfterMs < 0 || job.quitAfterMs > 60000) throw new Error('Invalid normal-quit countdown.');
            const quitAt = now() + job.quitAfterMs;
            while (now() < quitAt) {
                if (options.signal?.aborted) throw new DOMException('Installation cancelled.', 'AbortError');
                await pause(Math.min(250, quitAt - now()));
            }
            if (options.signal?.aborted) throw new DOMException('Installation cancelled.', 'AbortError');
            if (now() < job.deadline) {
                phase = 'quitting'; report({ ...status, phase });
                status.quitRequest = (options.quit || requestCodexQuit)(job.stage.bundle.app);
                phase = 'waiting-for-quit'; report({ ...status, phase });
            }
        }
        let closedSince = null;
        let previousBlockers = '';
        while (true) {
            if (options.signal?.aborted) throw new DOMException('Installation cancelled.', 'AbortError');
            if (now() >= job.deadline) { phase = 'timed-out'; report({ ...status, phase, error: 'Codex was not closed before the deadline. The installed app is unchanged.' }); return phase; }
            if (running(job.stage.bundle)) {
                closedSince = null;
                const blockers = options.blockers ? options.blockers(job.stage.bundle)
                    : options.running ? null : codexProcesses(job.stage.bundle);
                const key = JSON.stringify(blockers);
                if (blockers && key !== previousBlockers) {
                    status.blockingProcesses = blockers; previousBlockers = key;
                    report({ ...status, phase });
                }
            }
            else {
                delete status.blockingProcesses;
                closedSince ??= now();
                if (now() - closedSince >= 1500) break;
            }
            await pause(500);
        }
        phase = 'installing'; report({ ...status, phase });
        const result = commit(job.stage);
        if (job.reopen === false) {
            phase = 'complete'; report({ ...status, phase, result, reopened: false, completedAt: new Date(now()).toISOString() });
            return phase;
        }
        phase = 'reopening'; report({ ...status, phase, result });
        try {
            open(job.stage.bundle.app);
            await confirmOpen(job.stage.bundle);
        } catch (error) {
            rollback(job.stage.bundle);
            open(job.stage.bundle.app);
            phase = 'rolled-back'; report({ ...status, phase, error: error.message, originalAppRestored: true });
            return phase;
        }
        phase = 'complete'; report({ ...status, phase, result, completedAt: new Date(now()).toISOString() });
        return phase;
    } catch (error) {
        phase = error.name === 'AbortError' ? 'cancelled' : 'failed';
        report({ ...status, phase, error: error.message });
        throw error;
    } finally { cleanup(job.stage); }
}
