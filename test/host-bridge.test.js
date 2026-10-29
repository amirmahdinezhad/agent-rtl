import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { eligible } = require('../bin/host/bridge.cjs');
it('keeps T3 and Codex native origins separate and rejects embedded T3 documents', () => {
    assert.equal(eligible('t3code://app/local/thread-1', 't3'), true);
    assert.equal(eligible('t3code://app/', 't3'), true);
    for (const url of ['app://-/index.html', 'https://app/local/thread-1', 't3code://embed/local/thread-1', 't3code://app/document.html']) assert.equal(eligible(url, 't3'), false);
    assert.equal(eligible('t3code://app/local/thread-1'), false);
});
it('limits the native bridge to application shells', () => {
    assert.equal(eligible('app://-/index.html'), true);
    assert.equal(eligible('app://-/detached-window.html'), true);
    for (const url of ['https://example.com', 'app://evil/index.html', 'app://-/document.html']) assert.equal(eligible(url), false);
});
it('exposes only fixed operations in the main shell, never raw IPC or a shell executor', async () => {
    const code = fs.readFileSync(new URL('../bin/host/preload.cjs', import.meta.url), 'utf8');
    for (const [isMainFrame, pathname, exposed] of [[true, '/', true], [false, '/', false], [true, '/document.html', false]]) {
        let bridge;
        vm.runInNewContext(code, { URLSearchParams, process: { isMainFrame }, location: { protocol: 'app:', hostname: '-', pathname },
            require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'rastaNative'); bridge = value; } },
                ipcRenderer: { invoke: async (channel, action) => { assert.equal(channel, 'rasta:control'); return action; } } }) });
        assert.equal(!!bridge, exposed);
        if (bridge) { assert.deepEqual(Object.keys(bridge).sort(), ['cancel', 'check', 'fonts', 'importFont', 'open', 'prepare', 'repair', 'restore', 'selectFont', 'setAppearance', 'status']); assert.equal(await bridge.prepare('ignored-command'), 'prepare'); }
    }
});
it('rejects iframe and unknown IPC actions before spawning a worker', async () => {
    const code = fs.readFileSync(new URL('../bin/host/bridge.cjs', import.meta.url), 'utf8');
    let handler, calls = 0;
    const sandbox = { URL, WeakSet, Set, console, process: { env: {} }, __dirname: '/archive/rasta', module: { exports: {} },
        require: name => name === 'node:path' ? require(name) : { execFile: (_node, _args, _options, done) => { calls++; done(null, '{"ok":true,"value":{"ready":true}}'); } } };
    vm.runInNewContext(code, sandbox);
    sandbox.module.exports.install({ app: { on() {}, whenReady: () => Promise.resolve() },
        ipcMain: { handle: (_name, fn) => { handler = fn; } }, session: { defaultSession: { registerPreloadScript() {} } } },
    { app: '/Applications/ChatGPT.app', runtime: '/support/rtl' });
    const mainFrame = { url: 'app://-/index.html' }, sender = { mainFrame };
    await assert.rejects(handler({ sender, senderFrame: { url: mainFrame.url } }, 'prepare'), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'execute shell'), /Untrusted/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'appearance', { theme: 'dark', accent: 'url(evil)' }), /Invalid Rasta appearance/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'font-select', { id: '../bad' }), /Invalid font/);
    await assert.rejects(handler({ sender, senderFrame: mainFrame }, 'font-import', { name: 'bad.txt', data: 'abc' }), /TTF or OTF/);
    await assert.rejects(handler({ sender, senderFrame: { url: mainFrame.url } }, 'font-import', { name: 'font.ttf', data: 'abc' }), /Untrusted/);
    assert.equal(calls, 0);
    assert.equal((await handler({ sender, senderFrame: mainFrame }, 'status')).ready, true);
    assert.equal(calls, 1);
});
