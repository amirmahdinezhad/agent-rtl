import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveAppearance } from '../bin/lib/appearance.js';
test('appearance saves only validated Rasta preferences outside runtime', () => {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'artl-appearance-'));
 try {
  saveAppearance({theme:'dark',accent:'#68c7a4',path:'/ignored'},home);
  const file=path.join(home,'Library/Application Support/Agent RTL/appearance.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{schema:1,theme:'dark',accent:'#68c7a4'});
  for(const input of [{theme:'dark',accent:'red'},{theme:'bad',accent:'auto'},null])assert.throws(()=>saveAppearance(input,home));
  assert.equal(JSON.parse(fs.readFileSync(file)).accent,'#68c7a4');
 } finally {fs.rmSync(home,{recursive:true,force:true})}
});
