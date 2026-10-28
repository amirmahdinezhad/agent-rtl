// Real font decoding/rendering and persistence on owned pages only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { fontPaths, fontPreferences, importFont, selectFont } from '../bin/lib/font-preferences.js';
import { buildCodexPayload } from '../bin/lib/codex.js';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Provide ARTL_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-font-browser-'));
fs.mkdirSync(path.resolve('dist/design-preview'), { recursive: true });
const payload = buildCodexPayload();
const font = fs.readFileSync(new URL('../bin/assets/Vazir-Bold.ttf', import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:">
<style>body{font-family:Arial}aside span,button,input{font-family:Arial}pre,code,.font-mono,.xterm{font-family:monospace}.codicon{font-family:TestIcons}</style></head><body>
<aside><span id="sidebar">گفتگوها</span></aside><button id="host-button">Settings</button><input id="host-input" value="جستجو">
<div data-markdown-text-style><p id="message">سلام، متن فارسی و English text</p><pre><code id="code"><span id="code-span">let x = 1;</span></code></pre><p><code id="inline-code">inline</code></p></div>
<div class="font-mono"><span id="mono">diff text</span></div><div class="xterm"><span id="terminal">terminal output</span></div><span class="codicon" id="icon">X</span>
<script src="/bridge.js"></script><script src="/payload.js"></script></body></html>`;
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/payload.js' ? payload : request.url === '/bridge.js' ? `if(window.fontRPC)window.agentRTLNative={fonts:()=>window.fontRPC('fonts'),importFont:input=>window.fontRPC('import',input),selectFont:id=>window.fontRPC('select',id),status:async()=>({}),check:async()=>({})};` : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    for (const mode of ['native', 'browser']) {
        const paths = fontPaths(path.join(directory, mode));
        const viewport = mode === 'native' ? { width: 920, height: 900 } : { width: 360, height: 800 };
        const context = await browser.newContext({ viewport, colorScheme: mode === 'native' ? 'dark' : 'light', reducedMotion: 'no-preference',
            recordVideo: { dir: path.resolve('dist/design-preview/font-motion'), size: viewport } });
        if (mode === 'native') await context.exposeBinding('fontRPC', (_source, action, input) => action === 'fonts' ? fontPreferences(paths) : action === 'import' ? importFont(input, paths) : selectFont(input, paths));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        await page.locator('.artl-widget-trigger').click();
        const picker = page.getByRole('combobox', { name: 'Font', exact: true });
        await page.waitForFunction(() => !document.getElementById('artl-app-font').disabled);
        assert.equal(await picker.innerText(), 'Vazir');
        for (const selector of ['#sidebar', '#host-button', '#host-input', '#message', '.artl-brand-title']) assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily), /Vazir/, selector);
        const untouched = ['#code', '#code-span', '#inline-code', '#mono', '#terminal', '#icon'];
        const before = await Promise.all(untouched.map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily)));
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add font', exact: true }).click()]);
        await chooser.setFiles({ name: 'MyFont.ttf', mimeType: 'font/ttf', buffer: font });
        await page.waitForFunction(() => !document.getElementById('artl-app-font').disabled && getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('AgentRTLUser_'));
        const customStack = await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily);
        const selected = mode === 'native' ? fontPreferences(paths).selected : await page.evaluate(() => JSON.parse(localStorage.getItem('agent-rtl-fonts')).selected);
        const selectedLabel = mode === 'native' ? 'Vazir (custom)' : 'MyFont';
        assert.equal(await picker.innerText(), selectedLabel, 'a successful import becomes the displayed selection immediately');
        assert.equal(await picker.evaluate(el => el === document.activeElement), true, 'focus returns to the selected font after import');
        await picker.click();
        const importedOption = page.locator(`[role=option][data-value="${selected}"]`);
        assert.equal(await importedOption.count(), 1, 'the imported font is present once in the catalog');
        assert.equal(await importedOption.getAttribute('aria-selected'), 'true', 'the imported font is selected without restarting');
        await page.keyboard.press('Escape');
        for (const selector of ['#host-button', '#host-input', '#message', '.artl-brand-title']) assert.match(await page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily), /AgentRTLUser_/);
        assert.deepEqual(await Promise.all(untouched.map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).fontFamily))), before);
        // Verify actual glyphs came from a custom face, beyond a CSS family string.
        const cdp = await context.newCDPSession(page);
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sidebar' });
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.some(face => face.isCustomFont && /Vazir/.test(face.familyName) && face.glyphCount > 0));
        await page.locator('#artl-toggle-btn').click();
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        assert.equal(await page.locator('#message').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        assert.equal(await page.locator('#artl-app-font-style').count(), 0);
        assert.equal(await picker.innerText(), selectedLabel, 'disabling RTL preserves the selected font for later');
        await page.reload(); await page.locator('.artl-widget-trigger').click();
        await page.waitForFunction(() => !document.getElementById('artl-app-font').disabled);
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        assert.equal(await picker.innerText(), selectedLabel);
        assert.equal(await page.locator('#artl-toggle-btn').getAttribute('aria-checked'), 'false');
        await page.locator('#artl-toggle-btn').click();
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), customStack, 'reenabling RTL restores the saved custom font');
        await page.locator('#artl-toggle-btn').click();
        await page.locator('#artl-font-file').setInputFiles({ name: 'Broken.ttf', mimeType: 'font/ttf', buffer: Buffer.from('broken') });
        await page.getByRole('alert').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        await picker.click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.getElementById('artl-app-font').disabled && !getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('AgentRTLUser_'));
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        await page.locator('#artl-toggle-btn').click();
        assert.match(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), /Vazir/);
        // The original import stays available after a reset and in another window.
        const second = await context.newPage(); await second.goto(url);
        await second.locator('.artl-widget-trigger').click();
        await second.waitForFunction(() => !document.getElementById('artl-app-font').disabled);
        await picker.click(); await page.locator(`[role=option][data-value="${selected}"]`).click();
        await second.waitForFunction(() => getComputedStyle(document.getElementById('sidebar')).fontFamily.includes('AgentRTLUser_'));
        if (mode === 'browser') {
            await page.bringToFront();
            if (await page.locator('.artl-widget-panel').getAttribute('aria-hidden') === 'true') await page.locator('.artl-widget-trigger').click();
            await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'agent-rtl-fonts') throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, key, value); }; });
            await picker.click(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
            await page.getByRole('alert').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), customStack);
            assert.equal(await picker.innerText(), 'MyFont');
        }
        await page.bringToFront();
        if (await page.locator('.artl-widget-panel').getAttribute('aria-hidden') === 'true') await page.locator('.artl-widget-trigger').click();
        await page.screenshot({ path: path.resolve(`dist/design-preview/font-${mode}.png`) });
        assert.deepEqual(errors, []);
        await page.evaluate(() => window.__agentRTLPro.dispose());
        assert.equal(await page.locator('#artl-app-font-style').count(), 0);
        assert.equal(await page.locator('#sidebar').evaluate(el => getComputedStyle(el).fontFamily), 'Arial');
        const video = page.video(); await context.close(); await video.saveAs(path.resolve(`dist/design-preview/font-${mode}-flow.webm`));
    }
    console.log('PASS: shared/native and browser imports, actual custom glyphs, global chrome, code/icons exclusion, reload, cross-window sync, reset, bad files and failed persistence.');
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true });
}
