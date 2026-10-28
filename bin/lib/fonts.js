import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bundledFont = fileURLToPath(new URL('../assets/Vazir-Regular.woff2', import.meta.url));

// One embedded face serves both scripts; custom fonts use font-preferences.js.
export function collectFonts() {
    const shared = fs.existsSync(bundledFont)
        ? [{ family: 'Vazir', file: bundledFont, ext: path.extname(bundledFont) }] : [];
    return { fa: shared, en: shared, all: shared };
}

export function buildFontList(fonts) {
    return fonts.map(({ family }) => ({ label: family, value: family }));
}
