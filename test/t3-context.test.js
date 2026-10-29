import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createT3MessageContext } from '../bin/payloads/t3-message-context.js';
import { guiPaths } from '../bin/lib/gui-runtime.js';
import { fontPaths } from '../bin/lib/font-preferences.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeGUIData, finishGUIUninstall } from '../bin/lib/gui-uninstall.js';
import { releaseConfiguration } from '../bin/lib/gui-updates.js';

it('keys T3 directions by environment, thread and stable assistant ID', () => {
    const root = { getClientRects: () => [1], contains: () => true };
    const listeners = new Map();
    const window = { location: { protocol: 't3code:', hostname: 'app', pathname: '/local/thread-1' }, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) };
    let roots = [root];
    const context = createT3MessageContext({ document: { querySelectorAll: () => roots }, window, changed() {} });
    const row = { getAttribute: () => 'reply-1', closest: selector => selector === '.messages-timeline-scroll' ? root : null };
    const key = context.keyFor(row, context.current());
    window.location.pathname = '/remote/thread-1';
    assert.notEqual(context.keyFor(row, context.current()), key);
    window.location.pathname = '/local/thread-2';
    assert.notEqual(context.keyFor(row, context.current()), key);
    roots = [root, root]; assert.equal(context.current(), null);
    roots = [root]; window.location.protocol = 'https:'; assert.equal(context.current(), null);
    context.dispose(); assert.equal(listeners.size, 0);
});

it('isolates T3 settings, fonts, jobs and backups from Codex', () => {
    const old = process.env.ARTL_TARGET;
    try {
        process.env.ARTL_TARGET = 'codex'; const codex = guiPaths(), codexFonts = fontPaths();
        process.env.ARTL_TARGET = 't3'; const t3 = guiPaths(), t3Fonts = fontPaths();
        assert.notEqual(t3.support, codex.support);
        assert.notEqual(t3.jobs, codex.jobs);
        assert.notEqual(t3Fonts.preferences, codexFonts.preferences);
        assert.deepEqual(releaseConfiguration().supportedAppVersions, ['0.1.4']);
        assert.match(releaseConfiguration().feedUrl, /\/rasta-t3-release\.json$/);
        process.env.ARTL_TARGET = 'codex';
        assert.match(releaseConfiguration().feedUrl, /\/rasta-release\.json$/);
        assert.notEqual(releaseConfiguration().feedUrl, releaseConfiguration().t3FeedUrl);
    } finally { if (old === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = old; }
});

it('T3 uninstall preserves Codex files and its update registration', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-t3-isolation-'));
    const oldTarget = process.env.ARTL_TARGET, oldHome = process.env.ARTL_CODEX_STATE_HOME;
    try {
        process.env.ARTL_CODEX_STATE_HOME = home;
        process.env.ARTL_TARGET = 'codex'; const codex = guiPaths();
        fs.mkdirSync(codex.support, { recursive: true }); fs.writeFileSync(codex.config, 'keep');
        process.env.ARTL_TARGET = 't3'; const t3 = guiPaths();
        fs.mkdirSync(t3.support, { recursive: true }); fs.writeFileSync(t3.config, 'remove');
        const agents = path.join(home, 'Library/LaunchAgents'); fs.mkdirSync(agents, { recursive: true });
        const codexAgent = path.join(agents, 'dev.rasta.update.aaaaaaaaaaaa.plist');
        const t3Agent = path.join(agents, 'dev.rasta.update.bbbbbbbbbbbb.plist');
        fs.writeFileSync(codexAgent, codex.support + '/node'); fs.writeFileSync(t3Agent, t3.support + '/node');
        removeGUIData({ run: () => '' });
        await finishGUIUninstall({ id: 'fixture' }, { waitForWindow: false });
        assert.equal(fs.readFileSync(codex.config, 'utf8'), 'keep');
        assert.equal(fs.existsSync(codexAgent), true); assert.equal(fs.existsSync(t3Agent), false);
        assert.equal(fs.existsSync(t3.support), false);
    } finally {
        if (oldTarget === undefined) delete process.env.ARTL_TARGET; else process.env.ARTL_TARGET = oldTarget;
        if (oldHome === undefined) delete process.env.ARTL_CODEX_STATE_HOME; else process.env.ARTL_CODEX_STATE_HOME = oldHome;
        fs.rmSync(home, { recursive: true, force: true });
    }
});
