// Optional browser check for the actual HTML script-loading installation path.
// No CDP port, external controller, launcher or background service is used.
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { buildCodexPayload } from '../bin/lib/codex.js';
import { patchHtml } from '../bin/lib/html.js';

if (!process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Set ARTL_PLAYWRIGHT_MODULE to the installed Playwright module path.');
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const fixture = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"></head><body>
<aside><span id="chrome">منوی برنامه</span></aside>
<div data-markdown-text-style="assistant-message"><p id="fa" dir="auto">پاسخ فارسی کدکس</p><p id="en">English reply</p><pre dir="ltr"><code><span id="code">const greeting = 'سلام';</span></code></pre></div>
<div data-codex-composer><div class="ProseMirror" contenteditable="true"><p id="typed">ورودی فارسی</p></div><button id="send">Send</button></div>
<script type="module" src="./original.js"></script></body></html>`;
const payload = buildCodexPayload();
const server = http.createServer((request, response) => {
    if (request.url === '/agent-rtl-payload.js') {
        response.setHeader('Content-Type', 'application/javascript'); response.end(payload);
    } else if (request.url === '/original.js') {
        response.setHeader('Content-Type', 'application/javascript'); response.end('window.originalAppLogic = "unchanged";');
    } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(request.url === '/embedded.html' ? fixture : patchHtml(fixture).html);
    }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector('.artl-widget-container');
    assert.equal(await page.locator('#fa').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('#en').getAttribute('dir'), 'ltr');
    assert.equal(await page.locator('#typed').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('#code').getAttribute('dir'), null);
    assert.equal(await page.locator('#chrome').getAttribute('dir'), null);
    assert.equal(await page.evaluate(() => window.originalAppLogic), 'unchanged');
    await page.evaluate(() => {
        const p = document.createElement('p'); p.id = 'stream'; p.textContent = 'پاسخ در حال تولید';
        document.querySelector('[data-markdown-text-style]').appendChild(p);
    });
    await page.waitForFunction(() => document.getElementById('stream').dir === 'rtl');
    await page.locator('.artl-widget-trigger').click();
    await page.locator('#artl-toggle-btn').click();
    assert.equal(await page.locator('#fa').getAttribute('dir'), 'auto');
    await page.reload();
    await page.waitForSelector('.artl-widget-container');
    assert.equal(await page.locator('#fa').getAttribute('dir'), 'auto', 'disabled setting survives reload');
    await page.locator('.artl-widget-trigger').click();
    await page.locator('#artl-toggle-btn').click();
    await page.locator('#artl-size').click();
    await page.getByRole('option', { name: '18', exact: true }).click();
    assert.equal(await page.locator('#fa').evaluate(element => getComputedStyle(element).fontSize), '18px');
    await page.locator('#artl-force-btn').click();
    assert.equal(await page.locator('#en').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('#send').getAttribute('dir'), 'ltr');
    assert.equal(await page.locator('#code').getAttribute('dir'), null);
    await page.locator('#artl-force-btn').click();
    await page.locator('.artl-widget-trigger').click();
    await page.reload();
    await page.waitForSelector('.artl-widget-container');
    assert.equal(await page.locator('.artl-widget-container').count(), 1);
    const detached = await context.newPage(); await detached.goto(`${url}detached-window.html`);
    await detached.waitForSelector('.artl-widget-container');
    assert.equal(await detached.locator('#fa').getAttribute('dir'), 'rtl');
    const embedded = await context.newPage(); await embedded.goto(`${url}embedded.html`);
    assert.equal(await embedded.locator('.artl-widget-container').count(), 0);
    await detached.close(); await embedded.close();
    await page.close();
    const reopened = await context.newPage(); await reopened.goto(url);
    await reopened.waitForSelector('.artl-widget-container');
    assert.equal(await reopened.locator('#fa').getAttribute('dir'), 'rtl');
    assert.equal(await reopened.locator('#fa').evaluate(element => getComputedStyle(element).fontSize), '18px');
    await reopened.evaluate(async () => { await document.fonts.ready; });
    assert.equal(await reopened.evaluate(() => document.fonts.check('18px Vazir')), true);
    assert.deepEqual(errors, []);
    if (process.env.ARTL_BROWSER_SCREENSHOT) {
        fs.mkdirSync(path.dirname(process.env.ARTL_BROWSER_SCREENSHOT), { recursive: true });
        await reopened.locator('.artl-widget-trigger').click();
        await reopened.waitForFunction(() => Number(getComputedStyle(document.querySelector('.artl-widget-panel')).opacity) >= 0.99);
        await reopened.screenshot({ path: process.env.ARTL_BROWSER_SCREENSHOT });
    }
    console.log('PASS: native HTML script loading, strict CSP, RTL, controls, fonts, saved settings, streaming, detached windows and reopening without an external controller.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
