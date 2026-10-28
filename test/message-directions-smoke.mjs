import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { buildCodexPayload, resolveCodexApp } from '../bin/lib/codex.js';
import { patchHtml } from '../bin/lib/html.js';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Provide ARTL_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const content = fs.readFileSync(new URL('./fixtures/codex-message-directions.html', import.meta.url), 'utf8');
const bundle = process.env.ARTL_USE_CODEX_CSS === '1' ? resolveCodexApp() : null;
const cssFiles = bundle ? asar.listPackage(bundle.archive).filter(name => /^\/webview\/assets\/app-(initial|primary|shared)-[^/]+\.css$/.test(name)) : [];
if (process.env.ARTL_USE_CODEX_CSS === '1') assert.ok(cssFiles.length, 'host CSS is available');
const bootstrap = `window.emitRoute = (conversationId = 'thread-a', hostId = 'local') => window.dispatchEvent(new CustomEvent('codex-message-from-view', { detail: { type: 'app-shell-shortcut-state-changed', quickChatAppshotThreadTarget: conversationId === null ? null : { conversationId, hostId } } })); window.emitRoute();`;
const css = `body{margin:24px;font:16px system-ui;background:#fafafa;color:#27252d}main{max-width:760px;margin:auto}.thread-scroll-container{min-height:240px}#response-a,#response-b{display:flex;flex-direction:column;padding:16px;border-bottom:1px solid #ddd}p{margin:8px 0}pre{padding:12px;background:#eee}textarea{width:100%;min-height:50px}:root[data-theme=dark] body{background:#212026;color:#f4f3f7}:root[data-theme=dark] pre{background:#303035}:root[data-theme=dark] #response-a,:root[data-theme=dark] #response-b{border-color:#44394f}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:">${cssFiles.map(file => `<link rel="stylesheet" href="${file.slice('/webview'.length)}">`).join('')}<style>${css}</style></head><body>${content}<script type="module" src="./original.js"></script></body></html>`;
const payload = buildCodexPayload();
const server = http.createServer((request, response) => {
    const asset = '/webview' + new URL(request.url, 'http://localhost').pathname;
    if (bundle && (cssFiles.includes(asset) || /^\/webview\/assets\/[^/]+\.woff2?$/.test(asset))) {
        try { response.setHeader('Content-Type', asset.endsWith('.css') ? 'text/css' : 'font/woff2'); response.end(asar.extractFile(bundle.archive, asset.slice(1))); return; }
        catch { response.writeHead(404); response.end(); return; }
    }
    if (request.url === '/agent-rtl-payload.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(payload); }
    else if (request.url === '/original.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(bootstrap); }
    else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(patchHtml(html).html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
const prefix = 'agent-rtl:message-direction:v1:';
const key = (thread, message) => prefix + JSON.stringify(['codex', 'local', thread, message]);
const output = new URL('../dist/message-direction-preview/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-message-profile-'));
let persistent;
try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    context.on('page', tab => tab.on('pageerror', error => errors.push(error.message)));
    page.on('pageerror', error => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    const controls = page.locator('.artl-message-direction-control');
    const trigger = id => page.locator(`#${id} .artl-message-direction-control button`);
    const direction = (id, expected) => page.waitForFunction(([id, value]) => document.getElementById(id).getAttribute('dir') === value, [id, expected]);
    const choose = async (id, label) => { await page.locator(`#${id}`).hover(); await trigger(id).click(); await page.getByRole('menuitemradio', { name: label, exact: true }).click(); };
    await controls.first().waitFor();
    assert.equal(await controls.count(), 2);
    assert.equal(await page.locator('#synthetic .artl-message-direction-control, #positional .artl-message-direction-control, [data-user-message-bubble] .artl-message-direction-control').count(), 0);
    await trigger('response-a').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('menuitemradio', { name: 'Default', exact: true }).getAttribute('aria-checked'), 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await direction('en', 'rtl');
    assert.equal(await trigger('response-a').getAttribute('data-direction'), 'rtl');
    assert.equal(await page.locator('#other-en').getAttribute('dir'), 'ltr');
    assert.equal(await page.locator('#response-a').getAttribute('dir'), null);
    assert.equal(await page.locator('#code').getAttribute('dir'), null);
    await choose('response-a', 'LTR');
    await direction('fa', 'ltr');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key('thread-a', 'message-a')), 'ltr');
    await page.evaluate(() => document.getElementById('response-a').setAttribute('data-response-annotation-target', 'changed-message'));
    await direction('fa', 'rtl');
    assert.equal(await trigger('response-a').getAttribute('data-direction'), 'default');
    await page.evaluate(() => document.getElementById('response-a').setAttribute('data-response-annotation-target', 'message-a'));
    await direction('fa', 'ltr');

    await page.reload();
    await direction('fa', 'ltr');
    assert.equal(await trigger('response-a').getAttribute('aria-label'), 'Text direction: LTR');
    await page.evaluate(() => {
        const previous = document.getElementById('response-a');
        const replacement = previous.cloneNode(true);
        replacement.querySelector('.artl-message-direction-control').remove();
        replacement.querySelector('#fa').setAttribute('dir', 'auto');
        replacement.querySelector('#fa').removeAttribute('style');
        previous.replaceWith(replacement);
        const stream = document.createElement('p'); stream.id = 'stream'; stream.textContent = 'متن تازه در پاسخ';
        replacement.querySelector('[data-markdown-text-style]').appendChild(stream);
    });
    await direction('stream', 'ltr');
    assert.equal(await page.locator('#response-a .artl-message-direction-control').count(), 1);
    assert.equal(await page.locator('#user').getAttribute('dir'), 'rtl', 'user messages keep their ordinary automatic direction');
    assert.equal(await page.locator('#typed').getAttribute('dir'), 'rtl');
    const stored = await page.evaluate(prefix => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)), prefix);
    assert.deepEqual(stored, [[key('thread-a', 'message-a'), 'ltr']]);
    await page.evaluate(() => { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(document.getElementById('fa')); selection.removeAllRanges(); selection.addRange(range); });
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'پاسخ فارسی برای بررسی خوانایی');

    await page.locator('.artl-widget-trigger').click();
    await page.locator('#artl-force-btn').click();
    await direction('other-en', 'rtl');
    await direction('fa', 'ltr');
    await choose('response-a', 'Default');
    await direction('en', 'rtl');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key('thread-a', 'message-a')), null);
    await choose('response-a', 'LTR');
    await page.locator('.artl-widget-trigger').click();
    await page.locator('#artl-toggle-btn').click();
    assert.equal(await controls.count(), 0);
    assert.equal(await page.locator('#fa').getAttribute('dir'), 'auto');
    await page.locator('#artl-toggle-btn').click();
    await direction('fa', 'ltr');
    await page.locator('#artl-force-btn').click();
    await page.locator('.artl-widget-trigger').click();

    // Remote and unknown metadata withdraw the override even with identical IDs.
    await page.evaluate(() => window.emitRoute('thread-a', 'ssh:dev'));
    assert.equal(await controls.count(), 0);
    await direction('fa', 'rtl');
    await page.evaluate(() => window.emitRoute(null));
    assert.equal(await controls.count(), 0);
    await page.evaluate(() => window.emitRoute());
    await direction('fa', 'ltr');
    await page.evaluate(() => document.querySelector('[data-app-shell-active-page]').setAttribute('data-app-shell-active-page', 'false'));
    await page.waitForFunction(() => !document.querySelector('.artl-message-direction-control'));
    await direction('fa', 'rtl');
    await page.evaluate(() => document.querySelector('[data-app-shell-active-page]').setAttribute('data-app-shell-active-page', 'true'));
    await direction('fa', 'ltr');
    await page.evaluate(() => {
        window.emitRoute(null);
        document.querySelectorAll('[data-response-annotation-conversation]').forEach(el => el.setAttribute('data-response-annotation-conversation', 'thread-b'));
        window.emitRoute('thread-b');
    });
    await direction('fa', 'rtl');
    await choose('response-a', 'RTL');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), key('thread-b', 'message-a')), 'rtl');
    await page.reload();
    await direction('fa', 'ltr');

    // A right-panel response has no main-route host claim, even with the same ID.
    await page.evaluate(() => {
        const panel = document.getElementById('right-panel');
        panel.innerHTML = '<div class="thread-scroll-container"><div data-response-annotation-conversation="thread-a" data-response-annotation-target="panel-message"><div data-markdown-text-style="assistant-message"><p>پاسخ پنجره کناری</p></div></div></div>';
    });
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#right-panel .artl-message-direction-control').count(), 0);
    assert.equal(await controls.count(), 2);
    await page.evaluate(() => {
        const copy = document.getElementById('response-a').cloneNode(true);
        copy.id = 'duplicate';
        copy.querySelector('.artl-message-direction-control').remove();
        document.getElementById('transcript').appendChild(copy);
    });
    await page.waitForFunction(() => !document.querySelector('#response-a .artl-message-direction-control'));
    assert.equal(await page.locator('#duplicate .artl-message-direction-control').count(), 0);
    await page.evaluate(() => document.getElementById('duplicate').remove());
    await trigger('response-a').waitFor();

    const second = await context.newPage();
    await second.goto(url);
    await second.locator('#response-a .artl-message-direction-control').waitFor();
    await choose('response-a', 'RTL');
    await second.waitForFunction(() => document.getElementById('en').dir === 'rtl');
    await second.close();
    await choose('response-a', 'LTR');

    // Saving errors keep the prior direction and report the failure in place.
    await page.evaluate(() => {
        window.originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) { if (key.startsWith('agent-rtl:message-direction:v1:')) throw new Error('Quota'); return window.originalSetItem.call(this, key, value); };
    });
    await choose('response-a', 'RTL');
    assert.equal(await page.getByRole('status').last().textContent(), 'Couldn’t save direction. Try again.');
    await direction('fa', 'ltr');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await trigger('response-a').evaluate(el => document.activeElement === el), true);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });

    // Deleting the preference can fail too; keep the existing direction.
    await page.evaluate(() => {
        window.originalRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function(key) { if (key.startsWith('agent-rtl:message-direction:v1:')) throw new Error('Denied'); return window.originalRemoveItem.call(this, key); };
    });
    await choose('response-a', 'Default');
    assert.equal(await page.getByRole('status').last().textContent(), 'Couldn’t save direction. Try again.');
    await direction('fa', 'ltr');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { Storage.prototype.removeItem = window.originalRemoveItem; });

    await page.locator('#response-a').hover();
    await trigger('response-a').click();
    await page.screenshot({ path: new URL('light.png', output).pathname, fullPage: true });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(100);
    const menuPalette = await page.getByRole('menu').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.notEqual(menuPalette.background, 'rgb(255, 255, 255)', 'open menu follows a dark theme change');
    await page.screenshot({ path: new URL('dark.png', output).pathname, fullPage: true });
    await page.keyboard.press('Escape');
    await page.locator('.artl-widget-trigger').click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await page.getByRole('option', { name: 'Light', exact: true }).click();
    await page.getByRole('button', { name: 'Lavender accent', exact: true }).click();
    await trigger('response-a').click();
    assert.equal(await page.getByRole('menu').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', 'direction menu uses the explicit panel theme');
    const beforePalette = await page.getByRole('menu').evaluate(el => getComputedStyle(el).getPropertyValue('--artl-ink'));
    // An already-open direction menu also observes appearance updates.
    await page.evaluate(() => document.querySelector('[aria-label="Blue accent"]').onclick());
    assert.notEqual(await page.getByRole('menu').evaluate(el => getComputedStyle(el).getPropertyValue('--artl-ink')), beforePalette);
    assert.equal(await page.getByRole('menu').evaluate(el => getComputedStyle(el).getPropertyValue('--artl-accent')).then(value => value.trim()), '#79adeb');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator('#response-a').hover();
    await trigger('response-a').click();
    const bounds = await page.getByRole('menu').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360 && bounds.y >= 0 && bounds.y + bounds.height <= 640);
    await page.screenshot({ path: new URL('narrow.png', output).pathname, fullPage: true });
    await page.evaluate(() => window.__agentRTLPro.dispose());
    assert.equal(await controls.count(), 0);
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.locator('#artl-message-direction-style').count(), 0);
    await page.evaluate(() => window.emitRoute());
    assert.equal(await controls.count(), 0);
    assert.equal(await page.locator('#fa').getAttribute('dir'), 'auto');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(url);
    await reopened.waitForFunction(() => document.getElementById('fa').dir === 'ltr');
    assert.equal(await reopened.locator('#response-a .artl-message-direction-control').count(), 1);
    const detached = await context.newPage();
    await detached.goto(url + 'detached-window.html');
    await detached.waitForSelector('.artl-widget-container');
    assert.equal(await detached.locator('.artl-message-direction-control').count(), 0);
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Blocked'); }; });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(url);
    await blockedPage.waitForSelector('.artl-widget-container');
    assert.equal(await blockedPage.locator('.artl-message-direction-control').count(), 0);
    await blocked.close();

    // Verify durable disk storage through an actual fixture-browser restart.
    const options = { headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE };
    persistent = await chromium.launchPersistentContext(profile, options);
    const beforeRestart = await persistent.newPage();
    await beforeRestart.goto(url);
    await beforeRestart.locator('#response-a').hover();
    await beforeRestart.locator('#response-a .artl-message-direction-control button').click();
    await beforeRestart.getByRole('menuitemradio', { name: 'LTR', exact: true }).click();
    await beforeRestart.waitForFunction(() => document.getElementById('fa').dir === 'ltr');
    await persistent.close(); persistent = null;
    persistent = await chromium.launchPersistentContext(profile, options);
    const afterRestart = await persistent.newPage();
    await afterRestart.goto(url);
    await afterRestart.waitForFunction(() => document.getElementById('fa').dir === 'ltr');
    assert.equal(await afterRestart.locator('#response-a .artl-message-direction-control button').getAttribute('data-direction'), 'ltr');
    await persistent.close(); persistent = null;
    assert.deepEqual(errors, []);
    console.log(`PASS: canonical local response identity; keyboard menu; independent overrides; streaming/remount/reopen/browser restart; Default/Force/disable; remote/inactive/secondary exclusion; blocked storage/events/errors; disposal; light/dark/narrow layout (${cssFiles.length} host CSS files).`);
} finally {
    if (persistent) await persistent.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
}
