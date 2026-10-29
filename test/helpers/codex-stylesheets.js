import * as asar from '@electron/asar';

// Read the vendor's actual entry-point styles, including builds with hashed names.
export function codexStylesheets(archive) {
    const files = new Set();
    for (const entry of ['webview/index.html', 'webview/detached-window.html']) {
        const html = asar.extractFile(archive, entry).toString();
        for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
            if (!/\brel=["']stylesheet["']/i.test(link[0])) continue;
            const href = link[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
            if (!href) continue;
            const url = new URL(href, `https://fixture.invalid/${entry}`);
            if (url.origin === 'https://fixture.invalid' && /^\/webview\/assets\/[^/]+\.css$/.test(url.pathname)) {
                asar.statFile(archive, url.pathname.slice(1));
                files.add(url.pathname);
            }
        }
    }
    return [...files];
}
