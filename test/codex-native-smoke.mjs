// Runs only an already prepared staging copy, with isolated Electron user data.
// It never starts, quits or modifies the installed Codex bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const manifest = process.argv[2];
if (!manifest || !process.env.ARTL_PLAYWRIGHT_MODULE) throw new Error('Provide a staging manifest and ARTL_PLAYWRIGHT_MODULE.');
const stage = JSON.parse(fs.readFileSync(manifest));
assert.equal(path.dirname(stage.staging), path.dirname(stage.bundle.app));
assert.ok(path.basename(stage.staging).startsWith('.rasta-stage-'));
assert.equal(path.dirname(stage.stagedApp), stage.staging);
const { chromium } = await import(pathToFileURL(process.env.ARTL_PLAYWRIGHT_MODULE).href);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-native-profile-'));
// Optionally retain existing renderer preferences in a disposable profile;
// this avoids waiting for first-run initialization in the standalone copy.
if (process.env.ARTL_NATIVE_PROFILE_SOURCE) {
    for (const name of ['Local State', 'Preferences', 'Local Storage', 'Session Storage']) {
        const source = path.join(process.env.ARTL_NATIVE_PROFILE_SOURCE, name);
        if (fs.existsSync(source)) fs.cpSync(source, path.join(profile, name), { recursive: true });
    }
}
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const executable = path.join(stage.stagedApp, path.relative(stage.bundle.app, stage.bundle.executable));
const viaOpen = process.env.ARTL_NATIVE_VIA_OPEN === '1';
let log = '', exitState, browser;
const testEnvironment = { ...process.env, CODEX_ELECTRON_USER_DATA_PATH: profile };
// Desktop task variables point to the running app's CLI and tool session.
// A normal launch from Finder does not inherit these routing overrides.
for (const name of ['CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_CLI_PATH', 'CODEX_MCP_NODE_PATH', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
    'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY', 'CODEX_CI', 'CODEX_VERSION', 'CODEX_PERMISSION_PROFILE']) delete testEnvironment[name];
const browserArguments = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'];
const child = spawn(viaOpen ? '/usr/bin/open' : executable,
    viaOpen ? ['-n', '--env', `CODEX_ELECTRON_USER_DATA_PATH=${profile}`, stage.stagedApp, '--args', ...browserArguments] : browserArguments, {
    env: testEnvironment, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', bytes => { log = (log + bytes).slice(-16000); });
child.stderr.on('data', bytes => { log = (log + bytes).slice(-16000); });
child.on('exit', (code, signal) => { if (!viaOpen || code !== 0) exitState = { code, signal }; });
child.on('error', error => { exitState = { error: error.message }; });
try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        if (exitState) break;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
            const targets = await response.json();
            if (targets.some(target => target.type === 'page' && target.url.startsWith('app://-/'))) { ready = true; break; }
        } catch {}
        await delay(250);
    }
    if (!ready) throw new Error(`Staged Codex did not open: ${JSON.stringify(exitState)} ${log.slice(-3500)}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    await delay(3000);
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('app://-/'));
    const auxiliary = /character|avatar|dictation|spotlight|screen-overlay|browser-comment|snap-guides/;
    const page = pages.find(page => !auxiliary.test(new URL(page.url()).searchParams.get('initialRoute') || ''));
    const loadingFailures = [];
    page.on('pageerror', error => loadingFailures.push(error.message.replace(/https?:\/\/\S+/g, '<URL>')));
    page.on('requestfailed', request => loadingFailures.push(request.failure()?.errorText));
    console.log(await Promise.all(pages.map(async page => ({ route: (new URL(page.url()).searchParams.get('initialRoute') || '/').split('/').slice(0,2).join('/'), rootChildren: await page.evaluate(() => document.getElementById('root')?.childElementCount) }))));
    assert.ok(page);
    try {
        await page.waitForFunction(() => document.getElementById('root')?.querySelector('button, input, [role=button]'), null, { timeout: 20000 });
    } catch (error) {
        console.log(await page.evaluate(() => ({ widget: !!document.querySelector('.artl-widget-container'),
            rootShapes: [...(document.getElementById('root')?.children || [])].map(el => ({ tag: el.tagName, class: el.className, children: el.childElementCount })),
            readyState: document.readyState })));
        console.log({ loadingFailures, startupErrors: log.split('\n').filter(line => /error|fatal|failed|exception|spawn/i.test(line)).map(line => line.replace(/https?:\/\/\S+/g, '<URL>')).slice(-8) });
        throw error;
    }
    await page.waitForSelector('.artl-widget-container', { timeout: 20000 });
    assert.equal(await page.locator('.artl-widget-container').count(), 1);
    await page.locator('.artl-widget-trigger').click();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.artl-widget-panel')).opacity) > 0.99);
    await page.locator('#artl-toggle-btn').click();
    assert.equal(await page.locator('#artl-toggle-btn').evaluate(element => element.classList.contains('active')), false);
    await page.locator('#artl-toggle-btn').click();
    assert.equal(await page.locator('#artl-toggle-btn').evaluate(element => element.classList.contains('active')), true);
    await page.locator('#artl-size').click();
    await page.getByRole('option', { name: '18', exact: true }).click();
    await page.locator('.artl-widget-trigger').click();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('root')?.querySelector('button, input, [role=button]'), null, { timeout: 20000 });
    await page.waitForSelector('.artl-widget-container', { timeout: 20000 });
    await page.locator('.artl-widget-trigger').click();
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.artl-widget-panel')).opacity) > 0.99);
    assert.equal(await page.locator('#artl-size').textContent(), '18');
    // Exercise the exact user-bubble and question shapes in the native
    // renderer without sending a chat message or submitting an AI request.
    const content = fs.readFileSync(new URL('./fixtures/codex-content.html', import.meta.url), 'utf8');
    await page.evaluate(html => {
        const fixture = document.createElement('div'); fixture.id = 'artl-content-fixture';
        fixture.innerHTML = html; document.body.appendChild(fixture);
    }, content);
    await page.waitForFunction(() => document.getElementById('sent-fa').dir === 'rtl' && document.getElementById('mcp-option').dir === 'rtl');
    await page.evaluate(async () => { await document.fonts.ready; });
    assert.match(await page.locator('#sent-fa').evaluate(el => getComputedStyle(el).fontFamily), /Vazir/);
    assert.equal(await page.locator('#question-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#multi-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#button-option').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.match(await page.locator('#queue-fa').evaluate(el => getComputedStyle(el).fontFamily), /Vazir/);
    assert.equal(await page.locator('#queue-fa').evaluate(el => getComputedStyle(el).direction), 'rtl');
    assert.equal(await page.locator('#queue-preview').evaluate(el => getComputedStyle(el).direction), 'rtl');
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable'); await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sent-fa' });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => /Vazir/.test(font.familyName) && font.isCustomFont && font.glyphCount > 0));
    await page.evaluate(() => document.getElementById('artl-content-fixture').remove());
    const result = { nativeStarted: true, originalInterfaceMounted: true, nativeWidgetVisible: true, controlsWork: true, settingsSurviveReload: true,
        sentPersianGlyphsUseCustomFont: true, questionChoicesRTL: true, mcpQuestionsRTL: true,
        queuedMessagesStyled: true,
        originalLogicPreserved: stage.report.originalDataHash === stage.report.preservedDataHash, installedAppChanged: false };
    fs.writeFileSync(path.join(path.dirname(manifest), 'native-validation.json'), JSON.stringify(result, null, 2) + '\n');
    if (process.env.ARTL_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.ARTL_BROWSER_SCREENSHOT });
    console.log(result);
} finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await delay(1500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    const commands = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
    for (const row of commands.split('\n')) {
        const match = row.trim().match(/^(\d+) (.+)$/);
        if (match && match[2].startsWith(`${stage.stagedApp}/Contents/`)) try { process.kill(Number(match[1]), 'SIGTERM'); } catch {}
    }
    fs.rmSync(profile, { recursive: true, force: true });
}
