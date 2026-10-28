#!/usr/bin/env node
import { guiPaths, readJSON } from './lib/gui-runtime.js';
import { resolveGUIApp } from './lib/gui-updates.js';
import { verifyInstalledNative } from './lib/codex-native.js';
import { promptAfterAppChange } from './lib/update-events.js';
const config = readJSON(guiPaths().config);
if (config) {
    const outcome = await promptAfterAppChange(config, { resolve: resolveGUIApp, healthy: bundle => {
        try { verifyInstalledNative(bundle); return true; } catch { return false; }
    } });
    console.log(JSON.stringify({ at: new Date().toISOString(), event: 'app-change', outcome }));
}
