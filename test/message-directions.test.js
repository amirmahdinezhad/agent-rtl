import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexMessageContext } from '../bin/payloads/codex-message-context.js';

function fixture() {
    const window = new EventTarget();
    window.location = { pathname: '/' };
    const focus = { getAttribute: () => 'main' };
    const root = { getClientRects: () => [{}], closest: selector => selector.includes('focus-area') ? focus : null };
    let conversations = ['thread-a'];
    root.querySelectorAll = () => conversations.map(id => ({
        getAttribute: () => id,
        closest: selector => selector === '.thread-scroll-container' ? root : focus,
    }));
    let roots = [root];
    const shell = { closest: () => null, getClientRects: () => [{}], querySelectorAll: () => roots };
    const document = { querySelectorAll: () => [shell] };
    let changes = 0;
    const context = createCodexMessageContext({ document, window, changed: () => changes++ });
    const emit = (target, type = 'app-shell-shortcut-state-changed') => {
        const event = new Event('codex-message-from-view');
        event.detail = { type, quickChatAppshotThreadTarget: target };
        window.dispatchEvent(event);
    };
    return { context, emit, window, root, setRoots: value => { roots = value; },
        setConversations: value => { conversations = value; }, changes: () => changes };
}

describe('local assistant message context', () => {
    it('requires explicit matching local route metadata, rather than a URL or a guessed host', () => {
        const f = fixture();
        assert.equal(f.context.current(), null);
        for (const target of [null, {}, { conversationId: 'thread-a' }, { conversationId: 'thread-a', hostId: '' },
            { conversationId: 'thread-a', hostId: 'durable' }, { conversationId: 'thread-a', hostId: 'ssh:dev' },
            { conversationId: 'thread-b', hostId: 'local' }]) {
            f.emit(target);
            assert.equal(f.context.current(), null);
        }
        f.emit({ conversationId: 'thread-a', hostId: 'local' });
        assert.deepEqual(f.context.current(), { conversationId: 'thread-a', root: f.root });
        f.context.dispose();
    });

    it('withdraws eligibility during navigation, cleanup and remote-host changes with the same chat ID', () => {
        const f = fixture();
        f.emit({ conversationId: 'thread-a', hostId: 'local' });
        assert.ok(f.context.current());
        f.emit({ conversationId: 'thread-a', hostId: 'ssh:dev' });
        assert.equal(f.context.current(), null);
        f.emit({ conversationId: 'thread-a', hostId: 'local' });
        f.emit(null);
        assert.equal(f.context.current(), null);
        assert.equal(f.changes(), 4);
        f.context.dispose();
    });

    it('rejects secondary windows, missing or ambiguous roots and mixed conversation identities', () => {
        const f = fixture();
        f.emit({ conversationId: 'thread-a', hostId: 'local' });
        f.window.location.pathname = '/detached-window.html';
        assert.equal(f.context.current(), null);
        f.window.location.pathname = '/';
        f.setConversations(['thread-a', 'thread-b']);
        assert.equal(f.context.current(), null);
        f.setConversations(['thread-a']);
        f.setRoots([]);
        assert.equal(f.context.current(), null);
        f.setRoots([f.root, f.root]);
        assert.equal(f.context.current(), null);
        f.context.dispose();
    });

    it('ignores unrelated events and removes the route listener on disposal', () => {
        const f = fixture();
        f.emit({ conversationId: 'thread-a', hostId: 'local' }, 'other-message');
        assert.equal(f.context.current(), null);
        assert.equal(f.changes(), 0);
        f.context.dispose();
        f.emit({ conversationId: 'thread-a', hostId: 'local' });
        assert.equal(f.context.current(), null);
        assert.equal(f.changes(), 0);
    });
});
