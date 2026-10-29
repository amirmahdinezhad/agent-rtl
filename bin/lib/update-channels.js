import fs from 'node:fs';
import path from 'node:path';
import { targetId } from './app-target.js';
import { guiPaths, readJSON, saveJSON } from './gui-runtime.js';
import { authorizePrivateRepository } from './github-release.js';

// IDs and repository names are public identifiers. Credentials stay with GitHub CLI.
export const BETA_REPOSITORY = 'amirmahdinezhad/rasta-beta';
export const BETA_OWNER_ID = 17439071;
const preferenceFile = () => path.join(guiPaths().support, 'update-channel.json');
const preference = () => readJSON(preferenceFile())?.channel === 'beta' ? 'beta' : 'stable';

/** Resolve visible channel controls from fresh GitHub authentication, failing closed. */
export async function updateChannelStatus({ authorize = authorizePrivateRepository } = {}) {
    try {
        const account = await authorize(BETA_REPOSITORY, BETA_OWNER_ID, { signal: AbortSignal.timeout(10000) });
        return { channel: preference(), betaAvailable: true, account: account.login };
    } catch {
        return { channel: 'stable', betaAvailable: false };
    }
}

/** Persist this app's channel only; selecting Beta always requires owner authentication. */
export async function setUpdateChannel(channel, { authorize = authorizePrivateRepository } = {}) {
    if (!['stable', 'beta'].includes(channel)) throw new Error('Invalid update channel.');
    if (channel === 'beta') await authorize(BETA_REPOSITORY, BETA_OWNER_ID, { signal: AbortSignal.timeout(10000) });
    saveJSON(preferenceFile(), { channel });
    fs.rmSync(guiPaths().cache, { force: true });
    return { channel };
}

/** Keep stable checks available after logout; private metadata and downloads require fresh owner access. */
export async function resolveReleaseChannel(stable, { authorize = authorizePrivateRepository } = {}) {
    if (preference() !== 'beta') return { ...stable, channel: 'stable' };
    try {
        await authorize(BETA_REPOSITORY, BETA_OWNER_ID, { signal: AbortSignal.timeout(10000) });
    } catch {
        fs.rmSync(guiPaths().cache, { force: true });
        return { ...stable, channel: 'stable' };
    }
    return { ...stable, channel: 'beta', privateRepository: BETA_REPOSITORY, betaOwnerId: BETA_OWNER_ID,
        feedUrl: `https://github.com/${BETA_REPOSITORY}/releases/download/beta/rasta-beta-${targetId()}.json` };
}
