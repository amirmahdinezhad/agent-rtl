// macOS runs this job only for app-bundle changes. There is no idle helper.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { guiPaths, readJSON, saveJSON, activeWorker } from './gui-runtime.js';

export function updateEventPaths(app) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    const label = 'dev.agentrtl.update.' + createHash('sha256').update(app).digest('hex').slice(0, 12);
    return { label, domain: `gui/${process.getuid()}`, plist: path.join(home, 'Library/LaunchAgents', label + '.plist'), state: path.join(guiPaths().support, 'update-event.json') };
}
export function updateEventPlist(config) {
    const paths = updateEventPaths(config.app);
    return { Label: paths.label, ProgramArguments: [path.join(config.runtime, 'node'), path.join(config.runtime, 'bin/gui-update-event.js')],
        WatchPaths: [path.dirname(config.app), config.app, path.join(config.app, 'Contents/Info.plist'), path.join(config.app, 'Contents/Resources/app.asar')],
        RunAtLoad: true, KeepAlive: false, ThrottleInterval: 15, AbandonProcessGroup: true, ProcessType: 'Background',
        StandardOutPath: path.join(guiPaths().support, 'update-event.log'), StandardErrorPath: path.join(guiPaths().support, 'update-event.log'),
        ...(process.env.ARTL_CODEX_STATE_HOME ? { EnvironmentVariables: { ARTL_CODEX_STATE_HOME: process.env.ARTL_CODEX_STATE_HOME } } : {}) };
}
export function appFingerprint(app) {
    return ['Contents/Info.plist', 'Contents/Resources/app.asar'].map(name => {
        const stat = fs.statSync(path.join(app, name)); return [stat.dev, stat.ino, stat.size, stat.mtimeMs].join(':');
    }).join('|');
}
export function installUpdateEvent(config, { healthy = true } = {}) {
    const paths = updateEventPaths(config.app);
    try { execFileSync('/bin/launchctl', ['bootout', `${paths.domain}/${paths.label}`], { stdio: 'pipe' }); } catch {}
    saveJSON(paths.state, { enabled: true, app: config.app, healthyFingerprint: healthy ? appFingerprint(config.app) : null });
    saveJSON(paths.plist, updateEventPlist(config));
    try {
        execFileSync('/usr/bin/plutil', ['-convert', 'xml1', paths.plist], { stdio: 'pipe' });
        execFileSync('/bin/launchctl', ['bootstrap', paths.domain, paths.plist], { stdio: 'pipe' });
    } catch (error) { fs.rmSync(paths.plist, { force: true }); saveJSON(paths.state, { enabled: false, app: config.app }); throw error; }
    return paths;
}
export function removeUpdateEvent(config) {
    const paths = updateEventPaths(config.app); saveJSON(paths.state, { enabled: false, app: config.app });
    try { execFileSync('/bin/launchctl', ['bootout', `${paths.domain}/${paths.label}`], { stdio: 'pipe' }); } catch {}
    fs.rmSync(paths.plist, { force: true });
    try { fs.rmdirSync(path.dirname(paths.plist)); } catch {}
}
export function wizardRunning(config, pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
        const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
        return command === `${path.join(config.runtime, 'agent-rtl-ui')} --wizard ${config.runtime} ${config.app}`;
    } catch { return false; }
}
export async function promptAfterAppChange(config, { resolve, healthy, fingerprint = appFingerprint, pause = delay, busy = activeWorker, launch = launchWizard,
    attempts = 15, now = Date.now, wizardRunning: isWizardRunning = wizardRunning } = {}) {
    const paths = updateEventPaths(config.app);
    let previous = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (busy()) return 'busy';
        const state = readJSON(paths.state);
        if (!state?.enabled || state.app !== config.app) return 'disabled';
        let prompt = null;
        try {
            const current = fingerprint(config.app);
            if (state.healthyFingerprint === current) return 'unchanged';
            // A prompt is not a successful installation. Suppress only an active
            // wizard or a short event burst, so a dismissed/failed UI can recover.
            if (state.promptFingerprint === current && (isWizardRunning(config, state.promptPid)
                || now() - Date.parse(state.promptedAt) < 300000)) return 'unchanged';
            // Bundle replacement can produce incomplete intermediate files. Re-read after settling.
            if (current === previous) {
                const bundle = resolve(config.app);
                if (healthy(bundle)) { saveJSON(paths.state, { ...state, healthyFingerprint: current }); return 'healthy'; }
                prompt = current;
            }
            previous = current;
        } catch { previous = null; }
        // Spawn errors must remain visible and must not consume a retry.
        if (prompt !== null) {
            const pid = await launch(config);
            saveJSON(paths.state, { ...state, promptFingerprint: prompt, promptedAt: new Date(now()).toISOString(), promptPid: pid });
            return 'prompted';
        }
        await pause(2000);
    }
    return 'not-ready';
}
export function launchWizard(config) {
    return new Promise((resolve, reject) => {
        const child = spawn(path.join(config.runtime, 'agent-rtl-ui'), ['--wizard', config.runtime, config.app], {
            detached: true, stdio: 'ignore', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('CODEX_') && key !== 'ELECTRON_RUN_AS_NODE')),
        });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(child.pid); });
    });
}
