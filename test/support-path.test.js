import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixture } from './helpers/native-fixture.js';
import { it } from 'node:test';
import * as asar from '@electron/asar';

for (const target of ['codex', 't3']) it(`keeps ${target} handoff jobs, backups and settings in their existing support directory`, async () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-support-')));
    try {
        const support = path.join(home, 'Library/Application Support', target === 't3' ? 'Previous T3' : 'Previous Codex');
        const runtime = path.join(support, 'ui-runtimes', '1.0.5-fixture');
        fs.mkdirSync(runtime, { recursive: true });
        fs.cpSync(new URL('../bin', import.meta.url), path.join(runtime, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
        fs.symlinkSync(path.resolve('node_modules'), path.join(runtime, 'node_modules'));
        const configFile = path.join(runtime, 'bin/release-config.json');
        const config = JSON.parse(fs.readFileSync(configFile)); config.target = target;
        fs.writeFileSync(configFile, JSON.stringify(config));
        const env = { ...process.env, ARTL_CODEX_STATE_HOME: home, ARTL_TARGET: target };
        const job = path.join(support, 'ui-jobs', 'fixture', 'job.json');
        fs.mkdirSync(path.dirname(job), { recursive: true });
        // An invalid action stops before any installation, after the real worker path check.
        fs.writeFileSync(job, JSON.stringify({ schema: 1, id: 'fixture', folder: path.dirname(job), action: 'invalid', config: {} }));
        const result = spawnSync(process.execPath, [path.join(runtime, 'bin/gui-service.js'), '--worker', job], { env, encoding: 'utf8' });
        assert.equal(JSON.parse(result.stdout).error, 'Invalid update job.');
        const probe = `import {supportPath} from ${JSON.stringify(path.join(runtime, 'bin/lib/app-target.js'))}; console.log(supportPath());`;
        assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { env, encoding: 'utf8' }).trim(), support);
        const other = path.join(home, 'Library/Application Support', target === 't3' ? 'Previous Codex' : 'Previous T3', 'ui-jobs/fixture/job.json');
        const rejected = spawnSync(process.execPath, [path.join(runtime, 'bin/gui-service.js'), '--worker', other], { env, encoding: 'utf8' });
        assert.equal(JSON.parse(rejected.stdout).error, 'Invalid UI job path.');

        const source = path.join(home, 'archive-source'); fs.mkdirSync(path.join(source, 'earlier-host'), { recursive: true });
        const app = path.join(home, 'Fixture.app'), archive = path.join(app, 'Contents/Resources/app.asar');
        fs.mkdirSync(path.dirname(archive), { recursive: true });
        fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: target === 't3' ? 't3code' : 'openai-codex-electron', main: 'earlier-host/main.cjs' }));
        fs.writeFileSync(path.join(source, 'earlier-host/host.json'), JSON.stringify({ app, runtime, target }));
        await asar.createPackage(source, archive);
        const standalone = `import {installedSupportPath} from ${JSON.stringify(path.resolve('bin/lib/app-target.js'))}; console.log(installedSupportPath(${JSON.stringify({home, app, target})}));`;
        assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', standalone], { env, encoding: 'utf8' }).trim(), support);

        const fixture = await nativeFixture(path.join(home, 'fixture'), config.supportedAppVersions[0], false, target);
        const before = fs.readFileSync(fixture.archive);
        const backup = path.join(support, 'codex-original-fixture'); fs.mkdirSync(backup);
        fs.writeFileSync(path.join(backup, 'original'), 'preserve backup');
        const service = path.join(runtime, 'bin/gui-service.js');
        const worker = fs.readFileSync(service, 'utf8');
        fs.writeFileSync(service, worker.replace('await runGUIJob(readJSON(file));', "await runGUIJob(readJSON(file), {noUI:true,check:async()=>({available:false,supported:true}),stage:()=>({report:{}}),discard:()=>{}});"));
        fs.writeFileSync(job, JSON.stringify({ schema: 1, id: 'fixture', folder: path.dirname(job), action: 'repair', handoffParentPid: process.pid,
            config: { app: fixture.app, runtime, agentVersion: '1.0.4', flow: 'download-install', verifiedReleaseVersion: '1.0.4', showWindow: false } }));
        const child = spawn(process.execPath, [service, '--worker', job], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        const completion = new Promise(resolve => child.once('exit', resolve));
        try {
            const status = path.join(support, 'gui-status.json');
            let value;
            for (let i = 0; i < 100; i++) {
                if (fs.existsSync(status)) value = JSON.parse(fs.readFileSync(status));
                if (value?.phase === 'ready-to-install' || value?.phase === 'failed') break;
                await delay(50);
            }
            assert.equal(value?.phase, 'ready-to-install', JSON.stringify(value));
            assert.equal(fs.existsSync(path.join(home, 'Library/Application Support', target === 't3' ? 'Rasta T3' : 'Rasta')), false, 'no support migration before explicit Launch');
            assert.deepEqual(fs.readFileSync(fixture.archive), before, 'preparation never modifies the installed app');
            fs.writeFileSync(path.join(support, 'gui-cancel'), 'cancel');
            assert.equal(await Promise.race([completion, delay(5000).then(() => 'timeout')]), 0);
            assert.equal(JSON.parse(fs.readFileSync(status)).phase, 'cancelled');
            assert.equal(fs.readFileSync(path.join(backup, 'original'), 'utf8'), 'preserve backup');
            assert.deepEqual(fs.readFileSync(fixture.archive), before);
        } finally { if (child.exitCode === null) child.kill('SIGTERM'); }

    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
