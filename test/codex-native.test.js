import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import * as asar from '@electron/asar';
import { createCodexArchive, dictionaryDigest, digestSlots, prepareNative, stageNative, commitNative, discardNativeStage, installNative, inspectNative, restoreNative, nativePaths, localSigningEntitlements, isCodexRunning, codexProcesses } from '../bin/lib/codex-native.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const plutil = args => execFileSync('/usr/bin/plutil', args, { encoding: 'utf8' });
const html = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;; style-src &#39;self&#39; &#39;unsafe-inline&#39;; font-src &#39;self&#39; data:;"></head><body><script type="module" src="./assets/original.js"></script></body></html>';

function frameworkFixture(digest) {
    const binary = Buffer.alloc(512);
    binary.writeUInt32LE(0xfeedfacf, 0);
    binary.writeUInt32LE(1, 16); binary.writeUInt32LE(152, 20);
    binary.writeUInt32LE(0x19, 32); binary.writeUInt32LE(152, 36);
    binary.writeUInt32LE(1, 32 + 64);
    const section = 32 + 72;
    binary.write('__asar_integrity', section); binary.write('__DATA_CONST', section + 16);
    binary.writeBigUInt64LE(66n, section + 40); binary.writeUInt32LE(256, section + 48);
    binary.write('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A', 256);
    binary[288] = 1; binary[289] = 1; digest.copy(binary, 290);
    binary.write('Native instruction sentinel', 350);
    return binary;
}

async function fixture(dir) {
    const source = path.join(dir, 'source'), app = path.join(dir, 'Codex.app');
    const archive = path.join(app, 'Contents/Resources/app.asar');
    fs.mkdirSync(path.join(source, 'webview/assets'), { recursive: true });
    fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{"name":"openai-codex-electron","version":"fixture"}');
    fs.writeFileSync(path.join(source, 'webview/index.html'), html);
    fs.writeFileSync(path.join(source, 'webview/detached-window.html'), html);
    fs.writeFileSync(path.join(source, 'webview/assets/original.js'), 'window.originalLogic = "do not edit";');
    fs.writeFileSync(path.join(source, '.vite/build/main.js'), 'MAIN LOGIC SENTINEL');
    fs.writeFileSync(path.join(source, '.vite/build/preload.js'), 'PRELOAD LOGIC SENTINEL');
    fs.writeFileSync(path.join(source, 'native.node'), 'UNPACKED NATIVE SENTINEL');
    fs.symlinkSync('original.js', path.join(source, 'webview/assets/link.js'));
    await asar.createPackageWithOptions(source, archive, { unpack: '*.node' });
    const dictionary = { 'Resources/app.asar': { algorithm: 'SHA256', hash: hash(asar.getRawHeader(archive).headerString) } };
    const plist = path.join(app, 'Contents/Info.plist');
    fs.writeFileSync(plist, JSON.stringify({ CFBundleExecutable: 'Codex', ElectronAsarIntegrity: dictionary }));
    plutil(['-convert', 'xml1', plist]);
    const executable = path.join(app, 'Contents/MacOS/Codex');
    fs.writeFileSync(executable, 'EXECUTABLE SENTINEL');
    const framework = path.join(app, 'Contents/Frameworks/Codex Framework.framework/Versions/A/Codex Framework');
    fs.mkdirSync(path.dirname(framework), { recursive: true });
    fs.symlinkSync('A', path.join(path.dirname(path.dirname(framework)), 'Current'));
    fs.writeFileSync(framework, frameworkFixture(dictionaryDigest(dictionary)));
    return { app, archive, executable, framework, version: 'fixture' };
}

describe('Codex in-app resources', () => {
    it('waits for the main app and renderer, but not surviving CLI or crash-reporting processes', { skip: os.platform() !== 'darwin' }, async () => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'artl-processes-')));
        const bundle = { app: path.join(dir, 'Codex.app') }, children = [];
        const start = relative => {
            const file = path.join(bundle.app, relative);
            const child = spawn(file, ['20'], { stdio: 'ignore' }); children.push(child); return child;
        };
        const stop = child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
        try {
            const sleeperSource = path.join(dir, 'sleeper.c'), sleeper = path.join(dir, 'sleeper');
            fs.writeFileSync(sleeperSource, '#include <unistd.h>\nint main(void) { sleep(20); return 0; }\n');
            execFileSync('/usr/bin/xcrun', ['clang', sleeperSource, '-o', sleeper], { stdio: 'pipe' });
            // Use project-owned code instead of a renamed platform binary,
            // and finish the fixture before executing any of its files.
            for (const relative of ['Contents/MacOS/Codex',
                'Contents/Frameworks/Codex Framework.framework/Versions/A/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)',
                'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
                'Contents/Frameworks/Codex Framework.framework/Versions/A/Helpers/browser_crashpad_handler']) {
                const file = path.join(bundle.app, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.copyFileSync(sleeper, file);
            }
            const main = start('Contents/MacOS/Codex');
            const renderer = start('Contents/Frameworks/Codex Framework.framework/Versions/A/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)');
            start('Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
            start('Contents/Frameworks/Codex Framework.framework/Versions/A/Helpers/browser_crashpad_handler');
            await Promise.all(children.map(child => new Promise(resolve => child.once('spawn', resolve))));
            assert.equal(isCodexRunning(bundle), true);
            await stop(main);
            assert.equal(isCodexRunning(bundle), true, 'a live renderer must still prevent installation');
            await stop(renderer);
            assert.equal(codexProcesses(bundle, { includeBackground: true }).length, 2);
            assert.equal(isCodexRunning(bundle), false, 'standalone CLI and crash handlers do not keep the GUI open');
        } finally { await Promise.all(children.map(stop)); fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('removes invalid Team-bound entitlements while retaining ordinary app permissions for local signing', () => {
        const original = { 'com.apple.application-identifier': 'TEAM.app', 'com.apple.developer.team-identifier': 'TEAM',
            'com.apple.developer.aps-environment': 'production', 'com.apple.security.application-groups': ['TEAM.group'],
            'keychain-access-groups': ['TEAM.*'], 'com.apple.security.cs.allow-jit': true,
            'com.apple.security.device.audio-input': true, 'com.apple.security.network.client': true };
        const next = localSigningEntitlements(original);
        assert.equal(next['com.apple.security.cs.allow-jit'], true);
        assert.equal(next['com.apple.security.device.audio-input'], true);
        assert.equal(next['com.apple.security.network.client'], true);
        assert.equal(next['com.apple.security.cs.disable-library-validation'], true);
        assert.equal(next['keychain-access-groups'], undefined);
        assert.equal(next['com.apple.security.application-groups'], undefined);
        assert.equal(next['com.apple.developer.team-identifier'], undefined);
        assert.equal(original['com.apple.developer.team-identifier'], 'TEAM', 'original input is never mutated');
    });
    it('preserves all original logic descriptors and bytes, including links and unpacked native modules', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-native-'));
        try {
            const bundle = await fixture(dir), destination = path.join(dir, 'patched.asar');
            const before = fs.readFileSync(bundle.archive);
            const report = createCodexArchive(bundle.archive, destination, 'window.widget = true;');
            assert.equal(report.originalDataHash, report.preservedDataHash);
            assert.deepEqual(fs.readFileSync(bundle.archive), before);
            fs.cpSync(`${bundle.archive}.unpacked`, `${destination}.unpacked`, { recursive: true });
            const original = asar.getRawHeader(bundle.archive).header;
            const patched = asar.getRawHeader(destination).header;
            for (const name of ['package.json', '.vite/build/main.js', '.vite/build/preload.js', 'webview/assets/original.js', 'webview/assets/link.js', 'native.node']) {
                assert.deepEqual(asar.extractFile(destination, name), asar.extractFile(bundle.archive, name));
                const get = header => name.split('/').reduce((node, part) => node.files[part], header);
                assert.deepEqual(get(patched), get(original));
            }
            for (const name of report.changed) {
                const next = asar.extractFile(destination, name).toString();
                assert.equal(next.match(/rasta-payload.js/g).length, 1);
                assert.ok(next.includes('src="./assets/original.js"'));
                assert.ok(next.includes('script-src &#39;self&#39;'));
            }
            assert.equal(asar.extractFile(destination, 'webview/rasta-payload.js').toString(), 'window.widget = true;');
            assert.throws(() => createCodexArchive(bundle.archive, bundle.archive), /separate destination/);
            const refreshed = path.join(dir, 'refreshed.asar');
            createCodexArchive(destination, refreshed, 'window.widget = "refreshed";');
            assert.equal(asar.extractFile(refreshed, 'webview/index.html').toString().match(/rasta-payload.js/g).length, 1);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('locates enabled native digest metadata in thin and universal Mach-O files, without changing security flags', () => {
        const digest = Buffer.alloc(32, 7), binary = frameworkFixture(digest);
        assert.deepEqual(digestSlots(binary), [290]);
        const universal = Buffer.alloc(1024);
        universal.writeUInt32BE(0xcafebabe, 0); universal.writeUInt32BE(1, 4);
        universal.writeUInt32BE(512, 16); universal.writeUInt32BE(512, 20);
        binary.copy(universal, 512);
        assert.deepEqual(digestSlots(universal), [802]);
        binary[288] = 0;
        assert.throws(() => digestSlots(binary), /disabled/);
        assert.throws(() => dictionaryDigest({ a: { algorithm: 'MD5', hash: 'invalid' } }), /Unsupported/);
    });

    it('preserves a vendor-disabled T3 digest only with an explicit opt-in', () => {
        const binary = frameworkFixture(Buffer.alloc(32));
        binary[288] = 0; binary[289] = 0;
        const before = Buffer.from(binary);
        assert.throws(() => digestSlots(binary), /disabled/);
        assert.deepEqual(digestSlots(binary, { allowDisabled: true }), []);
        assert.deepEqual(binary, before);
        binary[289] = 1;
        assert.throws(() => digestSlots(binary, { allowDisabled: true }), /disabled/);
    });

    it('patches T3 client HTML without changing package entrypoints or vendor JavaScript', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-t3-'));
        try {
            const source = path.join(dir, 'source'), client = 'apps/server/dist/client';
            fs.mkdirSync(path.join(source, client), { recursive: true });
            fs.writeFileSync(path.join(source, client, 'index.html'), html);
            fs.writeFileSync(path.join(source, client, 'original.js'), '// vendor logic');
            fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 't3code', main: 'boot.cjs' }));
            fs.writeFileSync(path.join(source, 'boot.cjs'), '// vendor boot');
            const archive = path.join(dir, 'app.asar'), patched = path.join(dir, 'patched.asar');
            await asar.createPackage(source, archive);
            const options = { htmlPaths: [client + '/index.html'], scriptSrc: '/rasta-payload.js' };
            const report = createCodexArchive(archive, patched, '// shared panel', options);
            assert.equal(report.originalDataHash, report.preservedDataHash);
            for (const file of ['package.json', 'boot.cjs', client + '/original.js']) assert.deepEqual(asar.extractFile(patched, file), asar.extractFile(archive, file));
            assert.equal(asar.extractFile(patched, client + '/rasta-payload.js').toString(), '// shared panel');
            const script = asar.extractFile(patched, client + '/index.html').toString().match(/<script src="([^"]*rasta-payload.js)"><\/script>/)[1];
            assert.equal(new URL(script, 't3code://app/local/thread-1').href, 't3code://app/rasta-payload.js');
            const refreshed = path.join(dir, 'refreshed.asar');
            createCodexArchive(patched, refreshed, '// refreshed panel', options);
            assert.equal(asar.extractFile(refreshed, client + '/index.html').toString().match(/rasta-payload.js/g).length, 1);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('prepares a reviewable patch without touching the installed app; only 32 native metadata bytes change', { skip: os.platform() !== 'darwin' }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-prepare-'));
        try {
            const bundle = await fixture(dir), preview = path.join(dir, 'preview');
            const files = [bundle.archive, bundle.framework, bundle.executable, path.join(bundle.app, 'Contents/Info.plist')];
            const before = files.map(file => fs.readFileSync(file));
            assert.equal(inspectNative(bundle).state, 'not-patched');
            const report = prepareNative(bundle, preview);
            assert.equal(report.backgroundProcesses, 0); assert.equal(report.launchers, 0);
            assert.equal(report.originalLogicPreserved, true);
            assert.equal(report.nativeMetadataBytes, 32);
            files.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
            const patched = fs.readFileSync(path.join(preview, 'framework-integrity'));
            assert.deepEqual(patched.subarray(0, 290), before[1].subarray(0, 290));
            assert.deepEqual(patched.subarray(322), before[1].subarray(322));
            const dictionary = JSON.parse(plutil(['-convert', 'json', '-o', '-', path.join(preview, 'Info.plist')])).ElectronAsarIntegrity;
            assert.deepEqual(patched.subarray(290, 322), dictionaryDigest(dictionary));
            assert.throws(() => prepareNative(bundle, preview), /already exists/);
            assert.throws(() => installNative(bundle), /requires local re-signing/);
            assert.equal(fs.existsSync(nativePaths(dir).state), false);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('refuses tampered originals and restores nothing when Codex updated after patching', { skip: os.platform() !== 'darwin' }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-integrity-'));
        const saved = process.env.ARTL_CODEX_STATE_HOME;
        try {
            const bundle = await fixture(dir);
            const framework = fs.readFileSync(bundle.framework); framework[290] ^= 1;
            fs.writeFileSync(bundle.framework, framework);
            const preview = path.join(dir, 'preview');
            assert.throws(() => prepareNative(bundle, preview), /native integrity digest does not match/);
            assert.equal(fs.existsSync(preview), false);
            process.env.ARTL_CODEX_STATE_HOME = dir;
            const paths = nativePaths(); fs.mkdirSync(paths.support, { recursive: true });
            fs.writeFileSync(paths.state, JSON.stringify({ version: 1, app: bundle.app, backup: path.join(paths.support, 'codex-original-fixture'), headerHash: 'old-version' }));
            const archive = fs.readFileSync(bundle.archive);
            assert.throws(() => restoreNative(bundle), /changed since patching/);
            assert.deepEqual(fs.readFileSync(bundle.archive), archive);
        } finally {
            if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('refreshes a signed bundle while retaining its original backup, and rolls back a failed swap', { skip: os.platform() !== 'darwin' }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-native-refresh-'));
        const saved = process.env.ARTL_CODEX_STATE_HOME;
        let stage;
        try {
            process.env.ARTL_CODEX_STATE_HOME = dir;
            const bundle = await fixture(dir);
            const digestBytes = fs.readFileSync(bundle.framework).subarray(256, 322);
            const c = path.join(dir, 'fixture.c'), binary = path.join(dir, 'fixture-binary');
            fs.writeFileSync(c, `__attribute__((used,section("__DATA_CONST,__asar_integrity"),aligned(1))) static const unsigned char integrity[66] = {${[...digestBytes].join(',')}}; int main(void) {return 0;}`);
            execFileSync('/usr/bin/xcrun', ['clang', c, '-o', binary], { stdio: 'pipe' });
            fs.copyFileSync(binary, bundle.framework); fs.copyFileSync(binary, bundle.executable);
            fs.chmodSync(bundle.executable, 0o755); fs.chmodSync(bundle.framework, 0o755);
            const framework = path.dirname(path.dirname(path.dirname(bundle.framework)));
            const resources = path.join(path.dirname(bundle.framework), 'Resources'); fs.mkdirSync(resources);
            fs.writeFileSync(path.join(resources, 'Info.plist'), JSON.stringify({ CFBundleExecutable: 'Codex Framework', CFBundleIdentifier: 'dev.rasta.test-framework', CFBundlePackageType: 'FMWK' }));
            plutil(['-convert', 'xml1', path.join(resources, 'Info.plist')]);
            fs.symlinkSync('Versions/Current/Codex Framework', path.join(framework, 'Codex Framework'));
            fs.symlinkSync('Versions/Current/Resources', path.join(framework, 'Resources'));
            plutil(['-insert', 'CFBundleIdentifier', '-string', 'dev.rasta.test-app', path.join(bundle.app, 'Contents/Info.plist')]);
            // Sparkle's nested updater tools must share the host's local
            // signing mode; leaving the vendor's Autoupdate signature behind
            // makes its Team ID requirement reject the patched host (4005).
            const sparkle = path.join(bundle.app, 'Contents/Frameworks/Sparkle.framework');
            const sparkleVersion = path.join(sparkle, 'Versions/B');
            const writePlist = (file, value) => {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, JSON.stringify(value)); plutil(['-convert', 'xml1', file]);
            };
            writePlist(path.join(sparkleVersion, 'Resources/Info.plist'), {
                CFBundleExecutable: 'Sparkle', CFBundleIdentifier: 'dev.rasta.test-sparkle', CFBundlePackageType: 'FMWK' });
            fs.symlinkSync('B', path.join(sparkle, 'Versions/Current'));
            for (const name of ['Sparkle', 'Resources']) fs.symlinkSync(`Versions/Current/${name}`, path.join(sparkle, name));
            const sparkleTools = ['Autoupdate', 'Updater.app', 'XPCServices/Installer.xpc', 'XPCServices/Downloader.xpc'];
            const toolPermissions = path.join(dir, 'tool-entitlements.plist');
            writePlist(toolPermissions, { 'com.apple.security.network.client': true,
                'com.apple.security.app-sandbox': false, 'com.apple.security.application-groups': ['TEAM.updater'] });
            fs.copyFileSync(binary, path.join(sparkleVersion, 'Sparkle'));
            for (const name of sparkleTools) {
                const target = path.join(sparkleVersion, name);
                let executable = target;
                if (name !== 'Autoupdate') {
                    const executableName = path.basename(name, path.extname(name));
                    writePlist(path.join(target, 'Contents/Info.plist'), { CFBundleExecutable: executableName,
                        CFBundleIdentifier: `dev.rasta.test-${executableName.toLowerCase()}`,
                        CFBundlePackageType: name.endsWith('.xpc') ? 'XPC!' : 'APPL' });
                    executable = path.join(target, 'Contents/MacOS', executableName);
                    fs.mkdirSync(path.dirname(executable), { recursive: true });
                }
                fs.copyFileSync(binary, executable);
                execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', toolPermissions, target], { stdio: 'pipe' });
            }
            execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', sparkle], { stdio: 'pipe' });
            execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', framework], { stdio: 'pipe' });
            execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle.app], { stdio: 'pipe' });
            const originalArchive = fs.readFileSync(bundle.archive), originalExecutable = fs.readFileSync(bundle.executable);
            stage = stageNative(bundle, { allowLocalSigning: true });
            for (const name of sparkleTools) {
                const relative = `Contents/Frameworks/Sparkle.framework/Versions/B/${name}`;
                assert.ok(stage.report.signingPermissions.some(edit => edit.target === relative), `${name} must be re-signed with the host`);
                const target = path.join(stage.stagedApp, relative);
                const signed = spawnSync('/usr/bin/codesign', ['-dvv', target], { encoding: 'utf8' });
                assert.match(signed.stderr, /Signature=adhoc/);
                assert.match(signed.stderr, /flags=.*runtime/);
                const xml = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                const entitlements = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml, encoding: 'utf8' }));
                assert.equal(entitlements['com.apple.security.network.client'], true);
                assert.equal(entitlements['com.apple.security.app-sandbox'], false);
                assert.equal(entitlements['com.apple.security.application-groups'], undefined);
            }
            commitNative(stage); discardNativeStage(stage); stage = null;
            const state = JSON.parse(fs.readFileSync(nativePaths().state));
            const originalBackupArchive = path.join(state.backup, 'Contents/Resources/app.asar');
            assert.deepEqual(fs.readFileSync(originalBackupArchive), originalArchive);
            const installedArchive = fs.readFileSync(bundle.archive);
            stage = stageNative(bundle, { allowLocalSigning: true });
            assert.equal(stage.report.refreshing, true);
            const rename = fs.renameSync;
            const fault = mock.method(fs, 'renameSync', (from, to) => {
                if (to === nativePaths().state) throw new Error('State swap fixture failure');
                return rename(from, to);
            });
            try { assert.throws(() => commitNative(stage), /State swap fixture failure/); }
            finally { fault.mock.restore(); }
            assert.deepEqual(fs.readFileSync(bundle.archive), installedArchive);
            assert.deepEqual(JSON.parse(fs.readFileSync(nativePaths().state)), state);
            assert.deepEqual(fs.readFileSync(originalBackupArchive), originalArchive);
            discardNativeStage(stage); stage = null;
            stage = stageNative(bundle, { allowLocalSigning: true }); commitNative(stage); discardNativeStage(stage); stage = null;
            assert.equal(JSON.parse(fs.readFileSync(nativePaths().state)).backup, state.backup);
            assert.deepEqual(fs.readFileSync(originalBackupArchive), originalArchive);
            assert.equal(restoreNative(bundle), true);
            assert.deepEqual(fs.readFileSync(bundle.archive), originalArchive);
            assert.deepEqual(fs.readFileSync(bundle.executable), originalExecutable);
            execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app], { stdio: 'pipe' });
        } finally {
            if (stage) discardNativeStage(stage);
            if (saved === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = saved;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

});
