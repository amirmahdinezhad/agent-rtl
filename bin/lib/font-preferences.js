import fs from 'node:fs';
import { supportPath } from './app-target.js';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_FONT_BYTES = 2 * 1024 * 1024;
export const MAX_CUSTOM_FONTS = 20;
const ID = /^[a-f0-9]{32}$/;

/** Stable user-owned storage, independent of replaceable installer runtimes. */
export function fontPaths(home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) {
    const support = supportPath(home);
    return { preferences: path.join(support, 'font-preferences.json'), directory: path.join(support, 'custom-fonts') };
}

/** Read the SFNT name table after checking all table and string bounds. */
export function inspectFont(bytes) {
    if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0)))
        throw new Error('Choose a valid TTF or OTF font (up to 2 MB).');
    const count = bytes.readUInt16BE(4);
    if (!count || 12 + count * 16 > bytes.length) throw new Error('The font table is incomplete.');
    let names;
    for (let i = 0; i < count; i++) {
        const entry = 12 + i * 16, start = bytes.readUInt32BE(entry + 8), length = bytes.readUInt32BE(entry + 12);
        if (start > bytes.length || length > bytes.length - start) throw new Error('The font table is incomplete.');
        if (bytes.toString('ascii', entry, entry + 4) === 'name') names = bytes.subarray(start, start + length);
    }
    if (!names || names.length < 6) throw new Error('The font has no readable family name.');
    const records = names.readUInt16BE(2), strings = names.readUInt16BE(4), candidates = [];
    if (6 + records * 12 > names.length || strings < 6 + records * 12 || strings > names.length) throw new Error('The font names are incomplete.');
    for (let i = 0; i < records; i++) {
        const entry = 6 + i * 12, platform = names.readUInt16BE(entry), language = names.readUInt16BE(entry + 4);
        const name = names.readUInt16BE(entry + 6), length = names.readUInt16BE(entry + 8), offset = strings + names.readUInt16BE(entry + 10);
        if (offset > names.length || length > names.length - offset) throw new Error('The font names are incomplete.');
        if (![1, 16].includes(name) || ![0, 3].includes(platform) || length % 2) continue;
        const raw = names.subarray(offset, offset + length);
        let label = '';
        for (let j = 0; j < raw.length; j += 2) label += String.fromCharCode(raw.readUInt16BE(j));
        label = label.trim().normalize('NFC');
        if (label && label.length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/.test(label)) candidates.push({ label, rank: (name === 16 ? 0 : 2) + (language === 0x409 ? 0 : 1) });
    }
    candidates.sort((a, b) => a.rank - b.rank);
    if (!candidates.length) throw new Error('The font has no readable family name.');
    return { label: candidates[0].label, ext: bytes.readUInt32BE(0) === 0x4f54544f ? '.otf' : '.ttf' };
}

function readPreferences(paths) {
    try {
        const saved = JSON.parse(fs.readFileSync(paths.preferences, 'utf8'));
        if (saved?.schema !== 1 || !Array.isArray(saved.fonts)) return { schema: 1, selected: 'vazir', fonts: [] };
        const fonts = saved.fonts.filter(font => font && typeof font.id === 'string' && ID.test(font.id) && typeof font.file === 'string' && font.file === `${font.id}${path.extname(font.file)}`
            && ['.ttf', '.otf'].includes(path.extname(font.file)) && typeof font.label === 'string' && font.label.length <= 120);
        return { schema: 1, selected: saved.selected, fonts };
    } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
        return { schema: 1, selected: 'vazir', fonts: [] };
    }
}

function savePreferences(paths, saved) {
    fs.mkdirSync(path.dirname(paths.preferences), { recursive: true });
    const temporary = `${paths.preferences}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(temporary, paths.preferences);
    } finally { fs.rmSync(temporary, { force: true }); }
}

/** List imported families and return bytes only for the selected face. */
export function fontPreferences(paths = fontPaths()) {
    const saved = readPreferences(paths), fonts = [];
    let active = null;
    for (const font of saved.fonts) {
        try {
            const file = path.join(paths.directory, font.file);
            if (fs.statSync(file).size > MAX_FONT_BYTES) continue;
            const bytes = fs.readFileSync(file);
            inspectFont(bytes);
            if (createHash('sha256').update(bytes).digest('hex').slice(0, 32) !== font.id) continue;
            fonts.push({ id: font.id, label: font.label });
            if (saved.selected === font.id) active = { id: font.id, data: bytes.toString('base64') };
        } catch { /* A missing or damaged custom face must never break the UI. */ }
    }
    return { selected: active?.id || 'vazir', fonts, active };
}

/** Import a bounded SFNT file and select a private copy; never install OS fonts. */
export function importFont(input, paths = fontPaths()) {
    if (!input || typeof input.name !== 'string' || !/\.(ttf|otf)$/i.test(input.name)
        || typeof input.data !== 'string' || input.data.length > Math.ceil(MAX_FONT_BYTES / 3) * 4
        || input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
        throw new Error('Choose a valid TTF or OTF font (up to 2 MB).');
    const bytes = Buffer.from(input.data, 'base64'), { label, ext } = inspectFont(bytes);
    const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32), file = `${id}${ext}`;
    const saved = readPreferences(paths);
    if (!saved.fonts.some(font => font.id === id) && saved.fonts.length >= MAX_CUSTOM_FONTS) throw new Error('You can add up to 20 fonts.');
    fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(paths.directory, file), bytes, { mode: 0o600 });
    if (!saved.fonts.some(font => font.id === id)) saved.fonts.push({ id, label, file });
    saved.selected = id;
    savePreferences(paths, saved);
    return fontPreferences(paths);
}

/** Select an imported ID or restore bundled Vazir, rejecting arbitrary paths. */
export function selectFont(id, paths = fontPaths()) {
    const available = fontPreferences(paths);
    if (id !== 'vazir' && !available.fonts.some(font => font.id === id)) throw new Error('This font is unavailable. Add it again.');
    const saved = readPreferences(paths); saved.selected = id; savePreferences(paths, saved);
    return fontPreferences(paths);
}
