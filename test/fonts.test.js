import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectFonts, buildFontList } from '../bin/lib/fonts.js';

it('embeds one real offline Vazir font for both scripts without duplicate assets', () => {
    const { fa, en, all } = collectFonts();
    assert.equal(all.length, 1);
    assert.equal(fa, all);
    assert.equal(en, all);
    assert.equal(all[0].family, 'Vazir');
    assert.equal(all[0].ext, '.woff2');
    assert.equal(fs.readFileSync(all[0].file).subarray(0, 4).toString(), 'wOF2');
    assert.deepEqual(buildFontList(all), [{ label: 'Vazir', value: 'Vazir' }]);
});
