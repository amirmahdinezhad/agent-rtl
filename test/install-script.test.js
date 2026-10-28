import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyReleaseEnvelope } from '../bin/lib/update-feed.js';

const script = fileURLToPath(new URL('../install.sh', import.meta.url));
const source = fs.readFileSync(script, 'utf8');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const fixtureBytes = Buffer.from('owned installer archive fixture\n');
const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex');

// Real shell, size and SHA-256 checks; only network and macOS interactions are
// replaced. No installed app, actual launch or user Downloads folder is touched.
function runInstaller(t, { env = {}, args = [], overrides = true, commandString = false, tty = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-bootstrap-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const user = path.join(root, 'User With Spaces');
    const temporary = path.join(root, 'Temporary With Spaces');
    const stubs = path.join(root, 'commands');
    for (const dir of [user, temporary, stubs]) fs.mkdirSync(dir);
    fs.mkdirSync(path.join(user, 'Downloads', 'Agent-RTL-previous'), { recursive: true });
    fs.writeFileSync(path.join(user, 'Downloads', 'Agent-RTL-previous', 'keep.txt'), 'previous setup');
    const archive = path.join(root, 'fixture.zip');
    const log = path.join(root, 'calls.log');
    fs.writeFileSync(archive, fixtureBytes);
    fs.writeFileSync(log, '');
    const router = `#!/bin/bash
set -eu
tool="\${0##*/}"
printf '%s' "$tool" >> "$ARTL_TEST_LOG"
printf ' <%s>' "$@" >> "$ARTL_TEST_LOG"
printf '\\n' >> "$ARTL_TEST_LOG"
if [ "\${ARTL_TEST_FAIL:-}" = "$tool" ]; then exit 1; fi
case "$tool" in
  uname) if [ "$1" = -s ]; then echo "\${ARTL_TEST_SYSTEM:-Darwin}"; else echo "\${ARTL_TEST_ARCH:-arm64}"; fi ;;
  sw_vers) echo "\${ARTL_TEST_OS:-13.5}" ;;
  sysctl) echo "\${ARTL_TEST_ARM64:-0}" ;;
  id) echo "\${ARTL_TEST_UID:-501}" ;;
  curl)
    destination=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --output ]; then destination="$2"; shift; fi
      shift
    done
    cp "$ARTL_TEST_ARCHIVE" "$destination" ;;
  ditto)
    if [ "\${ARTL_TEST_NO_APP:-}" != 1 ]; then mkdir -p "$4/Agent RTL Setup.app"; fi ;;
esac
`;
    for (const name of ['uname', 'sw_vers', 'sysctl', 'id', 'curl', 'ditto', 'codesign', 'xattr', 'open']) {
        fs.writeFileSync(path.join(stubs, name), router, { mode: 0o755 });
    }
    const wrapper = path.join(root, 'run.sh');
    fs.writeFileSync(wrapper, `source ${quote(script)}\nARTL_INSTALL_SIZE=${quote(env.ARTL_TEST_SIZE ?? String(fixtureBytes.length))}\nARTL_INSTALL_SHA256=${quote(env.ARTL_TEST_SHA256 ?? fixtureHash)}\nartl_install_main "$@"\n`);
    const fixtureSource = source
        .replace(/^ARTL_INSTALL_SIZE='[^']*'/m, `ARTL_INSTALL_SIZE=${quote(env.ARTL_TEST_SIZE ?? String(fixtureBytes.length))}`)
        .replace(/^ARTL_INSTALL_SHA256='[^']*'/m, `ARTL_INSTALL_SHA256=${quote(env.ARTL_TEST_SHA256 ?? fixtureHash)}`);
    const invocation = commandString ? ['-c', overrides ? fixtureSource : source, 'install.sh', ...args]
        : overrides ? [wrapper, ...args] : [script, ...args];
    const executable = tty ? '/usr/bin/script' : '/bin/bash';
    const parameters = tty ? ['-q', '/dev/null', '/bin/bash', ...invocation] : invocation;
    const result = spawnSync(executable, parameters, {
        encoding: 'utf8', timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: user, TMPDIR: temporary, TERM: 'xterm-256color', NO_COLOR: '',
            PATH: `${stubs}:/usr/bin:/bin:/usr/sbin:/sbin`,
            ARTL_TEST_LOG: log, ARTL_TEST_ARCHIVE: archive, ...env }
    });
    assert.ifError(result.error);
    return { ...result, calls: fs.readFileSync(log, 'utf8'),
        temporary: fs.readdirSync(temporary), downloads: fs.readdirSync(path.join(user, 'Downloads')),
        previous: fs.readFileSync(path.join(user, 'Downloads', 'Agent-RTL-previous', 'keep.txt'), 'utf8') };
}

test('bootstrap pins match the public release manifest authenticated with the project key', () => {
    const config = JSON.parse(fs.readFileSync(new URL('../bin/release-config.json', import.meta.url)));
    const envelope = JSON.parse(fs.readFileSync(new URL('./fixtures/installer-release.json', import.meta.url)));
    const manifest = verifyReleaseEnvelope(envelope, config.publicKey, 'darwin-arm64');
    const pins = Object.fromEntries([...source.matchAll(/^ARTL_INSTALL_(\w+)='([^']+)'/gm)].map(([, key, value]) => [key, value]));
    assert.equal(pins.VERSION, manifest.agentVersion);
    assert.equal(pins.URL, manifest.artifact.url);
    assert.equal(pins.SIZE, String(manifest.artifact.size));
    assert.equal(pins.SHA256, manifest.artifact.sha256);
});

test('opens only the verified app and keeps it in a unique Downloads folder', t => {
    const result = runInstaller(t);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /codesign <--verify> <--deep> <--strict>/);
    assert.match(result.calls, /curl .*<--proto> <=https> <--proto-redir> <=https>/);
    assert.match(result.calls, /xattr <-r> <-w> <com.apple.quarantine>/);
    assert.ok(result.calls.indexOf('codesign ') < result.calls.indexOf('open '));
    assert.ok(result.calls.indexOf('xattr <-r>') < result.calls.indexOf('open '));
    assert.match(result.stdout, /click Launch/);
    assert.match(result.stdout, /NEXT: CONTINUE IN SETUP/);
    assert.match(result.stdout, /click Update RTL or Download update/);
    assert.match(result.stdout, /click Launch to restart Codex/);
    assert.ok(result.stdout.trim().split('\n').length <= 23, result.stdout);
    assert.doesNotMatch(result.stdout, /Help:|Verified Setup saved/);
    assert.match(result.calls, /curl .*<--silent>/);
    assert.doesNotMatch(result.stdout, /\x1b/);
    assert.doesNotMatch(result.stdout, /installation successful/i);
    assert.deepEqual(result.temporary, []);
    assert.equal(result.downloads.length, 2);
    assert.equal(result.previous, 'previous setup');
});

test('download-only retains verified Setup without opening any app', t => {
    const result = runInstaller(t, { args: ['--download-only'] });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.calls, /^open /m);
    assert.equal(result.downloads.length, 2);
    assert.deepEqual(result.temporary, []);
    assert.match(result.stdout, /NEXT: OPEN SETUP/);
    assert.match(result.stdout, /Open Agent RTL Setup.app from Downloads/);
    assert.match(result.stdout, /Open the saved app:/);
});

test('README command-string downloads successfully and cleans up on exit', t => {
    const result = runInstaller(t, { commandString: true, args: ['--download-only'] });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /unbound variable/);
    assert.doesNotMatch(result.calls, /^open /m);
    assert.equal(result.downloads.length, 2);
    assert.deepEqual(result.temporary, []);
});

test('README command-string opens Setup and cleans up on exit', t => {
    const result = runInstaller(t, { commandString: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /^open /m);
    assert.equal(result.downloads.length, 2);
    assert.deepEqual(result.temporary, []);
});

test('README command-string failures clean up without masking the original error', t => {
    for (const env of [{ ARTL_TEST_FAIL: 'curl' }, { ARTL_TEST_SHA256: '0'.repeat(64) }]) {
        const result = runInstaller(t, { commandString: true, env });
        assert.equal(result.status, 1);
        assert.doesNotMatch(result.stderr, /unbound variable/);
        assert.match(result.stderr, /Download failed|verification failed/);
        assert.doesNotMatch(result.calls, /^open /m);
        assert.deepEqual(result.temporary, []);
        assert.deepEqual(result.downloads, ['Agent-RTL-previous']);
    }
});

test('supports Apple Silicon running a Rosetta terminal', t => {
    const result = runInstaller(t, { env: { ARTL_TEST_ARCH: 'x86_64', ARTL_TEST_ARM64: '1' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /^open /m);
});

for (const [name, env, message] of [
    ['Linux', { ARTL_TEST_SYSTEM: 'Linux' }, /requires macOS/],
    ['Intel', { ARTL_TEST_ARCH: 'x86_64' }, /Intel installer is not available/],
    ['older macOS minor', { ARTL_TEST_OS: '13.4.1' }, /13.5 or newer/],
    ['older macOS major', { ARTL_TEST_OS: '12.7.6' }, /13.5 or newer/],
    ['unknown OS version', { ARTL_TEST_OS: 'unknown' }, /determine your macOS/],
    ['root', { ARTL_TEST_UID: '0' }, /without sudo/]
]) {
    test(`rejects ${name} before downloading`, t => {
        const result = runInstaller(t, { env });
        assert.equal(result.status, 1);
        assert.match(result.stderr, message);
        assert.doesNotMatch(result.calls, /^curl /m);
        assert.deepEqual(result.temporary, []);
        assert.deepEqual(result.downloads, ['Agent-RTL-previous']);
    });
}

for (const [name, env, message] of [
    ['network error', { ARTL_TEST_FAIL: 'curl' }, /Download failed/],
    ['truncated archive', { ARTL_TEST_SIZE: '999' }, /incomplete or has changed/],
    ['changed archive', { ARTL_TEST_SHA256: '0'.repeat(64) }, /verification failed/],
    ['unpack error', { ARTL_TEST_FAIL: 'ditto' }, /Could not unpack/],
    ['missing app', { ARTL_TEST_NO_APP: '1' }, /does not contain/],
    ['invalid signature', { ARTL_TEST_FAIL: 'codesign' }, /signature is invalid/],
    ['quarantine failure', { ARTL_TEST_FAIL: 'xattr' }, /Could not preserve macOS/]
]) {
    test(`${name} never opens an app and cleans its own files`, t => {
        const result = runInstaller(t, { env });
        assert.equal(result.status, 1);
        if (message) assert.match(result.stderr, message);
        assert.doesNotMatch(result.calls, /^open /m);
        if (/archive/.test(name)) assert.doesNotMatch(result.calls, /^ditto /m);
        assert.deepEqual(result.temporary, []);
        assert.deepEqual(result.downloads, ['Agent-RTL-previous']);
        assert.equal(result.previous, 'previous setup');
    });
}

test('failed open retains the verified app and gives a Finder fallback', t => {
    const result = runInstaller(t, { env: { ARTL_TEST_FAIL: 'open' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Open the saved app from Finder/);
    assert.match(result.stdout, /IF MACOS BLOCKS SETUP/);
    assert.match(result.stdout, /Open the saved app:/);
    assert.match(result.stderr, /Help:/);
    assert.equal(result.downloads.length, 2);
    assert.deepEqual(result.temporary, []);
});

test('direct script and README command-string entry points both work', t => {
    for (const commandString of [false, true]) {
        const help = runInstaller(t, { overrides: false, commandString, args: ['--help'] });
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /Usage:/);
        assert.equal(help.calls, '');
        const invalid = runInstaller(t, { overrides: false, commandString, args: ['--invalid'] });
        assert.equal(invalid.status, 1);
        assert.match(invalid.stderr, /Unknown option/);
        assert.equal(invalid.calls, '');
    }
});

test('preview shows the full guide without network, platform checks or opening apps', t => {
    const result = runInstaller(t, { overrides: false, commandString: true, args: ['--preview'] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls, '');
    assert.match(result.stdout, /AGENT RTL \| PREVIEW/);
    assert.match(result.stdout, /no download or app launch/);
    assert.ok(result.stdout.trim().split('\n').length <= 23, result.stdout);
    for (const step of ['Check your Mac', 'Download Setup', 'Verify and prepare Setup', 'Request Setup opening']) {
        assert.match(result.stdout, new RegExp(step));
    }
    assert.match(result.stdout, /NEXT: CONTINUE IN SETUP/);
    assert.deepEqual(result.temporary, []);
    assert.deepEqual(result.downloads, ['Agent-RTL-previous']);
});

const stripAnsi = text => text.replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r', '');

test('a real terminal gets colored frames that fit its width', t => {
    const result = runInstaller(t, { overrides: false, tty: true, env: { COLUMNS: '64' }, args: ['--preview'] });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\x1b\[35m/);
    const framed = stripAnsi(result.stdout).split('\n').filter(line => /^[╭│╰]/u.test(line));
    assert.ok(framed.length >= 6);
    assert.ok(framed.every(line => [...line].length === 64), JSON.stringify(framed));
    assert.match(stripAnsi(result.stdout), /click Launch to restart Codex/);
    assert.equal(result.calls, '');
});

test('NO_COLOR preserves terminal frames without color escapes', t => {
    const result = runInstaller(t, { overrides: false, tty: true, env: { COLUMNS: '72', NO_COLOR: '1' }, args: ['--preview'] });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /╭/);
    assert.doesNotMatch(result.stdout, /\x1b/);
});

test('narrow and basic terminals keep a plain, wrapped guide', t => {
    for (const env of [{ COLUMNS: '32' }, { TERM: 'dumb', COLUMNS: '72' }]) {
        const result = runInstaller(t, { overrides: false, tty: true, env, args: ['--preview'] });
        assert.equal(result.status, 0, result.stderr);
        const plain = stripAnsi(result.stdout);
        assert.doesNotMatch(plain, /[╭│╰]/u);
        assert.match(plain, /NEXT: CONTINUE IN SETUP/);
        if (env.COLUMNS === '32') {
            const instructions = plain.split('NEXT: CONTINUE IN SETUP\n')[1].split('\n\nIF MACOS')[0];
            assert.ok(instructions.split('\n').every(line => line.length <= 32));
        } else assert.doesNotMatch(result.stdout, /\x1b/);
    }
});

test('terminal mode shows download progress and identifies a failed step', t => {
    const result = runInstaller(t, { tty: true, env: { ARTL_TEST_FAIL: 'curl' } });
    assert.match(result.calls, /curl .*<--progress-bar>/);
    assert.doesNotMatch(result.calls, /^open /m);
    const output = stripAnsi(result.stdout + result.stderr);
    assert.match(output, /Stopped at: Download Setup/);
    assert.doesNotMatch(output, /NEXT: CONTINUE IN SETUP/);
    assert.deepEqual(result.temporary, []);
});


test('successful open request still explains Gatekeeper approval and retains a retry path', t => {
    const result = runInstaller(t);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /IF MACOS BLOCKS SETUP/);
    assert.match(result.stdout, /Open Anyway/);
    assert.match(result.stdout, /not notarized by Apple/);
    assert.match(result.stdout, /open 'x-apple.systempreferences:com.apple.preference.security\?Privacy'/);
    assert.match(result.stdout, /Open the saved app:/);
    assert.doesNotMatch(result.stdout, /\[4\/4\] Open Setup OK/);
    assert.equal(result.calls.split('\n').filter(line => line.startsWith('open ')).length, 1,
        'settings must not open automatically');
});

test('supported terminal output offers a settings hyperlink without executing it', t => {
    const result = runInstaller(t, { tty: true, args: ['--preview'] });
    assert.match(result.stdout, /\x1b\]8;;x-apple.systempreferences:com.apple.preference.security\?Privacy\x1b\\/);
    assert.match(result.stdout, /Open Privacy & Security/);
    assert.equal(result.calls, '');
});
