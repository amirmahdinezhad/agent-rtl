/**
 * Observe Codex's own route metadata without changing its router or IPC bridge.
 * The HTML payload loads before the app's deferred modules. No context is
 * assumed when injected late, when metadata is absent, or in secondary views.
 * Embedded verbatim in the renderer payload: keep helpers inside this function.
 */
export function createCodexMessageContext({ document, window, changed }) {
    const TARGET = '[data-response-annotation-conversation][data-response-annotation-target]';
    let route = null, disposed = false;
    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
    function primaryRoot() {
        if (!['/', '/index.html'].includes(window.location.pathname)) return null;
        const shells = Array.from(document.querySelectorAll('main[data-app-shell-main-surface="default"]'))
            .filter(shell => !shell.closest('[data-app-shell-active-page="false"]') && shell.getClientRects().length > 0);
        if (shells.length !== 1) return null;
        const roots = Array.from(shells[0].querySelectorAll('.thread-scroll-container'))
            .filter(root => !root.closest('[data-app-shell-active-page="false"]') && root.getClientRects().length > 0
                && root.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area') === 'main');
        return roots.length === 1 ? roots[0] : null;
    }
    function current() {
        if (!route) return null;
        const root = primaryRoot();
        if (!root) return null;
        const conversations = new Set(Array.from(root.querySelectorAll(TARGET))
            .filter(element => element.closest('.thread-scroll-container') === root
                && element.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area') === 'main')
            .map(element => element.getAttribute('data-response-annotation-conversation')));
        return conversations.size === 1 && conversations.has(route) ? { conversationId: route, root } : null;
    }
    function receive(event) {
        if (disposed || event.detail?.type !== 'app-shell-shortcut-state-changed') return;
        const target = event.detail.quickChatAppshotThreadTarget;
        // An explicit local host is required; missing host metadata is unknown.
        const next = target?.hostId === 'local' && validId(target.conversationId) ? target.conversationId : null;
        if (next !== route) { route = next; changed(); }
    }
    window.addEventListener('codex-message-from-view', receive);
    return {
        current,
        verify() { return Promise.resolve(current()); },
        dispose() { disposed = true; route = null; window.removeEventListener('codex-message-from-view', receive); },
    };
}
