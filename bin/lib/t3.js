import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { TARGETS, resolveAsar } from './targets.js';

/** Resolve the actual T3 bundle and its vendor client entry. */
export function resolveT3App(app = null) {
    const archive = app ? path.join(app, 'Contents/Resources/app.asar') : resolveAsar(TARGETS.t3);
    if (!archive || !fs.existsSync(archive)) return null;
    asar.uncache(archive);
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
    if (pkg.name !== 't3code') throw new Error('Unexpected T3 application identity.');
    app ||= path.dirname(path.dirname(path.dirname(archive)));
    const executable = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (!executable || path.basename(executable) !== executable) throw new Error('Invalid T3 executable.');
    return { app, archive, executable: path.join(app, 'Contents/MacOS', executable), version: pkg.version,
        target: 't3', htmlPaths: TARGETS.t3.htmlPaths, scriptSrc: '/agent-rtl-payload.js', allowDisabledIntegrity: true };
}
