import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { buildCodexPayload, resolveCodexApp } from '../bin/lib/codex.js';
import { patchHtml } from '../bin/lib/html.js';

const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const content = fs.readFileSync(new URL('./fixtures/codex-content.html', import.meta.url), 'utf8');
const bundle = process.env.ARTL_USE_CODEX_CSS === '1' ? resolveCodexApp() : null;
const cssFiles = bundle ? asar.listPackage(bundle.archive).filter(name => /^\/webview\/assets\/app-(initial|primary|shared)-[^/]+\.css$/.test(name)) : [];
if (process.env.ARTL_USE_CODEX_CSS === '1') assert.ok(cssFiles.length, 'installed Codex styles must be available');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:">
${cssFiles.map(name => `<link rel="stylesheet" href="${name.slice('/webview'.length)}">`).join('\n')}
<style>body { font-family: Arial; direction: ltr; } .choice { display: flex; gap: 8px; width: 500px; text-align: left; } .choice-content { flex: 1; } pre, code { font-family: monospace; } .rich-text-user-turn { font-family: Arial; }</style>
</head><body>${content}</body></html>`;
const payload = buildCodexPayload();
const server = http.createServer((request, response) => {
    const asset = `/webview${new URL(request.url, 'http://localhost').pathname}`;
    if (bundle && (cssFiles.includes(asset) || /^\/webview\/assets\/[^/]+\.woff2?$/.test(asset))) {
        try {
            response.setHeader('Content-Type', asset.endsWith('.css') ? 'text/css' : 'font/woff2');
            response.end(asar.extractFile(bundle.archive, asset.slice(1))); return;
        } catch { response.writeHead(404); response.end(); return; }
    }
    response.setHeader('Content-Type', request.url === '/agent-rtl-payload.js' ? 'application/javascript' : 'text/html; charset=utf-8');
    response.end(request.url === '/agent-rtl-payload.js' ? payload : patchHtml(html).html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForSelector('.artl-widget-container');
    await page.evaluate(async () => { await document.fonts.ready; });
    const result = await page.evaluate(() => {
        const style = id => getComputedStyle(document.getElementById(id));
        return { sentFont: style('sent-fa').fontFamily, optionDirection: style('question-option').direction,
            multiDirection: style('multi-option').direction, mcpDirection: style('mcp-option').direction,
            optionFont: style('question-label').fontFamily, queueFont: style('queue-fa').fontFamily,
            queueDirection: style('queue-fa').direction, queuePreviewDirection: style('queue-preview').direction };
    });
    console.log({ ...result, originalCodexStylesheets: cssFiles.length });
    assert.match(result.sentFont, /Vazir/, 'sent Persian messages must use the configured Persian font');
    assert.equal(result.optionDirection, 'rtl', 'the complete choice row must be RTL, including its marker');
    assert.equal(result.multiDirection, 'rtl');
    assert.equal(result.mcpDirection, 'rtl');
    assert.match(result.optionFont, /Vazir/);
    assert.match(result.queueFont, /Vazir/, 'queued messages must use the same Persian font before submission');
    assert.equal(result.queueDirection, 'rtl');
    assert.equal(result.queuePreviewDirection, 'rtl');
    assert.equal(await page.locator('#queue-en').evaluate(el => getComputedStyle(el).direction), 'ltr');
    assert.equal(await page.locator('#queue-steer').getAttribute('dir'), null);
    assert.equal(await page.locator('#queue-delete').getAttribute('dir'), null);
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    for (const selector of ['#sent-fa', '#queue-fa', '#queue-preview']) {
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
        const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.some(font => /Vazir/.test(font.familyName) && font.isCustomFont && font.glyphCount > 0), `${selector}: Persian glyphs must render with the embedded font`);
    }
    assert.equal(await page.locator('#english-option').evaluate(el => getComputedStyle(el).direction), 'ltr');
    assert.equal(await page.locator('#button-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#question-option').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('#mcp-radio').isChecked(), false);
    await page.locator('#mcp-option').click();
    assert.equal(await page.locator('#mcp-radio').isChecked(), true, 'native radio selection must still work');
    assert.equal(await page.locator('#content-chrome').getAttribute('dir'), null);
    assert.equal(await page.locator('#sent-code').getAttribute('dir'), null);
    assert.match(await page.locator('#sent-code').evaluate(el => getComputedStyle(el).fontFamily), /monospace/);
    assert.equal(await page.locator('#question-marker').evaluate(el => el.getBoundingClientRect().left),
        await page.locator('#question-option').evaluate(el => el.getBoundingClientRect().right) - await page.locator('#question-marker').evaluate(el => el.getBoundingClientRect().width));
    await page.locator('.artl-widget-trigger').click();
    await page.locator('#artl-size').click();
    await page.getByRole('option', { name: '18', exact: true }).click();
    assert.equal(await page.locator('#sent-fa').evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.equal(await page.locator('#queue-fa').evaluate(el => getComputedStyle(el).fontSize), '18px');
    await page.locator('#artl-force-btn').click();
    assert.equal(await page.locator('#english-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#queue-en').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#content-send').getAttribute('dir'), 'ltr');
    await page.locator('#artl-toggle-btn').click();
    assert.equal(await page.locator('#question-option').getAttribute('dir'), null);
    assert.equal(await page.locator('#mcp-option').getAttribute('dir'), null);
    assert.equal(await page.locator('#queue-fa').getAttribute('dir'), null);
    assert.equal(await page.locator('#sent-fa').evaluate(el => getComputedStyle(el).fontFamily), 'Arial', 'turning off RTL restores the original app font');
    await page.locator('#artl-toggle-btn').click();
    await page.evaluate(() => {
        const bubble = document.createElement('div'); bubble.setAttribute('data-user-message-bubble', 'true');
        bubble.innerHTML = '<div class="rich-text-user-turn"><p id="new-sent">پیام فارسی جدید</p></div>';
        document.body.appendChild(bubble);
        const row = document.createElement('div'); row.id = 'new-option'; row.setAttribute('role', 'radio');
        row.innerHTML = '<span>گزینهٔ جدید</span>';
        document.querySelector('[role="radiogroup"]').appendChild(row);
    });
    await page.waitForFunction(() => document.getElementById('new-sent').dir === 'rtl');
    await page.waitForFunction(() => document.getElementById('new-option').dir === 'rtl');
    assert.match(await page.locator('#new-sent').evaluate(el => getComputedStyle(el).fontFamily), /Vazir/);
    await page.reload();
    await page.waitForSelector('.artl-widget-container');
    assert.equal(await page.locator('#sent-fa').evaluate(el => getComputedStyle(el).fontSize), '18px');
    assert.equal(await page.locator('#question-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    console.log('PASS: sent and queued Persian text, radio/checkbox rows, MCP questions, saved settings and native controls.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
