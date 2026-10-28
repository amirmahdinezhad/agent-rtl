import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// User-owned Persian fonts live here. Scanned Regular weight only, split
// into plain and Farsi-numeral (FaNum) models.
// Under sudo, os.homedir() is /var/root — resolve the invoking user's home
// via SUDO_USER instead, or the Persian fonts would silently go missing.
export function userFontsDir() {
    const sudoUser = process.env.SUDO_USER;
    if (sudoUser && sudoUser !== 'root') {
        const home = os.platform() === 'darwin'
            ? path.join('/Users', sudoUser)
            : path.join('/home', sudoUser);
        try {
            if (fs.statSync(home).isDirectory()) return path.join(home, 'Documents', 'fonts');
        } catch { /* fall through to os.homedir() */ }
    }
    return path.join(os.homedir(), 'Documents', 'fonts');
}

// Vazir is bundled for both Persian and English; no local font installation is required.
export const PERSIAN_FAMILIES = ['Vazir'];

// Shared family retained behind the existing English-font catalog interface.
export const BUNDLED_EN_FONTS = [
    { family: 'Vazir', asset: 'Vazir-Regular.woff2' },
];

export function baseFamilyName(family) {
    return family.replace(/\s*\(FaNum\)\s*$/i, '').trim();
}

export function isPersianFamily(family) {
    return PERSIAN_FAMILIES.some((allowed) => allowed.toLowerCase() === baseFamilyName(family).toLowerCase());
}

export function bundledEnglishFonts() {
    return BUNDLED_EN_FONTS.map(({ family, asset }) => ({
        family,
        file: path.join(ASSETS_DIR, asset),
        ext: path.extname(asset).toLowerCase(),
    })).filter((f) => fs.existsSync(f.file));
}

const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const EXT_RANK = { '.woff2': 0, '.woff': 1, '.ttf': 2, '.otf': 3 };
const FORMAT_HINT = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype', '.otf': 'opentype' };

// Non-Regular weights: files carrying any of these are excluded.
const NON_REGULAR_RE = /(thin|ultralight|extralight|light|medium|semibold|demibold|bold|extrabold|black|heavy|italic|oblique)/i;
// Tokens stripped when grouping files into families (FaNum is kept: it
// defines the plain vs Farsi-numeral model split).
const GROUP_STRIP_RE = /(regular|web|mobile)/gi;

function walkFiles(dir, out = []) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(full, out);
        else if (e.isFile() && FONT_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
    return out;
}

export function isRegularWeight(filePath) {
    const stem = path.basename(filePath, path.extname(filePath));
    return !NON_REGULAR_RE.test(stem);
}

// FaNum model when the stem or any parent folder says so.
export function isFaNum(filePath) {
    if (/fanum/i.test(path.basename(filePath))) return true;
    return filePath.split(path.sep).some((part) => /fanum|farsi.numerals/i.test(part));
}

export function familyBaseName(filePath) {
    const stem = path.basename(filePath, path.extname(filePath));
    const base = stem
        .replace(/\(?\s*fanum\s*\)?/gi, '')
        .replace(GROUP_STRIP_RE, '')
        .replace(NON_REGULAR_RE, '')
        .replace(/\(\s*\)/g, '')
        .replace(/[_\-\s]+/g, ' ')
        .trim();
    const clean = base || stem.replace(/[_\-\s]+/g, ' ').trim();
    return isFaNum(filePath) ? `${clean} (FaNum)` : clean;
}

// Scan dir (default ~/Documents/fonts): Regular files only, grouped into
// families split by FaNum model, best format per group
// (woff2 > woff > ttf > otf). Returns [{ family, file, ext }] sorted.
// Deterministic.
export function scanUserFonts(dir = userFontsDir()) {
    const files = walkFiles(dir).sort().filter(isRegularWeight);
    const groups = new Map();
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const family = familyBaseName(file);
        const key = family.toLowerCase();
        if (!groups.has(key)) groups.set(key, { family, files: [] });
        groups.get(key).files.push({ file, ext, name: path.basename(file) });
    }
    const out = [];
    for (const { family, files: group } of groups.values()) {
        group.sort((a, b) => (EXT_RANK[a.ext] - EXT_RANK[b.ext]) || (a.name.length - b.name.length));
        const best = group[0];
        out.push({ family, file: best.file, ext: best.ext });
    }
    out.sort((a, b) => a.family.localeCompare(b.family));
    return out;
}

// A shared family serves both scripts. Keep one copy in the embedded asset list.
export function collectFonts() {
    const shared = bundledEnglishFonts();
    return { fa: shared, en: shared, all: shared };
}

export function isFaNumFamily(family) {
    return /\(FaNum\)\s*$/i.test(family);
}

// Deterministic asset filenames for a scanned list.
export function fontAssetNames(fonts) {
    return fonts.map((f, i) => ({ family: f.family, asset: `artl-font-${i}${f.ext}` }));
}

// Copy family files next to the payload so @font-face can use relative URLs.
// Returns [{ family, asset }] where asset is the copied filename.
export function copyFontAssets(fonts, destDir) {
    const assets = fontAssetNames(fonts);
    fonts.forEach((f, i) => {
        fs.copyFileSync(f.file, path.join(destDir, assets[i].asset));
    });
    return assets;
}

// @font-face rules. local() first (helps the Tampermonkey build where the
// user may also have the font installed), relative url() for the asar build.
export function buildFontFaces(assets) {
    return assets
        .map(({ family, asset }) => {
            const fmt = FORMAT_HINT[path.extname(asset).toLowerCase()] || 'truetype';
            const esc = family.replace(/'/g, "\\'");
            return `@font-face { font-family: '${esc}'; src: local('${esc}'), url('./${asset}') format('${fmt}'); font-weight: 400; }`;
        })
        .join('\n            ');
}

// Dropdown options: exactly the scanned families, nothing else.
export function buildFontList(fonts) {
    return fonts.map((f) => ({ label: f.family, value: f.family }));
}
