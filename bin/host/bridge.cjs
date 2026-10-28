'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const CHANNEL = 'agent-rtl:control';
const ACTIONS = new Set(['status', 'check', 'prepare', 'cancel', 'repair', 'restore', 'open', 'ready', 'fonts', 'font-import', 'font-select', 'appearance']);
function eligible(url, target = 'codex') {
    try { const value = new URL(url); if (target === 't3') return value.protocol === 't3code:' && value.hostname === 'app' && (['/', '/index.html'].includes(value.pathname) || /^\/[^/.]+\/[^/.]+\/?$/.test(value.pathname)); return value.protocol === 'app:' && value.hostname === '-'
        && ['/', '/index.html', '/detached-window.html', '/detached-window'].includes(value.pathname)
        && !/character|avatar|dictation|spotlight|screen-overlay|browser-comment|snap-guides/.test(value.searchParams.get('initialRoute') || ''); }
    catch { return false; }
}
function install({ app, ipcMain, session }, config) {
    if (!path.isAbsolute(config.runtime) || !path.isAbsolute(config.app)) throw new Error('Invalid native configuration.');
    const seen = new WeakSet();
    const register = ses => {
        if (seen.has(ses)) return;
        if (typeof ses.registerPreloadScript !== 'function') throw new Error('This Electron version does not support the addon preload.');
        ses.registerPreloadScript({ type: 'frame', id: 'agent-rtl-controls', filePath: path.join(__dirname, 'preload.cjs') });
        seen.add(ses);
    };
    app.on('session-created', register);
    app.whenReady().then(() => register(session.defaultSession)).catch(error => console.error('[Rasta]', error.message));
    let busy = false;
    ipcMain.handle(CHANNEL, async (event, action, input) => {
        const frame = event.senderFrame;
        if (!frame || frame !== event.sender.mainFrame || !eligible(frame.url, config.target) || !ACTIONS.has(action)) throw new Error('Untrusted RTL request.');
        if (action === 'appearance' && (!['auto', 'light', 'dark'].includes(input?.theme) || !['auto', '#ad8cf3', '#79adeb', '#68c7a4', '#e9bf59'].includes(input?.accent))) throw new Error('Invalid RTL appearance.');
        if (action === 'font-select' && (typeof input?.id !== 'string' || !/^(vazir|[a-f0-9]{32})$/.test(input.id))) throw new Error('Invalid font selection.');
        if (action === 'font-import' && (typeof input?.name !== 'string' || input.name.length > 255 || !/\.(ttf|otf)$/i.test(input.name)
            || typeof input.data !== 'string' || input.data.length > 2796204)) throw new Error('Choose a TTF or OTF font up to 2 MB.');
        if (busy && !['status', 'cancel', 'check', 'ready', 'fonts'].includes(action)) throw new Error('Another RTL action is running.');
        const mutating = !['status', 'cancel', 'check', 'ready', 'fonts'].includes(action);
        if (mutating) busy = true;
        try {
            return await new Promise((resolve, reject) => {
                const environment = { ...process.env, ARTL_TARGET: config.target || 'codex' };
                for (const key of Object.keys(environment)) if (key.startsWith('CODEX_') || key === 'ELECTRON_RUN_AS_NODE') delete environment[key];
                const child = execFile(path.join(config.runtime, 'node'), [path.join(config.runtime, 'bin/gui-service.js'), '--rpc', action, '--app', config.app],
                    { env: environment, timeout: action === 'check' ? 45000 : 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
                        try { const response = JSON.parse(stdout); if (!response.ok) reject(new Error(response.error)); else resolve(response.value); }
                        catch (parseError) { reject(error || parseError); }
                    });
                if (action === 'appearance' || action === 'font-import' || action === 'font-select') {
                    child.stdin.on('error', () => {});
                    child.stdin.end(JSON.stringify(action === 'appearance' ? { theme: input.theme, accent: input.accent } : action === 'font-import' ? { name: input.name, data: input.data } : { id: input.id }));
                }
            });
        } finally { if (mutating) busy = false; }
    });
}
module.exports = { install, eligible, ACTIONS };
