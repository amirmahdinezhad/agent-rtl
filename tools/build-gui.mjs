import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCodexApp } from '../bin/lib/codex.js';
import { copyPackage, copyPortableNode } from '../bin/lib/gui-runtime.js';
import { edKey, trustedURL } from '../bin/lib/update-feed.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const t3 = process.env.ARTL_TARGET === 't3';
const output = process.env.ARTL_GUI_OUTPUT ? path.resolve(process.env.ARTL_GUI_OUTPUT) : path.join(root, t3 ? 'dist/Rasta T3 Setup.app' : 'dist/Rasta Setup.app');
const helper = path.join(root, 'bin/assets/rasta-ui');
const identity = process.env.ARTL_CODESIGN_IDENTITY || '-';
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const localCandidate = process.env.ARTL_LOCAL_CANDIDATE === '1';
if (localCandidate && (process.env.ARTL_RELEASE_FEED || process.env.ARTL_RELEASE_PUBLIC_KEY))
    throw new Error('A local candidate cannot also override the release feed.');
execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-target', `${architecture}-apple-macosx13.5`, '-O', path.join(root, 'native/RastaSetup.swift'), '-o', helper], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', helper]);
fs.rmSync(output, { recursive: true, force: true });
const runtime = path.join(output, 'Contents/Resources/runtime'); fs.mkdirSync(runtime, { recursive: true });
copyPackage(runtime);
if (t3) {
    const configPath = path.join(runtime, 'bin/release-config.json');
    const config = JSON.parse(fs.readFileSync(configPath));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, target: 't3', feedUrl: config.t3FeedUrl || null, supportedAppVersions: config.supportedT3Versions || [] }, null, 2) + '\n');
}
if (localCandidate) {
    // Test this embedded runtime without a GitHub release taking over the job.
    // Official Codex checks, signing, integrity and Launch approval still apply.
    const configPath = path.join(runtime, 'bin/release-config.json');
    const config = JSON.parse(fs.readFileSync(configPath));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, feedUrl: null, localCandidate: true }, null, 2) + '\n');
}
if (process.env.ARTL_RELEASE_FEED || process.env.ARTL_RELEASE_PUBLIC_KEY) {
    const feedUrl = trustedURL(process.env.ARTL_RELEASE_FEED, 'release').href;
    edKey(process.env.ARTL_RELEASE_PUBLIC_KEY);
    const configPath = path.join(runtime, 'bin/release-config.json');
    const config = JSON.parse(fs.readFileSync(configPath));
    delete config.privateRepository;
    fs.writeFileSync(configPath, JSON.stringify({ ...config, feedUrl, publicKey: process.env.ARTL_RELEASE_PUBLIC_KEY }, null, 2) + '\n');
}
const bundled = resolveCodexApp();
const node = process.env.ARTL_PORTABLE_NODE || (bundled && path.join(bundled.app, 'Contents/Resources/cua_node/bin/node'));
if (!node || !fs.existsSync(node)) throw new Error('Provide ARTL_PORTABLE_NODE for the distributable macOS Node executable.');
copyPortableNode(node, runtime);
fs.copyFileSync(helper, path.join(runtime, 'agent-rtl-ui'));
const executable = path.join(output, 'Contents/MacOS/Rasta Setup'); fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.copyFileSync(helper, executable);
const artwork = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rtl-artwork-'));
try {
    const iconset = path.join(artwork, 'AgentRTL.iconset'); fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) execFileSync(helper, ['--write-icon', path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), String(size * scale)]);
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', path.join(output, 'Contents/Resources/AgentRTL.icns'), iconset]);
} finally { fs.rmSync(artwork, { recursive: true, force: true }); }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const plist = path.join(output, 'Contents/Info.plist');
fs.writeFileSync(plist, JSON.stringify({ CFBundleName: 'Rasta Setup', CFBundleDisplayName: t3 ? 'Rasta — RTL for T3 Code' : 'Rasta — RTL for Codex', CFBundleExecutable: 'Rasta Setup',
    CFBundleIdentifier: t3 ? 'dev.agentrtl.t3.setup' : 'dev.agentrtl.setup', CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version,
    CFBundlePackageType: 'APPL', CFBundleIconFile: 'AgentRTL.icns', LSMinimumSystemVersion: '13.5', LSUIElement: true, NSHighResolutionCapable: true }));
execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
execFileSync('/usr/bin/codesign', ['--force', '--sign', identity, '--options', 'runtime', output]);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
console.log(output);
