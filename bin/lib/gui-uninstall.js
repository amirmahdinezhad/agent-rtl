import fs from 'node:fs';
import { targetId } from './app-target.js';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { guiPaths, readJSON } from './gui-runtime.js';

function removeRegistrations(home, support, jobId, run) {
    const domain = `gui/${process.getuid()}`;
    const owned = label => /^dev\.agentrtl\.(?:update\.[a-f0-9]{12}|ui\.[a-f0-9-]{36}|codex)$/.test(label);
    const labels = run('/bin/launchctl', ['list'], {encoding:'utf8',stdio:['pipe','pipe','pipe']}).split('\n').map(line=>line.trim().split(/\s+/).at(-1)).filter(owned);
    for (const label of labels) {
        if (label === `dev.agentrtl.ui.${jobId}`) continue;
        let state;
        try { state = run('/bin/launchctl',['print',`${domain}/${label}`],{encoding:'utf8',stdio:['pipe','pipe','pipe']}); } catch { continue; }
        const program = state.match(/\n\s*program = ([^\n]+)/)?.[1];
        // Isolated tests may only remove jobs from their own state home.
        if (process.env.ARTL_CODEX_STATE_HOME && !program?.startsWith(support + path.sep)) continue;
        // Preserve concurrently running isolated tests and other unrelated homes.
        if (!program || (!program.startsWith(support + path.sep) && fs.existsSync(program))) continue;
        if (targetId() === 't3' && !program.startsWith(support + path.sep)) continue;
        if (targetId() === 'codex' && program.includes('/Agent RTL T3/')) continue;
        run('/bin/launchctl',['bootout',`${domain}/${label}`],{stdio:['pipe','pipe','pipe']});
        let present = true;
        try { run('/bin/launchctl',['print',`${domain}/${label}`],{stdio:['pipe','pipe','pipe']}); } catch { present = false; }
        if (present) throw new Error('An Rasta background registration could not be removed.');
    }
    const agents = path.join(home, 'Library/LaunchAgents');
    if (fs.existsSync(agents)) for (const name of fs.readdirSync(agents)) {
        if (name.endsWith('.plist') && owned(name.slice(0,-6))) {
            const text = fs.readFileSync(path.join(agents, name), 'utf8');
            if (targetId() === 't3' ? text.includes(support + '/') : !text.includes('/Agent RTL T3/')) fs.rmSync(path.join(agents,name));
        }
    }
}

/** Remove Rasta data after a successful restore, keeping only the active result and job until its window exits. */
export function removeGUIData({ jobId, run = execFileSync } = {}) {
    const paths = guiPaths();
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir();
    removeRegistrations(home, paths.support, jobId, run);
    const retained = new Set(['gui-status.json', 'ui-jobs', 'ui-job.lock', 'gui-cancel']);
    for (const name of fs.readdirSync(paths.support)) {
        if (!retained.has(name)) fs.rmSync(path.join(paths.support, name), { recursive: true, force: true });
    }
    const setupId = targetId() === 't3' ? 'dev.agentrtl.t3.setup' : 'dev.agentrtl.setup';
    for (const relative of ['Library/Preferences/dev.agentrtl.setup.plist', 'Library/Caches/dev.agentrtl.setup', 'Library/Saved Application State/dev.agentrtl.setup.savedState']) fs.rmSync(path.join(home, relative.replaceAll('dev.agentrtl.setup', setupId)), {recursive:true,force:true});
    const launcher = path.join(home, 'Applications/Codex RTL.app');
    const marker = path.join(launcher, '.agent-rtl-launcher');
    if (targetId() === 'codex' && fs.existsSync(marker) && fs.readFileSync(marker,'utf8') === 'dev.agentrtl.codex') fs.rmSync(launcher,{recursive:true,force:true});
}

/** Keep completion readable until the native removal window acknowledges it, then remove the final job and result so that window can exit. */
export async function finishGUIUninstall(job, { waitForWindow = true } = {}) {
    const paths = guiPaths();
    if (waitForWindow) {
        const deadline = Date.now() + 15000;
        while (readJSON(paths.status + '.ack')?.id !== job.id) {
            if (Date.now() >= deadline) throw new Error('RTL was removed, but the removal window did not close.');
            await delay(100);
        }
    }
    fs.rmSync(paths.support, { recursive: true, force: true });
}
