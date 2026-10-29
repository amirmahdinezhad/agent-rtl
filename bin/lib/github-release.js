// Development-only transport for a private repository. gh keeps credentials in
// the developer's own login; neither tokens nor gh are bundled in the product.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { trustedURL } from './update-feed.js';

export function privateAssetEndpoint(url, repository) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid private release repository.');
    const value = trustedURL(url, 'release');
    const root = `/${repository}/releases/`;
    if (value.hostname !== 'github.com' || !value.pathname.startsWith(root)) throw new Error('Private release URL is outside the configured repository.');
    const parts = value.pathname.slice(root.length).split('/');
    if (parts.length === 3 && parts[0] === 'latest' && parts[1] === 'download') return { release: `repos/${repository}/releases/latest`, name: decodeURIComponent(parts[2]) };
    if (parts.length === 3 && parts[0] === 'download' && /^(?:beta|v\d+\.\d+\.\d+(?:-beta(?:\.\d+)?)?)$/.test(parts[1])) return { release: `repos/${repository}/releases/tags/${parts[1]}`, name: decodeURIComponent(parts[2]) };
    throw new Error('Invalid private release asset URL.');
}
function ghPath() {
    for (const file of ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']) if (fs.existsSync(file)) return file;
    throw new Error('Private development releases require GitHub CLI signed in on this Mac.');
}
/** Authenticate the immutable GitHub owner ID and require a private, owner-held repository. */
export async function authorizePrivateRepository(repository, ownerId, { signal, run = gh } = {}) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !Number.isSafeInteger(ownerId) || ownerId < 1)
        throw new Error('Invalid Beta access configuration.');
    const options = { signal, maximum: 128 * 1024 };
    const account = JSON.parse((await run(['user'], options)).toString());
    if (account.id !== ownerId) throw new Error('Beta updates are restricted to the authorized GitHub account.');
    const repo = JSON.parse((await run([`repos/${repository}`], options)).toString());
    if (repo.private !== true || repo.owner?.id !== ownerId || repo.full_name?.toLowerCase() !== repository.toLowerCase())
        throw new Error('Beta updates require the authorized private repository.');
    return { login: account.login };
}

export async function privateAsset(url, repository, { signal, maximum, onChunk, run, ownerId } = {}) {
    const invoke = run || gh;
    const { release, name } = privateAssetEndpoint(url, repository);
    if (ownerId !== undefined) await authorizePrivateRepository(repository, ownerId, { signal, run: invoke });
    const metadata = JSON.parse((await invoke([release], { signal, maximum: 2 * 1024 * 1024 })).toString());
    const asset = metadata.assets?.find(item => item.name === name);
    if (!asset || !Number.isSafeInteger(asset.id) || asset.id < 1 || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maximum) throw new Error('Private release asset is missing or exceeds its size limit.');
    return invoke([`repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], { signal, maximum, onChunk });
}
function gh(args, { signal, maximum, onChunk } = {}) {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, GH_PROMPT_DISABLED: '1' }; delete env.GH_DEBUG;
        const child = spawn(ghPath(), ['api', '--hostname', 'github.com', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], signal });
        let bytes = 0, chunks = [], failed = null;
        const timeout = setTimeout(() => { failed = new Error('Private release request timed out.'); child.kill(); }, 120000);
        child.stderr.resume();
        child.stdout.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > maximum) { failed = new Error('Private release exceeds its size limit.'); child.kill(); return; }
            if (failed) return;
            try { if (onChunk) onChunk(chunk); else chunks.push(chunk); } catch (error) { failed = error; child.kill(); }
        });
        child.once('error', error => { failed = error; });
        child.once('close', code => { clearTimeout(timeout); if (failed) reject(failed); else if (code !== 0) reject(new Error('Could not read the private release. Check GitHub access on this Mac.')); else resolve(Buffer.concat(chunks)); });
    });
}
export async function downloadPrivateArtifact(artifact, file, repository, { signal, progress = () => {}, run, ownerId } = {}) {
    const out = fs.openSync(file, 'wx', 0o600), hash = createHash('sha256'); let count = 0;
    try {
        await privateAsset(artifact.url, repository, { signal, maximum: artifact.size, run, ownerId, onChunk: chunk => { count += chunk.length; if (count > artifact.size) throw new Error('Private release exceeds its signed length.'); fs.writeFileSync(out, chunk); hash.update(chunk); progress(count, artifact.size); } });
        if (count !== artifact.size || hash.digest('hex') !== artifact.sha256) throw new Error('Private release length or checksum mismatch.');
        fs.fsyncSync(out);
    } catch (error) { fs.rmSync(file, { force: true }); throw error; } finally { fs.closeSync(out); }
}
