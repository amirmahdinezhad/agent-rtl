import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAcceptance } from '../tools/development-release.js';

test('promotion requires both apps to explicitly accept the exact tested source and bytes', () => {
    const candidate = { version: '1.1.1', sourceCommit: 'a'.repeat(40), artifacts: [
        { target: 'codex', sha256: 'b'.repeat(64) }, { target: 't3', sha256: 'c'.repeat(64) },
    ] };
    const observation = sha256 => ({ sha256, closedPanelDot: true, refreshOffersVersion: true, panelUpgradeComplete: true, versionDisplayed: true, appWorking: true });
    const accepted = { version: candidate.version, sourceCommit: candidate.sourceCommit, githubPublicationAuthorized: true,
        targets: { codex: observation('b'.repeat(64)), t3: observation('c'.repeat(64)) } };
    assert.doesNotThrow(() => validateAcceptance(accepted, candidate));
    for (const change of [{ githubPublicationAuthorized: false }, { sourceCommit: 'd'.repeat(40) }, { version: '1.1.2' },
        { targets: { ...accepted.targets, t3: { ...accepted.targets.t3, panelUpgradeComplete: false } } },
        { targets: { ...accepted.targets, codex: { ...accepted.targets.codex, sha256: 'e'.repeat(64) } } }]) {
        assert.throws(() => validateAcceptance({ ...accepted, ...change }, candidate));
    }
});
