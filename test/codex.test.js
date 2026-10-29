import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { buildCodexPayload, isCodexPage, codexPages, DebugClient, resolveCodexApp, CODEX_WORLD } from '../bin/lib/codex.js';

describe('Codex detection and legacy overlay cleanup', () => {
    it('selects main and detached app shells, excluding embedded pages and pet frames', () => {
        for (const url of ['app://-/index.html', 'app://-/index.html?initialRoute=/threads/123', 'app://-/detached-window.html']) {
            assert.equal(isCodexPage({ type: 'page', url }), true, url);
        }
        for (const url of ['https://chatgpt.com', 'app://fs/@fs/tmp/index.html', 'app://-/assets/pet/frame.html', 'file:///tmp/index.html', 'invalid']) {
            assert.equal(isCodexPage({ type: 'page', url }), false, url);
        }
        assert.equal(isCodexPage({ type: 'iframe', url: 'app://-/index.html' }), false);
    });

    it('embeds fonts without relative bundle assets or unresolved placeholders', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-runtime-'));
        try {
            const file = path.join(dir, 'test.woff2');
            fs.writeFileSync(file, 'font fixture');
            const font = { family: 'Fixture', file, ext: '.woff2' };
            const payload = buildCodexPayload({ fa: [font], en: [], all: [font] });
            assert.ok(payload.includes(`data:font/woff2;base64,${Buffer.from('font fixture').toString('base64')}`));
            // Font-related CSS classes are fine; external font URLs are not.
            assert.doesNotMatch(payload, /url\([^)]*artl-font-/);
            assert.ok(!/__FA_FONTS__|__EN_FONTS__|__DEFAULT_FA__|__DEFAULT_EN__|__FONT_FACES__|__CODEX_MESSAGE_DIRECTIONS__/.test(payload));
            assert.doesNotThrow(() => new Function(payload));
            assert.deepEqual(fs.readdirSync(dir), ['test.woff2']);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });

    it('rejects remote debug sockets and ignores non-Codex pages', async () => {
        let targets;
        const server = http.createServer((request, response) => {
            assert.equal(request.url, '/json/list');
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(targets));
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        try {
            targets = [{ id: 'web', type: 'page', url: 'https://example.com' },
                { id: 'codex', type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/codex` }];
            assert.deepEqual((await codexPages(port)).map(page => page.id), ['codex']);
            targets[1].webSocketDebuggerUrl = 'ws://example.com:9223/devtools/page/codex';
            await assert.rejects(codexPages(port), /must be local/);
            targets = { unexpected: true };
            await assert.rejects(codexPages(port), /Invalid Codex/);
        } finally { await new Promise(resolve => server.close(resolve)); }
    });

    class Socket extends EventTarget {
        sent = [];
        send(message) { this.sent.push(JSON.parse(message)); }
        reply(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
        close() { this.dispatchEvent(new Event('close')); }
    }

    it('matches out-of-order CDP responses and rejects protocol errors', async () => {
        const socket = new Socket();
        const client = new DebugClient(socket);
        const first = client.send('Page.enable');
        const second = client.send('Runtime.evaluate');
        socket.reply({ id: 2, result: { value: 'second' } });
        socket.reply({ id: 1, error: { message: 'command rejected' } });
        assert.deepEqual(await second, { value: 'second' });
        await assert.rejects(first, /command rejected/);
        const pending = client.send('Page.getFrameTree');
        client.close();
        await assert.rejects(pending, /connection closed/);
    });

    it('evaluates the overlay in a named isolated world and surfaces script failures', async () => {
        const socket = new Socket();
        socket.send = message => {
            const request = JSON.parse(message);
            socket.sent.push(request);
            const result = request.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
                : request.method === 'Page.createIsolatedWorld' ? { executionContextId: 17 }
                    : { exceptionDetails: { text: 'payload error' } };
            queueMicrotask(() => socket.reply({ id: request.id, result }));
        };
        const client = new DebugClient(socket);
        await assert.rejects(client.evaluate('fixture'), /payload error/);
        assert.deepEqual(socket.sent[1].params, { frameId: 'main', worldName: CODEX_WORLD });
        assert.equal(socket.sent[2].params.contextId, 17);
        client.close();
    });

    it('detects the renamed Codex bundle without modifying it', { skip: os.platform() !== 'darwin' }, async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-codex-bundle-'));
        const saved = process.env.ARTL_CODEX_APP;
        try {
            const app = path.join(dir, 'ChatGPT.app');
            const contents = path.join(app, 'Contents');
            const source = path.join(dir, 'source');
            fs.mkdirSync(source);
            fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
            fs.mkdirSync(path.join(contents, 'MacOS'));
            fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'openai-codex-electron', version: 'fixture' }));
            fs.writeFileSync(path.join(source, 'backend.js'), 'DO NOT CHANGE THIS LOGIC');
            fs.mkdirSync(path.join(source, 'webview'));
            for (const name of ['index.html', 'detached-window.html']) fs.writeFileSync(path.join(source, 'webview', name), '<html><head></head><body></body></html>');
            fs.writeFileSync(path.join(contents, 'MacOS/ChatGPT'), 'EXECUTABLE SENTINEL');
            const plist = path.join(contents, 'Info.plist');
            fs.writeFileSync(plist, '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>ChatGPT</string></dict></plist>');
            execFileSync('/usr/bin/plutil', ['-lint', plist]);
            const archive = path.join(contents, 'Resources/app.asar');
            await asar.createPackage(source, archive);
            process.env.ARTL_CODEX_APP = app;
            const before = [archive, plist, path.join(contents, 'MacOS/ChatGPT')].map(file => fs.readFileSync(file));
            assert.equal(resolveCodexApp().app, app);
            [archive, plist, path.join(contents, 'MacOS/ChatGPT')].forEach((file, i) => assert.deepEqual(fs.readFileSync(file), before[i]));
            assert.deepEqual(fs.readdirSync(path.join(contents, 'Resources')), ['app.asar']);
            process.env.ARTL_CODEX_APP = path.join(dir, 'nonexistent.app');
            assert.equal(resolveCodexApp(), null, 'an invalid override must not fall back to the real installed app');
            const ordinary = path.join(dir, 'Ordinary ChatGPT.app');
            fs.mkdirSync(path.join(ordinary, 'Contents/Resources'), { recursive: true });
            fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'ordinary-chatgpt', version: 'fixture' }));
            await asar.createPackage(source, path.join(ordinary, 'Contents/Resources/app.asar'));
            process.env.ARTL_CODEX_APP = ordinary;
            assert.equal(resolveCodexApp(), null, 'the app filename alone must not identify Codex');
        } finally {
            if (saved === undefined) delete process.env.ARTL_CODEX_APP;
            else process.env.ARTL_CODEX_APP = saved;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

});
