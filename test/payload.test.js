import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAYLOAD = path.join(__dirname, '..', 'bin', 'payloads', 'desktop-payload.js');

function mockMatches(el, sel) {
    if (!el || !el.tagName) return false;
    if (sel.startsWith('.')) return (el.className || '').split(/\s+/).includes(sel.slice(1));
    if (sel.startsWith('[')) {
        const m = sel.match(/^\[([^\]\s]+?)(?:([*^$]?=)"?([^"\]]*)"?)?\]$/);
        if (!m) return false;
        const [, attr, op, value] = m;
        const actual = attr === 'class' ? (el.className || '') : el.getAttribute(attr);
        if (actual === null || actual === undefined) return false;
        if (!op) return true;
        if (op === '=') return actual === value;
        if (op === '*=') return actual.includes(value);
        return false;
    }
    return el.tagName.toLowerCase() === sel.toLowerCase();
}

function makeEl(tag) {
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        children: [],
        parent: null,
        style: { _props: {}, _priorities: {},
            setProperty(k, v, p = '') { this._props[k] = v; this._priorities[k] = p; },
            getPropertyValue(k) { return this._props[k] || ''; },
            getPropertyPriority(k) { return this._priorities[k] || ''; },
            removeProperty(k) { delete this._props[k]; delete this._priorities[k]; } },
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); },
            remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); },
            toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
        },
        attributes: {},
        textContent: '',
        className: '',
        value: '',
        appendChild(c) { c.parent = this; this.children.push(c); return c; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
        removeAttribute(k) { delete this.attributes[k]; },
        addEventListener() {},
        remove() {},
        closest(sel) {
            const parts = sel.split(',').map((s) => s.trim());
            let node = this;
            while (node) {
                if (parts.some((p) => mockMatches(node, p))) return node;
                node = node.parent;
            }
            return null;
        },
        contains() { return false; },
    };
    return el;
}

function runPayload({ seed, faList, enList } = {}) {
    const store = seed ? { 'rasta-config': seed } : {};
    const head = makeEl('head');
    const body = makeEl('body');
    const faBubble = makeEl('div');
    faBubble.className = 'chat-message assistant';
    faBubble.textContent = 'سلام دنیا، این یک پیام فارسی است';
    const enP = makeEl('p');
    enP.textContent = 'Hello world, plain english';
    const chatMarkdown = makeEl('div');
    chatMarkdown.className = 'chat-markdown';
    const chatText = makeEl('span');
    chatText.textContent = 'متن پاسخ';
    const chatEn = makeEl('span');
    chatEn.textContent = 'Hello reply';
    // A layout wrapper (thread/prompt container) holding a flex row, inside the
    // chat scope. It must keep its direction so the model bar never flips.
    const layoutContainer = makeEl('div');
    layoutContainer.className = 'thread-content';
    const layoutChild = makeEl('span');
    layoutChild.textContent = 'سلام';
    layoutContainer.appendChild(layoutChild);
    chatMarkdown.appendChild(chatText);
    chatMarkdown.appendChild(chatEn);
    chatMarkdown.appendChild(layoutContainer);
    const composer = makeEl('div');
    composer.setAttribute('contenteditable', 'true');
    composer.setAttribute('data-testid', 'composer-editor');
    composer.textContent = 'تایپ کن';
    // Pending question UI, rendered inside the composer: the option button
    // carries a Persian label and must be directed while the app chrome is not.
    const composerSurface = makeEl('div');
    composerSurface.setAttribute('data-chat-composer-surface', 'true');
    const pendingDrawer = makeEl('div');
    pendingDrawer.setAttribute('data-chat-composer-top-drawer', 'true');
    const optionBtn = makeEl('button');
    optionBtn.className = 'group flex w-full items-center gap-2 text-left';
    const optionLabel = makeEl('span');
    optionLabel.className = 'text-sm font-medium';
    optionLabel.textContent = 'گزینهٔ اول';
    optionBtn.appendChild(optionLabel);
    // The real DOM aggregates descendant text; the mock stores it explicitly.
    optionBtn.textContent = optionLabel.textContent;
    pendingDrawer.appendChild(optionBtn);
    composerSurface.appendChild(pendingDrawer);
    // A queued message card (rendered in the transcript while a turn runs): a
    // plain whitespace-pre-wrap text div inside [data-queued-message-id].
    const queuedCard = makeEl('div');
    queuedCard.className = 'flex flex-col items-end';
    queuedCard.setAttribute('data-queued-message-id', 'q1');
    const queuedPrompt = makeEl('div');
    queuedPrompt.className = 'whitespace-pre-wrap break-words text-sm';
    queuedPrompt.textContent = 'پیام در صف برای ارسال';
    queuedCard.appendChild(queuedPrompt);
    // T3 v0.0.44 assistant timeline: virtualized rows with no ChatMarkdown /
    // chat-message classes. The Persian/English paragraphs only qualify via
    // the data-timeline-* / data-message-* ancestors.
    const timelineRoot = makeEl('div');
    timelineRoot.className = 'relative h-full min-h-0';
    timelineRoot.setAttribute('data-timeline-root', 'true');
    const timelineRow = makeEl('div');
    timelineRow.className = 'relative min-w-0 px-1 py-0.5';
    timelineRow.setAttribute('data-timeline-row-id', 'row1');
    timelineRow.setAttribute('data-message-id', 'msg1');
    timelineRow.setAttribute('data-message-role', 'assistant');
    const assistantFa = makeEl('p');
    assistantFa.textContent = 'این پاسخ دستیار به فارسی است';
    const assistantEn = makeEl('p');
    assistantEn.textContent = 'This is an english assistant reply';
    timelineRow.appendChild(assistantFa);
    timelineRow.appendChild(assistantEn);
    timelineRoot.appendChild(timelineRow);
    // TipTap composer: the editable root carries .composer-tiptap /
    // .ProseMirror; inner paragraphs qualify through those ancestors.
    const tiptapRoot = makeEl('div');
    tiptapRoot.className = 'composer-tiptap ProseMirror';
    tiptapRoot.setAttribute('contenteditable', 'true');
    tiptapRoot.setAttribute('data-testid', 'composer-editor');
    const tiptapP = makeEl('p');
    tiptapP.textContent = 'متن تایپ‌شده در کامپوزر';
    tiptapRoot.appendChild(tiptapP);
    const tiptapEn = makeEl('p');
    tiptapEn.textContent = 'typed english line';
    tiptapRoot.appendChild(tiptapEn);
    // Prompt-section chrome: footer toolbar inside the composer surface. It is
    // inside CONTENT_SCOPE (via the surface) but outside FORCE_SCOPE, so Force
    // RTL must leave it on auto direction instead of flipping its layout.
    const composerFooter = makeEl('div');
    composerFooter.setAttribute('data-chat-composer-footer', 'true');
    const footerBtn = makeEl('button');
    footerBtn.className = 'flex items-center gap-2';
    footerBtn.textContent = 'Send';
    const footerLabel = makeEl('span');
    footerLabel.textContent = 'Claude Sonnet';
    composerFooter.appendChild(footerBtn);
    composerFooter.appendChild(footerLabel);
    composerSurface.appendChild(composerFooter);
    // App chrome must stay untouched by text direction changes.
    const appSidebar = makeEl('div');
    appSidebar.className = 'app-sidebar';
    const sidebarLabel = makeEl('span');
    sidebarLabel.textContent = 'برچسب';
    appSidebar.appendChild(sidebarLabel);
    const appButton = makeEl('button');
    appButton.className = 'app-toolbar-btn';
    appButton.textContent = 'ذخیره';
    // Chat input: a form field whose text lives in .value, not .textContent.
    const chatInput = makeEl('textarea');
    chatInput.value = 'سلام دنیا';
    // Codex uses semantic markdown attributes rather than T3's message IDs.
    const codexMessage = makeEl('div');
    codexMessage.setAttribute('data-markdown-text-style', 'assistant-message');
    const codexFa = makeEl('p');
    codexFa.textContent = 'پاسخ فارسی کدکس';
    const codexEn = makeEl('p');
    codexEn.textContent = 'An English Codex reply';
    const codexCode = makeEl('pre');
    const codexCodeText = makeEl('span');
    codexCodeText.textContent = 'const message = "سلام";';
    codexCode.appendChild(codexCodeText);
    codexMessage.appendChild(codexFa);
    codexMessage.appendChild(codexEn);
    codexMessage.appendChild(codexCode);
    const codexComposer = makeEl('div');
    codexComposer.setAttribute('data-codex-composer', '');
    const codexEditor = makeEl('div');
    codexEditor.className = 'ProseMirror';
    codexEditor.setAttribute('contenteditable', 'true');
    const codexTyped = makeEl('p');
    codexTyped.textContent = 'متن ورودی کدکس';
    codexEditor.appendChild(codexTyped);
    const codexToolbar = makeEl('button');
    codexToolbar.textContent = 'Send';
    codexComposer.appendChild(codexEditor);
    codexComposer.appendChild(codexToolbar);
    body.appendChild(codexMessage);
    body.appendChild(codexComposer);
    body.appendChild(faBubble);
    body.appendChild(enP);
    body.appendChild(chatInput);
    body.appendChild(chatMarkdown);
    body.appendChild(composer);
    body.appendChild(composerSurface);
    body.appendChild(queuedCard);
    body.appendChild(timelineRoot);
    body.appendChild(tiptapRoot);
    body.appendChild(appSidebar);
    body.appendChild(appButton);

    const listeners = {};
    const sandbox = {
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        MutationObserver: class { observe() {} disconnect() {} },
        setInterval: () => 0,
        clearInterval: () => {},
        window: null,
        document: null,
    };
    const addListener = (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); };
    const removeListener = (t, cb) => { listeners[t] = (listeners[t] || []).filter(listener => listener !== cb); };
    sandbox.window = { addEventListener: addListener, removeEventListener: removeListener };
    const byId = {};
    const document = {
        head,
        body,
        createElement: (t) => {
            const el = makeEl(t);
            if (t === 'style') {
                Object.defineProperty(el, 'id', {
                    set(v) { this._id = v; byId[v] = this; },
                    get() { return this._id; },
                });
                el.remove = function () { if (this._id) delete byId[this._id]; };
            }
            return el;
        },
        createElementNS: (ns, t) => makeEl(t),
        createTextNode: (t) => ({ textContent: t }),
        getElementById: (id) => byId[id] || null,
        querySelector: (sel) => body.children.find(el => mockMatches(el, sel)) || null,
        querySelectorAll: () => [faBubble, enP, layoutContainer, layoutChild, chatInput, chatMarkdown, chatText, chatEn, composer, composerSurface, pendingDrawer, optionBtn, optionLabel, queuedCard, queuedPrompt, timelineRoot, timelineRow, assistantFa, assistantEn, tiptapRoot, tiptapP, tiptapEn, composerFooter, footerBtn, footerLabel, appSidebar, sidebarLabel, appButton, codexFa, codexEn, codexCodeText, codexEditor, codexTyped, codexToolbar, body],
        addEventListener: addListener,
        removeEventListener: removeListener,
        execCommand: () => true,
    };
    sandbox.document = document;
    sandbox.globalThis = sandbox;

    const code = fs
        .readFileSync(PAYLOAD, 'utf8')
        .replace("/* __ARTL_VERSION__ */ ''", JSON.stringify('1.0.0'))
        .replace('__FA_FONTS__', JSON.stringify(faList || [{ label: 'FaTest', value: 'FaTest' }, { label: 'FaTest (FaNum)', value: 'FaTest (FaNum)' }]))
        .replace('__EN_FONTS__', JSON.stringify(enList || [{ label: 'EnTest', value: 'EnTest' }]))
        .replace('__DEFAULT_FA__', JSON.stringify('FaTest'))
        .replace('__DEFAULT_EN__', JSON.stringify('EnTest'))
        .replace('__FONT_FACES__', '');
    const fn = new Function(...Object.keys(sandbox), `${code}\nreturn __out;`);
    sandbox.__out = { listeners, byId, body, faBubble, enP, layoutContainer, layoutChild, chatInput, chatMarkdown, chatText, chatEn, composer, composerSurface, pendingDrawer, optionBtn, optionLabel, queuedCard, queuedPrompt, timelineRoot, timelineRow, assistantFa, assistantEn, tiptapRoot, tiptapP, tiptapEn, composerFooter, footerBtn, footerLabel, appSidebar, sidebarLabel, appButton, codexFa, codexEn, codexCodeText, codexTyped, codexToolbar, window: sandbox.window };
    // __out must be a visible parameter: rebuild fn args after adding it.
    const fn2 = new Function(...Object.keys(sandbox), `${code}\nreturn __out;`);
    return { ...fn2(...Object.values(sandbox)), code, store };
}

describe('desktop-payload', () => {
    it('directs Codex markdown and typed text on the first paint, leaving code alone', () => {
        const out = runPayload();
        assert.equal(out.codexFa.getAttribute('dir'), 'rtl');
        assert.equal(out.codexEn.getAttribute('dir'), 'ltr');
        assert.equal(out.codexTyped.getAttribute('dir'), 'rtl');
        assert.equal(out.codexCodeText.getAttribute('dir'), null);
        assert.equal(out.codexToolbar.getAttribute('dir'), 'ltr');
    });

    it('forces Codex messages while keeping composer controls and code in their own direction', () => {
        const out = runPayload({ seed: '{"forceRTL":true}' });
        assert.equal(out.codexEn.getAttribute('dir'), 'rtl');
        assert.equal(out.codexToolbar.getAttribute('dir'), 'ltr');
        assert.equal(out.codexCodeText.getAttribute('dir'), null);
    });

    it('disposes the runtime overlay and removes its input, keyboard and outside-click handlers', () => {
        const out = runPayload();
        out.window.__rastaPro.dispose();
        assert.equal(out.codexFa.getAttribute('dir'), null);
        assert.equal(out.codexTyped.style.getPropertyValue('direction'), '');
        assert.equal(out.byId['artl-rtl-style'], undefined);
        assert.equal(out.byId['artl-widget-style'], undefined);
        assert.equal(out.listeners.input.length, 0);
        assert.equal(out.listeners.keydown.length, 0);
        assert.equal(out.listeners.click.length, 0);
        assert.equal(out.window.__rastaPro.disabled, true);
    });

    it('preserves app-owned direction and inline styles when RTL is switched off', () => {
        const out = runPayload({ seed: '{"isRTL":false}' });
        out.codexFa.setAttribute('dir', 'auto');
        out.codexFa.style.setProperty('direction', 'ltr', 'important');
        toggleFor(out, 'artl-toggle-btn').onclick();
        assert.equal(out.codexFa.getAttribute('dir'), 'rtl');
        toggleFor(out, 'artl-toggle-btn').onclick();
        assert.equal(out.codexFa.getAttribute('dir'), 'auto');
        assert.equal(out.codexFa.style.getPropertyValue('direction'), 'ltr');
        assert.equal(out.codexFa.style.getPropertyPriority('direction'), 'important');
    });

    it('limits the Persian @ shortcut fix to chat fields', () => {
        const out = runPayload();
        let prevented = 0;
        const event = { code: 'Digit2', shiftKey: true, key: '،', preventDefault: () => prevented++ };
        out.listeners.keydown[0]({ ...event, target: out.sidebarLabel });
        assert.equal(prevented, 0);
        out.listeners.keydown[0]({ ...event, target: out.codexTyped });
        assert.equal(prevented, 1);
    });
    it('keeps Vazir as the default and excludes legacy font presets', () => {
        const code = fs.readFileSync(PAYLOAD, 'utf8');
        assert.ok(code.includes("{ label: 'Vazir', value: 'vazir' }"));
        for (const banned of ['Vazirmatn', 'PersianOnlyFont', 'System Default', '__FONT_BASE64__', 'Shabnam', 'B Yekan', 'B Nazanin', 'Tahoma', 'Consolas', 'Custom...']) {
            assert.ok(!code.includes(banned), `banned string leaked: ${banned}`);
        }
        for (const ph of ['__FA_FONTS__', '__EN_FONTS__', '__FONT_FACES__', '__DEFAULT_FA__', '__DEFAULT_EN__']) {
            assert.ok(code.includes(ph), `missing placeholder: ${ph}`);
        }
    });

    it('uses the rasta namespace (no legacy identifiers)', () => {
        const code = fs.readFileSync(PAYLOAD, 'utf8');
        for (const legacy of ['smart-rtl', 'smart-ide-rtl', "'rtl-", '"rtl-', '.rtl-']) {
            assert.ok(!code.includes(legacy), `legacy identifier leaked: ${legacy}`);
        }
        assert.ok(code.includes('antigravity-pro-rtl'), 'upstream attribution missing');
    });

    it('mounts the widget and directs fa→rtl / en→ltr inside the chat scope', () => {
        const { listeners, byId, body, faBubble, chatEn, enP } = runPayload();
        assert.ok(byId['artl-widget-style'], 'widget style missing');
        assert.ok(byId['artl-rtl-style'], 'rtl style missing');
        assert.ok(body.children.some((c) => c.className === 'artl-widget-container'), 'widget not mounted');
        for (const cb of listeners['input'] || []) cb();
        assert.equal(faBubble.getAttribute('dir'), 'rtl');
        assert.equal(chatEn.getAttribute('dir'), 'ltr');
        assert.equal(enP.getAttribute('dir'), null, 'outside the chat scope must stay untouched');
        assert.ok(faBubble.classList.contains('artl-text-node'));
    });

    it('directs text inside a layout container without flipping the container', () => {
        const { listeners, layoutContainer, layoutChild } = runPayload();
        for (const cb of listeners['input'] || []) cb();
        assert.equal(layoutChild.getAttribute('dir'), 'rtl');
        assert.equal(layoutContainer.getAttribute('dir'), null, 'wrapper must not get dir');
        assert.equal(layoutContainer.style._props.direction, undefined, 'wrapper must not be redirected');
    });

    it('directs a form-field input from its value, not textContent', () => {
        const { listeners, chatInput } = runPayload();
        for (const cb of listeners['input'] || []) cb();
        assert.equal(chatInput.getAttribute('dir'), 'rtl');
        assert.equal(chatInput.style._props.direction, 'rtl');
    });

    it('keeps forced RTL inside the chat/typing scope when layout is not mirrored', () => {
        const out = runPayload({ seed: '{"forceRTL":true}' });
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.chatText.getAttribute('dir'), 'rtl', 'chat text should be forced rtl');
        assert.equal(out.composer.getAttribute('dir'), 'rtl', 'composer should be forced rtl');
        assert.equal(out.chatInput.getAttribute('dir'), 'rtl', 'input should be forced rtl');
        assert.equal(out.sidebarLabel.getAttribute('dir'), null, 'app chrome must stay untouched');
        assert.equal(out.enP.getAttribute('dir'), null, 'outside content must stay untouched');
    });

    it('does not direct the app chrome in auto mode either', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.chatText.getAttribute('dir'), 'rtl', 'persian chat text should be rtl');
        assert.equal(out.sidebarLabel.getAttribute('dir'), null, 'app chrome must stay untouched');
        assert.equal(out.enP.getAttribute('dir'), null, 'outside content must stay untouched');
    });

    it('directs pending question options rendered inside the composer', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.optionLabel.getAttribute('dir'), 'rtl', 'persian option label should be rtl');
        assert.equal(out.optionBtn.getAttribute('dir'), 'rtl', 'option button should be rtl so the icon flips');
    });

    it('directs queued message text rendered in the transcript', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.queuedPrompt.getAttribute('dir'), 'rtl', 'persian queued prompt should be rtl');
        assert.equal(out.queuedPrompt.style._props.direction, 'rtl');
        assert.ok(out.queuedPrompt.classList.contains('artl-text-node'));
    });

    it('directs T3 v0.0.44 timeline assistant messages (data-message-id scope)', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.assistantFa.getAttribute('dir'), 'rtl', 'persian assistant reply should be rtl');
        assert.equal(out.assistantFa.style._props.direction, 'rtl');
        assert.ok(out.assistantFa.classList.contains('artl-text-node'));
        assert.equal(out.assistantEn.getAttribute('dir'), 'ltr', 'english assistant reply should be ltr');
    });

    it('directs TipTap composer paragraphs via .composer-tiptap scope', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.tiptapP.getAttribute('dir'), 'rtl', 'persian composer paragraph should be rtl');
    });

    it('forces transcript + typed text but leaves prompt chrome on auto when Force RTL is on', () => {
        const out = runPayload({ seed: '{"forceRTL":true}' });
        for (const cb of out.listeners['input'] || []) cb();
        // Readable content is forced rtl, even English text.
        assert.equal(out.assistantFa.getAttribute('dir'), 'rtl', 'persian transcript should be forced rtl');
        assert.equal(out.assistantEn.getAttribute('dir'), 'rtl', 'english transcript should be forced rtl');
        assert.equal(out.tiptapEn.getAttribute('dir'), 'rtl', 'english typed text should be forced rtl');
        assert.equal(out.optionBtn.getAttribute('dir'), 'rtl', 'pending option should stay forced rtl');
        // Composer chrome falls back to auto so the prompt layout never flips.
        assert.equal(out.footerBtn.getAttribute('dir'), 'ltr', 'footer button must stay ltr');
        assert.equal(out.footerLabel.getAttribute('dir'), 'ltr', 'footer label must stay ltr');
        assert.equal(out.footerBtn.style._props.direction, 'ltr', 'footer button direction must stay ltr');
    });

    it('styles the new timeline and TipTap selectors with the font stack', () => {
        const { byId } = runPayload();
        const css = byId['artl-rtl-style'].textContent;
        for (const sel of ['[data-timeline-root]', '[data-timeline-row-id]', '[data-message-id]', '[data-user-message-body]', '[data-testid="composer-editor"]', '.composer-tiptap', '.ProseMirror']) {
            assert.ok(css.includes(sel), `font selector missing: ${sel}`);
        }
    });

    it('styles queued messages with the configured font stack', () => {
        const { byId } = runPayload();
        const css = byId['artl-rtl-style'].textContent;
        assert.ok(css.includes('[data-queued-message-id]'), 'queued message selector missing');
        assert.ok(css.includes('[data-queued-message-id] .whitespace-pre-wrap'), 'queued prompt selector missing');
    });

    it('keeps app-chrome buttons untouched in auto mode', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.appButton.getAttribute('dir'), null, 'chrome button must stay untouched');
    });

    it('ignores removed layout settings without changing app chrome', () => {
        const out = runPayload({ seed: '{"layoutDir":true}' });
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.sidebarLabel.getAttribute('dir'), null);
        assert.equal(out.appButton.getAttribute('dir'), null);
        assert.equal(out.chatText.getAttribute('dir'), 'rtl');
        assert.ok(!out.byId['artl-layout-style']);
        assert.ok(!toggleFor(out, 'artl-layout-btn'));
    });

    it('respects a saved isRTL=false config', () => {
        const { byId } = runPayload({ seed: '{"isRTL":false}' });
        assert.ok(byId['artl-widget-style'], 'widget style missing');
        assert.ok(!byId['artl-rtl-style'], 'rtl style should be off');
        assert.ok(!byId['artl-app-font-style'], 'a saved disabled state must keep the original app font');
    });

    function descendants(node) { return [node, ...(node.children || []).flatMap(descendants)]; }
    function toggleFor(out, id) {
        return descendants(out.body).find(node => node.id === id);
    }

    it('shows the installed payload version without a Codex native bridge', () => {
        const out = runPayload();
        const version = descendants(out.body).find(node => node.className === 'artl-version');
        assert.equal(version.textContent, 'v1.0.0');
    });

    it('normalizes invalid appearance preferences and migrates older saved settings', () => {
        for (const seed of ['{"theme":"sepia","accent":"url(bad)","customAccent":"#xyz"}', '{"fs":"18"}', '{"accent":"auto"}']) {
            const out = runPayload({ seed });
            const widget = descendants(out.body).find(node => node.className === 'artl-widget-container');
            assert.equal(widget.getAttribute('data-artl-theme'), 'auto');
            assert.equal(toggleFor(out, 'artl-accent-custom'), undefined);
            const defaults = descendants(widget).find(node => node.getAttribute?.('aria-label') === 'Default accent');
            assert.equal(defaults, undefined);
            const lavender = descendants(widget).find(node => node.getAttribute?.('aria-label') === 'Lavender accent');
            assert.equal(lavender.getAttribute('aria-pressed'), 'true');
        }
    });

    it('retains each saved pastel choice as its livelier equivalent', () => {
        for (const [old, current] of [['#c4b5fd','#ad8cf3'],['#b8d4f5','#79adeb'],['#b9dfce','#68c7a4'],['#f3dfa8','#e9bf59']]) {
            const out = runPayload({ seed: JSON.stringify({accent:old}) });
            toggleFor(out, 'artl-at-btn').onclick();
            assert.equal(JSON.parse(out.store['rasta-config']).accent, current);
        }
    });

    it('migrates old presets and preserves appearance when changing reading controls', () => {
        const out = runPayload({ seed: '{"theme":"dark","accent":"#2563EB","customAccent":"#E15B97"}' });
        toggleFor(out, 'artl-at-btn').onclick();
        let saved = JSON.parse(out.store['rasta-config']);
        assert.equal(saved.theme, 'dark');
        assert.equal(saved.accent, '#79adeb');
        assert.equal('customAccent' in saved, false);
        const lavender = descendants(out.body).find(node => node.getAttribute?.('aria-label') === 'Lavender accent');
        lavender.onclick();
        saved = JSON.parse(out.store['rasta-config']);
        assert.equal(saved.accent, '#ad8cf3');
        assert.equal('customAccent' in saved, false);
        assert.equal(saved.theme, 'dark');
        assert.equal(saved.fixAtSign, false);
    });

    it('removes custom and warm accents from the saved palette', () => {
        for (const accent of ['#ff0000', '#c15c12', '#e15b97', '#abcdef']) {
            const out = runPayload({ seed: JSON.stringify({ accent, customAccent: accent }) });
            toggleFor(out, 'artl-at-btn').onclick();
            const saved = JSON.parse(out.store['rasta-config']);
            assert.equal(saved.accent, '#ad8cf3');
            assert.equal('customAccent' in saved, false);
            assert.equal(toggleFor(out, 'artl-accent-custom'), undefined);
        }
    });

    it('clears directions when Enable RTL is turned off', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.faBubble.getAttribute('dir'), 'rtl');

        const toggle = toggleFor(out, 'artl-toggle-btn');
        assert.ok(toggle, 'Enable RTL toggle missing');
        toggle.onclick();

        assert.equal(out.faBubble.getAttribute('dir'), null, 'dir must be removed when off');
        assert.equal(out.faBubble.style._props.direction, undefined, 'direction must be removed when off');
        assert.equal(out.faBubble.classList.contains('artl-text-node'), false, 'marker class must be removed when off');
    });

    it('clears direction even after React rewrites className', () => {
        const out = runPayload();
        for (const cb of out.listeners['input'] || []) cb();
        assert.equal(out.faBubble.getAttribute('dir'), 'rtl');
        // Simulate React re-rendering the node and dropping our marker class.
        out.faBubble.classList.remove('artl-text-node');
        out.faBubble.className = 'chat-message assistant';
        toggleFor(out, 'artl-toggle-btn').onclick();
        assert.equal(out.faBubble.getAttribute('dir'), null, 'tracked node must still be cleared');
        assert.equal(out.faBubble.style._props.direction, undefined);
    });

    it('keeps layout untouched while only text RTL is on', () => {
        const { byId } = runPayload();
        assert.ok(byId['artl-rtl-style'], 'text rtl style should be on');
        assert.ok(!byId['artl-layout-style'], 'layout style must stay off by default');
    });

    it('puts the English font before the Persian font in the stack', () => {
        const { byId } = runPayload();
        const css = byId['artl-rtl-style'].textContent;
        assert.ok(css.includes("'EnTest', 'FaTest'"), `english must come first: ${css.match(/font-family:[^;]+/g)}`);
    });



    it('offers font-size and line-height as presets, not free inputs', () => {
        const code = fs.readFileSync(PAYLOAD, 'utf8');
        assert.ok(code.includes("const FONT_SIZES = ['14', '16', '18']"));
        assert.ok(code.includes("const LINE_HEIGHTS = ['1.4', '1.6', '1.8']"));
        assert.ok(!code.includes("type = 'number'") && !code.includes("type = 'range'"));
    });

    it('normalizes stale saved values before the first paint', () => {
        const { byId } = runPayload({ seed: '{"enFont":"Gone","fs":"99","lh":"9.9"}' });
        const css = byId['artl-rtl-style'].textContent;
        assert.ok(css.includes("'EnTest'"), 'stale enFont should fall back to first entry');
        assert.ok(css.includes('font-size: 14px'), 'stale font size should fall back to 14');
        assert.ok(css.includes('line-height: 1.6'), 'stale line-height should fall back to 1.6');
    });

    function panelRowLabels(out) {
        return descendants(out.body).filter(node => node.className === 'artl-label').map(node => node.textContent);
    }

    it('hides the English Font row when only one English font exists', () => {
        const { body } = runPayload();
        const labels = panelRowLabels({ body });
        assert.ok(!labels.includes('English font'), labels.join(', '));
    });

    it('hides the Persian Font row when only one Persian font exists', () => {
        const { body } = runPayload({ faList: [{ label: 'IRANSansX (FaNum)', value: 'IRANSansX (FaNum)' }] });
        const labels = panelRowLabels({ body });
        assert.ok(labels.includes('Enable RTL'));
        assert.ok(!labels.includes('Persian font'), labels.join(', '));
        assert.ok(!labels.includes('English font'), labels.join(', '));
    });

    it('shows the Persian Font row when several Persian fonts exist', () => {
        const { body } = runPayload({ faList: [{ label: 'FaA', value: 'FaA' }, { label: 'FaB', value: 'FaB' }] });
        const labels = panelRowLabels({ body });
        assert.ok(labels.includes('Persian font'));
    });

    it('shows the English Font row when several English fonts exist', () => {
        const { body } = runPayload({ enList: [{ label: 'EnA', value: 'EnA' }, { label: 'EnB', value: 'EnB' }] });
        const labels = panelRowLabels({ body });
        assert.ok(labels.includes('English font'));
    });
});
