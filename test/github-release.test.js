import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {privateAssetEndpoint, privateAsset, downloadPrivateArtifact} from '../bin/lib/github-release.js';
test('private release transport limits credentials to its fixed repository and verifies signed archive bytes',async()=>{
 const repo='owner/rtl', url='https://github.com/owner/rtl/releases/download/v2.3.0/setup.zip';
 assert.equal(privateAssetEndpoint(url,repo).release,'repos/owner/rtl/releases/tags/v2.3.0');
 for(const bad of ['https://github.com/evil/rtl/releases/download/v2.3.0/setup.zip','https://example.com/a','https://api.github.com/repos/owner/rtl'])assert.throws(()=>privateAssetEndpoint(bad,repo));
 const bytes=Buffer.from('verified private release'); let calls=[];
 const run=async(args,options)=>{calls.push(args);if(args[0].includes('/assets/')){options.onChunk?.(bytes);return bytes;}return Buffer.from(JSON.stringify({assets:[{id:7,name:'setup.zip',size:bytes.length}]}));};
 assert.deepEqual(await privateAsset(url,repo,{maximum:1024,run}),bytes);
 assert.equal(calls[1][0],'repos/owner/rtl/releases/assets/7');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artl-private-'));
 try{const artifact={url,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 await downloadPrivateArtifact(artifact,path.join(dir,'ok.zip'),repo,{run});assert.deepEqual(fs.readFileSync(path.join(dir,'ok.zip')),bytes);
 await assert.rejects(downloadPrivateArtifact({...artifact,sha256:'0'.repeat(64)},path.join(dir,'bad.zip'),repo,{run}),/checksum/);assert.equal(fs.existsSync(path.join(dir,'bad.zip')),false);
 await assert.rejects(privateAsset(url,repo,{maximum:2,run}),/size limit/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
