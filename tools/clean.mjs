// Remove reproducible build outputs; application state and dependencies stay intact.
import fs from 'node:fs';
for (const relative of ['../dist/', '../bin/assets/rasta-ui']) {
    fs.rmSync(new URL(relative, import.meta.url), { recursive: true, force: true });
}
console.log('Removed dist/ and the generated native helper.');
