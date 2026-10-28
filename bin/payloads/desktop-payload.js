/* AGENT RTL PRO PATCH - SMART RTL PAYLOAD */
/* Ported from antigravity-pro-rtl's ide-payload.js for Codex and T3 Code.
 * Engine unchanged: MutationObserver + requestAnimationFrame, zero-delay.
 * Namespaced with the `artl-` prefix so it never collides with other
 * patchers. Chat selectors generalized beyond Monaco for React/Vite UIs
 * (Codex webviews and T3 ChatMarkdown/ChatView).
 */
(function() {
    if (window.__agentRTLPro && !window.__agentRTLPro.disabled) return;
    const STORAGE_KEY = 'agent-rtl-config';
    const AGENT_VERSION = /* __ARTL_VERSION__ */ '';
    const HOST_NAME = window.location?.protocol === 't3code:' ? 'T3 Code' : 'Codex';
    // Fixed presets for size / line-height (dropdowns, not free inputs).
    const FONT_SIZES = ['14', '16', '18'];
    const LINE_HEIGHTS = ['1.4', '1.6', '1.8'];
    const ACCENTS = [{ label: 'Lavender', value: '#ad8cf3' }, { label: 'Blue', value: '#79adeb' }, { label: 'Mint', value: '#68c7a4' }, { label: 'Yellow', value: '#e9bf59' }];
    // Migrate supported presets; legacy auto and removed/custom colors fall back to Lavender.
    function normalizeAccent(value) {
        const saved = typeof value === 'string' ? value.toLowerCase() : 'auto';
        const migrated = ({ '#2563eb': '#79adeb', '#16805d': '#68c7a4', '#c4b5fd': '#ad8cf3', '#b8d4f5': '#79adeb', '#b9dfce': '#68c7a4', '#f3dfa8': '#e9bf59' })[saved] || saved;
        return ACCENTS.some(preset => preset.value === migrated) ? migrated : '#ad8cf3';
    }
    let rtlConfig = { faFont: '', enFont: '', codeFont: '', lh: '1.6', fs: '14', isRTL: true, forceRTL: false, fixAtSign: true, theme: 'auto', accent: '#ad8cf3' };
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            rtlConfig = { ...rtlConfig, ...JSON.parse(saved) };
        }
    } catch (e) {}
    if (!['auto', 'light', 'dark'].includes(rtlConfig.theme)) rtlConfig.theme = 'auto';
    rtlConfig.accent = normalizeAccent(rtlConfig.accent);
    delete rtlConfig.customAccent;

    // Baked at patch time: Persian Regular fonts (plain + FaNum models) and
    // bundled English fonts. Stale/empty saved values fall back here.
    if (!rtlConfig.faFont) rtlConfig.faFont = __DEFAULT_FA__;
    if (!rtlConfig.enFont) rtlConfig.enFont = __DEFAULT_EN__;

    let isRTL = rtlConfig.isRTL;
    let forceRTL = rtlConfig.forceRTL || false;
    let fixAtSign = rtlConfig.fixAtSign !== false;
    let updatePoll = null, updateCheck = null;
    let updatesDisposed = false;
    let closeWidget = null, closeMenu = null, closeConfirmation = null, disposeTheme = null, disposeFonts = null, toastTimer = null, toastExitTimer = null;
    let appFontOverride = '';

    function injectStyle(id, css) {
        let style = document.getElementById(id);
        if (!style) {
            style = document.createElement('style');
            style.id = id;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }

    const staticCSS = `
        __FONT_FACES__
        .artl-widget-container {
            --artl-base: #ffffff; --artl-canvas: #f5f5f7; --artl-text: #25252a;
            --artl-muted: #6b6b75; --artl-accent: #9639ed;
            --artl-line: #e8e8ed; --artl-soft: #f2e9fc; --artl-on-accent: #ffffff; --artl-ink: var(--artl-accent);
            position: fixed; bottom: 20px; right: 20px; z-index: 999999;
            display: flex; flex-direction: column; align-items: flex-end;
            color: var(--artl-text); font: 14px/1.6 var(--artl-app-font, Vazir, system-ui, sans-serif); text-align: start; letter-spacing: normal; isolation: isolate; font-synthesis: weight style;
        }
        @media (prefers-color-scheme: dark) {
            .artl-widget-container { --artl-base: #252529; --artl-canvas: #303035; --artl-text: #f4f4f6; --artl-muted: #b0b0ba; --artl-accent: #a25bff; --artl-line: #3c3c44; --artl-soft: #382747; --artl-on-accent: #21142e; }
        }
        :root:is(.dark, [data-theme="dark"]) .artl-widget-container { --artl-base: #252529; --artl-canvas: #303035; --artl-text: #f4f4f6; --artl-muted: #b0b0ba; --artl-accent: #a25bff; --artl-line: #3c3c44; --artl-soft: #382747; --artl-on-accent: #21142e; }
        :root:is(.light, [data-theme="light"]) .artl-widget-container { --artl-base: #fff; --artl-canvas: #f5f5f7; --artl-text: #25252a; --artl-muted: #6b6b75; --artl-accent: #9639ed; --artl-line: #e8e8ed; --artl-soft: #f2e9fc; --artl-on-accent: #fff; }
        :root .artl-widget-container[data-artl-theme="dark"] { color-scheme: dark; --artl-base: #252529; --artl-canvas: #303035; --artl-text: #f4f4f6; --artl-muted: #b0b0ba; --artl-accent: #a25bff; --artl-line: #3c3c44; --artl-soft: #382747; --artl-on-accent: #21142e; }
        :root .artl-widget-container[data-artl-theme="light"] { color-scheme: light; --artl-base: #fff; --artl-canvas: #f5f5f7; --artl-text: #25252a; --artl-muted: #6b6b75; --artl-accent: #9639ed; --artl-line: #e8e8ed; --artl-soft: #f2e9fc; --artl-on-accent: #fff; }
        .artl-widget-container *, .artl-widget-container *::before, .artl-widget-container *::after { box-sizing: border-box; }
        .artl-widget-container :is(button, label, p, span, div) { font-family: inherit; letter-spacing: normal; }
        .artl-widget-container button { font: inherit; cursor: pointer; appearance: none; margin: 0; }
        .artl-widget-container :is(button, input, [role="combobox"]):focus-visible { outline: 2px solid var(--artl-ink); outline-offset: 2px; }
        .artl-widget-container button:disabled { cursor: default; opacity: .4; }
        .artl-widget-container [hidden] { display: none !important; }
        .artl-widget-container svg { display: block; flex: none; }
        .artl-widget-panel { position: absolute; bottom: 56px; right: 0; visibility: hidden; transform: translateY(4px) scale(.98); transform-origin: bottom right; opacity: 0; pointer-events: none; transition: opacity .14s ease-out, transform .18s cubic-bezier(.23,1,.32,1), visibility .18s; }
        .artl-widget-panel.open { visibility: visible; transform: translateY(0); opacity: 1; pointer-events: auto; }
        .artl-theme-panel { width: 352px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 104px); overflow: hidden; border: 1px solid var(--artl-line); border-radius: 16px; color: var(--artl-text); background: var(--artl-base); box-shadow: 0 12px 36px #15101f26, 0 2px 6px #15101f0a; }
        .artl-panel-content { max-height: calc(100dvh - 106px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 12px 16px 16px; }
        .artl-panel-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--artl-line); }
        .artl-brand-mark { width: 24px; height: 24px; color: var(--artl-brand-ink, #8056c6); flex-shrink: 0; }
        .artl-brand-title { flex: 1; min-width: 0; margin: 0; white-space: nowrap; color: var(--artl-text); font: 700 17px/1.4 var(--artl-app-font, Vazir, system-ui, sans-serif); }
        .artl-widget-container .artl-icon-button { display: grid; place-items: center; width: 44px; height: 44px; min-width: 44px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--artl-muted); transition: background .12s ease-out, color .12s ease-out; }
        .artl-icon-button svg { width: 16px; height: 16px; }
        #artl-update-check svg { width: 18px; height: 18px; stroke-width: 2; }
        .artl-widget-container #artl-update-check.is-loading { color: var(--artl-ink); opacity: 1; cursor: progress; }
        #artl-update-check.is-loading svg { animation: artl-refresh-spin .8s linear infinite; transform-origin: center; }
        @keyframes artl-refresh-spin { to { transform: rotate(360deg); } }
        .artl-widget-container .artl-icon-button:hover { color: var(--artl-ink); background: var(--artl-soft); }
        .artl-widget-container #artl-update-restore:hover { color: var(--color-text-danger, #bd3456); }
        .artl-widget-container .artl-icon-button:active { background: var(--artl-line); }
        .artl-update-actions { display: flex; align-items: center; gap: 0; }
        .artl-version { display: block; font-size: 11px; color: var(--artl-muted); margin-bottom: 8px; }
        .artl-release-notes { margin: 8px 0; padding-inline-start: 18px; font-size: 12px; line-height: 1.6; }
        .artl-update-notice { margin-bottom: 12px; padding: 12px; border-radius: 12px; background: var(--artl-soft); border: 1px solid var(--artl-line); }
        #artl-update-status { color: var(--artl-muted); font-size: 12px; line-height: 1.8; }
        .artl-widget-container .artl-update-install { width: 100%; min-height: 44px; padding: 8px 12px; margin-top: 8px; border-radius: 12px; border: 1px solid var(--artl-accent); background: var(--artl-accent); color: var(--artl-on-accent); font-size: 13px; font-weight: 700; }
        .artl-toast { position: absolute; z-index: 6; bottom: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--artl-line); border-radius: 10px; color: var(--artl-text); background: var(--artl-canvas); box-shadow: 0 2px 8px #10081d0a; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; pointer-events: none; opacity: 0; transform: translateY(8px); transition: opacity .14s ease-out, transform .14s ease-out; }
        .artl-toast.visible { opacity: 1; transform: translateY(0); transition-duration: .2s; transition-timing-function: cubic-bezier(.23,1,.32,1); }
        .artl-toast svg { width: 20px; height: 20px; color: var(--artl-ink); }
        .artl-toast[data-kind="error"] svg { color: #d76542; }
        .artl-confirm { position: absolute; z-index: 10; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 24px; border-radius: inherit; background: var(--artl-base); }
        .artl-confirm-icon { width: 44px; height: 44px; padding: 12px; margin-bottom: 20px; border: 1px solid var(--artl-line); border-radius: 12px; color: var(--artl-muted); background: var(--artl-canvas); }
        .artl-confirm h3 { margin: 0 0 8px; color: var(--artl-text); font: 700 19px/1.5 var(--artl-app-font, Vazir, sans-serif); }
        .artl-confirm p { margin: 0; color: var(--artl-muted); font-size: 13px; line-height: 1.7; }
        .artl-confirm-actions { display: flex; gap: 8px; margin-top: 24px; }
        .artl-widget-container .artl-confirm-actions button { flex: 1; min-height: 44px; padding: 8px 12px; border: 1px solid var(--artl-line); border-radius: 12px; color: var(--artl-text); background: var(--artl-canvas); font-size: 13px; font-weight: 700; }
        .artl-widget-container .artl-confirm-actions .artl-danger { border-color: #b7324c; color: #fff; background: #b7324c; }
        .artl-settings-group { padding: 0 4px; }
        .artl-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 48px; margin: 0; padding: 2px 0; }
        .artl-type-group { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--artl-line); }
        .artl-type-group .artl-row { flex-direction: column; align-items: stretch; min-height: 0; padding: 0; gap: 8px; }
        .artl-type-group .artl-label-copy { flex: none; }
        .artl-type-group .artl-label { font-size: 12px; font-weight: 400; }
        .artl-type-group .artl-select { width: 100%; }
        .artl-type-group .artl-font-row { grid-column: 1 / -1; }
        .artl-font-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; min-width: 0; }
        .artl-widget-container .artl-font-add { border: 1px solid var(--artl-line); border-radius: 10px; color: var(--artl-muted); }
        .artl-widget-container .artl-font-add:hover { background: var(--artl-canvas); }
        .artl-font-error { grid-column: 1 / -1; margin: 0; color: var(--artl-text); font-size: 12px; overflow-wrap: anywhere; }
        .artl-appearance-group { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--artl-line); }
        .artl-appearance-group .artl-select { width: 156px; max-width: 60%; }
        .artl-accent-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 12px 0 8px; color: var(--artl-text); font-size: 13px; font-weight: 500; }
        .artl-accent-value { color: var(--artl-muted); font-size: 12px; font-weight: 400; }
        .artl-accent-options { display: grid; grid-template-columns: repeat(4, minmax(44px, 1fr)); gap: 4px; }
        .artl-widget-container .artl-accent-swatch { position: relative; display: grid; place-items: center; min-width: 44px; height: 44px; padding: 0; border: 1px solid transparent; border-radius: 10px; background: transparent; }
        .artl-widget-container .artl-accent-swatch:hover { background: var(--artl-canvas); }
        .artl-widget-container .artl-accent-swatch[aria-pressed="true"] { border-color: var(--artl-ink); background: var(--artl-canvas); }
        .artl-accent-dot { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid #80808080; border-radius: 50%; background: var(--artl-swatch); color: var(--artl-swatch-text, #fff); }
        .artl-accent-dot svg { width: 14px; height: 14px; }
        .artl-accent-swatch[aria-pressed="false"] svg { visibility: hidden; }
        .artl-select-trigger > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .artl-label-copy { display: flex; flex: 1; gap: 8px; align-items: center; min-width: 0; }
        .artl-label { color: var(--artl-text); font-size: 13px; font-weight: 500; cursor: pointer; }
        .artl-widget-container .artl-toggle-btn-reset { position: relative; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 12px; background: transparent; direction: ltr; }
        .artl-toggle-btn-reset::before { content: ''; position: absolute; inset: 10px 0; height: 24px; border-radius: 12px; background: var(--artl-line); transition: background-color .14s ease-out; }
        .artl-toggle-btn-reset.active::before { background-color: var(--artl-accent); }
        .artl-toggle-knob { position: absolute; width: 18px; height: 18px; top: 13px; left: 3px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #10081d28; transition: transform .14s cubic-bezier(.23,1,.32,1); }
        .artl-toggle-btn-reset.active .artl-toggle-knob { transform: translateX(20px); }
        .artl-widget-container[data-artl-selected-accent="true"] .artl-toggle-btn-reset.active::before { box-shadow: inset 0 0 0 1px var(--artl-ink); }
        .artl-select { position: relative; flex: none; width: 100px; direction: ltr; }
        .artl-widget-container .artl-select-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 8px 12px; border: 1px solid transparent; border-radius: 10px; background: var(--artl-canvas); color: var(--artl-text); text-align: start; font-size: 14px; font-weight: 400; font-variant-numeric: tabular-nums; transition: border-color .12s ease-out; }
        .artl-widget-container .artl-select-trigger:hover { border-color: var(--artl-line); }
        #artl-size.artl-select-trigger > span::after { content: ' px'; color: var(--artl-muted); font-size: 11px; }
        .artl-select-trigger svg { width: 14px; height: 14px; color: var(--artl-muted); }
        .artl-select-menu { position: absolute; z-index: 5; top: calc(100% + 5px); inset-inline: 0; display: flex; flex-direction: column; gap: 4px; max-height: 192px; overflow-y: auto; padding: 4px; border: 1px solid var(--artl-line); border-radius: 12px; background: var(--artl-base); box-shadow: 0 8px 24px #10081d20; }
        .artl-select-menu.above { top: auto; bottom: calc(100% + 5px); }
        .artl-widget-container .artl-select-option { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; width: 100%; min-height: 44px; padding: 8px; border: 0; border-radius: 8px; color: var(--artl-text); background: transparent; font-size: 13px; text-align: start; font-variant-numeric: tabular-nums; }
        .artl-select-option > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .artl-select-option svg { width: 14px; height: 14px; visibility: hidden; }
        .artl-select-option[aria-selected="true"] svg { visibility: visible; }
        .artl-widget-container .artl-select-option:is(:hover, .highlighted) { color: var(--artl-ink); background: var(--artl-soft); }
        .artl-widget-container .artl-widget-trigger { position: relative; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid var(--artl-line); border-radius: 22px; color: var(--artl-text); background: var(--artl-base); box-shadow: 0 4px 16px #10081d18; direction: ltr; }
        .artl-widget-trigger svg { width: 28px; height: 28px; }
        .artl-widget-container .artl-widget-trigger.active { color: var(--artl-on-accent); background: var(--artl-accent); border-color: var(--artl-accent); }
        .artl-widget-container[data-artl-selected-accent="true"] :is(.artl-widget-trigger.active, .artl-update-install) { border-color: var(--artl-ink); }
        .artl-widget-container :is(.artl-widget-trigger, .artl-update-install, .artl-confirm-actions button):active { transform: scale(.98); }
        .artl-update-badge { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border: 2px solid var(--artl-base); border-radius: 50%; background: #efae43; }
        @media (max-width: 400px) { .artl-widget-container { bottom: 16px; right: 16px; } .artl-panel-header { gap: 4px; } .artl-brand-mark { width: 20px; height: 20px; } .artl-brand-title { font-size: 16px; } }
        @media (prefers-reduced-motion: reduce) { .artl-widget-container *, .artl-widget-container *::before, .artl-widget-container *::after { transition: none !important; animation: none !important; } .artl-widget-panel, .artl-widget-container :is(.artl-widget-trigger, .artl-update-install, .artl-confirm-actions button):active { transform: none; } }
    `;
    injectStyle('artl-widget-style', staticCSS);

    function updateAppFontCSS(family) {
        if (!isRTL) { document.getElementById('artl-app-font-style')?.remove(); return; }
        const stack = [family, 'Vazir'].filter((value, index, all) => value && all.indexOf(value) === index)
            .map(value => JSON.stringify(value)).join(', ') + ', system-ui, sans-serif';
        // Keep code, terminal output and font-based icons on their host stacks.
        injectStyle('artl-app-font-style', `
            :root { --artl-app-font: ${stack} !important; --font-sans: ${stack} !important; --font-family-sans: ${stack} !important; --vscode-font-family: ${stack} !important; }
            body, body :where(*):not(:where(pre, pre *, code, code *, kbd, kbd *, samp, samp *,
                .monaco-editor, .monaco-editor *, .xterm, .xterm *, .terminal, .terminal *,
                [class*="font-mono"], [class*="font-mono"] *, [class*="codicon"], [class*="codicon"] *,
                .material-icons, .material-icons *, .material-symbols-outlined, .material-symbols-outlined *, svg, svg *)) {
                font-family: ${stack} !important;
            }
        `);
    }

    function updateDynamicCSS(faFont, enFont, codeFont, lh, fs) {
        // Distinct Latin families take precedence; shared Vazir is embedded once.
        const families = (appFontOverride ? [appFontOverride, 'Vazir'] : [enFont, faFont]).filter((family, index, list) => family && list.indexOf(family) === index);
        const stack = families.map(family => `'${family.replace(/'/g, "\\'")}', `).join('') + 'ui-sans-serif, system-ui, sans-serif, "Segoe UI Emoji"';

        const dynamicCSS = `
            :root {
                --vscode-font-family: ${stack} !important;
            }
            .artl-text-node,
            .monaco-chat-request,
            .monaco-chat-response,
            .interactive-input-part,
            .chat-input-part,
            [class*="ChatMarkdown"],
            [class*="ChatView"],
            [class*="chat-message"],
            [class*="thread-"],
            [data-user-message-body],
            [data-user-message-bubble],
            .rich-text-user-turn,
            [data-timeline-root],
            [data-timeline-row-id],
            [data-message-id],
            [data-message-role],
            [data-markdown-text-style],
            [data-markdown-copy],
            [data-codex-composer] .ProseMirror,
            [data-codex-composer-request-navigation],
            form[data-codex-character-input-boundary][data-codex-escape-boundary],
            [data-mcp-form-choices],
            [data-assistant-citation-viewport],
            [data-testid="composer-editor"],
            .composer-tiptap,
            .ProseMirror,
            .vertical-scroll-fade-mask [data-tooltip-overflow-target],
            :is([role="dialog"], [role="tooltip"]) .overscroll-contain.whitespace-pre-wrap,
            [data-queued-message-id],
            [data-queued-message-id] .whitespace-pre-wrap {
                font-family: ${stack} !important;
                font-size: ${fs}px !important;
                line-height: ${lh} !important;
            }
            .monaco-chat-request .value,
            .interactive-session .value {
                font-family: inherit !important;
                font-size: inherit !important;
            }
        `;
        if (isRTL) injectStyle('artl-rtl-style', dynamicCSS);
    }
    updateDynamicCSS(rtlConfig.faFont, rtlConfig.enFont, rtlConfig.codeFont, rtlConfig.lh, rtlConfig.fs);

    const UI = { settings: 'Rasta settings', close: 'Close settings', autoRTL: 'Enable RTL', forceRTL: 'Force RTL', fixAt: 'Type @ with Shift+2', faFont: 'Persian font', enFont: 'English font', appFont: 'Font', theme: 'Theme', size: 'Text size', spacing: 'Line height', check: 'Check for updates', restore: 'Remove Rasta', install: 'Download update', available: 'A Rasta update is ready', noUpdates: 'No updates available.', checkFailed: 'Couldn’t check for updates. Try again.', openFailed: 'Couldn’t open the installer. Try again.', removeTitle: 'Remove Rasta?', removeCopy: HOST_NAME + ' will close and reopen automatically after removal. The Rasta panel, helper, settings and added fonts will be deleted.', keep: 'Keep Rasta' };
    function icon(glyph, className = '') {
        const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg');
        for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
        if (className) svg.setAttribute('class', className);
        const path = document.createElementNS(ns, 'path'); path.setAttribute('d', glyph); svg.appendChild(path); return svg;
    }
    function brandIcon(className = '') {
        const svg = icon('M5.75 5H19.4Q20 5 20 5.6V7.9Q20 8.5 19.4 8.5H5.75a1.75 1.75 0 0 1 0-3.5ZM9.75 10.25H19.4Q20 10.25 20 10.85V13.15Q20 13.75 19.4 13.75H9.75a1.75 1.75 0 0 1 0-3.5ZM13.75 15.5H19.4Q20 15.5 20 16.1V18.4Q20 19 19.4 19H13.75a1.75 1.75 0 0 1 0-3.5Z', className);
        svg.setAttribute('stroke', 'none'); svg.setAttribute('fill', 'currentColor');
        return svg;
    }

    // Keep the chosen fill exact; derive readable icon/text colors separately.
    function accentColors(hex, background = '#ffffff') {
        const channels = value => {
            const raw = value.slice(1);
            return (raw.length === 3 ? raw.split('').map(part => part + part).join('') : raw).match(/../g).map(part => parseInt(part, 16));
        };
        const luminance = rgb => rgb.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; })
            .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
        const rgb = channels(hex), base = channels(background), white = [255, 255, 255], black = [0, 0, 0];
        const foreground = contrast(rgb, white) >= contrast(rgb, black) ? '#ffffff' : '#000000';
        const target = luminance(base) < .3 ? white : black;
        const soft = base.map((value, index) => value * .86 + rgb[index] * .14);
        let ink = rgb;
        for (let step = 0; step <= 100; step++) {
            ink = rgb.map((value, index) => Math.round(value + (target[index] - value) * step / 100));
            if (contrast(ink, base) >= 4.5 && contrast(ink, soft) >= 4.5) break;
        }
        return { foreground, ink: '#' + ink.map(value => value.toString(16).padStart(2, '0')).join('') };
    }

    function createWidget() {
        if (document.querySelector('.artl-widget-container')) return;
        const locale = 'en';
        const t = key => UI[key];
        function bind(node, key, attribute = '') {
            if (attribute) node.setAttribute(attribute, t(key)); else node.textContent = t(key);
            return node;
        }
        const container = document.createElement('div'); container.className = 'artl-widget-container';
        const panel = document.createElement('div'); panel.className = 'artl-widget-panel artl-theme-panel'; panel.id = 'artl-settings-panel';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'artl-panel-title'); panel.setAttribute('aria-hidden', 'true');
        const content = document.createElement('div'); content.className = 'artl-panel-content'; panel.appendChild(content);
        const header = document.createElement('div'); header.className = 'artl-panel-header';
        const title = document.createElement('h2'); title.id = 'artl-panel-title'; title.className = 'artl-brand-title'; title.textContent = 'Rasta'; title.title = 'Rasta — Right-to-left reading controls';
        const close = document.createElement('button'); close.type = 'button'; close.className = 'artl-icon-button artl-panel-close'; bind(close, 'close', 'aria-label'); close.appendChild(icon('M6 6l12 12M18 6 6 18'));
        header.appendChild(brandIcon('artl-brand-mark')); header.appendChild(title); content.appendChild(header);
        const toolbar = header;
        const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'artl-widget-trigger'; bind(trigger, 'settings', 'aria-label');
        trigger.setAttribute('aria-controls', panel.id); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.appendChild(brandIcon());
        let panelOpen = false;
        function setPanelOpen(open, restoreFocus = false) {
            panelOpen = open; panel.classList.toggle('open', open); panel.setAttribute('aria-hidden', String(!open)); trigger.setAttribute('aria-expanded', String(open));
            if (!open) { closeMenu?.(false); closeConfirmation?.(false); panel._artlDismissToast?.(); }
            if (open) toggleBtn.focus?.({ preventScroll: true }); else if (restoreFocus) trigger.focus?.({ preventScroll: true });
        }
        closeWidget = () => { if (panelOpen) setPanelOpen(false, true); };
        close.onclick = closeWidget; trigger.onclick = event => { event.stopPropagation(); setPanelOpen(!panelOpen); };
        onOutsideClick = event => {
            if (activeSelect && !activeSelect.element.contains(event.target)) closeMenu?.(false);
            if (!container.contains(event.target)) setPanelOpen(false);
        };
        document.addEventListener('click', onOutsideClick);
        let controlCount = 0, activeSelect = null;
        const selects = [];
        function createRow(key, element, group) {
            const row = document.createElement('div'); row.className = 'artl-row';
            if (key === 'faFont' || key === 'enFont' || key === 'appFont') row.className += ' artl-font-row';
            const copy = document.createElement('div'); copy.className = 'artl-label-copy';
            const control = element._artlControl || element; control.id ||= 'artl-setting-' + (++controlCount);
            const label = bind(document.createElement('label'), key); label.className = 'artl-label'; label.setAttribute('for', control.id); bind(control, key, 'aria-label'); if (element._artlMenu) bind(element._artlMenu, key, 'aria-label');
            copy.appendChild(label); row.appendChild(copy); row.appendChild(element); group.appendChild(row); return copy;
        }
        function syncToggle(button, active) { button.className = 'artl-toggle-btn-reset ' + (active ? 'active' : ''); button.setAttribute('aria-checked', String(active)); }
        function createToggle(id, active) {
            const button = document.createElement('button'); button.type = 'button'; button.id = id; button.setAttribute('role', 'switch'); syncToggle(button, active);
            const knob = document.createElement('span'); knob.className = 'artl-toggle-knob'; button.appendChild(knob); return button;
        }
        function createSelect(id, initial, options) {
            let value = options.some(option => option.value === initial) ? initial : options[0]?.value || '', opened = false, highlighted = 0;
            const listeners = [];
            const wrapper = document.createElement('div'); wrapper.className = 'artl-select';
            const button = document.createElement('button'); button.type = 'button'; button.id = id; button.className = 'artl-select-trigger'; button.setAttribute('role', 'combobox'); button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
            const display = document.createElement('span'); button.appendChild(display); button.appendChild(icon('m7 10 5 5 5-5')); wrapper.appendChild(button); wrapper._artlControl = button;
            const menu = document.createElement('div'); menu.className = 'artl-select-menu'; menu.id = id + '-menu'; menu.setAttribute('role', 'listbox'); menu.hidden = true; button.setAttribute('aria-controls', menu.id); wrapper.appendChild(menu); wrapper._artlMenu = menu;
            const format = raw => raw && Number.isFinite(Number(raw)) ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(raw)) : raw;
            const makeOption = (option, index) => {
                const item = document.createElement('button'); item.type = 'button'; item.className = 'artl-select-option'; item.id = id + '-option-' + index; item.tabIndex = -1; item.setAttribute('role', 'option'); item.setAttribute('data-value', option.value);
                const label = document.createElement('span'); label.textContent = format(option.label); item.appendChild(label); item.appendChild(icon('m5 12 4 4L19 6')); menu.appendChild(item);
                item.onclick = () => choose(index); return item;
            };
            let optionButtons = options.map(makeOption);
            function render() {
                display.textContent = format(options.find(option => option.value === value)?.label || value);
                optionButtons.forEach((item, index) => { item.setAttribute('aria-selected', String(options[index].value === value)); item.classList.toggle('highlighted', index === highlighted); item.children[0].textContent = format(options[index].label); });
                if (opened && optionButtons[highlighted]) { button.setAttribute('aria-activedescendant', optionButtons[highlighted].id); optionButtons[highlighted].scrollIntoView?.({ block: 'nearest' }); } else button.removeAttribute('aria-activedescendant');
            }
            function close(restoreFocus = true) { opened = false; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); closeMenu = null; activeSelect = null; render(); if (restoreFocus) button.focus?.({ preventScroll: true }); }
            function open() {
                closeMenu?.(false); opened = true; highlighted = Math.max(0, options.findIndex(option => option.value === value)); menu.hidden = false; button.setAttribute('aria-expanded', 'true');
                const rect = button.getBoundingClientRect?.(), bounds = panel.getBoundingClientRect?.();
                const menuHeight = Math.min(192, options.length * 44 + Math.max(0, options.length - 1) * 4 + 10);
                menu.classList.toggle('above', Boolean(rect && bounds && rect.bottom + menuHeight + 5 > bounds.bottom && rect.top - menuHeight - 5 > bounds.top));
                activeSelect = api; closeMenu = close; render();
            }
            function choose(index) { if (!options[index]) return; value = options[index].value; close(); listeners.forEach(listener => listener()); }
            button.onclick = () => opened ? close() : open();
            button.onkeydown = event => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault(); if (!opened) open(); else if (event.key === 'ArrowDown') highlighted = (highlighted + 1) % options.length; else if (event.key === 'ArrowUp') highlighted = (highlighted + options.length - 1) % options.length;
                    if (event.key === 'Home') highlighted = 0; if (event.key === 'End') highlighted = options.length - 1; render();
                } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (opened) choose(highlighted); else open(); }
                else if (event.key === 'Tab') close(false);
            };
            const api = { element: wrapper, getValue: () => value, onChange: listener => listeners.push(listener), render,
                setOptions(next, selected) { close(false); options = next; value = selected; highlighted = Math.max(0, options.findIndex(option => option.value === value)); optionButtons.forEach(item => item.remove()); optionButtons = options.map(makeOption); render(); } };
            selects.push(api); render(); return api;
        }
        const faFonts = __FA_FONTS__, enFonts = __EN_FONTS__;
        if (!faFonts.some(font => font.value === rtlConfig.faFont)) rtlConfig.faFont = faFonts[0]?.value || '';
        if (!enFonts.some(font => font.value === rtlConfig.enFont)) rtlConfig.enFont = enFonts[0]?.value || '';
        if (!FONT_SIZES.includes(String(rtlConfig.fs))) rtlConfig.fs = FONT_SIZES[0];
        if (!LINE_HEIGHTS.includes(String(rtlConfig.lh))) rtlConfig.lh = '1.6';
        const faFontSelector = createSelect('artl-fa-font', rtlConfig.faFont, faFonts), enFontSelector = createSelect('artl-en-font', rtlConfig.enFont, enFonts);
        const fsSelector = createSelect('artl-size', String(rtlConfig.fs), FONT_SIZES.map(value => ({ label: value, value })));
        const lhSelector = createSelect('artl-spacing', String(rtlConfig.lh), LINE_HEIGHTS.map(value => ({ label: value, value })));
        const toggleBtn = createToggle('artl-toggle-btn', isRTL), forceBtn = createToggle('artl-force-btn', forceRTL), atBtn = createToggle('artl-at-btn', fixAtSign);
        updateDynamicCSS(rtlConfig.faFont, rtlConfig.enFont, rtlConfig.codeFont, rtlConfig.lh, rtlConfig.fs);
        let renderUpdates = () => {};
        if (window.agentRTLNative) renderUpdates = createUpdateControls(panel, toolbar, trigger, window.agentRTLNative, t, bind, content);
        else if (AGENT_VERSION) {
            const version = document.createElement('span'); version.className = 'artl-version'; version.textContent = 'v' + AGENT_VERSION; version.title = 'Rasta ' + AGENT_VERSION; content.appendChild(version);
        }
        const readingGroup = document.createElement('div'); readingGroup.className = 'artl-settings-group';
        const typeGroup = document.createElement('div'); typeGroup.className = 'artl-settings-group artl-type-group';
        content.appendChild(readingGroup); content.appendChild(typeGroup);
        createRow('autoRTL', toggleBtn, readingGroup);
        createRow('forceRTL', forceBtn, readingGroup);
        createRow('fixAt', atBtn, readingGroup);
        if (faFonts.length > 1) createRow('faFont', faFontSelector.element, typeGroup);
        if (enFonts.length > 1) createRow('enFont', enFontSelector.element, typeGroup);
        createRow('size', fsSelector.element, typeGroup); createRow('spacing', lhSelector.element, typeGroup);
        header.appendChild(close);
        function syncState() {
            trigger.classList.toggle('active', isRTL); trigger.setAttribute('data-rtl-enabled', String(isRTL)); trigger.title = isRTL ? 'RTL enabled' : 'RTL disabled';
        }
        function renderUI() {
            container.setAttribute('lang', 'en'); container.setAttribute('dir', 'ltr');
            selects.forEach(select => select.render()); syncState(); renderUpdates();
        }
        const saveConfig = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ faFont: faFontSelector.getValue(), enFont: enFontSelector.getValue(), codeFont: '', lh: lhSelector.getValue(), fs: fsSelector.getValue(), isRTL, forceRTL, fixAtSign, theme: rtlConfig.theme, accent: rtlConfig.accent })); } catch {} };
        const onSettingsChange = () => { saveConfig(); syncState(); updateAppFontCSS(appFontOverride || enFontSelector.getValue()); if (isRTL) { updateDynamicCSS(faFontSelector.getValue(), enFontSelector.getValue(), '', lhSelector.getValue(), fsSelector.getValue()); updateDir(); } };
        toggleBtn.onclick = () => { isRTL = !isRTL; syncToggle(toggleBtn, isRTL); syncState(); saveConfig(); if (isRTL) onSettingsChange(); else { document.getElementById('artl-rtl-style')?.remove(); document.getElementById('artl-app-font-style')?.remove(); clearDir(); messageDirections?.sync(); } };
        forceBtn.onclick = () => { forceRTL = !forceRTL; syncToggle(forceBtn, forceRTL); saveConfig(); clearDir(); updateDir(); };
        atBtn.onclick = () => { fixAtSign = !fixAtSign; syncToggle(atBtn, fixAtSign); saveConfig(); };
        for (const select of selects) select.onChange(onSettingsChange);
        updateAppFontCSS(rtlConfig.enFont);
        createFontControls(typeGroup, createSelect, element => createRow('appFont', element, typeGroup), family => {
            appFontOverride = family;
            updateAppFontCSS(family || rtlConfig.enFont);
            updateDynamicCSS(faFontSelector.getValue(), enFontSelector.getValue(), '', lhSelector.getValue(), fsSelector.getValue());
        });
        const appearanceGroup = document.createElement('div'); appearanceGroup.className = 'artl-settings-group artl-appearance-group'; content.appendChild(appearanceGroup);
        const themeSelector = createSelect('artl-theme', rtlConfig.theme, [{ label: 'Auto', value: 'auto' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]);
        createRow('theme', themeSelector.element, appearanceGroup);
        themeSelector.element._artlControl.title = 'Auto follows the app appearance';
        const accentHeading = document.createElement('div'); accentHeading.className = 'artl-accent-heading';
        const accentLabel = document.createElement('span'); accentLabel.id = 'artl-accent-label'; accentLabel.textContent = 'Accent color';
        const accentValue = document.createElement('span'); accentValue.className = 'artl-accent-value';
        accentHeading.appendChild(accentLabel); accentHeading.appendChild(accentValue); appearanceGroup.appendChild(accentHeading);
        const accentOptions = document.createElement('div'); accentOptions.className = 'artl-accent-options'; accentOptions.setAttribute('role', 'group'); accentOptions.setAttribute('aria-labelledby', accentLabel.id); appearanceGroup.appendChild(accentOptions);
        const swatches = ACCENTS.map(preset => {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'artl-accent-swatch'; button.setAttribute('aria-label', preset.label + ' accent'); button.title = preset.label + ' accent';
            const dot = document.createElement('span'); dot.className = 'artl-accent-dot'; dot.appendChild(icon('m5 12 4 4L19 6')); button.appendChild(dot);
            button.style.setProperty('--artl-swatch', preset.value); button.style.setProperty('--artl-swatch-text', accentColors(preset.value).foreground);
            button.onclick = () => { closeMenu?.(false); rtlConfig.accent = preset.value; syncPalette(); saveConfig(); };
            accentOptions.appendChild(button); return button;
        });
        themeSelector.onChange(() => { rtlConfig.theme = themeSelector.getValue(); syncPalette(); saveConfig(); });
        let savedAppearance = '';
        function shareAppearance() {
            const value = JSON.stringify({ theme: rtlConfig.theme, accent: rtlConfig.accent });
            if (value === savedAppearance || typeof window.agentRTLNative?.setAppearance !== 'function') return;
            savedAppearance = value;
            window.agentRTLNative.setAppearance(JSON.parse(value)).catch(() => { savedAppearance = ''; });
        }
        renderUI(); container.appendChild(panel); container.appendChild(trigger); document.body.appendChild(container);
        function syncPalette() {
            shareAppearance();
            container.setAttribute('data-artl-theme', rtlConfig.theme);
            container.setAttribute('data-artl-selected-accent', String(rtlConfig.accent !== 'auto'));
            swatches.forEach((button, index) => button.setAttribute('aria-pressed', String(ACCENTS[index].value === rtlConfig.accent)));
            accentValue.textContent = ACCENTS.find(preset => preset.value === rtlConfig.accent)?.label || rtlConfig.accent.toUpperCase();
            for (const name of ['accent', 'text', 'muted', 'soft', 'on-accent', 'ink']) container.style.removeProperty('--artl-' + name);
            if (window.getComputedStyle && window.CSS?.supports) {
                const root = window.getComputedStyle(document.documentElement);
                for (const [own, host] of [['--artl-accent', '--app-color-accent-purple'], ['--artl-text', '--app-color-text-foreground'], ['--artl-muted', '--app-color-text-foreground-tertiary']]) {
                    if (rtlConfig.theme !== 'auto' && own !== '--artl-accent') continue;
                    const value = root.getPropertyValue(host).trim();
                    if (value && !/^(var\(|currentColor|inherit|initial|unset)/i.test(value) && window.CSS.supports('color', value)) container.style.setProperty(own, value);
                }
                const style = window.getComputedStyle(container);
                container.style.setProperty('--artl-brand-ink', accentColors('#ad8cf3', style.getPropertyValue('--artl-base').trim()).ink);
                if (rtlConfig.accent !== 'auto') {
                    const colors = accentColors(rtlConfig.accent, style.getPropertyValue('--artl-base').trim());
                    container.style.setProperty('--artl-accent', rtlConfig.accent);
                    container.style.setProperty('--artl-ink', colors.ink);
                    container.style.setProperty('--artl-on-accent', colors.foreground);
                    container.style.setProperty('--artl-soft', 'color-mix(in srgb, var(--artl-accent) 14%, var(--artl-base))');
                }
            }
            // Direction actions live outside the popover and copy its palette.
            window.dispatchEvent?.(new Event('agent-rtl-appearance-change'));
        }
        syncPalette();
        if (document.documentElement && window.getComputedStyle && window.CSS?.supports) {
            const observer = new MutationObserver(syncPalette); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
            const media = window.matchMedia?.('(prefers-color-scheme: dark)'); media?.addEventListener?.('change', syncPalette);
            disposeTheme = () => { observer.disconnect(); media?.removeEventListener?.('change', syncPalette); };
        }

    }

    // Native Codex shares its private catalog with AppKit. Other targets keep
    // their catalog in this browser profile; bytes never leave the device.
    function createFontControls(parent, createSelect, createRow, apply) {
        const key = 'agent-rtl-fonts', signal = 'agent-rtl-font-change';
        const native = window.agentRTLNative;
        const shared = native && ['fonts', 'importFont', 'selectFont'].every(method => typeof native[method] === 'function');
        const defaults = [{ label: 'Vazir', value: 'vazir' }];
        const select = createSelect('artl-app-font', 'vazir', defaults);
        const controls = document.createElement('div'); controls.className = 'artl-font-controls';
        controls._artlControl = select.element._artlControl; controls._artlMenu = select.element._artlMenu; controls.appendChild(select.element);
        const add = document.createElement('button'); add.type = 'button'; add.id = 'artl-font-add'; add.className = 'artl-icon-button artl-font-add'; add.setAttribute('aria-label', 'Add font'); add.title = 'Add font (TTF or OTF, up to 2 MB)'; add.appendChild(icon('M12 5v14M5 12h14')); controls.appendChild(add); createRow(controls);
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.ttf,.otf'; input.hidden = true; input.id = 'artl-font-file'; input.setAttribute('aria-label', 'Choose font file'); parent.appendChild(input);
        const error = document.createElement('p'); error.className = 'artl-font-error'; error.setAttribute('role', 'alert'); error.hidden = true; parent.appendChild(error);
        let selected = 'vazir', busy = false, disposed = false, refreshing = null;
        const loaded = new Map();
        const validID = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
        const setBusy = value => { busy = value; add.disabled = value; select.element._artlControl.disabled = value; add.setAttribute('aria-busy', String(value)); };
        const tell = message => { error.textContent = message; error.hidden = !message; };
        function localCatalog() {
            const value = localStorage.getItem(key);
            let saved;
            try { saved = JSON.parse(value || '{"selected":"vazir","fonts":[]}'); }
            catch { return { selected: 'vazir', fonts: [] }; }
            if (!Array.isArray(saved?.fonts)) return { selected: 'vazir', fonts: [] };
            return { selected: saved.selected, fonts: saved.fonts.filter(font => font && validID(font.id) && typeof font.label === 'string'
                && typeof font.data === 'string' && font.data.length <= 2796204 && /^[A-Za-z0-9+/]+=*$/.test(font.data)) };
        }
        function localState(saved) { return { selected: saved.selected, fonts: saved.fonts, active: saved.fonts.find(font => font.id === saved.selected) || null }; }
        async function loadFace(id, data) {
            if (!validID(id) || typeof data !== 'string' || data.length > 2796204 || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new Error('The font file is invalid.');
            const family = 'AgentRTLUser_' + id;
            if (!loaded.has(id)) {
                const face = new window.FontFace(family, `url("data:font/ttf;base64,${data}")`);
                await face.load();
                if (disposed) return family;
                document.fonts.add(face); loaded.set(id, face);
            }
            return family;
        }
        async function accept(state) {
            const active = state.active;
            const family = state.selected !== 'vazir' && active?.id === state.selected ? await loadFace(active.id, active.data) : '';
            if (disposed) return;
            selected = family ? active.id : 'vazir';
            select.setOptions([...defaults, ...state.fonts.filter(font => validID(font.id) && typeof font.label === 'string').map(font => ({ label: font.label === 'Vazir' ? 'Vazir (custom)' : font.label, value: font.id }))], selected);
            apply(family);
        }
        function refresh() {
            if (busy || disposed) return refreshing;
            setBusy(true);
            refreshing = (async () => {
                try { await accept(shared ? await native.fonts() : localState(localCatalog())); tell(''); }
                catch { tell('Couldn’t load saved fonts. Try again.'); }
                finally { refreshing = null; if (!disposed) setBusy(false); }
            })();
            return refreshing;
        }
        async function change(id, imported) {
            const previous = selected;
            let committed = false;
            setBusy(true); tell('');
            try {
                let state;
                if (shared) { state = imported ? await native.importFont(imported) : await native.selectFont(id); committed = true; }
                else {
                    const saved = localCatalog();
                    if (imported) {
                        if (!saved.fonts.some(font => font.id === id)) {
                            if (saved.fonts.length >= 20) throw new Error('You can add up to 20 fonts.');
                            saved.fonts.push({ id, label: imported.name.replace(/\.(ttf|otf)$/i, ''), data: imported.data });
                        }
                    }
                    saved.selected = id;
                    // Check decoding before committing, including restored/imported files.
                    const active = saved.fonts.find(font => font.id === id);
                    if (id !== 'vazir') { if (!active) throw new Error('This font is unavailable.'); await loadFace(id, active.data); }
                    localStorage.setItem(key, JSON.stringify(saved)); state = localState(saved);
                }
                await accept(state);
                try { localStorage.setItem(signal, String(Date.now()) + Math.random()); } catch {}
            } catch (failure) {
                if (shared && committed) { try { await native.selectFont(previous); } catch {} }
                select.setOptions(selectOptions(), previous);
                tell(failure?.name === 'QuotaExceededError' ? 'There isn’t enough browser storage for this font.'
                    : failure?.message === 'You can add up to 20 fonts.' ? failure.message : 'Couldn’t apply the font. Choose a valid TTF or OTF file up to 2 MB.');
            } finally { if (!disposed) setBusy(false); }
        }
        // Preserve the current catalog if an import or a persistence write fails.
        function selectOptions() {
            return Array.from(select.element._artlMenu.children).map(item => ({ value: item.getAttribute('data-value'), label: item.children[0].textContent }));
        }
        select.onChange(() => change(select.getValue()));
        add.onclick = () => { input.value = ''; input.click(); };
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || disposed) return;
            // Native file pickers restore window focus before dispatching change.
            // Finish that focus-triggered catalog read instead of dropping the file.
            if (refreshing) await refreshing;
            if (busy || disposed) return;
            if (!/\.(ttf|otf)$/i.test(file.name) || file.size === 0 || file.size > 2 * 1024 * 1024) { tell('Choose a TTF or OTF font up to 2 MB.'); return; }
            setBusy(true); tell('');
            try {
                const bytes = await file.arrayBuffer();
                const hash = await window.crypto.subtle.digest('SHA-256', bytes);
                const id = Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
                const data = new Uint8Array(bytes); let binary = '';
                for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
                const encoded = window.btoa(binary);
                await loadFace(id, encoded);
                if (!disposed) {
                    await change(id, { name: file.name, data: encoded });
                    if (!disposed && selected === id && controls.closest('[role="dialog"]')?.getAttribute('aria-hidden') === 'false') select.element._artlControl.focus?.({ preventScroll: true });
                }
            } catch { tell('Couldn’t read this font. Choose a valid TTF or OTF file.'); }
            finally { if (!disposed) setBusy(false); }
        };
        const onStorage = event => { if (event.key === key || event.key === signal) refresh(); };
        window.addEventListener('focus', refresh); window.addEventListener('storage', onStorage);
        disposeFonts = () => { disposed = true; window.removeEventListener('focus', refresh); window.removeEventListener('storage', onStorage); for (const face of loaded.values()) document.fonts.delete(face); };
        refresh();
    }

    function createUpdateControls(panel, toolbar, trigger, native, t, bind, content) {
        const actions = document.createElement('div'); actions.className = 'artl-update-actions'; toolbar.appendChild(actions);
        const version = document.createElement('span'); version.className = 'artl-version'; version.hidden = true; content.appendChild(version);
        const notice = document.createElement('div'); notice.className = 'artl-update-notice'; notice.hidden = true; content.appendChild(notice);
        const status = document.createElement('div'); status.id = 'artl-update-status'; status.textContent = t('available'); notice.appendChild(status);
        const notes = document.createElement('ul'); notes.className = 'artl-release-notes'; notes.hidden = true; notice.appendChild(notes);
        const toast = document.createElement('div'); toast.className = 'artl-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.hidden = true; panel.appendChild(toast);
        const toastIcon = icon('M9 12l2 2 4-4M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0');
        const toastCopy = document.createElement('span'); toast.append(toastIcon, toastCopy);
        const dismissToast = (immediate = false) => {
            clearTimeout(toastTimer); clearTimeout(toastExitTimer); toast.classList.remove('visible');
            if (immediate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) toast.hidden = true;
            else toastExitTimer = setTimeout(() => { toast.hidden = true; }, 160);
        };
        panel._artlDismissToast = () => dismissToast();
        const badge = document.createElement('span'); badge.className = 'artl-update-badge'; badge.hidden = true; badge.title = t('available'); trigger.appendChild(badge);
        let running = false, checking = false, latest = null;
        const tell = (message, kind = 'success') => {
            if (updatesDisposed || panel.getAttribute('aria-hidden') === 'true') return;
            clearTimeout(toastTimer); clearTimeout(toastExitTimer);
            toastCopy.textContent = message; toast.dataset.kind = kind;
            toastIcon.querySelector('path').setAttribute('d', kind === 'error' ? 'M12 8v4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0' : 'M9 12l2 2 4-4M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0');
            toast.hidden = false;
            // Commit the hidden pose so repeated feedback can retarget its transition.
            void toast.offsetHeight; toast.classList.add('visible');
            toastTimer = setTimeout(dismissToast, 4000);
        };
        const makeButton = (parent, id, key, fn, glyph = '') => {
            const button = document.createElement('button'); button.type = 'button'; button.id = id; bind(button, key, 'aria-label'); bind(button, key, 'title');
            if (glyph) { button.className = 'artl-icon-button'; button.appendChild(icon(glyph)); } else bind(button, key);
            button.addEventListener('click', fn); parent.appendChild(button); return button;
        };
        const refreshGlyph = 'M3 12a9 9 0 0 1 9-9c2.5 0 4.9 1 6.7 2.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9c-2.5 0-4.9-1-6.7-2.7L3 16M8 16H3v5';
        const check = makeButton(actions, 'artl-update-check', 'check', () => checkNow(true), refreshGlyph);
        const restore = makeButton(actions, 'artl-update-restore', 'restore', confirmRemoval, 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');
        const update = makeButton(notice, 'artl-update-install', 'install', () => openUpdate(latest)); update.className = 'artl-update-install';
        const active = new Set(['starting', 'checking', 'downloading-agent', 'downloading-app', 'verifying', 'preparing', 'ready-to-install', 'quitting', 'waiting-for-quit', 'installing']);
        function render() {
            const available = Boolean(latest?.available && latest.release);
            status.textContent = available ? `Rasta ${latest.release.agentVersion} is ready` : t('available');
            notes.replaceChildren();
            for (const text of (Array.isArray(latest?.release?.releaseNotes) ? latest.release.releaseNotes : []).slice(0, 3)) {
                if (typeof text !== 'string') continue;
                const item = document.createElement('li'); item.textContent = text.slice(0, 120); notes.appendChild(item);
            }
            notes.hidden = !notes.children.length;
            check.disabled = checking || running; restore.disabled = running || checking; update.disabled = running || !available;
            check.classList.toggle('is-loading', checking);
            check.querySelector('path').setAttribute('d', checking ? 'M21 12a9 9 0 1 1-9-9' : refreshGlyph);
            check.title = checking ? 'Checking for updates…' : t('check');
            check.setAttribute('aria-busy', String(checking)); badge.hidden = !available || running; notice.hidden = !available || running;
        }
        async function refresh() {
            if (updatesDisposed) return;
            try {
                const value = await native.status(); if (updatesDisposed) return;
                const currentVersion = value.installedAgentVersion || value.agentVersion;
                version.textContent = currentVersion ? `v${currentVersion}` : ''; version.hidden = !currentVersion; version.title = currentVersion ? `Rasta ${currentVersion}` : '';
                running = Boolean(value.running || active.has(value.operation?.phase)); latest = value.update || latest; render();
                if (value.operation?.action === 'restore' && value.operation?.phase === 'failed') tell('Couldn’t remove Rasta. Try again.', 'error');
                if (running) updatePoll = setTimeout(refresh, 1000);
            } catch { if (!updatesDisposed) { running = false; render(); } }
        }
        async function start(action) {
            running = true; render();
            try {
                await native[action]();
                if (action === 'restore') {
                    const keys = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key === STORAGE_KEY || key === 'agent-rtl-fonts' || key === 'agent-rtl-font-change' || key?.startsWith('agent-rtl:message-direction:v1:')) keys.push(key);
                    }
                    for (const key of keys) localStorage.removeItem(key);
                }
                await refresh();
            }
            catch { running = false; render(); tell(t('openFailed'), 'error'); }
        }
        async function openUpdate(release) {
            if (release?.supported) await start('prepare');
            else { try { await native.open(); } catch { tell(t('openFailed'), 'error'); } }
        }
        async function checkNow(explicit = false) {
            if (checking || running || updatesDisposed) return;
            checking = true; render();
            try {
                const release = await native.check(); if (updatesDisposed) return;
                if (release.releaseError) { if (explicit) tell(t('checkFailed'), 'error'); return; }
                latest = release; render();
                if (explicit) {
                    if (release.available && release.release) notice.scrollIntoView?.({ block: 'nearest' });
                    else if (release.requiresAppUpdate || !release.supported) { try { await native.open(); } catch { tell(t('openFailed'), 'error'); } }
                    else tell(t('noUpdates'));
                }
            } catch { if (explicit && !updatesDisposed) tell(t('checkFailed'), 'error'); }
            finally { checking = false; if (!updatesDisposed) render(); }
        }
        function confirmRemoval() {
            if (closeConfirmation || running) return;
            dismissToast(true);
            const dialog = document.createElement('div'); dialog.id = 'artl-remove-confirm'; dialog.className = 'artl-confirm'; dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'artl-remove-title'); dialog.setAttribute('aria-describedby', 'artl-remove-copy');
            const title = document.createElement('h3'); title.id = 'artl-remove-title'; title.textContent = t('removeTitle');
            const copy = document.createElement('p'); copy.id = 'artl-remove-copy'; copy.textContent = t('removeCopy');
            const buttons = document.createElement('div'); buttons.className = 'artl-confirm-actions';
            const keep = document.createElement('button'); keep.type = 'button'; keep.textContent = t('keep');
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'artl-danger'; remove.textContent = t('restore');
            buttons.appendChild(keep); buttons.appendChild(remove); dialog.appendChild(icon('M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', 'artl-confirm-icon')); dialog.appendChild(title); dialog.appendChild(copy); dialog.appendChild(buttons);
            const siblings = Array.from(panel.children); siblings.forEach(child => { child.inert = true; }); panel.appendChild(dialog);
            closeConfirmation = (focus = true) => { siblings.forEach(child => { child.inert = false; }); dialog.remove(); closeConfirmation = null; if (focus) restore.focus?.({ preventScroll: true }); };
            keep.onclick = event => { event.stopPropagation(); closeConfirmation?.(); };
            remove.onclick = event => { event.stopPropagation(); closeConfirmation?.(false); start('restore'); };
            dialog.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === keep ? remove : keep).focus(); } });
            keep.focus?.({ preventScroll: true });
        }
        refresh().then(() => { if (!updatesDisposed && !running) checkNow(); });
        updateCheck = setInterval(() => checkNow(), 4 * 3600000);
        return render;
    }

    let onOutsideClick;
    if (document.body) createWidget();
    else window.addEventListener('DOMContentLoaded', createWidget, { once: true });

    /* __CODEX_MESSAGE_DIRECTIONS__ */
    const contextFactory = window.location?.protocol === 't3code:' && typeof createT3MessageContext === 'function'
        ? createT3MessageContext : typeof createCodexMessageContext === 'function' ? createCodexMessageContext : null;
    const messageContext = contextFactory ? contextFactory({ document, window, changed: () => updateDir() }) : null;
    const messageDirections = typeof createCodexMessageDirections === 'function'
        ? createCodexMessageDirections({ document, window, context: messageContext, enabled: () => isRTL,
            refresh: () => updateDir(), icon, beforeOpen: () => { closeMenu?.(false); closeWidget?.(); } }) : null;

    // Elements we have touched, tracked explicitly so clearDir() can undo them
    // even if React later rewrites their className and drops our marker class.
    const directedNodes = new Map();

    // The chat / typing environment: conversation text, the composer, and the
    // pending question / approval surfaces (option buttons + custom-answer
    // prompt) that T3 renders inside the composer. Force RTL must stay inside
    // this scope so the app chrome (sidebar, toolbar, menus) keeps its own
    // direction.
    // T3 v0.0.44 moved assistant messages into a virtualized timeline with no
    // ChatMarkdown/chat-message classes: rows carry data-timeline-row-id +
    // data-message-id / data-message-role under [data-timeline-root], user
    // bubbles carry [data-user-message-body], and the composer is TipTap
    // (.composer-tiptap / .ProseMirror / [data-testid="composer-editor"]).
    // All of them are listed here; legacy selectors are kept for older builds
    // across supported app views.
    const CONTENT_SCOPE = '.chat-markdown, [class*="ChatMarkdown"], [class*="chat-message"], [data-user-message-body], [data-user-message-footer], [data-timeline-root], [data-timeline-row-id], [data-message-id], [data-message-role], [data-assistant-citation-viewport], [data-queued-message-id], [data-testid="composer-editor"], [data-composer-rich-text], .composer-tiptap, .ProseMirror, [contenteditable="true"], textarea, .monaco-chat-request, .monaco-chat-response, .interactive-input-part, .chat-input-part, .interactive-session, [data-chat-composer-surface], [data-chat-composer-body], [data-chat-composer-main-surface], [data-chat-composer-top-drawer], [data-chat-composer-overlay], [data-chat-composer-tasks-drawer], [data-pending-user-input-toggle], [data-approval-detail]';

    // Sent messages use rich-text-user-turn and a bubble, while MCP questions
    // use a form boundary instead of the main composer's request attribute.
    const CODEX_MESSAGE_SCOPE = '[data-user-message-bubble], .rich-text-user-turn';
    // Codex's queue uses a clipped markdown preview instead of T3's queued
    // message IDs. Its full-text preview is rendered in a separate portal.
    const CODEX_QUEUE_SCOPE = '.vertical-scroll-fade-mask [data-tooltip-overflow-target], :is([role="dialog"], [role="tooltip"]) .overscroll-contain.whitespace-pre-wrap';
    const CODEX_QUESTION_SCOPE = '[data-codex-composer-request-navigation], form[data-codex-character-input-boundary][data-codex-escape-boundary], [data-mcp-form-choices]';
    const CODEX_CONTENT_SCOPE = `[data-markdown-text-style], [data-markdown-copy], [data-codex-composer], ${CODEX_MESSAGE_SCOPE}, ${CODEX_QUESTION_SCOPE}, ${CODEX_QUEUE_SCOPE}`;
    const CODEX_FORCE_SCOPE = `[data-markdown-text-style], [data-markdown-copy], ${CODEX_MESSAGE_SCOPE}, ${CODEX_QUESTION_SCOPE}, ${CODEX_QUEUE_SCOPE}`;

    function inContentScope(el) {
        return !!(el.closest && el.closest(`${CONTENT_SCOPE}, ${CODEX_CONTENT_SCOPE}`));
    }

    // Forced RTL is scoped to readable content: the message transcript, the
    // pending/approval cards and the actual typed text (editor, fields).
    // Composer chrome (model bar, send row, footer toolbar, resting controls)
    // is deliberately NOT listed, so turning on Force RTL never flips the
    // prompt section layout — chrome keeps auto direction.
    const FORCE_SCOPE = '.chat-markdown, [class*="ChatMarkdown"], [class*="chat-message"], [data-user-message-body], [data-user-message-footer], [data-timeline-root], [data-timeline-row-id], [data-message-id], [data-message-role], [data-assistant-citation-viewport], [data-queued-message-id], [data-testid="composer-editor"], [data-composer-rich-text], .composer-tiptap, .ProseMirror, [contenteditable="true"], textarea, input, .monaco-chat-request, .monaco-chat-response, .interactive-input-part, .chat-input-part, .interactive-session, [data-chat-composer-top-drawer], [data-chat-composer-tasks-drawer], [data-pending-user-input-toggle], [data-approval-detail]';

    function inForceScope(el) {
        return !!(el.closest && el.closest(`${FORCE_SCOPE}, ${CODEX_FORCE_SCOPE}`));
    }

    function updateDir() {
        messageDirections?.sync();
        if (!isRTL) return;

        const allElements = document.querySelectorAll('*');
        const textElements = [];
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tag = el.tagName;

            // BUTTON carries multi-choice option labels (and the "type your own
            // answer" prompt): directing it flips its flex row so the icon /
            // checkmark moves to the right and the text right-aligns.
            if (['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'SPAN', 'BUTTON', 'LABEL', 'LEGEND', 'TEXTAREA'].includes(tag)) {
                textElements.push(el);
                continue;
            }
            // A question choice is a flex row containing its marker and label.
            // Direct the semantic row too, so the marker follows RTL text even
            // when the app renders a DIV instead of a BUTTON or LABEL.
            if (['radio', 'checkbox'].includes(el.getAttribute('role')) && el.closest(CODEX_QUESTION_SCOPE)) {
                textElements.push(el);
                continue;
            }
            if (tag === 'INPUT') {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                if (['text', 'search', 'url', 'email', 'tel'].includes(type)) textElements.push(el);
                continue;
            }
            if (el.getAttribute('contenteditable') === 'true') {
                textElements.push(el);
                continue;
            }
            // A DIV qualifies only when it directly holds text and no element
            // children. Directing chat/thread/prompt wrapper DIVs flips their
            // flex/grid layout (the model bar + send button), so containers are
            // left alone — text nodes and the input carry the direction.
            if (tag === 'DIV' && el.children.length === 0 && el.textContent.trim().length > 0) {
                textElements.push(el);
            }
        }

        textElements.forEach(el => {
            if (el.closest('.artl-widget-container')) return;
            if (messageDirections?.owns(el)) return;
            if (el.closest('pre, code, .cm-editor, .xterm, [data-composer-code-block]')) return;
            if (el.closest('.monaco-editor') && !el.closest('.interactive-input-part, .chat-input-part, [class*="message"], [class*="request"], [data-message-id], [data-timeline-root], [data-user-message-body]')) return;

            // Form fields keep their text in .value, not .textContent.
            const isField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
            const raw = isField ? el.value : el.textContent;
            const text = (raw || '').replace(/[؀-؏﻿]/g, '').trim();
            if (!text) return;

            // Direction stays inside chat and typing content; app layout is never mirrored.
            if (!inContentScope(el)) return;

            if (!directedNodes.has(el)) {
                directedNodes.set(el, {
                    dir: el.getAttribute('dir'),
                    marked: el.classList.contains('artl-text-node'),
                    styles: ['direction', 'text-align', 'unicode-bidi'].map(name => [
                        name, el.style.getPropertyValue ? el.style.getPropertyValue(name) : '',
                        el.style.getPropertyPriority ? el.style.getPropertyPriority(name) : '',
                    ]),
                });
            }

            let dir = 'auto';
            const messageDirection = messageDirections?.directionFor(el);
            if (messageDirection) {
                dir = messageDirection;
            } else if (forceRTL && inForceScope(el)) {
                dir = 'rtl';
            } else {
                const firstChar = text.match(/[A-Za-z؀-ۿ]/);
                if (firstChar) {
                    dir = /[؀-ۿ]/.test(firstChar[0]) ? 'rtl' : 'ltr';
                }
            }

            if (!el.classList.contains('artl-text-node')) {
                el.classList.add('artl-text-node');
            }

            if (el.getAttribute('dir') !== dir) {
                el.setAttribute('dir', dir);

                if (dir === 'rtl') {
                    el.style.setProperty('text-align', 'right', 'important');
                    el.style.setProperty('direction', 'rtl', 'important');
                    el.style.setProperty('unicode-bidi', 'isolate', 'important');
                } else {
                    el.style.setProperty('text-align', 'left', 'important');
                    el.style.setProperty('direction', 'ltr', 'important');
                    el.style.setProperty('unicode-bidi', 'isolate', 'important');
                }
            }
        });
    }

    // Undo everything updateDir() applied. Called when RTL is switched off so
    // previously directed text returns to the app's own layout instead of
    // keeping stale inline dir / direction styles.
    function clearDir() {
        directedNodes.forEach((original, el) => {
            if (original.dir === null) el.removeAttribute('dir');
            else el.setAttribute('dir', original.dir);
            if (!original.marked) el.classList.remove('artl-text-node');
            original.styles.forEach(([name, value, priority]) => {
                if (value) el.style.setProperty(name, value, priority);
                else el.style.removeProperty(name);
            });
        });
        directedNodes.clear();
    }

    document.addEventListener('input', updateDir, { capture: true });

    let updateDirRAF = null;
    const observer = new MutationObserver((mutations) => {
        if (!isRTL) return;
        let needsUpdate = false;
        for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0 || mutations[i].removedNodes.length > 0 || mutations[i].type === 'characterData' || mutations[i].type === 'attributes') {
                needsUpdate = true;
                break;
            }
        }
        if (needsUpdate) {
            if (updateDirRAF) cancelAnimationFrame(updateDirRAF);
            updateDirRAF = requestAnimationFrame(() => {
                updateDir();
            });
        }
    });

    if (document.body) {
        observer.observe(document.body, messageObserverOptions());
    } else {
        document.addEventListener('DOMContentLoaded', observeBody, { once: true });
    }

    function observeBody() {
        if (document.body) {
            observer.observe(document.body, messageObserverOptions());
        }
    }

    function messageObserverOptions() {
        return { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['data-response-annotation-conversation', 'data-response-annotation-target',
                'data-app-shell-active-page', 'data-app-shell-focus-area', 'data-app-shell-main-surface'] };
    }

    const interval = setInterval(() => {
        if (isRTL) updateDir();
    }, 1500);

    function onKeyDown(e) {
        if (e.code === 'Escape' || e.key === 'Escape') {
            if (closeConfirmation) { closeConfirmation(); e.preventDefault?.(); e.stopPropagation?.(); return; }
            if (messageDirections?.dismiss(true)) { e.preventDefault?.(); e.stopPropagation?.(); return; }
            if (closeMenu) { closeMenu(); e.preventDefault?.(); e.stopPropagation?.(); return; }
            closeWidget?.();
        }
        if (closeConfirmation) return;
        if (e.altKey && e.code === 'KeyR') {
            const toggle = document.getElementById('artl-toggle-btn');
            if (toggle) toggle.click();
        }
        if (fixAtSign && e.code === 'Digit2' && e.shiftKey && inContentScope(e.target)) {
            if (e.key === '٬' || e.key === '،') {
                e.preventDefault();
                document.execCommand('insertText', false, '@');
            }
        }
    }
    document.addEventListener('keydown', onKeyDown, { capture: true });

    window.__agentRTLPro = {
        dispose() {
            updatesDisposed = true;
            messageContext?.dispose(); messageDirections?.dispose();
            closeWidget = null; closeMenu = null; closeConfirmation = null; clearTimeout(toastTimer); clearTimeout(toastExitTimer); disposeTheme?.(); disposeTheme = null; disposeFonts?.(); disposeFonts = null;
            if (updatePoll) clearTimeout(updatePoll);
            if (updateCheck) clearInterval(updateCheck);
            observer.disconnect();
            if (updateDirRAF) cancelAnimationFrame(updateDirRAF);
            clearInterval(interval);
            document.removeEventListener('input', updateDir, { capture: true });
            document.removeEventListener('keydown', onKeyDown, { capture: true });
            document.removeEventListener('click', onOutsideClick);
            document.removeEventListener('DOMContentLoaded', observeBody);
            document.removeEventListener('DOMContentLoaded', updateDir);
            window.removeEventListener('DOMContentLoaded', createWidget);
            clearDir();
            ['artl-rtl-style', 'artl-widget-style', 'artl-layout-style', 'artl-app-font-style'].forEach(id => {
                const style = document.getElementById(id);
                if (style) style.remove();
            });
            const widget = document.querySelector('.artl-widget-container');
            if (widget) widget.remove();
            window.__agentRTLPro = { disabled: true };
        },
    };
    if (document.body) updateDir();
    else document.addEventListener('DOMContentLoaded', updateDir, { once: true });

})();
