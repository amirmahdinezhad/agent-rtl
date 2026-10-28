import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    scanUserFonts,
    buildFontList,
    buildFontFaces,
    copyFontAssets,
    fontAssetNames,
    familyBaseName,
    isRegularWeight,
    isFaNum,
    collectFonts,
    bundledEnglishFonts,
    isPersianFamily,
    isFaNumFamily,
    baseFamilyName,
    userFontsDir,
    ASSETS_DIR,
} from '../bin/lib/fonts.js';

let fixture;

before(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-fonts-'));
    const files = [
        'MyFont-Regular.woff2',
        'MyFont-Bold.ttf',
        'MyFont-Light.woff',
        'MyFontFaNum-Regular.woff',
        'MyFontFaNum-Bold.woff2',
        'IRANSansX-Regular.woff2',
        'IRANSansX-Bold.woff2',
        'IRANSansXFaNum-Regular.woff2',
        'IRANYekanX-Regular.woff2',
        'Other-Italic.otf',
        'Other.ttf',
        'notes.txt',
        '.hidden.ttf',
    ];
    for (const f of files) fs.writeFileSync(path.join(fixture, f), 'fake');
    fs.mkdirSync(path.join(fixture, 'Farsi numerals'));
    fs.writeFileSync(path.join(fixture, 'Farsi numerals', 'PlainRegular.ttf'), 'fake');
});

after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
});

describe('scanUserFonts', () => {
    it('keeps Regular only, split into plain and FaNum models', () => {
        const families = scanUserFonts(fixture).map((f) => `${f.family}<=${f.ext}`);
        assert.ok(families.includes('MyFont<=.woff2'), JSON.stringify(families));
        assert.ok(families.includes('MyFont (FaNum)<=.woff'), JSON.stringify(families));
        // Bold/Light/Italic variants are excluded, not grouped.
        assert.ok(!families.some((f) => /bold|light|italic/i.test(f)), JSON.stringify(families));
    });

    it('detects FaNum from the parent folder too', () => {
        const families = scanUserFonts(fixture).map((f) => f.family);
        assert.ok(families.includes('Plain (FaNum)'), JSON.stringify(families));
    });

    it('ignores non-font and hidden files', () => {
        const fonts = scanUserFonts(fixture);
        assert.ok(!fonts.some((f) => /notes|hidden/i.test(f.family)));
    });

    it('is deterministic across runs', () => {
        assert.deepEqual(scanUserFonts(fixture), scanUserFonts(fixture));
    });

    it('returns [] for a missing dir', () => {
        assert.deepEqual(scanUserFonts(path.join(fixture, 'nope')), []);
    });
});

describe('isRegularWeight / isFaNum', () => {
    it('classifies weights', () => {
        assert.equal(isRegularWeight('/x/A-Regular.ttf'), true);
        assert.equal(isRegularWeight('/x/A.ttf'), true);
        assert.equal(isRegularWeight('/x/A-Bold.ttf'), false);
        assert.equal(isRegularWeight('/x/A-Light.woff2'), false);
    });

    it('detects FaNum from stem or folder', () => {
        assert.equal(isFaNum('/x/AFaNum-Regular.ttf'), true);
        assert.equal(isFaNum('/x/Farsi numerals/A-Regular.ttf'), true);
        assert.equal(isFaNum('/x/A-Regular.ttf'), false);
    });
});

describe('familyBaseName', () => {
    it('groups weights, splits FaNum models', () => {
        assert.equal(familyBaseName('/x/IRANSansWeb(FaNum)_Bold.woff2'), 'IRANSans (FaNum)');
        assert.equal(familyBaseName('/x/IRANYekanXFaNum-Regular.woff2'), 'IRANYekanX (FaNum)');
        assert.equal(familyBaseName('/x/IRANSansX-Regular.ttf'), 'IRANSansX');
    });
});

describe('buildFontList / buildFontFaces / copyFontAssets', () => {
    it('lists exactly the scanned families (no defaults, no presets)', () => {
        const list = buildFontList([{ family: 'MyFont' }, { family: 'MyFont (FaNum)' }]);
        assert.deepEqual(list, [
            { label: 'MyFont', value: 'MyFont' },
            { label: 'MyFont (FaNum)', value: 'MyFont (FaNum)' },
        ]);
    });

    it('emits local-first faces and copies assets', () => {
        const fonts = scanUserFonts(fixture);
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'artl-dest-'));
        try {
            const assets = copyFontAssets(fonts, dest);
            assert.ok(assets.length >= 3);
            for (const a of assets) assert.ok(fs.existsSync(path.join(dest, a.asset)));
            const css = buildFontFaces(assets);
            assert.ok(css.includes("local('MyFont (FaNum)')"));
            assert.ok(css.includes('./artl-font-'));
            assert.deepEqual(fontAssetNames(fonts), assets);
        } finally {
            fs.rmSync(dest, { recursive: true, force: true });
        }
    });
});

describe('persian allowlist / bundled english', () => {
    it('strips the FaNum suffix when comparing base names', () => {
        assert.equal(baseFamilyName('IRANSansX (FaNum)'), 'IRANSansX');
        assert.equal(baseFamilyName('IRANSansX'), 'IRANSansX');
    });

    it('allows Vazir while excluding the old Persian font families', () => {
        assert.equal(isPersianFamily('Vazir'), true);
        assert.equal(isPersianFamily('IRANSansX (FaNum)'), false);
        assert.equal(isPersianFamily('IRANYekanX'), false);
        assert.equal(isPersianFamily('IRANSansXNoEn'), false);
    });

    it('detects the FaNum model by family suffix', () => {
        assert.equal(isFaNumFamily('IRANSansX (FaNum)'), true);
        assert.equal(isFaNumFamily('IRANSansX'), false);
    });

    it('bundles one shared Vazir family without requiring local font files', () => {
        const { fa, en, all } = collectFonts(fixture);
        assert.deepEqual(fa.map((f) => f.family), ['Vazir']);
        assert.deepEqual(en.map((f) => f.family), ['Vazir']);
        assert.deepEqual(all.map((f) => f.family), ['Vazir']);
    });

    it('resolves the invoking user home under sudo (SUDO_USER)', () => {
        const prev = process.env.SUDO_USER;
        const who = prev || os.userInfo().username;
        const home = os.platform() === 'darwin' ? `/Users/${who}` : `/home/${who}`;
        if (!fs.existsSync(home)) return; // CI user without a home dir: skip
        process.env.SUDO_USER = who;
        try {
            assert.equal(userFontsDir(), path.join(home, 'Documents', 'fonts'));
        } finally {
            if (prev === undefined) delete process.env.SUDO_USER;
            else process.env.SUDO_USER = prev;
        }
    });

    it('bundled english fonts ship as woff2 assets', () => {
        const bundled = bundledEnglishFonts();
        assert.deepEqual(bundled.map((f) => f.family), ['Vazir']);
        for (const f of bundled) {
            assert.equal(f.ext, '.woff2');
            assert.ok(f.file.startsWith(ASSETS_DIR));
            assert.ok(fs.existsSync(f.file), `missing asset: ${f.file}`);
        }
    });
});
