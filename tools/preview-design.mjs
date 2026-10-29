// Compile and render only the UI. No packaged installer, RPC or installed-app access.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('The native design preview requires macOS and Xcode Command Line Tools.');
if (process.argv.slice(2).some(argument => argument !== '--open')) throw new Error('Usage: npm run preview:design -- [--open]');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/design-preview');
const native = path.join(root, 'dist/native-refinement-preview');
const executable = path.join(output, 'rasta-ui-preview');
fs.mkdirSync(output, { recursive: true });
const architecture = process.arch === 'arm64' ? 'arm64' : 'x86_64';
execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-target', `${architecture}-apple-macosx13.5`, '-O',
    path.join(root, 'native/RastaSetup.swift'), '-o', executable], { cwd: root, stdio: 'inherit' });
// --wizard supplies the source directory for the bundled fonts. --preview-ui exits
// before loadPlan, timers and RPC; its app-path placeholder is never used.
execFileSync(executable, ['--wizard', root, 'design-preview-only', '--preview-ui', native], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'tools/build-design-preview.mjs')], { cwd: root, stdio: 'inherit' });
console.log("Review light/dark themes, narrow layouts, controls, focus, text wrapping and response direction.");
if (process.argv.includes('--open')) execFileSync('/usr/bin/open', [path.join(output, 'review.html')]);
