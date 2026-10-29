// Migration cleanup only. This module cannot install a service or launcher.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restoreCodex } from './codex.js';

export const SERVICE_LABEL = 'dev.rasta.codex';
const OWNER_MARKER = '.rasta-launcher';
const backgroundHome = () => process.env.ARTL_CODEX_STATE_HOME || os.homedir();

export function backgroundPaths(home = backgroundHome()) {
    const support = path.join(home, 'Library/Application Support/Rasta');
    return {
        support, runtime: path.join(support, 'runtime'), config: path.join(support, 'codex.json'),
        log: path.join(support, 'codex.log'),
        agent: path.join(home, `Library/LaunchAgents/${SERVICE_LABEL}.plist`),
        launcher: path.join(home, 'Applications/Codex RTL.app'),
    };
}

export function readBackgroundConfig(home = backgroundHome()) {
    try {
        const config = JSON.parse(fs.readFileSync(backgroundPaths(home).config, 'utf8'));
        if (config.label !== SERVICE_LABEL || config.version !== 1) throw new Error('Invalid Codex Rasta service configuration.');
        return config;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

const domain = () => `gui/${process.getuid()}`;
const serviceTarget = () => `${domain()}/${SERVICE_LABEL}`;
const command = (file, args, options = {}) => execFileSync(file, args, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
});

function bootout() {
    try { command('/bin/launchctl', ['print', serviceTarget()]); }
    catch { return; }
    command('/bin/launchctl', ['bootout', serviceTarget()]);
}

export function writePlist(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    command('/usr/bin/plutil', ['-convert', 'xml1', '-o', file, '--', '-'], { input: JSON.stringify(value) });
}

function extract(file, key, format = 'raw') {
    try { return command('/usr/bin/plutil', ['-extract', key, format, '-o', '-', file]).trim(); }
    catch { return null; }
}

function dockTiles(file) {
    const tiles = [];
    for (let index = 0; index < 200; index++) {
        if (extract(file, `persistent-apps.${index}`, 'xml1') === null) break;
        const url = extract(file, `persistent-apps.${index}.tile-data.file-data._CFURLString`);
        let app;
        try { app = url?.startsWith('file:') ? fileURLToPath(url) : url; } catch { app = null; }
        tiles.push({ index, app: app && path.resolve(app), guid: extract(file, `persistent-apps.${index}.GUID`) });
    }
    return tiles;
}

export function restoreDockFile(file, launcher, snapshots) {
    const matches = dockTiles(file).filter(tile => tile.app === path.resolve(launcher)).reverse();
    for (const tile of matches) {
        const snapshot = snapshots.find(item => item.guid === tile.guid) || snapshots[0];
        if (snapshot) command('/usr/bin/plutil', ['-replace', `persistent-apps.${tile.index}`, '-xml', snapshot.xml, file]);
        else command('/usr/bin/plutil', ['-remove', `persistent-apps.${tile.index}`, file]);
    }
}

function updateDock(edit) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-dock-'));
    try {
        const file = path.join(dir, 'dock.plist');
        fs.writeFileSync(file, command('/usr/bin/defaults', ['export', 'com.apple.dock', '-']));
        const original = fs.readFileSync(file);
        const result = edit(file);
        if (fs.readFileSync(file).equals(original)) return result;
        command('/usr/bin/defaults', ['import', 'com.apple.dock', file]);
        try { command('/usr/bin/killall', ['Dock']); } catch { /* Dock may not be running */ }
        return result;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function uninstallBackground({ home = backgroundHome(), activate = true, dock = true } = {}) {
    const paths = backgroundPaths(home), config = readBackgroundConfig(home);
    if (!config) return false;
    if (activate) bootout();
    await restoreCodex(config.port);
    if (dock) updateDock(file => restoreDockFile(file, paths.launcher, config.dockSnapshots || []));
    if (fs.existsSync(path.join(paths.launcher, OWNER_MARKER)) && fs.readFileSync(path.join(paths.launcher, OWNER_MARKER), 'utf8') === SERVICE_LABEL) {
        fs.rmSync(paths.launcher, { recursive: true, force: true });
    }
    fs.rmSync(paths.agent, { force: true });
    fs.rmSync(paths.runtime, { recursive: true, force: true });
    fs.rmSync(paths.config, { force: true });
    fs.rmSync(paths.log, { force: true });
    if (!fs.readdirSync(paths.support).length) fs.rmdirSync(paths.support);
    return true;
}

