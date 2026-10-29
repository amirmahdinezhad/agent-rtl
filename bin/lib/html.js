export const PAYLOAD_FILENAME = 'rasta-payload.js';

// Patch a single HTML string by injecting the payload script tag and
// allowing embedded fonts in CSP when needed.
// Returns { html, changed, alreadyPatched }. Pure function — safe to test.
export function patchHtml(html, { scriptSrc = `./${PAYLOAD_FILENAME}` } = {}) {
    if (html.includes(PAYLOAD_FILENAME)) return { html, changed: false, alreadyPatched: true };
    html = html.replace(/<meta\b[^>]*>/gi, meta => {
        if (!/\bhttp-equiv\s*=\s*(["'])Content-Security-Policy\1/i.test(meta)) return meta;
        return meta.replace(/(\bcontent\s*=\s*)(["'])(.*?)\2/gi, (attribute, prefix, quote, policy) => {
            // Entity terminators (e.g. &#39;) are not CSP directive separators.
            // Keep the original policy byte-for-byte when data fonts are
            // already allowed, as they are in Codex's production HTML.
            const fonts = /\bfont-src((?:&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);|[^;])*)(;|$)/gi;
            let found = false;
            let next = policy.replace(fonts, (directive, sources, end) => {
                found = true;
                return /(?:^|\s)data:(?:\s|$)/.test(sources) ? directive : `font-src${sources} data:${end}`;
            });
            if (!found && /\bstyle-src\b/.test(policy)) next = policy.replace(/\bstyle-src\b/, 'font-src &#39;self&#39; data:; style-src');
            return next === policy ? attribute : `${prefix}${quote}${next}${quote}`;
        });
    });

    const tag = `  <script src="${scriptSrc}"></script>`;
    if (html.includes('</body>')) {
        html = html.replace('</body>', `${tag}\n</body>`);
    } else {
        html = html.replace('</html>', `${tag}\n</html>`);
    }
    return { html, changed: true, alreadyPatched: false };
}
