import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const samples = JSON.parse(fs.readFileSync(new URL('./fixtures/language-samples.json', import.meta.url)));
const arabic = /\p{Script=Arabic}/u;
const hash = line => createHash('sha256').update(line).digest('hex');

// Exact line hashes allow only reviewed RTL content and character-matching logic.
// New explanatory copy in an existing sample file still fails this check.
function violations(file, source) {
    if (file === 'README.md') {
        source = source.replace(/<a id="persian-documentation"><\/a>\s*<div dir="rtl" lang="fa">[\s\S]*?<\/div>/, '');
    }
    const allowed = new Set(samples[file] ?? []);
    return source.split('\n').flatMap((line, index) =>
        arabic.test(line) && !allowed.has(hash(line)) ? [`${file}:${index + 1}`] : []);
}

test('explanatory copy is English outside the root README Persian guide', () => {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
    const failures = [];
    for (const file of new Set(files)) {
        if (!file || (!/\.(?:md|js|mjs|cjs|swift|json|ya?ml|html|css|sh|txt)$/i.test(file) && !['LICENSE', 'Makefile'].includes(file))) continue;
        const absolute = path.join(root, file);
        if (!fs.existsSync(absolute)) continue;
        failures.push(...violations(file, fs.readFileSync(absolute, 'utf8')));
    }
    assert.deepEqual(failures, [], 'Translate explanatory text to English; review exact RTL sample exceptions separately.');
});

test('language guard rejects new copy even in a file containing approved samples', () => {
    const nonEnglish = String.fromCodePoint(0x633, 0x644, 0x627, 0x645);
    assert.equal(violations('docs/example.md', nonEnglish).length, 1);
    assert.equal(violations('test/payload.test.js', `// ${nonEnglish}`).length, 1);
    assert.equal(violations('native/AgentRTLSetup.swift', `let title = "${nonEnglish}"`).length, 1);
    assert.equal(violations('README.md', `${nonEnglish}\n<a id="persian-documentation"></a>\n<div dir="rtl" lang="fa">${nonEnglish}</div>\n${nonEnglish}`).length, 2);
    assert.deepEqual(violations('README.md', `<a id="persian-documentation"></a>\n<div dir="rtl" lang="fa">${nonEnglish}</div>`), []);
});
