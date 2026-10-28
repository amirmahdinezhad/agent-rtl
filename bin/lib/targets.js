import fs from 'fs';
import path from 'path';
import os from 'os';

export const PAYLOAD_FILENAME = 'agent-rtl-payload.js';
export const BACKUP_SUFFIX = '.bak';
export const PATCH_MARKER = 'AGENT RTL PRO PATCH';

// ARTL_PATCH_ANCHOR is appended to patched HTML files so --status and
// re-runs can detect an existing injection without parsing the payload.
export const HTML_INJECT_ANCHOR = 'agent-rtl-payload.js';

function firstExisting(candidates) {
    for (const p of candidates) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch { /* ignore */ }
    }
    return null;
}

function globAppDir(pattern) {
    // Minimal glob for macOS "/Applications/T3*.app" style patterns
    // (avoids adding a dependency for a single lookup).
    const dir = path.dirname(pattern);
    const base = path.basename(pattern);
    const star = base.indexOf('*');
    if (star === -1) return fs.existsSync(pattern) ? pattern : null;
    const prefix = base.slice(0, star);
    const suffix = base.slice(star + 1);
    let entries = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null;
    }
    const match = entries
        .filter((e) => e.startsWith(prefix) && e.endsWith(suffix))
        .sort()
        .map((e) => path.join(dir, e))[0];
    return match || null;
}

export const TARGETS = {
    opencode: {
        id: 'opencode',
        label: 'OpenCode',
        // Path to app.asar inside the Electron bundle per OS.
        asarCandidates() {
            if (os.platform() === 'darwin') {
                return ['/Applications/OpenCode.app/Contents/Resources/app.asar'];
            }
            if (os.platform() === 'win32') {
                const local = process.env.LOCALAPPDATA || '';
                return [
                    path.join(local, 'Programs', 'OpenCode', 'resources', 'app.asar'),
                    path.join(local, 'OpenCode', 'resources', 'app.asar'),
                ];
            }
            return [
                '/opt/OpenCode/resources/app.asar',
                '/usr/lib/opencode/resources/app.asar',
            ];
        },
        // Files inside the asar to patch (relative, no leading slash).
        htmlPaths: ['out/renderer/index.html'],
    },
    t3: {
        id: 't3',
        label: 'T3 Code',
        asarCandidates() {
            if (os.platform() === 'darwin') {
                const globbed = globAppDir('/Applications/T3*.app');
                const found = [];
                if (globbed) found.push(path.join(globbed, 'Contents', 'Resources', 'app.asar'));
                // Known exact names as fallback (glob already covers them).
                found.push(
                    '/Applications/T3 Code (Alpha).app/Contents/Resources/app.asar',
                    '/Applications/T3 Code.app/Contents/Resources/app.asar',
                );
                return found;
            }
            if (os.platform() === 'win32') {
                const local = process.env.LOCALAPPDATA || '';
                return [
                    path.join(local, 'Programs', 'T3 Code', 'resources', 'app.asar'),
                ];
            }
            return ['/opt/T3 Code/resources/app.asar'];
        },
        htmlPaths: ['apps/server/dist/client/index.html'],
    },
    codex: {
        id: 'codex',
        label: 'Codex',
        mode: 'codex-native',
    },
};

export function resolveAsar(target) {
    if (target.mode === 'codex-native') return null;
    // Test hook: ARTL_ASAR_OPENCODE / ARTL_ASAR_T3 override auto-detection.
    const override = process.env[`ARTL_ASAR_${target.id.toUpperCase()}`];
    if (override && fs.existsSync(override)) return override;
    return firstExisting(target.asarCandidates());
}

export function listTargets() {
    return Object.values(TARGETS);
}
