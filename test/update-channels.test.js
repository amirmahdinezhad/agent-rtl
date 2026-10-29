import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { guiPaths, saveJSON } from '../bin/lib/gui-runtime.js';
import { authorizePrivateRepository, privateAsset, privateAssetEndpoint } from '../bin/lib/github-release.js';
import { BETA_REPOSITORY, BETA_OWNER_ID, updateChannelStatus, setUpdateChannel, resolveReleaseChannel } from '../bin/lib/update-channels.js';

const owner = { id: BETA_OWNER_ID, login: 'owner' };
const repo = { private: true, owner, full_name: BETA_REPOSITORY };
const access = (account = owner, metadata = repo, calls = []) => async args => {
    calls.push(args[0]); return Buffer.from(JSON.stringify(args[0] === 'user' ? account : metadata));
};

test('private Beta requires the immutable owner ID and a private owner-held repository', async () => {
    assert.deepEqual(await authorizePrivateRepository(BETA_REPOSITORY, BETA_OWNER_ID, { run: access() }), { login: 'owner' });
    await assert.rejects(authorizePrivateRepository(BETA_REPOSITORY, BETA_OWNER_ID, { run: access({ ...owner, id: 1 }) }), /restricted/);
    for (const metadata of [{ ...repo, private: false }, { ...repo, owner: { id: 1 } }, { ...repo, full_name: 'evil/other' }]) {
        await assert.rejects(authorizePrivateRepository(BETA_REPOSITORY, BETA_OWNER_ID, { run: access(owner, metadata) }), /private repository/);
    }
    const calls = [];
    await assert.rejects(privateAsset(`https://github.com/${BETA_REPOSITORY}/releases/download/beta/feed.json`, BETA_REPOSITORY,
        { ownerId: BETA_OWNER_ID, maximum: 1024, run: access({ id: 1 }, repo, calls) }), /restricted/);
    assert.deepEqual(calls, ['user'], 'unauthorized accounts cannot reach release metadata or asset download');
    for (const tag of ['beta', 'v1.0.6-beta.1', 'v1.0.6']) assert.ok(privateAssetEndpoint(`https://github.com/${BETA_REPOSITORY}/releases/download/${tag}/feed.json`, BETA_REPOSITORY));
    for (const tag of ['..', 'other/repo', 'v1.0.6%2f..']) assert.throws(() => privateAssetEndpoint(`https://github.com/${BETA_REPOSITORY}/releases/download/${tag}/feed.json`, BETA_REPOSITORY));
});

test('Beta is per app, hidden for other accounts, and fails closed after logout', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-channels-'));
    const previousHome = process.env.ARTL_CODEX_STATE_HOME, previousTarget = process.env.ARTL_TARGET;
    process.env.ARTL_CODEX_STATE_HOME = home; process.env.ARTL_TARGET = 'codex';
    const yes = { authorize: async () => ({ login: 'owner' }) }, no = { authorize: async () => { throw Error('not authorized'); } };
    const stable = { feedUrl: 'https://github.com/owner/stable/releases/latest/download/feed.json', publicKey: 'pinned' };
    try {
        assert.deepEqual(await updateChannelStatus(no), { channel: 'stable', betaAvailable: false });
        await assert.rejects(setUpdateChannel('beta', no), /not authorized/);
        assert.equal(fs.existsSync(path.join(guiPaths().support, 'update-channel.json')), false);
        await setUpdateChannel('beta', yes);
        const codex = await resolveReleaseChannel(stable, yes);
        assert.equal(codex.privateRepository, BETA_REPOSITORY); assert.equal(codex.betaOwnerId, BETA_OWNER_ID);
        assert.ok(codex.feedUrl.endsWith('rasta-beta-codex.json')); assert.equal(codex.publicKey, 'pinned');
        saveJSON(guiPaths().cache, { available: true, channel: 'beta' });
        assert.equal((await resolveReleaseChannel(stable, no)).channel, 'stable');
        assert.equal(fs.existsSync(guiPaths().cache), false, 'do not retain private update metadata after access is revoked');
        assert.deepEqual(await updateChannelStatus(no), { channel: 'stable', betaAvailable: false });
        process.env.ARTL_TARGET = 't3';
        assert.equal((await updateChannelStatus(yes)).channel, 'stable');
        await setUpdateChannel('beta', yes);
        assert.ok((await resolveReleaseChannel(stable, yes)).feedUrl.endsWith('rasta-beta-t3.json'));
        await setUpdateChannel('stable', no);
        assert.equal((await resolveReleaseChannel(stable, no)).channel, 'stable');
        process.env.ARTL_TARGET = 'codex'; assert.equal((await updateChannelStatus(yes)).channel, 'beta');
        await assert.rejects(setUpdateChannel('../beta', yes), /Invalid update channel/);
    } finally {
        if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome;
        if (previousTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = previousTarget;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
