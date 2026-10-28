#!/usr/bin/env node
import { saveAppearance } from './lib/appearance.js';
import fs from 'node:fs';
import { targetId } from './lib/app-target.js';
import { resolveT3App } from './lib/t3.js';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compareVersions } from './lib/update-feed.js';
import { guiPaths, readJSON, saveJSON, snapshotRuntime, launchGUIJob, activeWorker, releaseGUIJob, agentVersion, requestGUIInstall } from './lib/gui-runtime.js';
import { resolveGUIApp, checkGUIUpdates, runGUIJob, prepareGUIStage, releaseConfiguration } from './lib/gui-updates.js';
import { inspectNative, verifyInstalledNative } from './lib/codex-native.js';
import { resolveCodexApp } from './lib/codex.js';
import { launchWizard } from './lib/update-events.js';
import { fontPreferences, importFont, selectFont, MAX_FONT_BYTES } from './lib/font-preferences.js';
import * as asar from '@electron/asar';

const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
async function main() {
    if (args.includes('--worker')) {
        const file = value('--worker'), paths = guiPaths();
        if (path.dirname(path.dirname(file)) !== paths.jobs || path.basename(file) !== 'job.json') throw new Error('Invalid UI job path.');
        await runGUIJob(readJSON(file)); return;
    }
    if (args.includes('--stage')) {
        const file = value('--stage');
        if (path.dirname(path.dirname(file)) !== guiPaths().jobs || path.basename(file) !== 'stage-request.json') throw new Error('Invalid staged update request.');
        saveJSON(`${file}.result`, prepareGUIStage(readJSON(file))); return;
    }
    const action = value('--rpc'), paths = guiPaths();
    if (['fonts', 'font-import', 'font-select', 'appearance'].includes(action)) {
        if (action === 'fonts') return fontPreferences();
        const chunks = []; let length = 0;
        for await (const chunk of process.stdin) {
            length += chunk.length;
            if (length > Math.ceil(MAX_FONT_BYTES / 3) * 4 + 1024) throw new Error('The font request is too large.');
            chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (action === 'appearance') return saveAppearance(input);
        return action === 'font-import' ? importFont(input) : selectFont(input.id);
    }
    const app = args.includes('--app') ? value('--app') : (targetId() === 't3' ? resolveT3App() : resolveCodexApp())?.app;
    if (!app) throw new Error('ChatGPT/Codex application not found.');
    const bundle = resolveGUIApp(app);
    let config = readJSON(paths.config);
    if (args.includes('--setup') && ['repair', 'restore', 'check', 'prepare'].includes(action)) {
        if (activeWorker()) throw new Error('An update is already running.');
        if (config?.app === app && compareVersions(config.agentVersion, agentVersion) > 0) {
            const response = JSON.parse(execFileSync(path.join(config.runtime, 'node'), [path.join(config.runtime, 'bin/gui-service.js'),
                '--rpc', action, '--app', app, '--attached-ui'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
            if (!response.ok) throw new Error(response.error); return response.value;
        }
        if (!config || config.app !== app || config.agentVersion !== agentVersion || action === 'repair') {
            const runtime = snapshotRuntime(bundle);
            config = { schema: 1, app, runtime, agentVersion, flow: 'download-launch' }; saveJSON(paths.config, config);
        }
    }
    if (action === 'status') {
        const running = activeWorker(); let operation = readJSON(paths.status);
        if (operation && ['starting', 'checking', 'downloading-agent', 'downloading-app', 'verifying', 'preparing', 'ready-to-install', 'quitting', 'waiting-for-quit', 'installing', 'reopening'].includes(operation.phase) && !running)
            operation = { ...operation, phase: 'failed', error: 'The installer stopped. Please retry from Rasta.' };
        const patch = inspectNative(bundle).state;
        let installedAgentVersion = null;
        try { installedAgentVersion = JSON.parse(asar.extractFile(bundle.archive, 'agent-rtl/host.json')).agentVersion || null; } catch {}
        let healthy = patch === 'patched-in-app';
        // Only the setup window requests the expensive signature check. Widget polling stays cheap.
        if (healthy && args.includes('--setup')) { try { verifyInstalledNative(bundle); } catch { healthy = false; } }
        const releaseConfig = releaseConfiguration();
        return { app, appVersion: bundle.version, agentVersion, installedAgentVersion,
            localSupported: releaseConfig.supportedAppVersions.includes(bundle.version),
            patchCurrent: Boolean(healthy && installedAgentVersion && compareVersions(installedAgentVersion, agentVersion) >= 0),
            patch, operation, update: readJSON(paths.cache), running };
    }
    if (!config || config.app !== app) throw new Error('Rasta setup has not completed for this app.');
    if (action === 'ready') {
        const host = JSON.parse(asar.extractFile(bundle.archive, 'agent-rtl/host.json'));
        if (host.app !== app || host.runtime !== config.runtime) throw new Error('RTL runtime does not match the installed host.');
        saveJSON(paths.ready, { app, agentVersion: host.agentVersion, at: Date.now() }); return { ready: true };
    }
    if (action === 'open') return { pid: await launchWizard(config) };
    if (action === 'check') return await checkGUIUpdates({ ...config, flow: 'download-launch' });
    if (action === 'install') {
        if (!args.includes('--setup') && !args.includes('--attached-ui')) throw new Error('Install is only available in the setup window.');
        return requestGUIInstall(value('--job'), app);
    }
    if (action === 'cancel') { fs.writeFileSync(paths.cancel, 'cancel'); return { phase: 'cancelling' }; }
    if (!['repair', 'prepare', 'restore'].includes(action)) throw new Error('Unknown RTL action.');
    const fromPanel = !args.includes('--setup') && !args.includes('--attached-ui');
    return await launchGUIJob(action, { ...config, flow: 'download-launch',
        silentRestore: action === 'restore' && fromPanel, showWindow: action !== 'restore' && fromPanel });
}
main().then(value => { if (!args.includes('--worker') && !args.includes('--stage')) console.log(JSON.stringify({ ok: true, value })); })
    .catch(error => {
        if (args.includes('--worker')) {
            const paths = guiPaths(), file = value('--worker');
            if (path.dirname(path.dirname(file)) === paths.jobs) {
                const id = path.basename(path.dirname(file));
                if (readJSON(paths.status)?.id === id) saveJSON(paths.status, { id, phase: 'failed', error: error.message });
                releaseGUIJob(id);
            }
        }
        console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1;
    });
