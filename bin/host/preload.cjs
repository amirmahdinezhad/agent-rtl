'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Do not expose privileged controls in document embeds, browser tabs or frames.
if (process.isMainFrame && ((location.protocol === 't3code:' && location.hostname === 'app' && (['/', '/index.html'].includes(location.pathname) || /^\/[^/.]+\/[^/.]+\/?$/.test(location.pathname))) || (location.protocol === 'app:' && location.hostname === '-'
    && ['/', '/index.html', '/detached-window.html', '/detached-window'].includes(location.pathname)
    && !/character|avatar|dictation|spotlight|screen-overlay|browser-comment|snap-guides/.test(new URLSearchParams(location.search || '').get('initialRoute') || '')))) {
    if (typeof document !== 'undefined') {
        let attempts = 0;
        const ready = setInterval(() => {
            if (document.querySelector('.artl-widget-trigger')) { clearInterval(ready); ipcRenderer.invoke('agent-rtl:control', 'ready').catch(() => {}); }
            else if (++attempts >= 120) clearInterval(ready);
        }, 500);
    }
    const request = (action, input) => ipcRenderer.invoke('agent-rtl:control', action, input);
    contextBridge.exposeInMainWorld('agentRTLNative', Object.freeze({
        status: () => request('status'), check: () => request('check'), prepare: () => request('prepare'),
        open: () => request('open'), cancel: () => request('cancel'), repair: () => request('repair'), restore: () => request('restore'),
        setAppearance: input => request('appearance', input),
        fonts: () => request('fonts'), importFont: input => request('font-import', input), selectFont: id => request('font-select', { id }),
    }));
}
