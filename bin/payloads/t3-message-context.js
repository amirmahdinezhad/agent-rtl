/** Scope direction overrides to canonical T3 assistant rows and routed threads.
 * Embedded in the renderer: no privileged bridge or vendor router mutation.
 */
export function createT3MessageContext({ document, window, changed }) {
    const selector = '[data-timeline-row-kind="message"][data-message-role="assistant"][data-message-id]';
    const valid = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
    function current() {
        if (window.location.protocol !== 't3code:' || window.location.hostname !== 'app') return null;
        const parts = window.location.pathname.split('/').filter(Boolean).map(value => { try { return decodeURIComponent(value); } catch { return ''; } });
        if (parts.length !== 2 || !parts.every(valid) || ['settings', 'new', 'pull-requests'].includes(parts[0])) return null;
        const roots = [...document.querySelectorAll('.messages-timeline-scroll')].filter(root => root.getClientRects().length > 0);
        return roots.length === 1 ? { conversationId: JSON.stringify(parts), root: roots[0] } : null;
    }
    window.addEventListener('popstate', changed);
    return {
        selector, current, verify() { return Promise.resolve(current()); },
        keyFor(element, view) {
            const id = element.getAttribute('data-message-id');
            if (!valid(id) || !view.root.contains(element) || element.closest('.messages-timeline-scroll') !== view.root
                || element.closest('pre,code,[contenteditable="true"]')) return null;
            return 'rasta:message-direction:v1:' + JSON.stringify(['t3', view.conversationId, id]);
        },
        dispose() { window.removeEventListener('popstate', changed); },
    };
}
