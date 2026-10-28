/**
 * Mount persistent direction controls on canonical local assistant responses.
 * The caller supplies the verified active local conversation; an unknown view
 * never inherits identity from another transcript or a stale browser URL.
 * This function is embedded verbatim in the renderer payload: keep it closed.
 */
export function createCodexMessageDirections({ document, window, context, enabled, refresh, icon, beforeOpen }) {
    const PREFIX = 'agent-rtl:message-direction:v1:';
    const TARGET = context?.selector || '[data-response-annotation-conversation][data-response-annotation-target]';
    const OWN = '.artl-message-direction-control, .artl-message-direction-menu';
    const choices = ['Default', 'RTL', 'LTR'];
    const values = [null, 'rtl', 'ltr'];
    const records = new Map();
    let opened = null, serial = 0, storage = null, disposed = false, paletteValues = [];

    const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
        && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
        && !/^turn-index-|^\d+:(?:user|assistant)$/.test(value);
    function identity(element, view) {
        if (context.keyFor) return context.keyFor(element, view);
        if (!view.root.contains(element) || element.closest('.thread-scroll-container') !== view.root
            || element.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area') !== 'main') return null;
        const thread = element.getAttribute('data-response-annotation-conversation');
        const message = element.getAttribute('data-response-annotation-target');
        if (!validId(thread) || !validId(message) || thread !== view.conversationId) return null;
        if (element.closest('pre, code, [contenteditable="true"], [data-user-message-bubble]')) return null;
        if (!element.querySelector('[data-markdown-text-style="assistant-message"]')) return null;
        return PREFIX + JSON.stringify(['codex', 'local', thread, message]);
    }
    function read(key) {
        const value = storage.getItem(key);
        return value === 'rtl' || value === 'ltr' ? value : null;
    }
    function availableStorage() {
        try {
            storage = window.localStorage;
            const key = PREFIX + 'probe';
            storage.setItem(key, '1');
            if (storage.getItem(key) !== '1') return false;
            storage.removeItem(key);
            return true;
        } catch { storage = null; return false; }
    }
    function paint(record) {
        const label = choices[values.indexOf(record.value)];
        record.button.setAttribute('aria-label', 'Text direction: ' + label);
        record.button.title = 'Text direction: ' + label;
        record.control.classList.toggle('has-override', record.value !== null);
        record.button.setAttribute('data-direction', record.value || 'default');
    }
    function readPalette() {
        const widget = document.querySelector('.artl-widget-container');
        if (!widget || !window.getComputedStyle) return [];
        const style = window.getComputedStyle(widget);
        return ['base', 'text', 'muted', 'accent', 'ink', 'line', 'soft'].map(name => ['--artl-' + name, style.getPropertyValue('--artl-' + name).trim()]);
    }
    function palette(element) {
        for (const [name, value] of paletteValues) if (value) element.style.setProperty(name, value);
    }
    function close(restoreFocus = false) {
        if (!opened) return false;
        const previous = opened;
        opened = null;
        previous.menu.remove();
        previous.record.button.setAttribute('aria-expanded', 'false');
        if (restoreFocus && previous.record.button.isConnected) previous.record.button.focus({ preventScroll: true });
        return true;
    }
    function remove(record) {
        if (opened?.record === record) close();
        record.control.remove();
        record.element.classList.remove('artl-message-direction-target');
        records.delete(record.element);
    }
    function positionMenu() {
        if (!opened) return;
        const { menu, record } = opened;
        if (!record.button.isConnected) { close(); return; }
        const rect = record.button.getBoundingClientRect();
        const width = menu.offsetWidth, height = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + 'px';
        const below = rect.bottom + 4;
        menu.style.top = Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : rect.top - height - 4, window.innerHeight - height - 8)) + 'px';
    }
    async function choose(record, index) {
        // Recheck identity at interaction time; React can reuse a message node.
        await context.verify();
        sync();
        if (records.get(record.element) !== record) return;
        const value = values[index];
        try {
            if (value === null) storage.removeItem(record.key);
            else storage.setItem(record.key, value);
            if (read(record.key) !== value) throw new Error('Direction was not saved');
        } catch {
            if (opened) {
                opened.status.textContent = 'Couldn’t save direction. Try again.';
                opened.status.hidden = false;
                positionMenu();
            }
            return;
        }
        close(true);
        refresh();
    }
    async function open(record) {
        await context.verify();
        sync();
        if (records.get(record.element) !== record) return;
        if (opened?.record === record) { close(true); return; }
        close();
        beforeOpen?.();
        const menu = document.createElement('div');
        menu.className = 'artl-message-direction-menu';
        menu.id = record.button.getAttribute('aria-controls');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Message text direction');
        menu.setAttribute('dir', 'ltr');
        menu.setAttribute('lang', 'en');
        menu.setAttribute('data-thread-find-skip', '');
        palette(menu);
        const items = choices.map((label, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.setAttribute('role', 'menuitemradio');
            button.setAttribute('aria-checked', String(values[index] === record.value));
            button.tabIndex = -1;
            button.onclick = event => { event.stopPropagation(); choose(record, index); };
            menu.appendChild(button);
            return button;
        });
        const status = document.createElement('div');
        status.className = 'artl-message-direction-status';
        status.setAttribute('role', 'status');
        status.hidden = true;
        menu.appendChild(status);
        let focused = values.indexOf(record.value);
        menu.onkeydown = event => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (event.key === 'Home') focused = 0;
                else if (event.key === 'End') focused = items.length - 1;
                else focused = (focused + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[focused].focus();
            } else if (event.key === 'Tab') close(true);
        };
        document.body.appendChild(menu);
        opened = { record, menu, status };
        record.button.setAttribute('aria-expanded', 'true');
        positionMenu();
        items[focused].focus({ preventScroll: true });
    }
    function mount(element, key) {
        const control = document.createElement('div');
        control.className = 'artl-message-direction-control';
        control.setAttribute('dir', 'ltr');
        control.setAttribute('lang', 'en');
        control.setAttribute('data-thread-find-skip', '');
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'artl-message-direction-' + (++serial));
        button.appendChild(icon('M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4'));
        control.appendChild(button);
        const record = { element, key, control, button, value: read(key) };
        button.onclick = event => { event.stopPropagation(); open(record); };
        button.onkeydown = event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(record); }
        };
        records.set(element, record);
        element.classList.add('artl-message-direction-target');
        element.appendChild(control);
        palette(control);
        paint(record);
    }
    function sync() {
        if (disposed) return;
        const view = enabled() ? context.current() : null;
        if (!validId(view?.conversationId) || (!storage && !availableStorage())) {
            for (const record of records.values()) remove(record);
            return;
        }
        const current = new Map();
        paletteValues = readPalette();
        // An identity must name one rendered response, never multiple variants.
        const keys = new Map();
        for (const element of document.querySelectorAll(TARGET)) {
            const key = identity(element, view);
            if (!key) continue;
            keys.set(key, (keys.get(key) || 0) + 1);
            current.set(element, key);
        }
        for (const record of records.values()) {
            if (current.get(record.element) !== record.key || keys.get(record.key) !== 1
                || !record.control.isConnected || record.control.parentElement !== record.element) remove(record);
        }
        try {
            for (const [element, key] of current) {
                if (keys.get(key) !== 1) continue;
                const record = records.get(element);
                if (!record) mount(element, key);
                else { record.value = read(key); palette(record.control); paint(record); }
            }
        } catch {
            storage = null;
            for (const record of records.values()) remove(record);
        }
    }
    function outside(event) {
        if (opened && !opened.menu.contains(event.target) && !opened.record.control.contains(event.target)) close();
    }
    function stored(event) {
        if (event.key === null || event.key?.startsWith(PREFIX)) { close(); refresh(); }
    }
    function themeChanged() {
        paletteValues = readPalette();
        for (const record of records.values()) palette(record.control);
        if (opened) palette(opened.menu);
    }
    document.addEventListener('click', outside);
    document.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('storage', stored);
    const themeObserver = new window.MutationObserver(themeChanged);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', themeChanged);
    window.addEventListener('agent-rtl-appearance-change', themeChanged);
    const style = document.createElement('style');
    style.id = 'artl-message-direction-style';
    style.textContent = `
        .artl-message-direction-control, .artl-message-direction-menu {
            --artl-base:#fff; --artl-text:#27252d; --artl-muted:#6b6874; --artl-accent:#9639ed; --artl-line:#e5e4eb; --artl-soft:#f2e9fc;
            box-sizing:border-box; color:var(--artl-text); font:13px/1.5 var(--artl-app-font,Vazir,system-ui,sans-serif); direction:ltr; text-align:left; user-select:none;
        }
        .artl-message-direction-control { display:flex; justify-content:flex-end; align-self:stretch; height:44px; opacity:0; transition:opacity .12s ease-out; }
        .artl-message-direction-target:hover > .artl-message-direction-control, .artl-message-direction-control:focus-within, .artl-message-direction-control.has-override { opacity:1; }
        .artl-message-direction-control button { display:grid; place-items:center; width:44px; min-height:44px; padding:8px 14px; border:0; border-radius:8px; color:var(--artl-muted); background:transparent; cursor:pointer; }
        .artl-message-direction-control svg { display:block; width:16px; height:16px; }
        .artl-message-direction-control.has-override button, .artl-message-direction-control button:hover { color:var(--artl-ink,var(--artl-accent)); background:var(--artl-soft); }
        .artl-message-direction-menu { position:fixed; z-index:1000002; width:148px; padding:4px; border:1px solid var(--artl-line); border-radius:12px; background:var(--artl-base); box-shadow:0 8px 24px #15101f26; }
        .artl-message-direction-menu button { display:block; width:100%; min-height:44px; padding:8px 12px; border:0; border-radius:8px; font:inherit; text-align:left; color:inherit; background:transparent; cursor:pointer; }
        .artl-message-direction-menu button[aria-checked=true] { color:var(--artl-ink,var(--artl-accent)); background:var(--artl-soft); }
        .artl-message-direction-menu button:hover { background:var(--artl-soft); }
        :is(.artl-message-direction-control,.artl-message-direction-menu) button:focus-visible { outline:2px solid var(--artl-ink,var(--artl-accent)); outline-offset:-2px; }
        .artl-message-direction-status { padding:8px; font-size:12px; }
        .artl-message-direction-menu [hidden] { display:none; }
        @media (prefers-reduced-motion:reduce) { .artl-message-direction-control { transition:none; } }
        @media (hover:none) { .artl-message-direction-control { opacity:1; } }
    `;
    document.head.appendChild(style);
    return {
        sync,
        directionFor(element) { return records.get(element.closest(TARGET))?.value || null; },
        owns(element) { return Boolean(element.closest(OWN)); },
        dismiss: close,
        dispose() {
            disposed = true;
            for (const record of records.values()) remove(record);
            style.remove();
            document.removeEventListener('click', outside);
            document.removeEventListener('scroll', positionMenu, true);
            window.removeEventListener('resize', positionMenu);
            window.removeEventListener('storage', stored);
            themeObserver.disconnect();
            media?.removeEventListener?.('change', themeChanged);
            window.removeEventListener('agent-rtl-appearance-change', themeChanged);
        },
    };
}
