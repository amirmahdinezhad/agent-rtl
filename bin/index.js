#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import picocolors from 'picocolors';
import ora from 'ora';
import prompts from 'prompts';
import * as asar from '@electron/asar';
import {
    TARGETS,
    PAYLOAD_FILENAME,
    BACKUP_SUFFIX,
    HTML_INJECT_ANCHOR,
    resolveAsar,
    listTargets,
} from './lib/targets.js';
import { patchHtml } from './lib/html.js';
import { collectFonts, buildFontFaces, buildFontList, copyFontAssets } from './lib/fonts.js';
import { resolveCodexApp } from './lib/codex.js';
import { createCodexMessageContext } from './payloads/codex-message-context.js';
import { createT3MessageContext } from './payloads/t3-message-context.js';
import { createCodexMessageDirections } from './payloads/codex-message-directions.js';
import { resolveT3App } from './lib/t3.js';
import { inspectNative, prepareNative, installNative, restoreNative, stageNative, discardNativeStage, verifyInstalledNative } from './lib/codex-native.js';
import { queueAfterQuit, readInstallStatus, installerRunning, cancelInstallJob } from './lib/codex-after-quit.js';
import { uninstallBackground } from './lib/codex-legacy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { blue, cyan, green, red, yellow, bold, dim } = picocolors;

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function printBanner() {
    console.log('');
    console.log(bold(cyan('  ⇄  Agent RTL')) + dim(`  v${pkg.version}`));
    console.log(dim('     Reading controls for OpenCode, T3 Code and Codex.\n'));
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
    console.log(`Usage: agent-rtl [options]

Options:
  --target <opencode|t3|codex|all>  Which app to patch (default: all)
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

// Build the payload with user fonts baked in. Returns { code, fonts }
// where fonts = [{ family, file, ext }] (Persian from ~/Documents/fonts,
// English bundled) and fa/en are the per-dropdown option lists.
function buildPayloadBundle() {
    const payloadPath = path.join(__dirname, 'payloads', 'desktop-payload.js');
    let code = fs.readFileSync(payloadPath, 'utf8');
    const { fa, en, all } = collectFonts();
    const faList = buildFontList(fa);
    const enList = buildFontList(en);
    // NOTE: __FONT_FACES__ is filled later by fillFontFaces(), once the
    // per-target asset filenames are known.
    code = code
        .replace("/* __ARTL_VERSION__ */ ''", JSON.stringify(pkg.version))
        .replace('/* __CODEX_MESSAGE_DIRECTIONS__ */', () => `${createCodexMessageContext.toString()}\n${createT3MessageContext.toString()}\n${createCodexMessageDirections.toString()}`)
        .replace('__FA_FONTS__', JSON.stringify(faList))
        .replace('__EN_FONTS__', JSON.stringify(enList))
        .replace('__DEFAULT_FA__', JSON.stringify(faList.length ? faList[0].value : ''))
        .replace('__DEFAULT_EN__', JSON.stringify(enList.length ? enList[0].value : ''));
    return { code, fonts: all, fa: faList, en: enList };
}

// Fill __FONT_FACES__ once asset filenames are known, then copy the font
// files next to the payload. Returns final code.
function fillFontFaces(code, fonts, destDir) {
    const assets = copyFontAssets(fonts, destDir);
    return code.replace('__FONT_FACES__', buildFontFaces(assets));
}

// Patch a single HTML string: see lib/html.js (imported above).

function tempDirFor(asarPath, tag) {
    // Extract outside the bundle (OS temp dir) so --status/--dry-run work
    // without write access; only the final repack swap needs it (probed by
    // checkWritable). The tag keeps concurrent targets from colliding.
    const safe = String(tag || path.basename(asarPath)).replace(/[^a-z0-9_-]+/gi, '-');
    return path.join(os.tmpdir(), `artl-extract-${safe}`);
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Relative paths (no leading slash) of entries the source asar marks as
// `unpacked`, so native .node/.dylib modules stay on disk after a repack.
function collectUnpackedPaths(asarPath) {
    const out = [];
    try {
        const { header } = asar.getRawHeader(asarPath);
        const walk = (node, prefix) => {
            if (!node || !node.files) return;
            for (const name of Object.keys(node.files)) {
                const child = node.files[name];
                const rel = `${prefix}/${name}`;
                if (child.files) walk(child, rel);
                else if (child.unpacked) out.push(rel.slice(1));
            }
        };
        walk(header, '');
    } catch { /* header unreadable — nothing to preserve */ }
    return out;
}

// Repack extractDir into asarPath. Builds a sibling temp archive and swaps it
// in so a running Electron process never sees a half-written asar, and keeps
// the original unpacked native-module layout intact.
async function repackAsar(extractDir, asarPath) {
    const options = {};
    const unpacked = collectUnpackedPaths(asarPath);
    if (unpacked.length) options.unpack = `**/{${unpacked.join(',')}}`;
    const tmpAsar = `${asarPath}.artl-tmp`;
    const tmpUnpacked = `${tmpAsar}.unpacked`;
    const targetUnpacked = `${asarPath}.unpacked`;
    try {
        await asar.createPackageWithOptions(extractDir, tmpAsar, options);
        if (fs.existsSync(tmpUnpacked)) {
            fs.rmSync(targetUnpacked, { recursive: true, force: true });
            fs.renameSync(tmpUnpacked, targetUnpacked);
        }
        fs.renameSync(tmpAsar, asarPath);
    } finally {
        fs.rmSync(tmpAsar, { force: true });
        fs.rmSync(tmpUnpacked, { recursive: true, force: true });
    }
}

function checkWritable(asarPath, spinner) {
    // Probe with a real temp file: fs.access(W_OK) can lie (it may pass
    // while the kernel still denies writes with EPERM), so a failed probe
    // fails fast with the sudo hint instead of mid-patch.
    const probe = path.join(path.dirname(asarPath), '.artl-write-probe');
    try {
        fs.writeFileSync(probe, 'probe');
        fs.rmSync(probe, { force: true });
        return true;
    } catch (e) {
        spinner.fail('Access Denied.');
        console.error(red('\n[!] OS Exception: ' + e.message));
        console.error(yellow('Action required: re-run with elevated privileges (sudo).'));
        return false;
    }
}

// Read-only inspection shared by --dry-run and --status.
function inspectExtracted(dir, target, restore) {
    const report = [];
    for (const rel of target.htmlPaths) {
        const full = path.join(dir, rel);
        if (!fs.existsSync(full)) {
            report.push({ rel, state: 'html-missing-in-asar' });
            continue;
        }
        const html = fs.readFileSync(full, 'utf8');
        const hasBackup = fs.existsSync(full + BACKUP_SUFFIX);
        if (restore) {
            report.push({ rel, state: hasBackup ? 'would-restore' : 'no-backup' });
        } else if (html.includes(HTML_INJECT_ANCHOR)) {
            report.push({ rel, state: hasBackup ? 'patched+backup' : 'patched' });
        } else {
            report.push({ rel, state: hasBackup ? 'backup-only' : 'would-patch' });
        }
    }
    return report;
}

async function patchTarget(target, { restore, dryRun }) {
    if (target.id === 't3' && os.platform() === 'darwin') {
        const bundle = resolveT3App();
        if (!bundle) return 'missing';
        if (dryRun) { console.log(JSON.stringify(inspectNative(bundle), null, 2)); return 'dryrun'; }
        console.error(red('Use Agent RTL T3 Setup.app to install or remove RTL on macOS. The graphical flow preserves signing, integrity, rollback and the explicit Launch step.'));
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
    const asarPath = resolveAsar(target);
    if (!asarPath) {
        console.log(yellow(`[?] Target bypass: ${target.label} not found on this machine.`));
        return 'missing';
    }
    console.log(blue(`\n[✓] Target locked: ${target.label} at ${asarPath}`));

    if (dryRun) {
        const spinner = ora('Inspecting asar (dry-run)...').start();
        const extractDir = tempDirFor(asarPath, target.id);
        try {
            cleanDir(extractDir);
            asar.extractAll(asarPath, extractDir);
            const report = inspectExtracted(extractDir, target, restore);
            cleanDir(extractDir);
            spinner.stop();
            for (const r of report) console.log(`    ${dim(r.rel)} → ${cyan(r.state)}`);
            return 'dryrun';
        } catch (e) {
            cleanDir(extractDir);
            spinner.fail('Inspection failed.');
            console.error(red(e.message));
            return 'error';
        }
    }

    if (restore) return restoreTarget(target, asarPath);

    const spinner = ora('Checking write permissions...').start();
    if (!checkWritable(asarPath, spinner)) return 'denied';

    // Single extract → patch → repack pass.
    const extractDir = tempDirFor(asarPath, target.id);
    try {
        spinner.text = 'Unpacking ASAR core...';
        cleanDir(extractDir);
        asar.extractAll(asarPath, extractDir);

        spinner.text = 'Injecting RTL payload...';
        const { code: payloadTemplate, fonts, fa, en } = buildPayloadBundle();
        if (!fonts.length) {
            console.log(yellow('    [!] The bundled Vazir font is missing; reinstall Agent RTL.'));
        } else {
            console.log(blue(`    [fonts] Persian (bundled): ${fa.map((f) => f.label).join(', ') || 'none'}`));
            console.log(blue(`    [fonts] English (bundled): ${en.map((f) => f.label).join(', ') || 'none'}`));
        }
        let patchedAny = false;
        let alreadyAll = true;
        for (const rel of target.htmlPaths) {
            const full = path.join(extractDir, rel);
            if (!fs.existsSync(full)) {
                console.log(yellow(`    [!] ${rel} not found in asar, skipping.`));
                alreadyAll = false;
                continue;
            }
            const html = fs.readFileSync(full, 'utf8');
            const { html: next, changed, alreadyPatched } = patchHtml(html);
            const dir = path.dirname(full);
            if (alreadyPatched) {
                // Refresh the payload/fonts so engine fixes reach installs that
                // are already patched, without re-injecting the HTML or
                // touching the factory backups.
                fs.writeFileSync(path.join(dir, PAYLOAD_FILENAME), fillFontFaces(payloadTemplate, fonts, dir));
                patchedAny = true;
                continue;
            }
            if (changed) {
                alreadyAll = false;
                if (!fs.existsSync(full + BACKUP_SUFFIX)) {
                    fs.copyFileSync(full, full + BACKUP_SUFFIX);
                }
                fs.writeFileSync(path.join(dir, PAYLOAD_FILENAME), fillFontFaces(payloadTemplate, fonts, dir));
                fs.writeFileSync(full, next);
                patchedAny = true;
            }
        }

        if (alreadyAll && !patchedAny) {
            cleanDir(extractDir);
            spinner.succeed(`${target.label} is already patched.`);
            return 'already';
        }

        spinner.text = 'Rebuilding ASAR package...';
        await repackAsar(extractDir, asarPath);
        cleanDir(extractDir);
        spinner.succeed(`★ ${target.label} successfully patched with Agent RTL Pro!`);
        return 'patched';
    } catch (e) {
        cleanDir(extractDir);
        spinner.fail('Patch failed.');
        console.error(red(e.message));
        return 'error';
    }
}

async function restoreTarget(target, asarPath) {
    const spinner = ora('Restoring factory state...').start();
    if (!checkWritable(asarPath, spinner)) return 'denied';

    const extractDir = tempDirFor(asarPath, target.id);
    try {
        cleanDir(extractDir);
        asar.extractAll(asarPath, extractDir);
        let restored = 0;
        for (const rel of target.htmlPaths) {
            const full = path.join(extractDir, rel);
            const bak = full + BACKUP_SUFFIX;
            if (fs.existsSync(bak)) {
                fs.copyFileSync(bak, full);
                fs.rmSync(bak, { force: true });
                const dir = path.dirname(full);
                const payloadFile = path.join(dir, PAYLOAD_FILENAME);
                if (fs.existsSync(payloadFile)) fs.rmSync(payloadFile, { force: true });
                for (const f of fs.readdirSync(dir)) {
                    if (f.startsWith('artl-font-')) fs.rmSync(path.join(dir, f), { force: true });
                }
                restored++;
            }
        }
        if (!restored) {
            cleanDir(extractDir);
            spinner.info(`No backups detected for ${target.label}. Nothing to restore.`);
            return 'no-backup';
        }
        spinner.text = 'Rebuilding ASAR package...';
        await repackAsar(extractDir, asarPath);
        cleanDir(extractDir);
        spinner.succeed(`${target.label} restored to factory state.`);
        return 'restored';
    } catch (e) {
        cleanDir(extractDir);
        spinner.fail('Restore failed.');
        console.error(red(e.message));
        return 'error';
    }
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
    const asarPath = resolveAsar(target);
    if (!asarPath) return { target: target.id, label: target.label, asar: null, state: 'not-installed' };
    const extractDir = tempDirFor(asarPath, target.id);
    try {
        cleanDir(extractDir);
        asar.extractAll(asarPath, extractDir);
        const report = inspectExtracted(extractDir, target, false);
        cleanDir(extractDir);
        return { target: target.id, label: target.label, asar: asarPath, state: report.map((r) => r.state).join(',') };
    } catch (e) {
        cleanDir(extractDir);
        return { target: target.id, label: target.label, asar: asarPath, state: 'inspect-error: ' + e.message };
    }
}

async function main() {
    const wanted = targetFlag === 'all' ? listTargets() : [TARGETS[targetFlag]].filter(Boolean);
    if (!wanted.length) {
        console.error(red(`\n[!] Unknown target: ${targetFlag}. Use opencode, t3, codex or all.\n`));
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

    console.log(green(`\n⚡ Initializing Agent RTL Pro ${isRestore ? '(restore mode)' : ''}${isDryRun ? '(dry-run)' : ''}...`));

    const found = wanted.filter((t) => t.mode === 'codex-native' ? resolveCodexApp() : resolveAsar(t));
    const results = [];
    if (!found.length) {
        if (targetFlag === 'codex') {
            const result = await patchTarget(TARGETS.codex, { restore: isRestore, dryRun: isDryRun });
            if (['missing', 'error'].includes(result)) process.exitCode = 1;
            return;
        }
        console.log(yellow(`[?] No targets found on this machine.`));
        const response = await prompts({
            type: 'text',
            name: 'customPath',
            message: `Provide the absolute path to the target app.asar:`,
        });
        if (!response.customPath || !fs.existsSync(response.customPath)) {
            console.error(red('\n[!] Invalid path. Process aborted.\n'));
            process.exit(1);
        }
        const custom = { ...wanted[0], label: `${wanted[0].label} (custom)` };
        custom.asarCandidates = () => [response.customPath];
        results.push(await patchTarget(custom, { restore: isRestore, dryRun: isDryRun }));
    } else {
        for (const t of wanted) {
            results.push(await patchTarget(t, { restore: isRestore, dryRun: isDryRun }));
        }
    }

    if (results.some(result => ['error', 'denied'].includes(result))) {
        process.exitCode = 1;
        return;
    }
    if (targetFlag === 'codex') return;

    console.log(green(bold('\n⚡ Execution completed. Restart the apps to load the new UI.\n')));
    if (!isDryRun && !isRestore) {
        console.log(dim('Tip: run `agent-rtl --status` to verify, `agent-rtl --restore` to revert.\n'));
    }
}

main().catch((e) => {
    console.error(red('\n[!] An unhandled error occurred:'), e.message);
    process.exit(1);
});
