import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const PRIVATE_REPOSITORY = 'amirmahdinezhad/rasta-beta';
export const PUBLIC_REPOSITORY = 'amirmahdinezhad/rasta';
export const targets = [
    { id: 'codex', app: 'Rasta Setup.app', prefix: 'Rasta', stableFeed: 'rasta-release.json' },
    { id: 't3', app: 'Rasta T3 Setup.app', prefix: 'Rasta-T3', stableFeed: 'rasta-t3-release.json' },
];
/** Invoke fixed tool arguments without a shell; never include credentials in arguments. */
export function run(command, args, options = {}) {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
export const gh = args => run('gh', args);
export const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
/** Acceptance must name the immutable source and bytes tested in both apps. */
export function validateAcceptance(acceptance, candidate) {
    if (acceptance?.githubPublicationAuthorized !== true || acceptance.version !== candidate.version || acceptance.sourceCommit !== candidate.sourceCommit)
        throw new Error('Explicit acceptance and GitHub authorization for this exact candidate are required.');
    for (const target of targets) {
        const observation = acceptance.targets?.[target.id], artifact = candidate.artifacts.find(item => item.target === target.id);
        if (!artifact || observation?.sha256 !== artifact.sha256 || !['closedPanelDot', 'refreshOffersVersion', 'panelUpgradeComplete', 'versionDisplayed', 'appWorking'].every(key => observation[key] === true))
            throw new Error(`Manual panel acceptance is incomplete for ${target.id}.`);
    }
}
/** Verify the distributable ZIP bytes and extracted signature, independently after download. */
export function verifyZip(file, artifact, folder) {
    if (path.basename(artifact.filename) !== artifact.filename || !/^[a-f0-9]{64}$/.test(artifact.sha256) || digest(file) !== artifact.sha256 || fs.statSync(file).size !== artifact.size)
        throw new Error('Downloaded installer does not match the tested artifact.');
    fs.mkdirSync(folder, { recursive: true });
    run('/usr/bin/ditto', ['-x', '-k', file, folder]);
    const app = path.join(folder, targets.find(t => t.id === artifact.target).app);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    return app;
}
