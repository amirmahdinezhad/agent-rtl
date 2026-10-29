import { removeGUIData, finishGUIUninstall } from './gui-uninstall.js';
import fs from 'node:fs';
import { targetId, targetName } from './app-target.js';
import { resolveT3App } from './t3.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import * as asar from '@electron/asar';
import { setTimeout as delay } from 'node:timers/promises';
import { buildCodexPayload, resolveCodexApp } from './codex.js';
import { stageNative, stageManagedNative, commitNative, commitManagedNative, discardNativeStage,
    restoreNative, isCodexRunning, verifyOfficialBundle } from './codex-native.js';
import { guiPaths, saveJSON, readJSON, agentVersion, packageRoot, installedFonts, releaseGUIJob } from './gui-runtime.js';
import { downloadPrivateArtifact, privateAsset } from './github-release.js';
import { requestCodexQuit } from './codex-after-quit.js';
import { installUpdateEvent, removeUpdateEvent } from './update-events.js';
import { fetchTrusted, boundedText, parseAppcast, verifyReleaseEnvelope, compareVersions, downloadArtifact, VENDOR_KEY } from './update-feed.js';

export function resolveGUIApp(app) {
    if (!path.isAbsolute(app)) throw new Error('Invalid application path.');
    if (targetId() === 't3') { const bundle = resolveT3App(app); if (!bundle) throw new Error('T3 Code application not found.'); return bundle; }
    const previous = process.env.ARTL_CODEX_APP;
    try { process.env.ARTL_CODEX_APP = app; const bundle = resolveCodexApp(); if (!bundle) throw new Error('ChatGPT/Codex application not found.'); return bundle; }
    finally { if (previous === undefined) delete process.env.ARTL_CODEX_APP; else process.env.ARTL_CODEX_APP = previous; }
}
export function releaseConfiguration() {
    const config = readJSON(path.join(packageRoot, 'bin/release-config.json'));
    return targetId() === 't3' && config.target !== 't3'
        ? { ...config, target: 't3', feedUrl: config.t3FeedUrl || null, supportedAppVersions: config.supportedT3Versions || [] } : config;
}
export async function checkGUIUpdates(config, { fetcher, osVersion = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), arch = process.arch } = {}) {
    const bundle = resolveGUIApp(config.app), pkg = JSON.parse(asar.extractFile(bundle.archive, 'package.json'));
    const releaseConfig = releaseConfiguration(), signal = AbortSignal.timeout(30000);
    const url = new URL('https://updates.oaistatic.com/codex/app/appcast');
    const paths = guiPaths();
    const installation = readJSON(path.join(paths.support, 'update-client.json'), { id: randomUUID() });
    saveJSON(path.join(paths.support, 'update-client.json'), installation);
    for (const [key, value] of Object.entries({ installation_id: installation.id, arch, app_version: bundle.version,
        beta: 'false', 'os-version': osVersion, plan_type: 'unknown' })) url.searchParams.set(key, value);
    let appUpdate = null;
    if (targetId() === 'codex') {
        const response = await fetchTrusted(url, { signal, fetcher });
        const xml = await boundedText(response, 1024 * 1024);
        appUpdate = parseAppcast(xml, { arch, osVersion, currentBuild: Number(pkg.codexBuildNumber || 0) });
    }
    let release = null, releaseError = null;
    if (releaseConfig?.feedUrl && releaseConfig.publicKey) {
        try {
            const body = releaseConfig.privateRepository
                ? (await privateAsset(releaseConfig.feedUrl, releaseConfig.privateRepository, { signal, maximum: 128 * 1024 })).toString()
                : await boundedText(await fetchTrusted(releaseConfig.feedUrl, { kind: 'release', signal, fetcher }), 128 * 1024);
            release = verifyReleaseEnvelope(JSON.parse(body), releaseConfig.publicKey, `darwin-${arch}`, targetId());
            if ((release.target || 'codex') !== targetId()) throw new Error('The Rasta release belongs to another application.');
        } catch (error) { release = null; releaseError = error.message; }
    }
    let patchMissing = false; try { asar.extractFile(bundle.archive, 'rasta/host.json'); } catch { patchMissing = true; }
    const plan = updatePlan({ ...config, patchMissing }, bundle.version, appUpdate, release, releaseConfig);
    const result = { checkedAt: new Date().toISOString(), appVersion: bundle.version, agentVersion: config.agentVersion || agentVersion,
        appUpdate, ...plan, releaseConfigured: !!releaseConfig?.feedUrl, releaseError };
    saveJSON(paths.cache, result); return result;
}

// Only the newest explicit compatibility entry is accepted by the graphical flow.
// Legacy one-time jobs retain their original behavior so an in-flight upgrade can finish.
export function updatePlan(config, appVersion, appUpdate, release, releaseConfig) {
    const baseline = config.agentVersion || agentVersion;
    const available = release && (compareVersions(release.agentVersion, baseline) > 0 || (config.patchMissing && config.verifiedReleaseVersion !== release.agentVersion && compareVersions(release.agentVersion, baseline) === 0)) ? release : null;
    const versions = available?.supportedAppVersions || releaseConfig?.supportedAppVersions || [];
    const latestSupported = [...versions].sort(compareVersions).at(-1);
    const interactive = ['download-install', 'download-launch'].includes(config.flow);
    // A local candidate knows its required app version without a vendor feed response.
    const requiresAppUpdate = interactive && Boolean(appUpdate || (latestSupported && compareVersions(appVersion, latestSupported) < 0));
    const targetVersion = appUpdate?.version || (requiresAppUpdate ? latestSupported : appVersion);
    const supported = interactive ? !requiresAppUpdate && appVersion === latestSupported : versions.includes(targetVersion);
    const hasUpdate = interactive ? Boolean(available) : Boolean(appUpdate || available);
    return { release: available, available: hasUpdate, supported, targetVersion, requiresAppUpdate,
        phase: requiresAppUpdate ? 'update-codex-first' : !supported ? 'needs-compatible-release' : hasUpdate ? 'available' : 'up-to-date' };
}

function extractZip(file, destination) {
    fs.mkdirSync(destination, { recursive: true });
    execFileSync('/usr/bin/ditto', ['-x', '-k', file, destination], { stdio: 'pipe' });
}
function findApp(folder, expectedName = null) {
    const apps = fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.endsWith('.app') && (!expectedName || e.name === expectedName));
    if (apps.length !== 1) throw new Error('The signed update contains an unexpected application layout.');
    return path.join(folder, apps[0].name);
}
function verifyVendorArchive(file, item, runtime) {
    const helper = path.join(runtime, 'rasta-ui');
    // CryptoKit maps the large ZIP, avoiding a second ~700 MB JS heap copy.
    execFileSync(helper, ['--verify', file, VENDOR_KEY, item.signature], { stdio: 'pipe' });
}

export function prepareGUIStage(request) {
    const { config } = request, bundle = resolveGUIApp(config.app);
    const options = { allowLocalSigning: true, payload: buildCodexPayload(installedFonts()),
        host: { app: config.app, runtime: config.runtime, agentVersion: config.agentVersion, target: targetId() } };
    return request.official ? stageManagedNative(bundle, request.official, options) : stageNative(bundle, options);
}

// All operations have fixed inputs from the signed manifest and this app's
// configuration. No renderer-supplied command, path or shell script is run.
export async function runGUIJob(job, overrides = {}) {
    const paths = guiPaths(), { config, action } = job;
    if (job.schema !== 1 || path.dirname(job.folder) !== paths.jobs || !['repair', 'prepare', 'restore'].includes(action)) throw new Error('Invalid update job.');
    const ownerFile = path.join(paths.lock, 'owner.json'), owner = readJSON(ownerFile);
    if (!job.handoffParentPid && owner?.id === job.id) saveJSON(ownerFile, { ...owner, pid: process.pid });
    const publish = overrides.publish || (value => saveJSON(paths.status, { id: job.id, action, app: config.app, pid: process.pid, at: new Date().toISOString(), ...value }));
    const controller = new AbortController();
    const checkCancellation = () => { if (fs.existsSync(paths.cancel)) controller.abort(); controller.signal.throwIfAborted(); };
    const cancellation = setInterval(() => { if (fs.existsSync(paths.cancel)) controller.abort(); }, 250);
    let lastProgress = 0;
    const progressFor = phase => (n, total) => {
        if (n !== total && Date.now() - lastProgress < 250) return;
        lastProgress = Date.now(); publish({ phase, progress: n / total });
    };
    const interactive = ['download-install', 'download-launch'].includes(config.flow);
    const relaunch = config.flow === 'download-launch' && action !== 'restore';
    let stage, committed = false, ui, uninstalled = false;
    try {
        fs.rmSync(path.join(job.folder, 'once.plist'), { force: true });
        publish({ phase: 'checking', progress: 0 });
        if (config.showWindow && !(action === 'restore' && config.silentRestore) && !overrides.noUI) {
            ui = spawn(path.join(config.runtime, 'rasta-ui'), ['--watch', paths.status, paths.cancel, config.app, job.id], { stdio: 'ignore', detached: true });
            ui.on('error', () => controller.abort(new Error('The graphical installer could not open.')));
            ui.on('exit', () => { if (!committed) controller.abort(); });
            ui.unref(); // The completed worker must exit while the result window is still visible.
        }
        let next = { ...config }, official = null;
        const bundle = resolveGUIApp(config.app);
        if (action === 'prepare' || (interactive && action === 'repair')) {
            const update = await (overrides.check || checkGUIUpdates)(config);
            checkCancellation();
            if (interactive && (update.requiresAppUpdate || update.appUpdate)) throw new Error('Update Codex to ' + update.targetVersion + ' first, then try again.');
            if (!interactive && !update.available) throw new Error('No update is available.');
            if (!update.supported) throw new Error('The new ChatGPT version needs a compatible Rasta release.');
            if (update.release) {
                publish({ phase: 'downloading-agent', progress: 0 });
                const archive = path.join(job.folder, 'agent.zip');
                const releaseDownload = releaseConfiguration().privateRepository ? (artifact, file, options) => downloadPrivateArtifact(artifact, file, releaseConfiguration().privateRepository, options) : downloadArtifact;
                await (overrides.download || releaseDownload)(update.release.artifact, archive, { kind: 'release', signal: controller.signal,
                    progress: progressFor('downloading-agent') });
                const extracted = path.join(job.folder, 'agent'); extractZip(archive, extracted);
                const app = findApp(extracted, targetId() === 't3' ? 'Rasta T3 Setup.app' : 'Rasta Setup.app');
                const sourceRuntime = path.join(app, 'Contents/Resources/runtime');
                const releasePackage = readJSON(path.join(sourceRuntime, 'package.json'));
                const downloadedTarget = readJSON(path.join(sourceRuntime, 'bin/release-config.json'))?.target || 'codex';
                if (downloadedTarget !== targetId()) throw new Error('Downloaded Rasta installer belongs to another application.');
                if (releasePackage?.version !== update.release.agentVersion || !fs.existsSync(path.join(sourceRuntime, 'node'))) throw new Error('Rasta archive does not match its signed release.');
                const runtime = path.join(paths.runtimes, `${update.release.agentVersion}-${randomUUID()}`);
                fs.cpSync(sourceRuntime, runtime, { recursive: true, verbatimSymlinks: true });
                next = { ...config, runtime, agentVersion: update.release.agentVersion, verifiedReleaseVersion: update.release.agentVersion };
                // The newly authenticated updater owns the rest of the job,
                // including app verification and commit. Updates to installer
                // code and pinned vendor keys therefore take effect immediately.
                const handoff = path.join(job.folder, 'job.json');
                saveJSON(handoff, { ...job, handoffParentPid: job.handoffParentPid || process.pid,
                    action: !interactive && update.appUpdate ? 'prepare' : 'repair', config: { ...next, showWindow: false } });
                execFileSync(path.join(runtime, 'node'), [path.join(runtime, 'bin/gui-service.js'), '--worker', handoff], { stdio: 'pipe', maxBuffer: 1024 * 1024 });
                const result = readJSON(paths.status);
                if (result?.id !== job.id || !['complete', 'failed', 'cancelled'].includes(result.phase)) throw new Error('The new updater did not finish its operation.');
                committed = result.phase === 'complete';
                return result.phase;
            }
            if (update.appUpdate) {
                const item = update.appUpdate;
                publish({ phase: 'downloading-app', progress: 0 });
                const archive = path.join(job.folder, 'chatgpt.zip');
                await downloadArtifact(item, archive, { signal: controller.signal,
                    progress: progressFor('downloading-app') });
                controller.signal.throwIfAborted(); publish({ phase: 'verifying', progress: 1 });
                (overrides.verifyArchive || verifyVendorArchive)(archive, item, config.runtime);
                const extracted = path.join(job.folder, 'official'); extractZip(archive, extracted);
                official = resolveGUIApp(findApp(extracted));
                const pkg = verifyOfficialBundle(official);
                if (official.version !== item.version || Number(pkg.codexBuildNumber) !== item.build) throw new Error('Official update version does not match its feed.');
                execFileSync('/usr/bin/lipo', ['-verify_arch', item.arch === 'x64' ? 'x86_64' : 'arm64', official.executable], { stdio: 'pipe' });
            }
        } else if (action === 'repair') {
            if (!releaseConfiguration().supportedAppVersions.includes(bundle.version)) throw new Error('This ChatGPT version needs a compatible Rasta release.');
        }
        if (action !== 'restore') {
            checkCancellation(); publish({ phase: 'preparing', progress: 0 });
            stage = (overrides.stage || prepareGUIStage)({ config: next, official });
        }
        checkCancellation();
        const running = overrides.running || isCodexRunning;
        if (interactive && action !== 'restore') {
            publish({ phase: 'ready-to-install', progress: 1, targetVersion: bundle.version, agentVersion: next.agentVersion });
            const approval = path.join(job.folder, 'install-request.json');
            while (readJSON(approval)?.id !== job.id) { checkCancellation(); await delay(150, undefined, { signal: controller.signal }); }
            checkCancellation(); publish({ phase: 'checking', progress: 1 });
            const latest = await (overrides.check || checkGUIUpdates)(next);
            checkCancellation();
            if (latest.requiresAppUpdate || latest.appUpdate) throw new Error('Update Codex to ' + latest.targetVersion + ' first, then try again.');
            if (!latest.supported) throw new Error('A compatible Rasta release is needed.');
            publish({ phase: 'quitting', progress: 1 });
            // Only this explicit Install approval can request normal termination.
            if (running(bundle)) (overrides.quit || requestCodexQuit)(bundle.app);
        }
        if (interactive && action === 'restore') { publish({ phase: 'quitting', progress: 1 }); if (running(bundle)) (overrides.quit || requestCodexQuit)(bundle.app); }
        publish({ phase: 'waiting-for-quit', progress: 1, targetVersion: official?.version || bundle.version,
            agentVersion: next.agentVersion, ready: true });
        const quitDeadline = interactive ? Date.now() + 30000 : null;
        let closedSince = null;
        while (true) {
            checkCancellation();
            if (quitDeadline && Date.now() >= quitDeadline) throw new Error('Codex did not quit. Finish any quit prompt, then try again.');
            if (running(bundle)) closedSince = null;
            else { closedSince ??= Date.now(); if (Date.now() - closedSince >= 1500) break; }
            await delay(250, undefined, { signal: controller.signal });
        }
        checkCancellation(); clearInterval(cancellation); publish({ phase: 'installing', progress: 1 });
        if (action === 'restore') (overrides.restore || restoreNative)(bundle);
        else {
            if (stage.report.managedUpdate) (overrides.commitManaged || commitManagedNative)(stage); else (overrides.commit || commitNative)(stage);
            committed = true;
            saveJSON(paths.config, { ...next, showWindow: undefined });
        }
        committed = true;
        if (interactive) fs.rmSync(paths.cache, { force: true });
        let autoPromptError = null;
        try { if (action === 'restore') (overrides.removeEvent || removeUpdateEvent)(next); else (overrides.installEvent || installUpdateEvent)(next); }
        catch (error) { if (action === 'restore') throw error; autoPromptError = error.message; }
        if (relaunch) {
            publish({ phase: 'reopening', progress: 1 });
            fs.rmSync(paths.ready, { force: true });
            const launchedAt = Date.now();
            await (overrides.open || (app => execFileSync('/usr/bin/open', [app], { stdio: 'pipe' })))(bundle.app);
            if (overrides.confirmReady) await overrides.confirmReady(bundle, next.agentVersion);
            else {
                let ready = false;
                for (let i = 0; i < 120; i++) {
                    const value = readJSON(paths.ready);
                    if (running(bundle) && value?.app === bundle.app && value.agentVersion === next.agentVersion && value.at >= launchedAt) { ready = true; break; }
                    await delay(500);
                }
                if (!ready) throw new Error('Codex opened, but the new Rasta panel did not confirm startup. Close and reopen Codex, then try again.');
            }
        }
        if (action === 'restore') { (overrides.removeData || removeGUIData)({ jobId: job.id }); uninstalled = true; }
        publish({ phase: 'complete', progress: 1, uninstall: uninstalled, targetVersion: official?.version || bundle.version, agentVersion: next.agentVersion, restored: action === 'restore', autoPromptError, autoClose: interactive && !autoPromptError });
        return 'complete';
    } catch (error) {
        const phase = controller.signal.aborted ? 'cancelled' : 'failed';
        const message = targetId() === 't3' ? error.message.replaceAll('ChatGPT', targetName()).replaceAll('Codex', targetName()) : error.message;
        publish({ phase, error: message, installed: committed }); return phase;
    } finally {
        clearInterval(cancellation);
        const cleanup = [];
        const attempt = fn => { try { fn(); } catch (error) { cleanup.push(error.message); } };
        if (stage) attempt(() => (overrides.discard || discardNativeStage)(stage));
        // A complete/prior bundle stays in the separate verified backup.
        for (const name of ['chatgpt.zip', 'agent.zip', 'official', 'agent', 'install-request.json']) attempt(() => fs.rmSync(path.join(job.folder, name), { recursive: true, force: true }));
        attempt(() => fs.rmSync(paths.cancel, { force: true }));
        if (!job.handoffParentPid && !uninstalled) attempt(() => releaseGUIJob(job.id));
        if (uninstalled && !cleanup.length) {
            try {
                await (overrides.finishUninstall || finishGUIUninstall)(job, { waitForWindow: !config.silentRestore && !overrides.noUI });
                if (config.flow === 'download-launch') {
                    await (overrides.open || (app => execFileSync('/usr/bin/open', [app], { stdio: 'pipe' })))(config.app);
                    if (overrides.confirmRestoredOpen) await overrides.confirmRestoredOpen(config.app);
                    else {
                        const deadline = Date.now() + 15000;
                        const restoredBundle = resolveGUIApp(config.app);
                        while (!(overrides.running || isCodexRunning)(restoredBundle)) {
                            if (Date.now() >= deadline) throw new Error('Rasta was removed, but Codex did not reopen. Open Codex manually.');
                            await delay(250);
                        }
                    }
                }
            }
            catch (error) { releaseGUIJob(job.id); publish({ phase: 'failed', error: error.message, installed: false }); return 'failed'; }
        }
        if (cleanup.length && uninstalled) {
            releaseGUIJob(job.id);
            publish({ phase: 'failed', error: 'Rasta was removed, but cleanup failed: ' + cleanup.join('\n'), installed: false });
            return 'failed';
        }
        if (cleanup.length) attempt(() => saveJSON(paths.status, { ...readJSON(paths.status), cleanupWarning: cleanup.join('\n') }));
    }
}
