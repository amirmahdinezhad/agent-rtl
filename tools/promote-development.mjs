import fs from 'node:fs';
import path from 'node:path';
import { signedManifest } from './release-manifest.mjs';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';
import { PRIVATE_REPOSITORY, PUBLIC_REPOSITORY, targets, run, gh, save, validateAcceptance, verifyZip } from './development-release.js';

const [tag, acceptanceFile] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag || '') || !acceptanceFile || !process.env.ARTL_RELEASE_PRIVATE_KEY_FILE) throw new Error('Provide a candidate tag, explicit acceptance record and signing key file.');
const directory = path.resolve('dist/promotion', tag);
if (fs.existsSync(directory)) throw new Error('Promotion directory already exists; inspect the previous attempt before retrying.');
fs.mkdirSync(directory, { recursive: true });
gh(['release', 'download', tag, '--repo', PRIVATE_REPOSITORY, '--dir', directory]);
const candidate = JSON.parse(fs.readFileSync(path.join(directory, 'candidate.json'))), acceptance = JSON.parse(fs.readFileSync(acceptanceFile));
if (candidate.tag !== tag || tag !== `v${candidate.version}` || !/^[a-f0-9]{40}$/.test(candidate.sourceCommit)) throw new Error('Invalid candidate identity.');
validateAcceptance(acceptance, candidate);
run('git', ['fetch', 'development', 'develop']);
run('git', ['merge-base', '--is-ancestor', candidate.sourceCommit, 'refs/remotes/development/develop']);
const config = JSON.parse(run('git', ['show', `${candidate.sourceCommit}:bin/release-config.json`]));
const privateKey = fs.readFileSync(process.env.ARTL_RELEASE_PRIVATE_KEY_FILE);
for (const artifact of candidate.artifacts) {
    const target = targets.find(t => t.id === artifact.target);
    const envelope = JSON.parse(fs.readFileSync(path.join(directory, `rasta-beta-${target.id}.json`)));
    const signed = verifyReleaseEnvelope(envelope, config.publicKey, 'darwin-arm64', target.id);
    if (signed.agentVersion !== candidate.version || signed.artifact.sha256 !== artifact.sha256 || signed.artifact.size !== artifact.size)
        throw new Error('Candidate provenance does not match its signed feed.');
    verifyZip(path.join(directory, artifact.filename), artifact, path.join(directory, 'extracted', target.id));
    const result = signedManifest({ artifact: path.join(directory, artifact.filename), repository: PUBLIC_REPOSITORY, platform: 'darwin-arm64', version: candidate.version,
        target: target.id, privateKey, supportedAppVersions: signed.supportedAppVersions, releaseNotes: signed.releaseNotes });
    if (result.publicKey !== config.publicKey) throw new Error('Pinned signing key mismatch.');
    save(path.join(directory, target.stableFeed), result.envelope);
}
// Fast-forward only: publish exactly the accepted source, never newer untested work.
run('git', ['push', 'origin', `${candidate.sourceCommit}:refs/heads/main`]);
const assets = candidate.artifacts.map(a => path.join(directory, a.filename)).concat(targets.map(t => path.join(directory, t.stableFeed)), path.join(directory, 'candidate.json'));
save(path.join(directory, 'manual-acceptance.json'), acceptance); assets.push(path.join(directory, 'manual-acceptance.json'));
const notes = path.join(directory, 'promotion-notes.md');
fs.writeFileSync(notes, `# Rasta ${candidate.version}\n\nPromoted from the manually accepted private Beta without rebuilding either installer.\n\nSource: ${candidate.sourceCommit}\n\nSupports Codex ${config.supportedAppVersions.join(', ')} and T3 Code ${config.supportedT3Versions.join(', ')}. Requires Apple Silicon and macOS 13.5+. Packages are ad hoc signed and are not notarized.\n`);
gh(['release', 'create', tag, ...assets, '--repo', PUBLIC_REPOSITORY, '--target', candidate.sourceCommit, '--title', `Rasta ${candidate.version}`, '--notes-file', notes, '--latest=false']);
const downloaded = path.join(directory, 'published');
gh(['release', 'download', tag, '--repo', PUBLIC_REPOSITORY, '--dir', downloaded]);
for (const artifact of candidate.artifacts) verifyZip(path.join(downloaded, artifact.filename), artifact, path.join(downloaded, 'extracted', artifact.target));
gh(['release', 'edit', tag, '--repo', PUBLIC_REPOSITORY, '--latest=true']);
// Earlier installed packages pin these release URLs. Update pointers, preserving old ZIPs.
for (const [previousTag, feed, targetId] of [
    ['v1.0.2', 'agent-rtl-release.json', 'codex'], ['v1.0.2', 'agent-rtl-t3-release.json', 't3'],
    ['v1.0.3', 'agent-rtl-t3-release.json', 't3'], ['v1.0.4', 'rasta-release.json', 'codex'], ['v1.0.4', 'rasta-t3-release.json', 't3'],
]) {
    const file = path.join(directory, 'feed-aliases', feed); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(directory, targets.find(t => t.id === targetId).stableFeed), file);
    gh(['release', 'upload', previousTag, file, '--repo', PUBLIC_REPOSITORY, '--clobber']);
}
save(path.join(directory, 'promotion-verification.json'), { version: candidate.version, sourceCommit: candidate.sourceCommit, artifacts: candidate.artifacts, publishedDownloadsVerified: true, sameZipBytes: true, postPublicationPanelAcceptance: 'pending' });
gh(['release', 'upload', tag, path.join(directory, 'promotion-verification.json'), '--repo', PUBLIC_REPOSITORY]);
console.log('Accepted source and identical installer bytes promoted. Request separate production-panel acceptance.');
