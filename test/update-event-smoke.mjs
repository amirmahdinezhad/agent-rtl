// Real launchd file event, using only our fixture app and a temporary UI stub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeFixture } from './helpers/native-fixture.js';
import { guiPaths, saveJSON, readJSON } from '../bin/lib/gui-runtime.js';
import { updateEventPaths, installUpdateEvent, removeUpdateEvent } from '../bin/lib/update-events.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-event-smoke-'));
process.env.ARTL_CODEX_STATE_HOME = dir;
const setup = path.resolve(process.env.ARTL_GUI_OUTPUT || 'dist/Agent RTL Setup.app');
const source = path.join(setup, 'Contents/Resources/runtime');
let config;
try {
    const catalog = JSON.parse(fs.readFileSync(path.join(source, 'bin/release-config.json')));
    const app = await nativeFixture(path.join(dir, 'fixture'), catalog.supportedAppVersions[0], true, catalog.target || 'codex');
    const runtime = path.join(dir, 'runtime'); fs.mkdirSync(runtime);
    for (const name of ['bin', 'node_modules', 'node', 'package.json']) fs.symlinkSync(path.join(source, name), path.join(runtime, name));
    // This is an owned stub, not a replacement for the installed Codex UI.
    const marker = path.join(dir, 'wizard.json');
    fs.writeFileSync(path.join(runtime, 'agent-rtl-ui'), '#!/bin/sh\nexec "' + path.join(source, 'node') + '" "' + path.join(dir, 'ui-stub.mjs') + '" "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'ui-stub.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));setTimeout(()=>{},1000);`);
    config = { app: app.app, runtime }; saveJSON(guiPaths().config, config);
    const paths = installUpdateEvent(config);
    const job = () => execFileSync('/bin/launchctl', ['print', `${paths.domain}/${paths.label}`], { encoding: 'utf8' });
    for(let i=0;i<50 && /\n\s*pid = \d+/.test(job());i++)await delay(100);
    assert.ok(!/\n\s*pid = \d+/.test(job()), 'login/bootstrap check exits; no idle checker process');
    fs.appendFileSync(path.join(app.app, 'Contents/Info.plist'), '\n');
    for (let i=0;i<160 && !fs.existsSync(marker);i++) await delay(200);
    assert.ok(fs.existsSync(marker), 'app file change opens quick wizard');
    const ui = readJSON(marker); assert.deepEqual(ui.args, ['--wizard', runtime, app.app]);
    for (let i=0;i<40 && /\n\s*pid = \d+/.test(job());i++) await delay(200);
    assert.ok(!/\n\s*pid = \d+/.test(job()), 'checker exits after event');
    assert.equal(readJSON(paths.state).promptPid, ui.pid);
    await delay(1500);
    assert.throws(()=>process.kill(ui.pid, 0), 'temporary wizard stub exits');
    fs.utimesSync(path.dirname(app.app), new Date(), new Date()); await delay(17000);
    assert.equal(readJSON(marker).pid, ui.pid, 'same app version does not reopen wizard');
    saveJSON(paths.state, { ...readJSON(paths.state), promptedAt: new Date(Date.now() - 600000).toISOString() });
    fs.utimesSync(path.dirname(app.app), new Date(), new Date());
    for (let i=0;i<160 && readJSON(marker).pid === ui.pid;i++) await delay(200);
    assert.notEqual(readJSON(marker).pid, ui.pid, 'next event retries the same unpatched bundle after the old wizard exits');
    for (let i=0;i<40 && /\n\s*pid = \d+/.test(job());i++) await delay(200);
    assert.ok(!/\n\s*pid = \d+/.test(job()), 'retry checker also exits');
    console.log('PASS: real file event opens wizard, duplicate events debounce, expired prompt retries the same unpatched app, no idle process.');
} finally {
    if (config) removeUpdateEvent(config);
    fs.rmSync(dir, { recursive: true, force: true });
}
