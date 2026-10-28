#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import picocolors from 'picocolors';
import { resolveCodexApp } from './lib/codex.js';
import { resolveT3App } from './lib/t3.js';
import { inspectNative, prepareNative, installNative, restoreNative, stageNative, discardNativeStage, verifyInstalledNative } from './lib/codex-native.js';
import { queueAfterQuit, readInstallStatus, installerRunning, cancelInstallJob } from './lib/codex-after-quit.js';
import { uninstallBackground } from './lib/codex-legacy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { blue, cyan, green, red, yellow, bold, dim } = picocolors;
const TARGETS = { codex: { id: 'codex', label: 'Codex', mode: 'codex-native' }, t3: { id: 't3', label: 'T3 Code' } };

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function printBanner() {
    console.log('');
    console.log(bold(cyan('  Rasta')) + dim(`  v${pkg.version}`));
    console.log(dim('     Right-to-left (RTL) reading controls for Codex and T3 Code on macOS.\n'));
}

printBanner();

const args = process.argv.slice(2);
const isRestore = args.includes('--restore');
const isStatus = args.includes('--status');
const isDryRun = args.includes('--dry-run');
const prepareIndex = args.indexOf('--prepare');
const prepareDir = prepareIndex === -1 ? null : args[prepareIndex + 1];
const allowLocalSigning = args.includes('--allow-local-signing');
const restart = args.includes('--restart');
const afterQuit = args.includes('--after-quit') || restart;
const manualReopen = args.includes('--no-reopen');
const targetFlag = (() => {
    const i = args.findIndex((a) => a === '--target');
    return i !== -1 ? (args[i + 1] || 'all') : 'all';
})();

if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: rasta [options]

Options:
  --target <codex|t3|all>  Which app to patch (default: all)
  --prepare <directory>       Codex: save a resource patch for review
  --allow-local-signing        Codex: accept replacing the official signature
  --after-quit                 Codex: install once after quitting, then reopen
  --restart                    Codex: quit normally in 5 seconds, install and reopen
  --no-reopen                  With --after-quit: leave the app closed after installing
  --dry-run                   Show what would change without writing
  --status                    Show patch status of each target
  --restore                   Restore original app backups
  --help, -h                  Show this help
`);
    console.log('Codex (macOS): loads the widget inside the original app. No launcher or service.\nIn-app installation requires local signing. Review --prepare before accepting it.\n');
    process.exit(0);
}

if (args.includes('--foreground') || args.includes('--codex-port')) {
    console.error(red('[!] Codex now uses an in-app patch. --foreground and --codex-port have been removed.'));
    process.exit(1);
}
if (prepareIndex !== -1 && (!prepareDir || prepareDir.startsWith('--'))) {
    console.error(red('[!] --prepare requires an output directory.'));
    process.exit(1);
}
if (prepareIndex !== -1 && (targetFlag !== 'codex' || isRestore || isStatus || isDryRun)) {
    console.error(red('[!] --prepare requires --target codex and cannot be combined with --restore, --status or --dry-run.'));
    process.exit(1);
}
if (afterQuit && (targetFlag !== 'codex' || isRestore || isStatus || isDryRun || prepareDir)) {
    console.error(red('[!] --after-quit / --restart require --target codex and a normal installation.'));
    process.exit(1);
}
if (manualReopen && (!afterQuit || restart)) {
    console.error(red('[!] --no-reopen requires --after-quit and cannot be combined with --restart.'));
    process.exit(1);
}

async function patchTarget(target, { restore, dryRun }) {
    if (target.id === 't3' && os.platform() === 'darwin') {
        const bundle = resolveT3App();
        if (!bundle) return 'missing';
        if (dryRun) { console.log(JSON.stringify(inspectNative(bundle), null, 2)); return 'dryrun'; }
        console.error(red('Use Rasta T3 Setup.app to install or remove RTL on macOS. The graphical flow preserves signing, integrity, rollback and the explicit Launch step.'));
        return 'error';
    }
    if (target.mode === 'codex-native') {
        try {
            if (restore && !dryRun) {
                const cancelled = await cancelInstallJob();
                const removed = await uninstallBackground();
                const bundle = resolveCodexApp();
                const restored = bundle && restoreNative(bundle);
                console.log(green(restored ? 'Restored the original Codex bundle and signature.'
                    : cancelled ? 'Cancelled the one-time Codex installation.'
                        : removed ? 'Removed the legacy Codex service and launcher; restored its Dock tile.' : 'No Codex RTL backup or legacy service found.'));
                return 'restored';
            }
            const bundle = resolveCodexApp();
            if (!bundle) {
                console.log(yellow('[?] Codex macOS bundle not found. Set ARTL_CODEX_APP to its .app path.'));
                return 'missing';
            }
            console.log(blue(`\n[✓] Codex ${bundle.version} at ${bundle.app}`));
            if (dryRun) {
                console.log(JSON.stringify(inspectNative(bundle), null, 2));
                console.log(dim(restore ? 'Would restore the saved original app, if present.'
                    : 'Would add the widget to two HTML entries and update integrity hashes. Installation requires local signing; original logic files are preserved.'));
                return 'dryrun';
            }
            if (prepareDir) {
                const destination = path.resolve(prepareDir);
                const report = prepareNative(bundle, destination);
                console.log(green(`Codex in-app patch prepared at ${destination}.`));
                console.log(dim(`Original archive data preserved: ${report.originalDataHash === report.preservedDataHash}. The installed app is unchanged.`));
                return 'prepared';
            }
            if (afterQuit) {
                const stage = stageNative(bundle, { allowLocalSigning });
                try {
                    const status = await queueAfterQuit(stage, { reopen: !manualReopen,
                        ...(restart ? { quitAfterMs: 5000, timeoutMs: 180000 } : {}) });
                    const nextStep = restart ? 'A normal quit will be requested in 5 seconds. Installation waits for confirmed exit; if Codex stays open, quit it with Cmd+Q.'
                        : manualReopen ? 'Quit Codex with Cmd+Q within 15 minutes; the installer leaves it closed after installing. Wait for completion, then reopen it manually.'
                        : 'Quit Codex with Cmd+Q within 15 minutes; it will install and reopen the original app automatically.';
                    console.log(green(`Codex patch staged and signed. One-time installer: ${status.phase}.\n${nextStep}\nThe terminal can be closed. No login service or launcher is created.`));
                    return 'queued';
                } catch (error) { discardNativeStage(stage); throw error; }
            }
            installNative(bundle, { allowLocalSigning });
            verifyInstalledNative(bundle);
            await uninstallBackground();
            console.log(green('Codex in-app RTL installed and verified. Open the original Codex app normally; the terminal can be closed.'));
            return 'patched';
        } catch (error) { console.error(red(error.message)); return 'error'; }
    }
    console.error(red('Only the Codex and T3 macOS apps are supported.'));
    return 'error';
}

async function statusTarget(target) {
    if (target.id === 't3' && os.platform() === 'darwin') {
        try {
            const bundle = resolveT3App();
            return { target: target.id, label: target.label, asar: bundle?.app || null, state: bundle ? inspectNative(bundle).state : 'not-installed' };
        } catch (error) { return { target: target.id, label: target.label, asar: null, state: 'inspect-error: ' + error.message }; }
    }
    if (target.mode === 'codex-native') {
        const bundle = resolveCodexApp();
        if (!bundle) return { target: target.id, label: target.label, asar: null, state: 'not-installed (Codex macOS)' };
        try {
            const pending = readInstallStatus();
            const current = inspectNative(bundle).state;
            const active = pending?.app === bundle.app && installerRunning(pending);
            const failed = pending?.app === bundle.app && current !== 'patched-in-app'
                && ['timed-out', 'failed', 'cancelled', 'rolled-back'].includes(pending.phase);
            const prefix = active ? `${pending.phase} / ` : failed ? `last install: ${pending.phase} / ` : '';
            return { target: target.id, label: target.label, asar: bundle.app, state: prefix + current };
        }
        catch (error) { return { target: target.id, label: target.label, asar: bundle.app, state: 'inspect-error: ' + error.message }; }
    }
    return { target: target.id, label: target.label, asar: null, state: 'unsupported-platform (macOS required)' };
}

async function main() {
    const wanted = targetFlag === 'all' ? Object.values(TARGETS) : [TARGETS[targetFlag]].filter(Boolean);
    if (!wanted.length) {
        console.error(red(`\n[!] Unknown target: ${targetFlag}. Use codex, t3 or all.\n`));
        process.exit(1);
    }

    if (isStatus) {
        console.log(green('\n◉ Patch status\n'));
        for (const t of wanted) {
            const s = await statusTarget(t);
            const mark = s.state.startsWith('patched') || s.state.includes('patched-in-app') ? green('●') : yellow('○');
            console.log(`  ${mark} ${bold(s.label)} ${dim(s.asar || 'not installed')} → ${cyan(s.state)}`);
        }
        console.log('');
        return;
    }

    console.log(green(`\n⚡ Initializing Rasta ${isRestore ? '(restore mode)' : ''}${isDryRun ? '(dry-run)' : ''}...`));

    const results = [];
    for (const target of wanted) results.push(await patchTarget(target, { restore: isRestore, dryRun: isDryRun }));

    if (results.some(result => ['error', 'missing'].includes(result))) {
        process.exitCode = 1;
        return;
    }
    if (targetFlag === 'codex') return;

    console.log(green(bold('\n⚡ Execution completed. Restart the apps to load the new UI.\n')));
    if (!isDryRun && !isRestore) {
        console.log(dim('Tip: run `rasta --status` to verify, `rasta --restore` to revert.\n'));
    }
}

main().catch((e) => {
    console.error(red('\n[!] An unhandled error occurred:'), e.message);
    process.exit(1);
});
