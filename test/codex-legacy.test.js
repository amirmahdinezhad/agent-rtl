import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { backgroundPaths, writePlist, restoreDockFile, uninstallBackground, SERVICE_LABEL } from '../bin/lib/codex-legacy.js';

const plutil = args => execFileSync('/usr/bin/plutil', args, { encoding: 'utf8' }).trim();
const xml = (file, key) => plutil(['-extract', key, 'xml1', '-o', '-', file]);
const tile = (app, guid) => ({ GUID: guid, 'tile-type': 'file-tile', 'tile-data': {
    'file-data': { _CFURLString: `${pathToFileURL(app).href}/`, _CFURLStringType: 15 }, 'file-label': path.basename(app),
} });

describe('legacy Codex service migration', () => {
    it('restores only the legacy Dock tile and preserves unrelated opaque bookmark data', { skip: os.platform() !== 'darwin' }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-legacy-dock-'));
        try {
            const file = path.join(dir, 'dock.plist'), helper = path.join(dir, 'Codex RTL.app');
            writePlist(file, { 'persistent-apps': [tile('/Applications/Other.app', 1), tile('/Applications/ChatGPT.app', 2)], 'unrelated-setting': 'keep' });
            plutil(['-insert', 'persistent-apps.0.tile-data.book', '-xml', '<data>cHJlc2VydmU=</data>', file]);
            const other = xml(file, 'persistent-apps.0'), original = xml(file, 'persistent-apps.1');
            plutil(['-replace', 'persistent-apps.1.tile-data.file-data._CFURLString', '-string', `${pathToFileURL(helper).href}/`, file]);
            restoreDockFile(file, helper, [{ guid: '2', xml: original }]);
            assert.equal(xml(file, 'persistent-apps.0'), other);
            assert.equal(xml(file, 'persistent-apps.1'), original);
            assert.equal(plutil(['-extract', 'unrelated-setting', 'raw', '-o', '-', file]), 'keep');
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('removes only owned launcher/service files and leaves no copied runtime behind', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-legacy-cleanup-'));
        try {
            const paths = backgroundPaths(home);
            fs.mkdirSync(paths.runtime, { recursive: true });
            fs.mkdirSync(paths.launcher, { recursive: true });
            fs.mkdirSync(path.dirname(paths.agent), { recursive: true });
            fs.writeFileSync(path.join(paths.launcher, '.agent-rtl-launcher'), SERVICE_LABEL);
            fs.writeFileSync(paths.agent, 'legacy agent');
            fs.writeFileSync(paths.log, 'legacy log');
            fs.writeFileSync(paths.config, JSON.stringify({ label: SERVICE_LABEL, version: 1, port: 0 }));
            assert.equal(await uninstallBackground({ home, activate: false, dock: false }), true);
            for (const name of ['runtime', 'launcher', 'config', 'agent', 'log', 'support']) assert.equal(fs.existsSync(paths[name]), false, name);
            assert.equal(await uninstallBackground({ home, activate: false, dock: false }), false);
            fs.mkdirSync(paths.runtime, { recursive: true });
            fs.mkdirSync(paths.launcher, { recursive: true });
            fs.writeFileSync(path.join(paths.launcher, 'unrelated'), 'preserve');
            fs.writeFileSync(paths.config, JSON.stringify({ label: SERVICE_LABEL, version: 1, port: 0 }));
            await uninstallBackground({ home, activate: false, dock: false });
            assert.equal(fs.readFileSync(path.join(paths.launcher, 'unrelated'), 'utf8'), 'preserve');
        } finally { fs.rmSync(home, { recursive: true, force: true }); }
    });
});
