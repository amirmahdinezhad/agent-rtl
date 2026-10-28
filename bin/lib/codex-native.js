import fs from 'node:fs';
import { supportPath } from './app-target.js';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { patchHtml } from './html.js';
import { buildCodexPayload } from './codex.js';
import { PAYLOAD_FILENAME } from './targets.js';

export const CODEX_HTML = ['webview/index.html', 'webview/detached-window.html'];
const digestSentinel = Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A');
const hash = data => createHash('sha256').update(data).digest('hex');
const command = (file, args, options = {}) => execFileSync(file, args, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
});
const readPlist = file => JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
export const nativePaths = (home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) => {
    const support = supportPath(home);
    return { support, state: path.join(support, 'codex-native.json') };
};

function lookup(header, name) {
    return name.split('/').reduce((node, part) => node?.files?.[part], header);
}
function integrity(data) {
    const blockSize = 4 * 1024 * 1024, blocks = [];
    for (let offset = 0; offset < data.length; offset += blockSize) blocks.push(hash(data.subarray(offset, offset + blockSize)));
    if (!blocks.length) blocks.push(hash(data));
    return { algorithm: 'SHA256', hash: hash(data), blockSize, blocks };
}

// Preserve the complete original data area and original file descriptors.
// HTML descriptors are redirected to appended presentation data. With native
// controls, package.json selects a new wrapper without changing vendor JS.
// Unpacked modules, offsets, links and every original JavaScript byte survive.
export function createCodexArchive(source, destination, payload = buildCodexPayload(), { host = null, htmlPaths = CODEX_HTML, scriptSrc = `./${PAYLOAD_FILENAME}` } = {}) {
    if (path.resolve(source) === path.resolve(destination)) throw new Error('Archive staging requires a separate destination.');
    asar.uncache(source);
    const { header, headerSize } = asar.getRawHeader(source);
    const append = [];
    let offset = fs.statSync(source).size - 8 - headerSize;
    const changed = [];
    const add = (name, data) => {
        const parent = path.posix.dirname(name) === '.' ? header : lookup(header, path.posix.dirname(name));
        if (!parent?.files) throw new Error(`Missing archive directory: ${name}`);
        parent.files[path.posix.basename(name)] = { size: data.length, offset: String(offset), integrity: integrity(data) };
        offset += data.length;
        append.push(data);
    };
    for (const name of htmlPaths) {
        const original = lookup(header, name);
        if (!original || original.unpacked || original.link) throw new Error(`Unsupported Codex HTML entry: ${name}`);
        const html = asar.extractFile(source, name).toString('utf8');
        const patched = patchHtml(html, { scriptSrc });
        if (!patched.html.includes(`<script src="${scriptSrc}"></script>`)) throw new Error(`Cannot inject application HTML: ${name}`);
        add(name, Buffer.from(patched.html));
        changed.push(name);
    }
    const added = [...new Set(htmlPaths.map(name => `${path.posix.dirname(name)}/${PAYLOAD_FILENAME}`))];
    for (const name of added) add(name, Buffer.from(payload));
    if (host) {
        const pkg = JSON.parse(asar.extractFile(source, 'package.json').toString());
        if (typeof pkg.main !== 'string' || pkg.main.includes('..') || path.posix.isAbsolute(pkg.main)
            || pkg.type === 'module' || !lookup(header, pkg.main)) throw new Error('Unsupported Codex main entry for native controls.');
        const originalMain = pkg.main;
        pkg.main = 'agent-rtl/main.cjs';
        add('package.json', Buffer.from(JSON.stringify(pkg, null, 2) + '\n')); changed.push('package.json');
        header.files['agent-rtl'] = { files: {} };
        for (const name of ['main.cjs', 'bridge.cjs', 'preload.cjs']) {
            add(`agent-rtl/${name}`, fs.readFileSync(new URL(`../host/${name}`, import.meta.url)));
            added.push(`agent-rtl/${name}`);
        }
        add('agent-rtl/host.json', Buffer.from(JSON.stringify({ ...host, originalMain })));
        added.push('agent-rtl/host.json');
    }
    const json = Buffer.from(JSON.stringify(header));
    const padded = Math.ceil(json.length / 4) * 4;
    const prefix = Buffer.alloc(16 + padded);
    prefix.writeUInt32LE(4, 0); // size pickle payload
    prefix.writeUInt32LE(8 + padded, 4); // header pickle size
    prefix.writeUInt32LE(4 + padded, 8); // header pickle payload
    prefix.writeUInt32LE(json.length, 12);
    json.copy(prefix, 16);
    const input = fs.openSync(source, 'r'), output = fs.openSync(destination, 'wx', fs.statSync(source).mode);
    try {
        fs.writeFileSync(output, prefix);
        const buffer = Buffer.alloc(4 * 1024 * 1024);
        let position = 8 + headerSize, read;
        while ((read = fs.readSync(input, buffer, 0, buffer.length, position))) {
            fs.writeFileSync(output, buffer.subarray(0, read));
            position += read;
        }
        for (const data of append) fs.writeFileSync(output, data);
        fs.fsyncSync(output);
    } finally { fs.closeSync(input); fs.closeSync(output); }
    asar.uncache(destination);
    // Validate the new header with Electron's archive reader before use.
    const next = asar.getRawHeader(destination);
    return { changed, added, headerHash: hash(next.headerString),
        originalDataHash: hashDataArea(source), preservedDataHash: hashDataArea(destination, 8 + next.headerSize, fs.statSync(source).size - 8 - headerSize) };
}

function hashDataArea(file, start, length) {
    if (start === undefined) start = 8 + asar.getRawHeader(file).headerSize;
    length ??= fs.statSync(file).size - start;
    const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(4 * 1024 * 1024), digest = createHash('sha256');
    try {
        while (length > 0) {
            const read = fs.readSync(fd, buffer, 0, Math.min(length, buffer.length), start);
            if (!read) throw new Error('Truncated archive data.');
            digest.update(buffer.subarray(0, read)); start += read; length -= read;
        }
        return digest.digest('hex');
    } finally { fs.closeSync(fd); }
}

// Electron hashes sorted path + algorithm + hash strings, without separators.
// See electron/shell/common/asar/integrity_digest.mm. Integrity remains enabled.
export function dictionaryDigest(dictionary) {
    const digest = createHash('sha256');
    for (const key of Object.keys(dictionary).sort()) {
        const value = dictionary[key];
        if (value.algorithm !== 'SHA256' || !/^[a-f0-9]{64}$/i.test(value.hash)) throw new Error('Unsupported ASAR integrity dictionary.');
        digest.update(key).update(value.algorithm).update(value.hash);
    }
    return digest.digest();
}

// Locate the digest by Mach-O section, never by a version-specific file offset.
export function digestSlots(binary, { allowDisabled = false } = {}) {
    const slots = [];
    let disabledSections = 0;
    const scan = (base, limit) => {
        if (base + 32 > binary.length || binary.readUInt32LE(base) !== 0xfeedfacf) throw new Error('Unsupported Electron Mach-O architecture.');
        const count = binary.readUInt32LE(base + 16), commandBytes = binary.readUInt32LE(base + 20);
        let cursor = base + 32;
        if (cursor + commandBytes > limit) throw new Error('Invalid Mach-O load commands.');
        for (let i = 0; i < count; i++) {
            const kind = binary.readUInt32LE(cursor), size = binary.readUInt32LE(cursor + 4);
            if (size < 8 || cursor + size > base + 32 + commandBytes) throw new Error('Invalid Mach-O command size.');
            if (kind === 0x19) {
                if (size < 72) throw new Error('Invalid Mach-O segment.');
                const sections = binary.readUInt32LE(cursor + 64);
                if (72 + sections * 80 > size) throw new Error('Invalid Mach-O sections.');
                for (let j = 0; j < sections; j++) {
                    const section = cursor + 72 + j * 80;
                    const name = binary.subarray(section, section + 16).toString().replace(/\0.*$/, '');
                    const segment = binary.subarray(section + 16, section + 32).toString().replace(/\0.*$/, '');
                    if (name !== '__asar_integrity' || segment !== '__DATA_CONST') continue;
                    const offset = base + binary.readUInt32LE(section + 48);
                    const length = Number(binary.readBigUInt64LE(section + 40));
                    if (length !== 66 || offset + length > limit || !binary.subarray(offset, offset + 32).equals(digestSentinel)) throw new Error('Unknown or disabled Electron integrity digest.');
                    // T3 ships with this section disabled. Preserve that vendor
                    // setting; Codex callers still require enabled integrity.
                    if (allowDisabled && binary[offset + 32] === 0 && binary[offset + 33] === 0) { disabledSections++; continue; }
                    if (binary[offset + 32] !== 1 || binary[offset + 33] !== 1) throw new Error('Unknown or disabled Electron integrity digest.');
                    slots.push(offset + 34);
                }
            }
            cursor += size;
        }
    };
    if (binary.readUInt32BE(0) === 0xcafebabe) {
        const count = binary.readUInt32BE(4);
        if (8 + count * 20 > binary.length) throw new Error('Invalid universal Mach-O.');
        for (let i = 0; i < count; i++) {
            const start = binary.readUInt32BE(8 + i * 20 + 8), size = binary.readUInt32BE(8 + i * 20 + 12);
            if (start + size > binary.length) throw new Error('Invalid universal Mach-O slice.');
            scan(start, start + size);
        }
    } else scan(0, binary.length);
    if (!slots.length && !(allowDisabled && disabledSections)) throw new Error('Electron ASAR integrity section not found; no executable changes made.');
    return slots;
}

function frameworkPath(app) {
    const dir = path.join(app, 'Contents/Frameworks');
    const frameworks = fs.readdirSync(dir).filter(name => /^(Codex|Electron) Framework\.framework$/.test(name));
    if (frameworks.length !== 1) throw new Error('Cannot identify the Codex Electron framework.');
    return path.join(dir, frameworks[0], 'Versions/Current', frameworks[0].replace('.framework', ''));
}

export function inspectNative(bundle, htmlPaths = bundle.htmlPaths || CODEX_HTML) {
    asar.uncache(bundle.archive);
    const html = htmlPaths.map(name => asar.extractFile(bundle.archive, name).toString());
    const patched = html.filter(text => text.includes(PAYLOAD_FILENAME)).length;
    return { state: patched === htmlPaths.length ? 'patched-in-app' : patched ? 'partial-patch' : 'not-patched',
        app: bundle.app, version: bundle.version, html: htmlPaths,
        signatureChangeRequired: true, backgroundProcesses: 0, launchers: 0 };
}

// A preview contains resources and metadata only. It is never a registered app.
export function prepareNative(bundle, destination, options = {}) {
    if (fs.existsSync(destination)) throw new Error(`Preview destination already exists: ${destination}`);
    const plist = path.join(bundle.app, 'Contents/Info.plist');
    const dictionary = readPlist(plist).ElectronAsarIntegrity;
    if (!dictionary?.['Resources/app.asar']) throw new Error('Missing Codex ASAR integrity metadata.');
    if (dictionary['Resources/app.asar'].hash !== hash(asar.getRawHeader(bundle.archive).headerString)) throw new Error('Original Codex archive does not match its integrity metadata.');
    const framework = frameworkPath(bundle.app), binary = fs.readFileSync(framework), slots = digestSlots(binary, { allowDisabled: options.allowDisabledIntegrity });
    const originalDigest = dictionaryDigest(dictionary);
    if (slots.some(offset => !binary.subarray(offset, offset + 32).equals(originalDigest))) throw new Error('Original Codex native integrity digest does not match.');
    fs.mkdirSync(destination, { recursive: true });
    try {
        const archive = path.join(destination, 'app.asar');
        const report = createCodexArchive(bundle.archive, archive, options.payload, { host: options.host, htmlPaths: options.htmlPaths, scriptSrc: options.scriptSrc });
        if (report.originalDataHash !== report.preservedDataHash) throw new Error('Original archive data changed; patch aborted.');
        dictionary['Resources/app.asar'].hash = report.headerHash;
        const stagedPlist = path.join(destination, 'Info.plist');
        fs.copyFileSync(plist, stagedPlist);
        command('/usr/bin/plutil', ['-replace', 'ElectronAsarIntegrity', '-json', JSON.stringify(dictionary), stagedPlist]);
        const digest = dictionaryDigest(dictionary);
        for (const offset of slots) digest.copy(binary, offset);
        fs.writeFileSync(path.join(destination, 'framework-integrity'), binary, { mode: fs.statSync(framework).mode });
        const result = { ...report, ...inspectNative(bundle, options.htmlPaths), state: 'prepared',
            originalHeaderHash: hash(asar.getRawHeader(bundle.archive).headerString),
            frameworkRelative: path.relative(bundle.app, framework), nativeMetadataBytes: slots.length * 32,
            originalLogicPreserved: true, note: 'Installing requires replacing the vendor signature with local signing. Login, Keychain access, macOS permissions and app updates may be affected. Official updates replace the RTL patch.' };
        fs.writeFileSync(path.join(destination, 'report.json'), JSON.stringify(result, null, 2) + '\n');
        return result;
    } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
}

export function assertCodexClosed(bundle) {
    if (isCodexRunning(bundle)) throw new Error('Quit Codex with Cmd+Q before installing or restoring its in-app patch.');
}

export function codexProcesses(bundle, { includeBackground = false } = {}) {
    let processes = '';
    try { processes = command('/bin/ps', ['-axo', 'pid=,ppid=,comm=']); } catch { throw new Error('Cannot confirm whether Codex is closed.'); }
    return processes.split('\n').flatMap(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match || !match[3].startsWith(`${bundle.app}/Contents/`)) return [];
        const executable = path.relative(bundle.app, match[3]);
        // Standalone task/CLI runtimes and crash reporting may outlive the
        // GUI. They do not load the patched HTML or Electron framework.
        // Every GUI/framework helper and any unknown process still blocks.
        const background = /^Contents\/Resources\/(?:codex-cli\/|cua_node\/)/.test(executable)
            || executable === 'Contents/Resources/native/bare-modifier-monitor'
            || /^Contents\/Frameworks\/(?:Codex|Electron) Framework\.framework\/Versions\/[^/]+\/Helpers\/browser_crashpad_handler$/.test(executable);
        if (background && !includeBackground) return [];
        return [{ pid: Number(match[1]), parent: Number(match[2]), executable }];
    });
}

export function isCodexRunning(bundle) {
    return codexProcesses(bundle).length > 0;
}

function readNativeState(bundle, paths) {
    if (!fs.existsSync(paths.state)) return null;
    const state = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
    if (state.version !== 1 || state.app !== bundle.app || typeof state.backup !== 'string'
        || path.dirname(state.backup) !== paths.support || !path.basename(state.backup).startsWith('codex-original-')) {
        throw new Error('Invalid Codex RTL backup metadata.');
    }
    return state;
}

// Report installation success only from the actual installed files, rather
// than a prepared stage or a queued installer that has not committed yet.
export function verifyInstalledNative(bundle) {
    const state = readNativeState(bundle, nativePaths());
    asar.uncache(bundle.archive);
    const headerHash = hash(asar.getRawHeader(bundle.archive).headerString);
    if (!state || headerHash !== state.headerHash || inspectNative(bundle).state !== 'patched-in-app') {
        throw new Error('The installed Codex files do not match a completed RTL installation.');
    }
    const dictionary = readPlist(path.join(bundle.app, 'Contents/Info.plist')).ElectronAsarIntegrity;
    if (dictionary?.['Resources/app.asar']?.hash !== headerHash) throw new Error('Installed ASAR integrity metadata does not match.');
    const binary = fs.readFileSync(frameworkPath(bundle.app)), digest = dictionaryDigest(dictionary);
    if (digestSlots(binary, { allowDisabled: bundle.allowDisabledIntegrity }).some(offset => !binary.subarray(offset, offset + 32).equals(digest))) {
        throw new Error('Installed native integrity metadata does not match.');
    }
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app]);
    return { state: 'patched-in-app', headerHash, signatureVerified: true };
}

// Team-bound capabilities cannot be asserted by an ad-hoc signer. Keep the
// ordinary app permissions, and allow the host to load the native dependencies
// that still carry their vendor signatures.
export function localSigningEntitlements(original) {
    const entitlements = { ...original };
    for (const key of Object.keys(entitlements)) {
        if (key.startsWith('com.apple.developer.') || ['application-identifier', 'com.apple.application-identifier',
            'keychain-access-groups', 'com.apple.security.application-groups'].includes(key)) delete entitlements[key];
    }
    entitlements['com.apple.security.cs.disable-library-validation'] = true;
    return entitlements;
}

export function signLocalBundle(app, scratch, { signHelpers = false } = {}) {
    const edits = [];
    const signApp = target => {
        const xml = command('/usr/bin/codesign', ['-d', '--entitlements', ':-', target]);
        const original = xml.trim() ? JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml })) : {};
        const next = localSigningEntitlements(original);
        const file = path.join(scratch, `entitlements-${randomUUID()}.plist`);
        command('/usr/bin/plutil', ['-convert', 'xml1', '-o', file, '--', '-'], { input: JSON.stringify(next) });
        try {
            command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none',
                '--preserve-metadata=identifier,flags,runtime', '--entitlements', file, target]);
        } finally { fs.rmSync(file, { force: true }); }
        edits.push({ target: path.relative(app, target) || '.',
            removed: Object.keys(original).filter(key => !(key in next)),
            added: ['com.apple.security.cs.disable-library-validation'] });
    };
    const frameworkBinary = frameworkPath(app);
    if (signHelpers) {
        const directory = path.join(app, 'Contents/Frameworks');
        for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.app'))) signApp(path.join(directory, name));
    }
    const framework = path.dirname(path.dirname(path.dirname(frameworkBinary)));
    const versions = path.join(framework, 'Versions');
    for (const version of fs.readdirSync(versions, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
        const helpers = path.join(versions, version.name, 'Helpers');
        if (!fs.existsSync(helpers)) continue;
        for (const helper of fs.readdirSync(helpers).filter(name => name.endsWith('.app'))) signApp(path.join(helpers, helper));
    }
    command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', framework]);
    // Sparkle's signed Autoupdate verifies the connecting host's Team ID.
    // Re-sign its nested tools from the inside out, as documented by Sparkle,
    // so the local host is not rejected by a remaining vendor-signed helper.
    // Updater instructions, feed configuration and update keys stay intact.
    const sparkle = path.join(app, 'Contents/Frameworks/Sparkle.framework');
    if (fs.existsSync(sparkle)) {
        const sparkleVersions = path.join(sparkle, 'Versions');
        for (const version of fs.readdirSync(sparkleVersions, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
            for (const name of ['XPCServices/Installer.xpc', 'XPCServices/Downloader.xpc', 'Autoupdate', 'Updater.app']) {
                const target = path.join(sparkleVersions, version.name, name);
                if (fs.existsSync(target)) signApp(target);
            }
        }
        command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none',
            '--preserve-metadata=identifier,flags,runtime', sparkle]);
    }
    signApp(app);
    return edits;
}

export function verifyOfficialBundle(bundle) {
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--test-requirement',
        '=identifier "com.openai.codex" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "2DC432GLL2"', bundle.app]);
    const pkg = JSON.parse(asar.extractFile(bundle.archive, 'package.json').toString());
    if (pkg.name !== 'openai-codex-electron' || pkg.version !== bundle.version) throw new Error('Official app identity does not match the selected version.');
    return pkg;
}

export function stageManagedNative(bundle, official, { payload, host, verifySource = verifyOfficialBundle } = {}) {
    verifySource(official);
    asar.uncache(bundle.archive);
    const installedHeaderHash = hash(asar.getRawHeader(bundle.archive).headerString);
    const staging = fs.mkdtempSync(path.join(path.dirname(bundle.app), '.agent-rtl-stage-'));
    const stagedApp = path.join(staging, path.basename(bundle.app));
    try {
        const preview = path.join(staging, 'preview');
        const report = { ...prepareNative(official, preview, { payload, host }), app: bundle.app,
            version: official.version, installedHeaderHash, managedUpdate: true };
        command('/usr/bin/ditto', [official.app, stagedApp]);
        for (const [from, to] of [['app.asar', 'Contents/Resources/app.asar'], ['Info.plist', 'Contents/Info.plist'], ['framework-integrity', report.frameworkRelative]]) {
            fs.copyFileSync(path.join(preview, from), path.join(stagedApp, to));
        }
        report.signingPermissions = signLocalBundle(stagedApp, staging, { signHelpers: bundle.target === 't3' });
        command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
        return { bundle, official, staging, stagedApp, report };
    } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
}

// A new release has TWO different originals: the old installed app for
// rollback, and the pristine NEW official app for future --restore. Never
// confuse these or restore would silently downgrade the application.
export function commitManagedNative(stage, { verifySource = verifyOfficialBundle, verifyInstalled = verifyInstalledNative } = {}) {
    const { bundle, official, stagedApp, report } = stage;
    assertCodexClosed(bundle); asar.uncache(bundle.archive);
    if (hash(asar.getRawHeader(bundle.archive).headerString) !== report.installedHeaderHash) throw new Error('The installed app changed while the update was prepared.');
    verifySource(official);
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
    const paths = nativePaths(), previous = readNativeState(bundle, paths);
    fs.mkdirSync(paths.support, { recursive: true });
    const backup = path.join(paths.support, `codex-original-${randomUUID()}`);
    const displaced = path.join(stage.staging, 'previous-app'), stateFile = path.join(paths.support, `.codex-native-${randomUUID()}.json`);
    const previousState = fs.existsSync(paths.state) ? fs.readFileSync(paths.state) : null;
    let officialMoved = false, installedMoved = false, stateChanged = false;
    try {
        fs.writeFileSync(stateFile, JSON.stringify({ version: 1, app: bundle.app, backup, headerHash: report.headerHash,
            installedAt: new Date().toISOString(), originalLogicPreserved: true }, null, 2), { flag: 'wx' });
        fs.renameSync(official.app, backup); officialMoved = true;
        assertCodexClosed(bundle);
        fs.renameSync(bundle.app, displaced); installedMoved = true;
        fs.renameSync(stagedApp, bundle.app);
        fs.renameSync(stateFile, paths.state); stateChanged = true;
        verifyInstalled({ ...bundle, version: official.version });
        installedMoved = false; officialMoved = false;
        if (previous) {
            try { fs.rmSync(previous.backup, { recursive: true, force: true }); }
            catch { /* An obsolete backup is harmless if macOS denies cleanup. */ }
        }
        return report;
    } catch (error) {
        if (installedMoved) { fs.rmSync(bundle.app, { recursive: true, force: true }); fs.renameSync(displaced, bundle.app); }
        if (officialMoved) fs.renameSync(backup, official.app);
        if (stateChanged) {
            if (previousState) fs.writeFileSync(paths.state, previousState); else fs.rmSync(paths.state, { force: true });
        }
        throw error;
    } finally { fs.rmSync(stateFile, { force: true }); }
}

export function stageNative(bundle, { allowLocalSigning = false, payload, host } = {}) {
    if (!allowLocalSigning) throw new Error('In-app RTL requires local re-signing of Codex. Review --prepare first; --allow-local-signing explicitly accepts replacing the OpenAI signature and possible login/Keychain/permission effects.');
    const paths = nativePaths();
    const previous = readNativeState(bundle, paths);
    asar.uncache(bundle.archive);
    const installedHeaderHash = hash(asar.getRawHeader(bundle.archive).headerString);
    const refreshing = previous?.headerHash === installedHeaderHash;
    // Rebuild a refresh from the saved original, retaining its complete
    // official signature and avoiding accumulation of old payload bytes.
    const source = refreshing ? { ...bundle, app: previous.backup,
        archive: path.join(previous.backup, path.relative(bundle.app, bundle.archive)),
        executable: path.join(previous.backup, path.relative(bundle.app, bundle.executable)) } : bundle;
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app]);
    if (refreshing) command('/usr/bin/codesign', ['--verify', '--deep', '--strict', source.app]);
    const parent = path.dirname(bundle.app), staging = fs.mkdtempSync(path.join(parent, '.agent-rtl-stage-'));
    const stagedApp = path.join(staging, path.basename(bundle.app)), preview = path.join(staging, 'preview');
    try {
        const report = { ...prepareNative(source, preview, { payload, host, htmlPaths: bundle.htmlPaths, scriptSrc: bundle.scriptSrc, allowDisabledIntegrity: bundle.allowDisabledIntegrity }), app: bundle.app, installedHeaderHash, refreshing };
        command('/usr/bin/ditto', [source.app, stagedApp]);
        fs.copyFileSync(path.join(preview, 'app.asar'), path.join(stagedApp, 'Contents/Resources/app.asar'));
        fs.copyFileSync(path.join(preview, 'Info.plist'), path.join(stagedApp, 'Contents/Info.plist'));
        fs.copyFileSync(path.join(preview, 'framework-integrity'), path.join(stagedApp, report.frameworkRelative));
        report.signingPermissions = signLocalBundle(stagedApp, staging, { signHelpers: bundle.target === 't3' });
        // ASAR integrity checks and Electron fuses remain enabled.
        command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
        asar.uncache(bundle.archive);
        if (hash(asar.getRawHeader(bundle.archive).headerString) !== installedHeaderHash) {
            throw new Error('Codex changed during preparation; no changes were installed.');
        }
        return { bundle, staging, stagedApp, report };
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
}

// Commit only after the app exits. The original signed bundle is the backup,
// and a failed swap restores it before the caller can reopen Codex.
export function commitNative(stage, { verifyInstalled = verifyInstalledNative } = {}) {
    const { bundle, stagedApp, report } = stage;
    assertCodexClosed(bundle);
    const paths = nativePaths(), previous = readNativeState(bundle, paths);
    asar.uncache(bundle.archive);
    const expectedHeaderHash = report.installedHeaderHash || report.originalHeaderHash;
    if (hash(asar.getRawHeader(bundle.archive).headerString) !== expectedHeaderHash) {
        throw new Error('Codex changed after preparation; no changes were installed.');
    }
    const refreshing = !!report.refreshing;
    if (refreshing && previous?.headerHash !== expectedHeaderHash) throw new Error('Codex RTL backup changed after preparation.');
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle.app]);
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp]);
    fs.mkdirSync(paths.support, { recursive: true });
    const backup = refreshing ? previous.backup : path.join(paths.support, `codex-original-${randomUUID()}`);
    if (refreshing) command('/usr/bin/codesign', ['--verify', '--deep', '--strict', backup]);
    const displaced = refreshing ? path.join(stage.staging, 'previous-app') : backup;
    const stagedState = path.join(paths.support, `.codex-native-${randomUUID()}.json`);
    const previousState = fs.existsSync(paths.state) ? fs.readFileSync(paths.state) : null;
    let moved = false, stateChanged = false;
    try {
        const state = { version: 1, app: bundle.app, backup, headerHash: report.headerHash,
            installedAt: new Date().toISOString(), originalLogicPreserved: true };
        fs.writeFileSync(stagedState, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
        // Re-check immediately before the atomic swap in case the user reopened.
        assertCodexClosed(bundle);
        fs.renameSync(bundle.app, displaced); moved = true;
        fs.renameSync(stagedApp, bundle.app);
        fs.renameSync(stagedState, paths.state); stateChanged = true;
        verifyInstalled(bundle); moved = false;
        if (previous && !refreshing) {
            try { fs.rmSync(previous.backup, { recursive: true, force: true }); }
            catch { /* Retain an obsolete backup if the OS denies cleanup. */ }
        }
        return report;
    } catch (error) {
        if (moved) { fs.rmSync(bundle.app, { recursive: true, force: true }); fs.renameSync(displaced, bundle.app); }
        if (stateChanged) {
            if (previousState) fs.writeFileSync(paths.state, previousState); else fs.rmSync(paths.state, { force: true });
        }
        throw error;
    } finally { fs.rmSync(stagedState, { force: true }); }
}

export function discardNativeStage(stage) {
    if (path.dirname(stage.staging) !== path.dirname(stage.bundle.app)
        || !path.basename(stage.staging).startsWith('.agent-rtl-stage-')) throw new Error('Invalid Codex staging path.');
    fs.rmSync(stage.staging, { recursive: true, force: true });
}

export function installNative(bundle, options) {
    // Authorization is checked before inspecting any running application.
    if (!options?.allowLocalSigning) return stageNative(bundle, options);
    assertCodexClosed(bundle);
    const stage = stageNative(bundle, options);
    try { return commitNative(stage); }
    finally { discardNativeStage(stage); }
}

export function restoreNative(bundle) {
    const paths = nativePaths();
    const state = readNativeState(bundle, paths);
    if (!state) return false;
    asar.uncache(bundle.archive);
    if (hash(asar.getRawHeader(bundle.archive).headerString) !== state.headerHash) throw new Error('Codex has changed since patching. Refusing to replace an updated app with an older backup.');
    assertCodexClosed(bundle);
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', state.backup]);
    const removed = path.join(path.dirname(bundle.app), `.agent-rtl-restore-${randomUUID()}`);
    fs.renameSync(bundle.app, removed);
    try { fs.renameSync(state.backup, bundle.app); }
    catch (error) { fs.renameSync(removed, bundle.app); throw error; }
    fs.rmSync(paths.state, { force: true });
    fs.rmSync(removed, { recursive: true, force: true });
    return true;
}
