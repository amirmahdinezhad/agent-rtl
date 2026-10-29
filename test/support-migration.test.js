import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { nativeFixture } from './helpers/native-fixture.js';
import { planSupportMigration, beginSupportMigration, rollbackSupportMigration } from '../bin/lib/support-migration.js';

for (const target of ['codex', 't3']) test(`${target} migration preserves signed rollback and removes the old path after takeover`, async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-migration-')));
    try {
        const from = path.join(home, 'Library/Application Support', target === 't3' ? 'Previous T3' : 'Previous Codex');
        const runtime = path.join(from, 'ui-runtimes', 'candidate'); fs.mkdirSync(runtime, { recursive: true });
        fs.cpSync(new URL('../bin', import.meta.url), path.join(runtime, 'bin'), { recursive: true });
        fs.symlinkSync(path.resolve('node_modules'), path.join(runtime, 'node_modules'));
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module', version: '2.0.0' }));
        const fixture = await nativeFixture(path.join(home, 'app'), target === 't3' ? '0.1.4' : '26.1023.51421', true, target);
        const script = path.join(runtime, 'check.mjs');
        fs.writeFileSync(script, `import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import * as asar from '@electron/asar';
import {stageNative,commitNative,discardNativeStage,nativePaths,restoreNative} from './bin/lib/codex-native.js';
import {guiPaths,saveJSON} from './bin/lib/gui-runtime.js';
import {planSupportMigration,beginSupportMigration,rollbackSupportMigration} from './bin/lib/support-migration.js';
import {finishSupportCleanup} from './bin/support-cleanup.js';
const bundle=${JSON.stringify(fixture)}; bundle.target=${JSON.stringify(target)};${target === 't3' ? "bundle.htmlPaths=['apps/server/dist/client/index.html'];bundle.scriptSrc='/rasta-payload.js';bundle.allowDisabledIntegrity=true;" : ''}
const old=${JSON.stringify(from)},runtime=${JSON.stringify(runtime)};
const original=fs.readFileSync(bundle.archive);
let first=stageNative(bundle,{allowLocalSigning:true,payload:'// prior',host:{app:bundle.app,runtime,agentVersion:'1.0.0',target:${JSON.stringify(target)}}});
commitNative(first);discardNativeStage(first);
const priorState=JSON.parse(fs.readFileSync(nativePaths().state));
saveJSON(guiPaths().config,{app:bundle.app,runtime,agentVersion:'1.0.0'});
saveJSON(path.join(old,'ui-fonts/catalog.json'),{file:path.join(old,'ui-fonts/custom.ttf')});
const plan=planSupportMigration({app:bundle.app,runtime},old);
assert.ok(plan);assert.equal(fs.existsSync(plan.to),false,'planning does not migrate before Launch');
let staged=stageNative(bundle,{allowLocalSigning:true,payload:'// upgraded',host:{app:bundle.app,runtime:plan.runtime,agentVersion:'2.0.0',target:${JSON.stringify(target)}}});
assert.equal(staged.report.refreshing,true);
assert.equal(fs.existsSync(plan.to),false,'preparation leaves the existing support directory in place');
beginSupportMigration(plan);
assert.equal(nativePaths().support,plan.to);assert.equal(fs.realpathSync(old),plan.to);
assert.equal(JSON.parse(fs.readFileSync(nativePaths().state)).backup,path.join(plan.to,path.basename(priorState.backup)));
assert.deepEqual(fs.readFileSync(path.join(plan.to,path.basename(priorState.backup),'Contents/Resources/app.asar')),original);
commitNative(staged);discardNativeStage(staged);
const current=JSON.parse(asar.extractFile(bundle.archive,'rasta/host.json'));assert.equal(current.runtime,plan.runtime);
saveJSON(path.join(plan.to,'gui-config.json'),{app:bundle.app,runtime:plan.runtime,agentVersion:'2.0.0'});
saveJSON(path.join(plan.to,'renderer-ready.json'),{app:bundle.app,agentVersion:'2.0.0'});
const receipt={from:old,to:plan.to,runtime:plan.runtime,app:bundle.app,version:'2.0.0',complete:true};
assert.equal(await finishSupportCleanup(receipt,{busy:()=>true,pause:async()=>{},attempts:1}),false,'keep bridge while an old worker or window is alive');
assert.equal(await finishSupportCleanup(receipt,{busy:()=>false}),true);
assert.equal(fs.existsSync(old),false);
assert.equal(JSON.parse(fs.readFileSync(path.join(plan.to,'ui-fonts/catalog.json'))).file,path.join(plan.to,'ui-fonts/custom.ttf'));
const restoreCode='import {restoreNative} from '+JSON.stringify(pathToFileURL(path.join(plan.runtime,'bin/lib/codex-native.js')).href)+'; if(!restoreNative('+JSON.stringify(bundle)+'))throw Error(\"Restore failed\");';
execFileSync(process.execPath,['--input-type=module','-e',restoreCode]);assert.deepEqual(fs.readFileSync(bundle.archive),original,'original signed app remains restorable from the canonical runtime');
console.log('PASS: preparation, canonical commit, bounded bridge cleanup and signed rollback.');`);
        const env = { ...process.env, ARTL_CODEX_STATE_HOME: home, ARTL_TARGET: target };
        const result = execFileSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 30000 });
        assert.match(result, /PASS:/);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('migration refuses conflicts and restores paths and metadata when the commit fails', () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-migration-fault-'))), previous = process.env.ARTL_TARGET;
    process.env.ARTL_TARGET = 'codex';
    try {
        const from = path.join(home, 'Library/Application Support/Previous'), runtime = path.join(from, 'ui-runtimes/candidate');fs.mkdirSync(runtime,{recursive:true});
        const file = path.join(from,'codex-native.json'), bytes=JSON.stringify({backup:path.join(from,'codex-original-fixture')});fs.writeFileSync(file,bytes);
        const plan=planSupportMigration({runtime,app:'/fixture.app'},from,{home});beginSupportMigration(plan);
        rollbackSupportMigration(plan);assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.existsSync(plan.to),false);assert.equal(fs.lstatSync(from).isSymbolicLink(),false);
        fs.mkdirSync(plan.to);fs.writeFileSync(path.join(plan.to,'unrelated'),'preserve');
        assert.throws(()=>planSupportMigration({runtime,app:'/fixture.app'},from,{home}),/already exists/);assert.equal(fs.readFileSync(path.join(plan.to,'unrelated'),'utf8'),'preserve');
    } finally { if(previous===undefined)delete process.env.ARTL_TARGET;else process.env.ARTL_TARGET=previous;fs.rmSync(home,{recursive:true,force:true}); }
});

test('canonical cleanup entry point runs correctly with spaces in the support path', async () => {
    const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'rasta-cleanup-entry-')));
    try {
        const support=path.join(home,'Library/Application Support/Rasta'),runtime=path.join(support,'ui-runtimes/current'),from=path.join(home,'Library/Application Support/Previous');
        fs.mkdirSync(runtime,{recursive:true});fs.cpSync(new URL('../bin',import.meta.url),path.join(runtime,'bin'),{recursive:true});
        fs.symlinkSync(path.resolve('node_modules'),path.join(runtime,'node_modules'));fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify({type:'module'}));
        const source=path.join(home,'archive');fs.mkdirSync(path.join(source,'rasta'),{recursive:true});
        const app=path.join(home,'Fixture.app');fs.mkdirSync(path.join(app,'Contents/Resources'),{recursive:true});
        fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({main:'rasta/main.cjs'}));
        fs.writeFileSync(path.join(source,'rasta/host.json'),JSON.stringify({app,runtime,agentVersion:'2.0.0'}));
        const asar=await import('@electron/asar');await asar.createPackage(source,path.join(app,'Contents/Resources/app.asar'));
        fs.writeFileSync(path.join(support,'renderer-ready.json'),JSON.stringify({app,agentVersion:'2.0.0'}));
        fs.mkdirSync(path.join(support,'ui-runtimes/obsolete'));fs.symlinkSync(support,from,'dir');
        const receipt=path.join(support,'support-migration.json');fs.writeFileSync(receipt,JSON.stringify({from,to:support,runtime,app,version:'2.0.0',complete:true}));
        execFileSync(process.execPath,[path.join(runtime,'bin/support-cleanup.js'),receipt],{env:{...process.env,ARTL_CODEX_STATE_HOME:home,ARTL_TARGET:'codex'},timeout:5000});
        assert.equal(fs.existsSync(from),false);assert.equal(fs.existsSync(path.join(support,'ui-runtimes/obsolete')),false);assert.equal(JSON.parse(fs.readFileSync(receipt)).bridgeRemoved,true);
    } finally {fs.rmSync(home,{recursive:true,force:true});}
});
