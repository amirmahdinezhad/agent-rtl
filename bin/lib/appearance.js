import fs from 'node:fs';
import { supportPath } from './app-target.js';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
export const themes = ['auto', 'light', 'dark'];
export const accents = ['auto', '#ad8cf3', '#79adeb', '#68c7a4', '#e9bf59'];
/** Store only Rasta appearance; never change host application preferences. */
export function saveAppearance(input, home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) {
    if (!themes.includes(input?.theme) || !accents.includes(input?.accent)) throw new Error('Invalid Rasta appearance.');
    const file = path.join(supportPath(home), 'appearance.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temporary, JSON.stringify({ schema: 1, theme: input.theme, accent: input.accent }) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    return { theme: input.theme, accent: input.accent };
}
