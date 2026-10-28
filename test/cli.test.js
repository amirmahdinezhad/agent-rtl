import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeFixture } from './helpers/native-fixture.js';
import { resolveT3App } from '../bin/lib/t3.js';

const run = (args, env = {}) => spawnSync(process.execPath, ['bin/index.js', ...args], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env },
});

it('rejects removed targets without modifying an arbitrary archive or requesting a path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-cli-target-'));
    try {
        const archive = path.join(dir, 'app.asar');
        fs.writeFileSync(archive, 'untouched archive');
        for (const args of [[], ['--restore'], ['--status'], ['--dry-run']]) {
            const result = run(['--target', 'opencode', ...args], { ARTL_ASAR_OPENCODE: archive });
            assert.equal(result.status, 1, result.stderr);
            assert.match(result.stderr, /Unknown target/);
            assert.doesNotMatch(result.stdout, /Provide the absolute path/);
            assert.equal(fs.readFileSync(archive, 'utf8'), 'untouched archive');
        }
        const help = run(['--help']);
        assert.equal(help.status, 0, help.stderr);
        assert.match(help.stdout, /--target <codex\|t3\|all>/);
        assert.doesNotMatch(help.stdout, /opencode/i);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

it('keeps T3 inspection read-only and requires Setup for installation and removal', { skip: os.platform() !== 'darwin' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-t3-cli-'));
    const previous = process.env.ARTL_ASAR_T3;
    try {
        const bundle = await nativeFixture(dir, '0.1.3', false, 't3');
        process.env.ARTL_ASAR_T3 = bundle.archive;
        assert.equal(resolveT3App().app, bundle.app);
        const before = fs.readFileSync(bundle.archive);
        for (const option of ['--status', '--dry-run']) {
            const result = run(['--target', 't3', option]);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /not-patched/);
        }
        for (const args of [[], ['--restore']]) {
            const result = run(['--target', 't3', ...args]);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /Setup.app/);
        }
        assert.deepEqual(fs.readFileSync(bundle.archive), before);
        process.env.ARTL_ASAR_T3 = path.join(dir, 'missing.asar');
        assert.equal(resolveT3App(), null, 'an invalid override never falls back to an installed app');
    } finally {
        if (previous === undefined) delete process.env.ARTL_ASAR_T3;
        else process.env.ARTL_ASAR_T3 = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
