import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { patchHtml } from '../bin/lib/html.js';

const MIN_HTML = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';

describe('patchHtml', () => {
    it('injects the payload script before </body>', () => {
        const { html, changed, alreadyPatched } = patchHtml(MIN_HTML);
        assert.equal(changed, true);
        assert.equal(alreadyPatched, false);
        assert.ok(html.includes('<script src="./rasta-payload.js"></script>'));
        assert.ok(html.indexOf('rasta-payload.js') < html.indexOf('</body>'));
    });

    it('is idempotent', () => {
        const once = patchHtml(MIN_HTML).html;
        const twice = patchHtml(once);
        assert.equal(twice.alreadyPatched, true);
        assert.equal(twice.changed, false);
        assert.equal(twice.html, once);
        assert.equal(once.match(/rasta-payload\.js/g).length, 1);
    });

    it('relaxes font-src CSP when present without data:', () => {
        const csp = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; font-src \'self\'; style-src \'self\'"></head><body></body></html>';
        const { html } = patchHtml(csp);
        assert.ok(html.includes('font-src \'self\' data:;'));
    });

    it('preserves Codex entity-encoded CSP when inline fonts are already allowed', () => {
        const meta = '<meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;; style-src &#39;self&#39; &#39;unsafe-inline&#39;; font-src &#39;self&#39; data:;">';
        assert.ok(patchHtml(`<html><head>${meta}</head><body></body></html>`).html.includes(meta));
    });

    it('adds data fonts without splitting encoded quotes or changing other CSP directives', () => {
        const meta = '<meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;; font-src &#39;self&#39;; style-src &#39;self&#39;">';
        const { html } = patchHtml(`<html><head>${meta}</head><body></body></html>`);
        assert.ok(html.includes('font-src &#39;self&#39; data:;'));
        assert.ok(html.includes('script-src &#39;self&#39;;'));
        assert.ok(html.includes('style-src &#39;self&#39;'));
    });

    it('falls back to </html> when no <body>', () => {
        const { html, changed } = patchHtml('<html><head></head></html>');
        assert.equal(changed, true);
        assert.ok(html.includes('rasta-payload.js'));
    });
});
