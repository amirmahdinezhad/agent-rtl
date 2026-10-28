// T3 presentation fixture with CSS from the installed T3 bundle; no live
// conversations, servers or account state are opened by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import * as asar from '@electron/asar';
import { resolveT3App } from '../bin/lib/t3.js';
import { buildCodexPayload } from '../bin/lib/codex.js';
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const folder = path.resolve('dist/design-preview/t3');
fs.mkdirSync(folder, { recursive: true });
const archive = process.env.ARTL_T3_ASAR || resolveT3App()?.archive;
if (!archive || !fs.existsSync(archive)) throw new Error('Install T3 Code or provide ARTL_T3_ASAR.');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const client = 'apps/server/dist/client';
const css = asar.listPackage(archive).find(name => new RegExp('^/' + client + '/assets/main-[^/]+\\.css$').test(name));
assert.ok(css, 'real T3 stylesheet');
const payload = buildCodexPayload();
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/t3.css"></head><body><main><button id="host">T3 action</button><div class="messages-timeline-scroll"><div data-timeline-row-kind="message" data-message-role="assistant" data-message-id="fixture"><div class="chat-markdown"><p>سلام T3</p></div></div></div><div class="composer-tiptap"><div class="ProseMirror" contenteditable="true"><p>سلام</p></div></div></main><script src="/payload.js"></script></body></html>`;
const server = http.createServer((req, res) => {
    const isCSS = req.url === '/t3.css', isJS = req.url === '/payload.js';
    res.setHeader('Content-Type', isCSS ? 'text/css' : isJS ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(isCSS ? asar.extractFile(archive, css.slice(1)) : isJS ? payload : html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARTL_CHROMIUM_EXECUTABLE });
try {
    for (const theme of ['Light', 'Dark']) {
        const page = await browser.newPage({ viewport: { width: 760, height: 1000 }, reducedMotion: 'reduce' });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator('.artl-widget-trigger').click();
        assert.equal(await page.locator('.artl-version').innerText(), 'v' + pkg.version);
        assert.equal(await page.locator('.artl-accent-value').innerText(), 'Lavender');
        assert.equal(await page.getByRole('button', { name: 'Default accent', exact: true }).count(), 0);
        assert.equal(await page.locator('.artl-accent-swatch').count(), 4);
        await page.getByRole('combobox', { name: 'Theme', exact: true }).click();
        await page.getByRole('option', { name: theme, exact: true }).click();
        const hostBefore = await page.locator('#host').evaluate(el => getComputedStyle(el).backgroundColor);
        for (const name of ['Lavender', 'Blue', 'Mint', 'Yellow']) {
            await page.getByRole('button', { name: name + ' accent', exact: true }).click();
            for (const toggle of await page.getByRole('switch').all()) {
                for (let i = 0; i < 2; i++) {
                    await toggle.click();
                    assert.equal(await toggle.locator('.artl-toggle-knob').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
                }
            }
            assert.equal(await page.locator('#host').evaluate(el => getComputedStyle(el).backgroundColor), hostBefore);
        }
        await page.reload(); await page.locator('.artl-widget-trigger').click();
        assert.equal(await page.locator('.artl-accent-value').innerText(), 'Yellow');
        assert.equal(await page.getByRole('combobox', { name: 'Theme', exact: true }).innerText(), theme);
        await page.setViewportSize({ width: 360, height: 900 });
        await page.locator('.artl-widget-panel').screenshot({ path: path.join(folder, 'panel-' + theme.toLowerCase() + '.png') });
        assert.deepEqual(errors, []); await page.close();
    }
    console.log('PASS: real T3 CSS, current source payload, version, Lavender default, four presets, white knobs in both states/themes, host isolation and persistence.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
