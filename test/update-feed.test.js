import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { parseAppcast, verifyReleaseEnvelope, trustedURL, compareVersions, downloadArtifact, fetchTrusted, boundedText, releaseNotes } from '../bin/lib/update-feed.js';
import { signedManifest } from '../tools/release-manifest.mjs';
const signature = Buffer.alloc(64).toString('base64');
const item = (build, version, arch = 'arm64') => `<item><sparkle:version>${build}</sparkle:version><sparkle:shortVersionString>${version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>${arch}</sparkle:hardwareRequirements><sparkle:deltas><enclosure url="https://persistent.oaistatic.com/delta.zip" length="1" sparkle:edSignature="${signature}"/></sparkle:deltas><enclosure url="https://persistent.oaistatic.com/full-${build}.zip" length="12" sparkle:edSignature="${signature}"/></item>`;
const xml = text => `<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>${text}</channel></rss>`;
describe('verified GUI update feeds', () => {
    it('requires signed T3 target metadata and rejects cross-app releases', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
        const manifest = { schema: 1, target: 't3', agentVersion: '2.4.13', supportedAppVersions: ['0.1.3'], downloads: { 'darwin-arm64': { url: 'https://github.com/example/repo/releases/download/v2.4.13/t3.zip', size: 1, sha256: 'a'.repeat(64) } } };
        const body = Buffer.from(JSON.stringify(manifest));
        const envelope = { payload: body.toString('base64'), signature: sign(null, body, privateKey).toString('base64') };
        assert.equal(verifyReleaseEnvelope(envelope, raw, 'darwin-arm64', 't3').target, 't3');
        assert.throws(() => verifyReleaseEnvelope(envelope, raw, 'darwin-arm64'), /another application/);
    });
    it('selects the full stable artifact by build and platform, never a delta or incompatible OS', () => {
        const value = parseAppcast(xml(item(99, '26.9.1') + item(101, '26.10.2') + item(200, '26.10.3', 'x64')), { arch: 'arm64', osVersion: '14.0', currentBuild: 100 });
        assert.equal(value.build, 101); assert.equal(value.version, '26.10.2'); assert.ok(value.url.endsWith('full-101.zip'));
        assert.equal(parseAppcast(xml(item(101, '26.10.2')), { arch: 'arm64', osVersion: '12.7', currentBuild: 0 }), null);
        assert.equal(parseAppcast(xml(item(101, '26.10.2')), { arch: 'arm64', osVersion: '14.0', currentBuild: 101 }), null);
        assert.equal(compareVersions('26.10.2', '26.9.99'), 1);
    });
    it('rejects entities and foreign or insecure artifact hosts', () => {
        assert.throws(() => parseAppcast('<!DOCTYPE rss><rss/>', {}), /Invalid/);
        for (const url of ['http://persistent.oaistatic.com/file', 'https://evil.example/a.zip', 'https://user@persistent.oaistatic.com/a.zip']) assert.throws(() => trustedURL(url), /Untrusted/);
    });
    it('verifies a signed release and its exact platform artifact without trusting a key from the feed', () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
        const payload = Buffer.from(JSON.stringify({ schema: 1, agentVersion: '2.1.0', supportedAppVersions: ['26.10.2'], downloads: {
            'darwin-arm64': { url: 'https://github.com/example/rtl/releases/download/v2.1.0/setup.zip', sha256: 'a'.repeat(64), size: 123 } } }));
        const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
        assert.equal(verifyReleaseEnvelope(envelope, raw, 'darwin-arm64').agentVersion, '2.1.0');
        assert.throws(() => verifyReleaseEnvelope({ ...envelope, payload: Buffer.from('{}').toString('base64') }, raw, 'darwin-arm64'), /signature/);
        assert.throws(() => verifyReleaseEnvelope(envelope, raw, 'darwin-x64'), /No valid/);
    });
    it('keeps signed summaries short and supports older manifests without notes', () => {
        assert.deepEqual(releaseNotes(), []);
        assert.deepEqual(releaseNotes(['  Clearer updates  ']), ['Clearer updates']);
        for (const value of [null, 'text', [''], ['a'.repeat(121)], ['line\nbreak'], ['a', 'b', 'c', 'd'], [42]])
            assert.throws(() => releaseNotes(value), /Invalid release notes/);
    });
    it('validates redirects and removes truncated or checksum-invalid downloads', async () => {
        await assert.rejects(fetchTrusted('https://persistent.oaistatic.com/a.zip', { fetcher: async () => new Response(null, { status: 302, headers: { location: 'http://evil.example/a' } }) }), /Untrusted/);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-download-'));
        try {
            const bytes = Buffer.from('signed artifact');
            const artifact = { url: 'https://github.com/example/setup.zip', size: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex') };
            const file = path.join(dir, 'good.zip');
            await downloadArtifact(artifact, file, { kind: 'release', fetcher: async () => new Response(bytes) });
            assert.deepEqual(fs.readFileSync(file), bytes);
            for (const variant of [{ ...artifact, size: bytes.length + 1 }, { ...artifact, sha256: '0'.repeat(64) }]) {
                const bad = path.join(dir, 'bad.zip');
                await assert.rejects(downloadArtifact(variant, bad, { kind: 'release', fetcher: async () => new Response(bytes) }));
                assert.equal(fs.existsSync(bad), false);
            }
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('authenticates beta-tagged downloads while retaining a numeric runtime version', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-beta-release-'));
        try {
            const artifact = path.join(dir, 'Agent-RTL-2.4.2-darwin-arm64.zip'); fs.writeFileSync(artifact, 'beta artifact');
            const { privateKey } = generateKeyPairSync('ed25519');
            const options = { artifact, repository: 'owner/agent-rtl', platform: 'darwin-arm64', version: '2.4.2',
                supportedAppVersions: ['26.1021.31345'], privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
            const release = signedManifest({ ...options, tag: 'v2.4.2-beta.1' });
            const manifest = verifyReleaseEnvelope(release.envelope, release.publicKey, 'darwin-arm64');
            assert.equal(manifest.agentVersion, '2.4.2');
            assert.deepEqual(manifest.releaseNotes, []);
            assert.equal(manifest.artifact.url, 'https://github.com/owner/agent-rtl/releases/download/v2.4.2-beta.1/Agent-RTL-2.4.2-darwin-arm64.zip');
            for (const tag of ['v2.4.3-beta.1', 'v2.4.2/../../other', 'v2.4.2-beta.1?redirect=elsewhere'])
                assert.throws(() => signedManifest({ ...options, tag }), /Invalid release tag/);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
    it('bounds manifests before parsing and produces a verifiable platform release', async () => {
        await assert.rejects(boundedText(new Response('oversized'), 4), /too large/);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-release-'));
        try {
            const artifact = path.join(dir, 'Agent-RTL-2.1.0-darwin-arm64.zip'); fs.writeFileSync(artifact, 'fixture archive');
            const { privateKey } = generateKeyPairSync('ed25519');
            const release = signedManifest({ artifact, repository: 'owner/agent-rtl', platform: 'darwin-arm64', version: '2.1.0',
                releaseNotes: ['Show the installed version.', 'Preview changes before downloading.'],
                supportedAppVersions: ['26.1013.40934'], privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) });
            const manifest = verifyReleaseEnvelope(release.envelope, release.publicKey, 'darwin-arm64');
            assert.deepEqual(manifest.releaseNotes, ['Show the installed version.', 'Preview changes before downloading.']);
            assert.equal(manifest.artifact.size, fs.statSync(artifact).size);
            assert.equal(manifest.artifact.sha256, createHash('sha256').update('fixture archive').digest('hex'));
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
