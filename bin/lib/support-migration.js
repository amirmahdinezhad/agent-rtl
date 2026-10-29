import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { canonicalSupportPath, runtimeSupportPath } from './app-target.js';

export const rebaseSupportPath = (value, from, to) => typeof value === 'string' && (value === from || value.startsWith(from + path.sep)) ? to + value.slice(from.length) : value;
function rebase(value, from, to) {
    if (Array.isArray(value)) return value.map(item => rebase(item, from, to));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, from, to)]));
    return rebaseSupportPath(value, from, to);
}
/** Plan without moving data or changing a running installation before Launch. */
export function planSupportMigration(config, support, { home = process.env.ARTL_CODEX_STATE_HOME || os.homedir() } = {}) {
    const to = canonicalSupportPath(home);
    if (support === to) return null;
    if (runtimeSupportPath(config.runtime, home) !== support || !fs.existsSync(support)) return null;
    if (fs.existsSync(to) || fs.lstatSync(path.dirname(to)).isSymbolicLink()) throw new Error('The Rasta support directory already exists. No installation data was moved.');
    return { from: support, to, runtime: rebaseSupportPath(config.runtime, support, to), app: config.app, originals: [] };
}
/** Move atomically after app exit; a temporary bridge serves the old updater until it exits. */
export function beginSupportMigration(plan) {
    if (!plan) return;
    if (fs.existsSync(plan.to)) throw new Error('The Rasta support directory changed during preparation.');
    fs.renameSync(plan.from, plan.to);
    try {
        fs.symlinkSync(plan.to, plan.from, 'dir');
        const rewrite = file => {
            const bytes = fs.readFileSync(file), data = JSON.parse(bytes), updated = rebase(data, plan.from, plan.to);
            if (JSON.stringify(data) !== JSON.stringify(updated)) {
                plan.originals.push({ file, bytes }); fs.writeFileSync(file, JSON.stringify(updated, null, 2) + '\n');
            }
        };
        for (const entry of fs.readdirSync(plan.to, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith('.json')) rewrite(path.join(plan.to, entry.name));
        }
        // Rewrite only mutable state. Vendor backups, runtime bytes and saved history remain intact.
        const visit = folder => {
            for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
                const file = path.join(folder, entry.name);
                if (entry.isDirectory()) visit(file);
                else if (entry.isFile() && entry.name.endsWith('.json')) rewrite(file);
            }
        };
        for (const name of ['ui-jobs', 'ui-fonts', 'ui-job.lock']) {
            const folder = path.join(plan.to, name); if (fs.existsSync(folder)) visit(folder);
        }
        plan.started = true;
    } catch (error) { rollbackSupportMigration(plan); throw error; }
}
/** Restore the prior paths and metadata if application commit fails. */
export function rollbackSupportMigration(plan) {
    if (!plan || !fs.existsSync(plan.to)) return;
    for (const { file, bytes } of plan.originals) fs.writeFileSync(file, bytes);
    if (fs.lstatSync(plan.from, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(plan.from);
    fs.renameSync(plan.to, plan.from); plan.started = false;
}
/** Remove only old app-owned registrations after the canonical registration is installed. */
export function retirePriorUpdateEvent(plan, previous, current) {
    if (!plan || !previous || previous.label === current?.label) return;
    try { execFileSync('/bin/launchctl', ['bootout', `${previous.domain}/${previous.label}`], { stdio: 'pipe' }); } catch {}
    fs.rmSync(previous.plist, { force: true });
}
/** A bounded canonical helper removes the bridge only after old workers and their window exit. */
export function scheduleSupportCleanup(plan, version) {
    if (!plan?.started) return;
    const receipt = path.join(plan.to, 'support-migration.json');
    fs.writeFileSync(receipt, JSON.stringify({ from: plan.from, to: plan.to, runtime: plan.runtime, app: plan.app, version, complete: true }, null, 2) + '\n');
    const child = spawn(path.join(plan.runtime, 'node'), [path.join(plan.runtime, 'bin/support-cleanup.js'), receipt], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
}
