import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const config = JSON.parse(fs.readFileSync(new URL('../release-config.json', import.meta.url)));
/** The bundled target owns its own settings, backups and updater runtime. */
export const targetId = () => (process.env.ARTL_TARGET || config.target) === 't3' ? 't3' : 'codex';
export const targetName = () => targetId() === 't3' ? 'T3 Code' : 'Codex';
export const supportPath = (home = process.env.ARTL_CODEX_STATE_HOME || os.homedir()) => path.join(home, 'Library/Application Support', targetId() === 't3' ? 'Agent RTL T3' : 'Agent RTL');
