import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { saveJSON, readJSON } from '../bin/lib/gui-runtime.js';
import { updateEventPaths, updateEventPlist, promptAfterAppChange } from '../bin/lib/update-events.js';

test('app-change prompt waits for stable files, deduplicates, and skips healthy or busy apps', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-events-'));
    const previousHome = process.env.ARTL_CODEX_STATE_HOME; process.env.ARTL_CODEX_STATE_HOME = dir;
    try {
        const config = { app: path.join(dir, 'Codex.app'), runtime: path.join(dir, 'runtime') }, paths = updateEventPaths(config.app);
        const plist = updateEventPlist(config);
        assert.equal(plist.KeepAlive, false); assert.equal(plist.RunAtLoad, true);
        assert.equal(plist.StartInterval, undefined); assert.equal(plist.LaunchOnlyOnce, undefined);
        let launched = 0, pauses = 0, resolved = 0;
        const enabled = () => saveJSON(paths.state, { enabled: true, app: config.app, healthyFingerprint: 'original' });
        const defaults = { fingerprint: () => 'updated', pause: async () => { pauses++; }, busy: () => false,
            resolve: () => { resolved++; return {}; }, healthy: () => false, launch: async () => { launched++; return 123; } };
        assert.equal(await promptAfterAppChange(config, defaults), 'disabled');
        enabled(); assert.equal(await promptAfterAppChange(config, { ...defaults, busy: () => true }), 'busy'); assert.equal(launched, 0);
        assert.equal(await promptAfterAppChange(config, { ...defaults, fingerprint: () => 'original' }), 'unchanged');
        let index = 0; const changing = [null, 'partial', 'replacement', 'updated', 'updated'];
        assert.equal(await promptAfterAppChange(config, { ...defaults, fingerprint: () => { const value = changing[index++]; if (!value) throw new Error('incomplete'); return value; } }), 'prompted');
        assert.equal(launched, 1); assert.equal(resolved, 1); assert.equal(pauses, 4);
        assert.equal(readJSON(paths.state).promptFingerprint, 'updated');
        assert.equal(await promptAfterAppChange(config, defaults), 'unchanged'); assert.equal(launched, 1);
        enabled(); assert.equal(await promptAfterAppChange(config, { ...defaults, healthy: () => true }), 'healthy');
        assert.equal(readJSON(paths.state).healthyFingerprint, 'updated'); assert.equal(launched, 1);
        enabled(); assert.equal(await promptAfterAppChange(config, { ...defaults, fingerprint: () => { throw new Error('missing'); }, attempts: 2 }), 'not-ready'); assert.equal(launched, 1);
        enabled(); let stopped = false;
        assert.equal(await promptAfterAppChange(config, { ...defaults, pause: async () => { stopped = true; saveJSON(paths.state, { enabled: false }); } }), 'disabled');
        assert.equal(stopped, true); assert.equal(launched, 1);
    } finally { if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an exited wizard does not permanently suppress recovery for an unpatched bundle', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-event-retry-'));
    const previousHome = process.env.ARTL_CODEX_STATE_HOME; process.env.ARTL_CODEX_STATE_HOME = dir;
    try {
        const config = { app: path.join(dir, 'Codex.app'), runtime: path.join(dir, 'runtime') }, paths = updateEventPaths(config.app);
        const now = Date.parse('2026-10-25T08:00:00Z');
        const seed = () => saveJSON(paths.state, { enabled: true, app: config.app, promptFingerprint: 'unpatched',
            promptedAt: new Date(now - 600000).toISOString(), promptPid: 123 });
        let launched = 0, checked = 0;
        const options = { fingerprint: () => 'unpatched', pause: async () => {}, busy: () => false,
            resolve: () => ({}), healthy: () => { checked++; return false; },
            launch: async () => { launched++; return 456; }, now: () => now, wizardRunning: () => false };
        seed();
        assert.equal(await promptAfterAppChange(config, options), 'prompted');
        assert.equal(launched, 1); assert.equal(checked, 1);
        assert.equal(readJSON(paths.state).promptPid, 456);
        assert.equal(await promptAfterAppChange(config, options), 'unchanged', 'recent prompts debounce file-event bursts');
        seed();
        assert.equal(await promptAfterAppChange(config, { ...options, wizardRunning: () => true }), 'unchanged', 'an existing wizard is reused');
        seed();
        assert.equal(await promptAfterAppChange(config, { ...options, healthy: () => true }), 'healthy', 'retry verifies actual files before prompting');
        seed();
        await assert.rejects(promptAfterAppChange(config, { ...options, launch: async () => { throw new Error('UI unavailable'); } }), /UI unavailable/);
        assert.equal(readJSON(paths.state).promptPid, 123, 'failed spawn must not acknowledge a new prompt');
    } finally { if (previousHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = previousHome; fs.rmSync(dir, { recursive: true, force: true }); }
});
