import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { collectFonts, buildFontList } from './fonts.js';
import { createCodexMessageContext } from '../payloads/codex-message-context.js';
import { createCodexMessageDirections } from '../payloads/codex-message-directions.js';
import { createT3MessageContext } from '../payloads/t3-message-context.js';

export const CODEX_PORT = 9223;
export const CODEX_WORLD = 'agent-rtl-pro';
const FORMATS = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

// Read the bundle identity; ChatGPT.app is accepted only when it actually
// contains Codex. No app resources, signatures or integrity metadata are edited.
export function resolveCodexApp() {
    if (os.platform() !== 'darwin') return null;
    const override = process.env.ARTL_CODEX_APP;
    const candidates = override ? [override] : [
        '/Applications/Codex.app', path.join(os.homedir(), 'Applications/Codex.app'),
        '/Applications/ChatGPT.app', path.join(os.homedir(), 'Applications/ChatGPT.app'),
    ];
    for (const app of candidates) {
        try {
            const archive = path.join(app, 'Contents/Resources/app.asar');
            asar.uncache(archive);
            const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
            if (pkg.name !== 'openai-codex-electron') continue;
            const name = execFileSync('/usr/bin/plutil', [
                '-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist'),
            ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (!name || path.basename(name) !== name) continue;
            const executable = path.join(app, 'Contents/MacOS', name);
            if (fs.existsSync(executable)) return { app, archive, executable, version: pkg.version };
        } catch { /* not an installed Codex bundle */ }
    }
    return null;
}

// Embed fonts in the presentation script so no font download is needed.
export function buildCodexPayload(fonts = collectFonts()) {
    const fa = buildFontList(fonts.fa), en = buildFontList(fonts.en);
    const faces = fonts.all.map(({ family, file, ext }) => {
        const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }[ext];
        const escaped = family.replace(/'/g, "\\'");
        return `@font-face { font-family: '${escaped}'; src: url('data:${mime};base64,${fs.readFileSync(file).toString('base64')}') format('${FORMATS[ext]}'); font-weight: 400; }`;
    }).join('\n');
    return fs.readFileSync(new URL('../payloads/desktop-payload.js', import.meta.url), 'utf8')
        .replace('/* __CODEX_MESSAGE_DIRECTIONS__ */', () => `${createCodexMessageContext.toString()}\n${createT3MessageContext.toString()}\n${createCodexMessageDirections.toString()}`)
        .replace("/* __ARTL_VERSION__ */ ''", JSON.stringify(JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version))
        .replace('__FA_FONTS__', JSON.stringify(fa))
        .replace('__EN_FONTS__', JSON.stringify(en))
        .replace('__DEFAULT_FA__', JSON.stringify(fa[0]?.value || ''))
        .replace('__DEFAULT_EN__', JSON.stringify(en[0]?.value || ''))
        .replace('__FONT_FACES__', () => faces);
}

// Only the local app shell qualifies. Embedded websites, documents, terminals
// and pet frames must never receive the overlay.
export function isCodexPage(target) {
    if (target.type !== 'page') return false;
    try {
        const url = new URL(target.url);
        return url.protocol === 'app:' && url.hostname === '-'
            && ['/', '/index.html', '/detached-window.html', '/detached-window'].includes(url.pathname);
    } catch { return false; }
}

export async function codexPages(port = CODEX_PORT) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`Codex debug endpoint returned HTTP ${response.status}.`);
    const targets = await response.json();
    if (!Array.isArray(targets)) throw new Error('Invalid Codex debug endpoint.');
    return targets.filter(isCodexPage).map(target => {
        const socket = new URL(target.webSocketDebuggerUrl);
        if (socket.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(socket.hostname)
            || socket.port !== String(port)) throw new Error('Codex debug socket must be local.');
        return target;
    });
}

export class DebugClient {
    constructor(socket) {
        this.socket = socket;
        this.pending = new Map();
        this.nextId = 0;
        socket.addEventListener('message', event => {
            let reply;
            try { reply = JSON.parse(event.data); } catch { return; }
            const request = this.pending.get(reply.id);
            if (!request) return;
            clearTimeout(request.timer);
            this.pending.delete(reply.id);
            if (reply.error) request.reject(new Error(reply.error.message));
            else request.resolve(reply.result);
        });
        const failed = () => {
            for (const request of this.pending.values()) {
                clearTimeout(request.timer);
                request.reject(new Error('Codex debug connection closed.'));
            }
            this.pending.clear();
        };
        socket.addEventListener('close', failed);
        socket.addEventListener('error', failed);
    }

    static async connect(url) {
        const socket = new WebSocket(url);
        const client = new DebugClient(socket);
        try {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Codex debug connection timed out.')), 3000);
                socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
                socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to Codex.')); }, { once: true });
            });
            return client;
        } catch (error) { client.close(); throw error; }
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Codex command timed out: ${method}`));
            }, 5000);
            this.pending.set(id, { resolve, reject, timer });
            try { this.socket.send(JSON.stringify({ id, method, params })); }
            catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        });
    }

    async evaluate(expression) {
        const { frameTree } = await this.send('Page.getFrameTree');
        const { executionContextId } = await this.send('Page.createIsolatedWorld', {
            frameId: frameTree.frame.id, worldName: CODEX_WORLD,
        });
        const result = await this.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Rasta payload failed.');
        return result.result?.value;
    }

    close() { this.socket.close(); }
}

const STATE = 'window.__agentRTLPro ? (window.__agentRTLPro.disabled ? "disabled" : (window.__agentRTLPro.pending ? "pending" : "active")) : "inactive"';
const REMOVE = 'window.__agentRTLPro?.dispose(); window.__agentRTLPro = { disabled: true }; "disabled"';

export async function restoreCodex(port = CODEX_PORT) {
    let restored = 0;
    let pages;
    try { pages = await codexPages(port); } catch { return 0; }
    for (const page of pages) {
        const client = await DebugClient.connect(page.webSocketDebuggerUrl);
        try {
            if (['active', 'pending'].includes(await client.evaluate(STATE))) {
                await client.evaluate(REMOVE);
                restored++;
            }
        } finally { client.close(); }
    }
    return restored;
}

