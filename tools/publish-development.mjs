import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import { signedManifest } from './release-manifest.mjs';
import { PRIVATE_REPOSITORY, targets, run, gh, digest, save, verifyZip } from './development-release.js';

if (process.env.GITHUB_REPOSITORY !== PRIVATE_REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/develop') throw new Error('Private develop workflow required.');
const repository = JSON.parse(gh(['api', `repos/${PRIVATE_REPOSITORY}`]));
if (!repository.private || repository.owner.id !== 17439071) throw new Error('Authorized private repository required.');
const sequence = Number(process.env.GITHUB_RUN_NUMBER);
if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid workflow build number.');
const version = `1.1.${sequence}`, tag = `v${version}`, directory = path.resolve('dist/development', version);
fs.mkdirSync(directory, { recursive: true });
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
const config = JSON.parse(fs.readFileSync('bin/release-config.json'));
const privateKey = Buffer.from(process.env.RELEASE_KEY_BASE64 || '', 'base64');
delete process.env.RELEASE_KEY_BASE64;
const publicKey = createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
if (publicKey !== config.publicKey) throw new Error('Release key does not match the embedded public key.');
const pkg = JSON.parse(fs.readFileSync('package.json')); pkg.version = version; save('package.json', pkg);
const lock = JSON.parse(fs.readFileSync('package-lock.json')); lock.version = version; lock.packages[''].version = version; save('package-lock.json', lock);
const candidate = { version, tag, sourceCommit, workflowRun: process.env.GITHUB_RUN_ID, artifacts: [], manualAcceptance: 'pending' };
for (const target of targets) {
    const output = path.join(directory, target.app);
    const env = { ...process.env, ARTL_TARGET: target.id, ARTL_TEST_TARGET: target.id, ARTL_GUI_OUTPUT: output, ARTL_PORTABLE_NODE: process.execPath, ARTL_NODE_LICENSE: path.resolve(path.dirname(process.execPath), '../LICENSE') };
    run(process.execPath, ['tools/build-gui.mjs'], { env });
    run(process.execPath, ['test/gui-job-smoke.mjs'], { env });
    run(process.execPath, ['test/update-event-smoke.mjs'], { env });
    const filename = `${target.prefix}-${version}-darwin-arm64.zip`, artifact = path.join(directory, filename);
    run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', output, artifact]);
    const result = signedManifest({ artifact, repository: PRIVATE_REPOSITORY, platform: 'darwin-arm64', version, privateKey, target: target.id,
        supportedAppVersions: target.id === 't3' ? config.supportedT3Versions : config.supportedAppVersions,
        releaseNotes: JSON.parse(fs.readFileSync(`docs/release-notes-${target.id}.json`)) });
    save(path.join(directory, `rasta-beta-${target.id}.json`), result.envelope);
    candidate.artifacts.push({ target: target.id, filename, sha256: digest(artifact), size: fs.statSync(artifact).size });
}
save(path.join(directory, 'candidate.json'), candidate);
const notes = path.join(directory, 'release-notes.md');
fs.writeFileSync(notes, `# Rasta ${version} private Beta\n\nSource: ${sourceCommit}\n\nManual panel acceptance is pending for Codex and T3. Public stable feeds are unchanged. These exact installer bytes are retained for promotion. Packages are ad hoc signed and are not notarized.\n`);
const assets = candidate.artifacts.map(item => path.join(directory, item.filename)).concat(targets.map(t => path.join(directory, `rasta-beta-${t.id}.json`)), path.join(directory, 'candidate.json'));
gh(['release', 'create', tag, ...assets, '--repo', PRIVATE_REPOSITORY, '--target', sourceCommit, '--title', `Rasta ${version} private Beta`, '--notes-file', notes, '--prerelease', '--latest=false']);
const downloaded = path.join(directory, 'downloaded');
gh(['release', 'download', tag, '--repo', PRIVATE_REPOSITORY, '--dir', downloaded]);
for (const artifact of candidate.artifacts) verifyZip(path.join(downloaded, artifact.filename), artifact, path.join(downloaded, 'extracted', artifact.target));
// Advance the private channel only after both published installers pass verification.
const feeds = targets.map(t => path.join(directory, `rasta-beta-${t.id}.json`));
try { gh(['release', 'view', 'beta', '--repo', PRIVATE_REPOSITORY]); }
catch { gh(['release', 'create', 'beta', '--repo', PRIVATE_REPOSITORY, '--target', sourceCommit, '--title', 'Private Beta channel', '--notes', 'Signed owner-only panel update feeds.', '--prerelease', '--latest=false']); }
gh(['release', 'upload', 'beta', ...feeds, '--repo', PRIVATE_REPOSITORY, '--clobber']);
console.log(`Private panel update ${version} verified and available for manual acceptance.`);
