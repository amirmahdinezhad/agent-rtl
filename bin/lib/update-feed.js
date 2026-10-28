import fs from 'node:fs';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const VENDOR_KEY = 'mNfr1v9t63BfgDtlw4C8lRvSY6uMggIXABDOCi3tS6k=';
export const VENDOR_HOSTS = new Set(['updates.oaistatic.com', 'persistent.oaistatic.com']);
const RELEASE_HOSTS = new Set(['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
export function trustedURL(value, kind = 'vendor') {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(kind === 'vendor' ? VENDOR_HOSTS : RELEASE_HOSTS).has(url.hostname)) throw new Error('Untrusted update URL.');
    return url;
}
export function compareVersions(a, b) {
    if (![a, b].every(value => typeof value === 'string' && /^\d+(?:\.\d+){1,4}$/.test(value))) throw new Error('Invalid update version.');
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) if ((left[i] || 0) !== (right[i] || 0)) return Math.sign((left[i] || 0) - (right[i] || 0));
    return 0;
}
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
export function parseAppcast(xml, { arch, osVersion, currentBuild = 0 } = {}) {
    if (Buffer.byteLength(xml) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid official update feed.');
    const tree = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, processEntities: false }).parse(xml);
    const entries = list(tree.rss?.channel?.item).flatMap(item => {
        const enclosure = list(item.enclosure)[0]; // Deliberately exclude sparkle:deltas.
        if (!enclosure || item['sparkle:channel']) return [];
        const version = String(item['sparkle:shortVersionString'] || enclosure['@_sparkle:shortVersionString'] || '');
        const build = Number(item['sparkle:version'] || enclosure['@_sparkle:version']);
        const minimumOS = String(item['sparkle:minimumSystemVersion'] || '13.0');
        const hardware = String(item['sparkle:hardwareRequirements'] || '');
        if (!Number.isSafeInteger(build) || build <= currentBuild || !/^\d+(?:\.\d+){1,4}$/.test(version)) return [];
        if (hardware && !hardware.split(/[,\s]+/).includes(arch)) return [];
        if (compareVersions(osVersion, minimumOS) < 0) return [];
        const url = trustedURL(enclosure['@_url']).href;
        const size = Number(enclosure['@_length']), signature = enclosure['@_sparkle:edSignature'];
        if (!new URL(url).pathname.endsWith('.zip') || !Number.isSafeInteger(size) || size < 1 || size > 3 * 1024 ** 3
            || typeof signature !== 'string' || Buffer.from(signature, 'base64').length !== 64) throw new Error('Invalid official update artifact.');
        return [{ version, build, minimumOS, arch, url, size, signature }];
    });
    return entries.sort((a, b) => b.build - a.build)[0] || null;
}
export function edKey(raw) {
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length !== 32) throw new Error('Invalid Ed25519 public key.');
    return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
}
/** Validate the optional, signed summary kept small enough for both update surfaces. */
export function releaseNotes(value = []) {
    if (!Array.isArray(value) || value.length > 3 || value.some(note => typeof note !== 'string'
        || !note.trim() || note.length > 120 || /[\r\n\x00-\x1f\x7f]/.test(note))) throw new Error('Invalid release notes: use up to 3 short lines (120 characters each).');
    return value.map(note => note.trim());
}
export function verifyReleaseEnvelope(envelope, key, platform, target = 'codex') {
    if (!key || typeof envelope?.payload !== 'string' || typeof envelope.signature !== 'string'
        || envelope.payload.length > 128 * 1024) throw new Error('Invalid Rasta release manifest.');
    const body = Buffer.from(envelope.payload, 'base64');
    if (!verify(null, body, edKey(key), Buffer.from(envelope.signature, 'base64'))) throw new Error('Rasta release signature is invalid.');
    const manifest = JSON.parse(body.toString());
    if ((manifest.target || 'codex') !== target) throw new Error('The Rasta release belongs to another application.');
    if ((manifest.target !== undefined && !['codex', 't3'].includes(manifest.target)) || manifest.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.agentVersion)
        || !Array.isArray(manifest.supportedAppVersions) || !manifest.supportedAppVersions.every(v => /^\d+(?:\.\d+){1,4}$/.test(v))) throw new Error('Unsupported Rasta release manifest.');
    const artifact = manifest.downloads?.[platform];
    if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 1024 ** 3) throw new Error('No valid release for this Mac.');
    trustedURL(artifact.url, 'release');
    return { ...manifest, releaseNotes: releaseNotes(manifest.releaseNotes), artifact };
}
export async function fetchTrusted(url, { kind = 'vendor', signal, fetcher = fetch } = {}) {
    for (let i = 0; i < 6; i++) {
        url = trustedURL(url, kind);
        const response = await fetcher(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'AgentRTL-Updater' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) throw new Error('Update redirect has no destination.');
            url = new URL(location, url); continue;
        }
        if (!response.ok) throw new Error(`Update download failed (${response.status}).`);
        return response;
    }
    throw new Error('Too many update redirects.');
}
export async function boundedText(response, maximum) {
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
        length += chunk.length;
        if (length > maximum) throw new Error('Update manifest is too large.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
export async function downloadArtifact(artifact, file, { kind = 'vendor', signal, progress = () => {}, fetcher } = {}) {
    const response = await fetchTrusted(artifact.url, { kind, signal, fetcher });
    const out = fs.openSync(file, 'wx', 0o600), digest = createHash('sha256'); let bytes = 0;
    try {
        for await (const chunk of response.body) {
            signal?.throwIfAborted(); bytes += chunk.length;
            if (bytes > artifact.size) throw new Error('Update exceeds its signed length.');
            fs.writeFileSync(out, chunk); digest.update(chunk); progress(bytes, artifact.size);
        }
        if (bytes !== artifact.size) throw new Error('Update download is incomplete.');
        const actual = digest.digest('hex');
        if (artifact.sha256 && actual !== artifact.sha256) throw new Error('Update checksum mismatch.');
        fs.fsyncSync(out); return actual;
    } catch (error) { fs.rmSync(file, { force: true }); throw error; }
    finally { fs.closeSync(out); }
}
