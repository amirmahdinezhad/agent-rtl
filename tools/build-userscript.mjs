import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const version = JSON.parse(fs.readFileSync(new URL('package.json', root))).version;
import { buildCodexPayload } from '../bin/lib/codex.js';
const header = `// ==UserScript==
// @name         Agent RTL (T3 Web)
// @namespace    agent-rtl-pro
// @version      ${version}
// @description  Persian and English reading controls for T3 Code. Includes the offline Vazir font and English controls.
// @match        https://app.t3.codes/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
`;
const payload = buildCodexPayload();
fs.writeFileSync(new URL('bin/payloads/desktop-payload.user.js', root), header + payload);
console.log('T3 userscript generated from the shared interface.');
