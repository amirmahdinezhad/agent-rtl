import fs from 'node:fs';
import { targetId } from './app-target.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { nativePaths } from './codex-native.js';
import { collectFonts } from './fonts.js';

export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const agentVersion = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).version;
export function guiPaths() {
    const { support } = nativePaths();
    return { support, config: path.join(support, 'gui-config.json'), cache: path.join(support, 'gui-cache.json'),
        status: path.join(support, 'gui-status.json'), ready: path.join(support, 'renderer-ready.json'), jobs: path.join(support, 'ui-jobs'),
        runtimes: path.join(support, 'ui-runtimes'), fonts: path.join(support, 'ui-fonts'), cancel: path.join(support, 'gui-cancel'),
        lock: path.join(support, 'ui-job.lock') };
}
export function readJSON(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
export function saveJSON(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
}
export function copyPackage(destination) {
    for (const entry of ['bin', 'package.json', 'LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs', 'node-LICENSE']) {
        const source = path.join(packageRoot, entry);
        if (fs.existsSync(source)) fs.cpSync(source, path.join(destination, entry), { recursive: true, verbatimSymlinks: true });
    }
    // Development Electron is used only by the isolated integration test.
    // Never ship or snapshot its runtime as part of the installer.
    const lock = readJSON(path.join(packageRoot, 'package-lock.json'));
    const excluded = Object.entries(lock?.packages || {}).filter(([, value]) => value.dev).map(([name]) => path.join(packageRoot, name));
    fs.cpSync(path.join(packageRoot, 'node_modules'), path.join(destination, 'node_modules'), {
        recursive: true, verbatimSymlinks: true,
        filter: file => !excluded.some(dir => file === dir || file.startsWith(dir + path.sep)) && !file.startsWith(path.join(packageRoot, 'node_modules/.bin')),
    });
}
export function copyPortableNode(source, destination, license = process.env.ARTL_NODE_LICENSE) {
    const licenseFile = license || (fs.existsSync(path.join(packageRoot, 'node-LICENSE')) ? path.join(packageRoot, 'node-LICENSE')
        : path.resolve(path.dirname(source), '../LICENSE'));
    if (!fs.existsSync(licenseFile)) throw new Error('Provide ARTL_NODE_LICENSE for the standalone Node runtime license.');
    fs.copyFileSync(source, path.join(destination, 'node')); fs.chmodSync(path.join(destination, 'node'), 0o755);
    fs.copyFileSync(licenseFile, path.join(destination, 'node-LICENSE'));
}
export function snapshotRuntime(bundle, { nativeUI = path.join(packageRoot, 'bin/assets/rasta-ui') } = {}) {
    const paths = guiPaths(), runtime = path.join(paths.runtimes, `${agentVersion}-${randomUUID()}`);
    fs.mkdirSync(runtime, { recursive: true });
    try {
        copyPackage(runtime);
        if (targetId() === 't3') {
            const file = path.join(runtime, 'bin/release-config.json'), config = readJSON(file);
            saveJSON(file, { ...config, target: 't3', feedUrl: config.target === 't3' ? config.feedUrl : config.t3FeedUrl || null, supportedAppVersions: config.target === 't3' ? config.supportedAppVersions : config.supportedT3Versions || [] });
        }
        const portable = path.join(packageRoot, 'node');
        const node = fs.existsSync(portable) ? portable : path.join(bundle.app, 'Contents/Resources/cua_node/bin/node');
        if (!fs.existsSync(node)) throw new Error('This app has no portable installer runtime.');
        copyPortableNode(node, runtime);
        if (!fs.existsSync(nativeUI)) throw new Error('The native setup interface has not been built.');
        fs.copyFileSync(nativeUI, path.join(runtime, 'rasta-ui')); fs.chmodSync(path.join(runtime, 'rasta-ui'), 0o755);
        const fonts = collectFonts(); fs.mkdirSync(paths.fonts, { recursive: true });
        const catalog = fonts.all.map((font, i) => { const file = `${i}${font.ext}`; fs.copyFileSync(font.file, path.join(paths.fonts, file)); return { ...font, file, persian: fonts.fa.includes(font), english: fonts.en.includes(font) }; });
        saveJSON(path.join(paths.fonts, 'catalog.json'), catalog);
        return runtime;
    } catch (error) { fs.rmSync(runtime, { recursive: true, force: true }); throw error; }
}
export function installedFonts() {
    const paths = guiPaths(), catalog = readJSON(path.join(paths.fonts, 'catalog.json'));
    if (!catalog) return collectFonts();
    const all = catalog.map(font => ({ ...font, file: path.join(paths.fonts, path.basename(font.file)) }));
    return { all, fa: all.filter(font => font.persian), en: all.filter(font => font.english ?? !font.persian) };
}
export function activeWorker() {
    const paths = guiPaths(), status = readJSON(paths.status), owner = readJSON(path.join(paths.lock, 'owner.json'));
    const alive = pid => {
        try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes('/bin/gui-service.js --worker '); }
        catch { return false; }
    };
    if (owner?.pid && alive(owner.pid)) return true;
    // launchd may not have assigned a PID yet. Reserve the operation during
    // this short startup window so two windows cannot enqueue two installers.
    if (owner && Date.now() - owner.createdAt < 60000 && (!status?.pid || status.id !== owner.id)) return true;
    if (!owner && fs.existsSync(paths.lock) && Date.now() - fs.statSync(paths.lock).mtimeMs < 60000) return true;
    if (!status?.pid) return false;
    if (!['starting', 'checking', 'downloading-agent', 'downloading-app', 'verifying', 'preparing', 'ready-to-install', 'quitting', 'waiting-for-quit', 'installing', 'reopening'].includes(status.phase)) return false;
    return alive(status.pid);
}
export function releaseGUIJob(id) {
    const paths = guiPaths();
    if (readJSON(path.join(paths.lock, 'owner.json'))?.id === id) fs.rmSync(paths.lock, { recursive: true, force: true });
}
// The setup window approves only the exact prepared job it is displaying.
export function requestGUIInstall(id, app) {
    const paths = guiPaths(), status = readJSON(paths.status);
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || status?.id !== id || status.app !== app || status.phase !== 'ready-to-install' || !activeWorker())
        throw new Error('This installation is no longer ready. Check the installer and try again.');
    saveJSON(path.join(paths.jobs, id, 'install-request.json'), { id, approvedAt: new Date().toISOString() });
    return { id, phase: 'quitting' };
}

export async function launchGUIJob(action, config) {
    if (activeWorker()) throw new Error('An update is already running.');
    const paths = guiPaths(); fs.mkdirSync(paths.jobs, { recursive: true });
    const id = randomUUID(), folder = path.join(paths.jobs, id); fs.mkdirSync(folder);
    // mkdir is atomic across the separate RPC processes used by each window.
    if (fs.existsSync(paths.lock) && !activeWorker()) fs.rmSync(paths.lock, { recursive: true, force: true });
    try { fs.mkdirSync(paths.lock); saveJSON(path.join(paths.lock, 'owner.json'), { id, createdAt: Date.now() }); }
    catch (error) { fs.rmSync(folder, { recursive: true, force: true }); throw new Error('An update is already starting.', { cause: error }); }
    fs.rmSync(paths.cancel, { force: true });
    const job = path.join(folder, 'job.json'), plist = path.join(folder, 'once.plist'), log = path.join(folder, 'log');
    const label = `dev.rasta.ui.${id}`, domain = `gui/${process.getuid()}`;
    saveJSON(job, { schema: 1, id, action, config, folder });
    saveJSON(paths.status, { id, action, phase: 'starting', app: config.app, progress: 0 });
    saveJSON(plist, { Label: label, ProgramArguments: [path.join(config.runtime, 'node'), path.join(config.runtime, 'bin/gui-service.js'), '--worker', job],
        RunAtLoad: true, KeepAlive: false, LaunchOnlyOnce: true, StandardOutPath: log, StandardErrorPath: log,
        ...(process.env.ARTL_CODEX_STATE_HOME ? { EnvironmentVariables: { ARTL_CODEX_STATE_HOME: process.env.ARTL_CODEX_STATE_HOME } } : {}) });
    try {
        execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist], { stdio: 'pipe' });
        execFileSync('/bin/launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' });
        return { id, phase: 'starting' };
    } catch (error) { releaseGUIJob(id); fs.rmSync(folder, { recursive: true, force: true }); saveJSON(paths.status, { id, phase: 'failed', error: error.message }); throw error; }
}
