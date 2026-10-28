import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { guiPaths, saveJSON } from '../bin/lib/gui-runtime.js';
import { removeGUIData, finishGUIUninstall } from '../bin/lib/gui-uninstall.js';

test('uninstall deletes only Rasta data, keeping its result until the window closes', async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artl-uninstall-')));
    const previous = process.env.ARTL_CODEX_STATE_HOME;
    process.env.ARTL_CODEX_STATE_HOME = home;
    try {
        const paths = guiPaths();
        for (const name of ['custom-fonts/font.ttf', 'ui-runtimes/runtime/node', 'ui-fonts/font.ttf', 'appearance.json', 'font-preferences.json', 'gui-config.json', 'gui-status.json', 'ui-jobs/current/log']) {
            const file = path.join(paths.support, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, 'fixture');
        }
        const codex = path.join(home, 'Library/Application Support/Codex/settings.json');
        const key = path.join(home, '.config/agent-rtl/release-private.pem');
        for (const file of [codex, key]) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, 'keep'); }
        const setup = path.join(home, 'Downloads/Rasta-2.4.6.fixture/Rasta Setup.app');
        const runtime = path.join(setup, 'Contents/Resources/runtime'); fs.mkdirSync(runtime,{recursive:true});
        fs.writeFileSync(path.join(setup,'Contents/Info.plist'),JSON.stringify({CFBundleIdentifier:'dev.agentrtl.setup'}));
        const sibling = path.join(path.dirname(setup),'personal-note.txt'); fs.writeFileSync(sibling,'keep');
        saveJSON(path.join(paths.support, 'setup-sources.json'), [setup]);
        const legacySetup = path.join(home, 'Downloads/Rasta-2.4.5.old/Rasta Setup.app');
        fs.mkdirSync(path.join(legacySetup,'Contents'),{recursive:true});
        fs.copyFileSync(path.join(setup,'Contents/Info.plist'),path.join(legacySetup,'Contents/Info.plist'));
        const archive = path.join(home,'Downloads/Rasta-2.4.5-darwin-arm64.zip');
        execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',legacySetup,archive]);
        const cache = path.join(home,'Library/Caches/dev.agentrtl.setup/data');fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,'remove');
        const agents=path.join(home,'Library/LaunchAgents');fs.mkdirSync(agents,{recursive:true});
        fs.writeFileSync(path.join(agents,'dev.agentrtl.update.aaaaaaaaaaaa.plist'),'fixture');
        fs.writeFileSync(path.join(agents,'other.plist'),'keep');
        const own='dev.agentrtl.update.aaaaaaaaaaaa',stale='dev.agentrtl.update.bbbbbbbbbbbb',concurrent='dev.agentrtl.update.cccccccccccc';
        const current='dev.agentrtl.ui.00000000-0000-0000-0000-000000000000';
        const live=path.join(home,'other-test/node');fs.mkdirSync(path.dirname(live),{recursive:true});fs.writeFileSync(live,'keep');
        const jobs=new Map([[own,path.join(paths.support,'ui-runtimes/runtime/node')],[stale,path.join(paths.support,'missing/node')],[concurrent,live],[current,path.join(paths.support,'ui-runtimes/runtime/node')]]);
        const removed=[];
        const run=(file,args,options)=>{
            if(file !== '/bin/launchctl') return execFileSync(file,args,options);
            if(args[0]==='list')return [...jobs.keys()].map(label=>' - 0 '+label).join('\n');
            const label=args[1].split('/').at(-1);
            if(args[0]==='bootout'){removed.push(label);jobs.delete(label);return '';}
            if(!jobs.has(label))throw new Error('not loaded');
            return '\n program = '+jobs.get(label)+'\n';
        };
        const guards = ['existsSync', 'readdirSync', 'readFileSync', 'realpathSync', 'rmSync'].map(name => {
            const original = fs[name];
            return mock.method(fs, name, (file, ...args) => {
                assert.ok(!String(file).startsWith(path.join(home, 'Downloads')), 'uninstall must never access Downloads, even when access is denied');
                return original(file, ...args);
            });
        });
        try { removeGUIData({jobId:'00000000-0000-0000-0000-000000000000',run}); } finally { guards.forEach(guard => guard.mock.restore()); }
        assert.deepEqual(removed,[own,stale],'unloads own and stale jobs but preserves the current worker and concurrent fixture');
        assert.equal(fs.existsSync(legacySetup),true,'preserves old downloaded installers');
        assert.equal(fs.existsSync(archive),true,'preserves downloaded ZIPs');
        assert.equal(fs.existsSync(cache),false);
        assert.deepEqual(fs.readdirSync(agents),['other.plist']);
        assert.equal(fs.existsSync(setup),true,'preserves tracked Setup downloads');
        assert.equal(fs.readFileSync(sibling,'utf8'),'keep','does not remove other downloaded files');
        assert.deepEqual(fs.readdirSync(paths.support).sort(), ['gui-status.json', 'ui-jobs']);
        saveJSON(paths.status + '.ack', {id:'current',pid:2147483647});
        await finishGUIUninstall({id:'current'});
        assert.equal(fs.existsSync(paths.support), false);
        assert.equal(fs.readFileSync(codex, 'utf8'), 'keep');
        assert.equal(fs.readFileSync(key, 'utf8'), 'keep');
    } finally {
        if (previous === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previous;
        fs.rmSync(home, {recursive:true,force:true});
    }
});

test('a background job that cannot be unloaded prevents reporting a clean uninstall', () => {
    const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'artl-uninstall-denied-')));
    const previous=process.env.ARTL_CODEX_STATE_HOME;process.env.ARTL_CODEX_STATE_HOME=home;
    try {
        const paths=guiPaths();fs.mkdirSync(paths.support,{recursive:true});
        const settings=path.join(paths.support,'appearance.json');fs.writeFileSync(settings,'keep');
        const label='dev.agentrtl.update.aaaaaaaaaaaa';
        const run=(_file,args)=>args[0]==='list' ? '- 0 '+label : '\n program = '+path.join(paths.support,'node')+'\n';
        assert.throws(()=>removeGUIData({run}),/background registration could not be removed/);
        assert.equal(fs.readFileSync(settings,'utf8'),'keep');
    } finally {
        if(previous===undefined)delete process.env.ARTL_CODEX_STATE_HOME;else process.env.ARTL_CODEX_STATE_HOME=previous;
        fs.rmSync(home,{recursive:true,force:true});
    }
});
