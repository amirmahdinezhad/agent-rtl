import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPackage, packageRoot } from '../bin/lib/gui-runtime.js';

it('packages the graphical service without exposing an install command', () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'rasta-setup-package-'));
    try {
        copyPackage(destination);
        const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
        const lock = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-lock.json'), 'utf8'));
        assert.equal(manifest.bin, undefined);
        assert.equal(lock.packages[''].bin, undefined);
        assert.equal(fs.existsSync(path.join(destination, 'bin/index.js')), false);
        assert.equal(fs.existsSync(path.join(destination, 'bin/gui-service.js')), true);
        assert.equal(manifest.dependencies.picocolors, undefined);
        assert.equal(lock.packages['node_modules/picocolors'], undefined);
    } finally { fs.rmSync(destination, { recursive: true, force: true }); }
});
