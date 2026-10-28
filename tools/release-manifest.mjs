import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyReleaseEnvelope, releaseNotes as validateReleaseNotes } from '../bin/lib/update-feed.js';

// Release metadata is authenticated by the key pinned in the installed UI,
// independently of GitHub's transport and the local app code signature.
export function signedManifest({ artifact, repository, platform, version, supportedAppVersions, privateKey, releaseNotes = [], target = 'codex', tag = `v${version}` }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^darwin-(arm64|x64)$/.test(platform)) throw new Error('Invalid release repository or platform.');
    if (tag !== `v${version}` && (!/^v\d+\.\d+\.\d+-beta(?:\.\d+)?$/.test(tag) || tag.split('-')[0] !== `v${version}`))
        throw new Error('Invalid release tag for this version.');
    const bytes = fs.readFileSync(artifact), filename = path.basename(artifact);
    if (!['codex', 't3'].includes(target)) throw new Error('Invalid target.');
    const manifest = { schema: 1, ...(target === 't3' ? { target } : {}), agentVersion: version, supportedAppVersions, releaseNotes: validateReleaseNotes(releaseNotes),
        downloads: { [platform]: { url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(filename)}`,
            size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } };
    const payload = Buffer.from(JSON.stringify(manifest));
    const key = createPrivateKey(privateKey);
    const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') };
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    verifyReleaseEnvelope(envelope, publicKey, platform, target);
    return { envelope, publicKey };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = process.argv.slice(2), arg = name => args[args.indexOf(name) + 1];
    if (!args.includes('--artifact') || !process.env.ARTL_RELEASE_PRIVATE_KEY_FILE) throw new Error('Provide --artifact and ARTL_RELEASE_PRIVATE_KEY_FILE. Never put a private key in command arguments.');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
    const config = JSON.parse(fs.readFileSync(new URL('../bin/release-config.json', import.meta.url)));
    const result = signedManifest({ artifact: path.resolve(arg('--artifact')), repository: arg('--repo'), platform: arg('--platform'),
        releaseNotes: args.includes('--notes') ? JSON.parse(fs.readFileSync(path.resolve(arg('--notes')), 'utf8')) : [],
        target: args.includes('--target') ? arg('--target') : 'codex',
        version: pkg.version, tag: args.includes('--tag') ? arg('--tag') : undefined, supportedAppVersions: args.includes('--target') && arg('--target') === 't3' ? config.supportedT3Versions : config.supportedAppVersions, privateKey: fs.readFileSync(process.env.ARTL_RELEASE_PRIVATE_KEY_FILE) });
    if (process.env.ARTL_RELEASE_PUBLIC_KEY !== result.publicKey) throw new Error('The release signing key does not match the key embedded in the setup build.');
    const output = path.resolve(args.includes('--output') ? arg('--output') : 'dist/agent-rtl-release.json');
    fs.writeFileSync(output, JSON.stringify(result.envelope, null, 2) + '\n'); console.log(output);
}
