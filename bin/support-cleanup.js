import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import * as asar from '@electron/asar';
import { canonicalSupportPath } from './lib/app-target.js';

/** Remove the temporary old path only after the replacement host and updater have taken over. */
export async function finishSupportCleanup(receipt, { busy, pause = delay, attempts = 120 } = {}) {
    const home = process.env.ARTL_CODEX_STATE_HOME || os.homedir(), canonical = canonicalSupportPath(home);
    if (receipt.to !== canonical || path.dirname(receipt.from) !== path.dirname(canonical) || receipt.from === canonical
        || path.dirname(receipt.runtime) !== path.join(canonical, 'ui-runtimes') || receipt.complete !== true) throw new Error('Invalid support migration receipt.');
    const pkg = JSON.parse(asar.extractFile(path.join(receipt.app, 'Contents/Resources/app.asar'), 'package.json'));
    const host = JSON.parse(asar.extractFile(path.join(receipt.app, 'Contents/Resources/app.asar'), path.posix.join(path.posix.dirname(pkg.main), 'host.json')));
    if (host.app !== receipt.app || host.runtime !== receipt.runtime || host.agentVersion !== receipt.version) throw new Error('Replacement app has not taken over the migrated support directory.');
    const ready = JSON.parse(fs.readFileSync(path.join(canonical, 'renderer-ready.json')));
    if (ready.app !== receipt.app || ready.agentVersion !== receipt.version) throw new Error('Replacement renderer has not confirmed startup.');
    const usingBridge = busy || (() => execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
        .some(line => Number(line.trim().split(/\s+/)[0]) !== process.pid && line.includes(receipt.from + '/')));
    for (let i = 0; i < attempts; i++) {
        if (!usingBridge()) {
            const link = fs.lstatSync(receipt.from, { throwIfNoEntry: false });
            if (link && (!link.isSymbolicLink() || fs.realpathSync(receipt.from) !== canonical)) throw new Error('Migration bridge changed; cleanup refused.');
            if (link) fs.unlinkSync(receipt.from);
            const runtimes = path.join(canonical, 'ui-runtimes');
            for (const entry of fs.readdirSync(runtimes)) if (path.join(runtimes, entry) !== receipt.runtime) fs.rmSync(path.join(runtimes, entry), { recursive: true, force: true });
            fs.writeFileSync(path.join(canonical, 'support-migration.json'), JSON.stringify({ ...receipt, bridgeRemoved: true }, null, 2) + '\n');
            return true;
        }
        await pause(1000);
    }
    return false;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const file = process.argv[2];
        if (file !== path.join(canonicalSupportPath(), 'support-migration.json')) throw new Error('Invalid cleanup request.');
        await finishSupportCleanup(JSON.parse(fs.readFileSync(file)));
    } catch { /* Keep the bridge and backup if verification or process shutdown is incomplete. */ }
}
