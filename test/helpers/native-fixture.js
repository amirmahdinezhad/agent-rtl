import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as asar from '@electron/asar';
import { dictionaryDigest } from '../../bin/lib/codex-native.js';

export async function nativeFixture(dir, version = '26.1013.40934', signed = true, target = 'codex') {
    const t3 = target === 't3', htmlDir = t3 ? 'apps/server/dist/client' : 'webview', frameworkName = t3 ? 'Electron Framework' : 'Codex Framework';
    const app = path.join(dir, t3 ? 'T3 Code.app' : 'ChatGPT.app'), source = path.join(dir, 'source');
    fs.mkdirSync(path.join(source, htmlDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(source, '.vite/build'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: t3 ? 't3code' : 'openai-codex-electron', version, codexBuildNumber: '20770', main: '.vite/build/main.js' }));
    for (const name of t3 ? ['index.html'] : ['index.html', 'detached-window.html']) fs.writeFileSync(path.join(source, htmlDir, name), '<html><head></head><body><script src="./assets/original.js"></script></body></html>');
    for (const name of ['main.js', 'preload.js']) fs.writeFileSync(path.join(source, '.vite/build', name), `// original ${name} logic`);
    fs.writeFileSync(path.join(source, htmlDir, 'assets/original.js'), '// original renderer logic');
    const archive = path.join(app, 'Contents/Resources/app.asar'); fs.mkdirSync(path.dirname(archive), { recursive: true });
    await asar.createPackage(source, archive);
    const dictionary = { 'Resources/app.asar': { algorithm: 'SHA256', hash: createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex') } };
    const executable = path.join(app, 'Contents/MacOS/Codex'); fs.mkdirSync(path.dirname(executable), { recursive: true });
    const plist = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); execFileSync('/usr/bin/plutil', ['-convert', 'xml1', file]); };
    plist(path.join(app, 'Contents/Info.plist'), { CFBundleExecutable: 'Codex', CFBundleIdentifier: 'dev.agentrtl.fixture', CFBundlePackageType: 'APPL', ElectronAsarIntegrity: dictionary });
    if (!signed) { fs.writeFileSync(executable, 'fixture'); return { app, archive, executable, version }; }
    const framework = path.join(app, 'Contents/Frameworks/' + frameworkName + '.framework'), binary = path.join(framework, 'Versions/A/' + frameworkName);
    const bytes = Buffer.concat([Buffer.from('AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A'), Buffer.from([1, 1]), dictionaryDigest(dictionary)]);
    const c = path.join(dir, 'fixture.c');
    fs.writeFileSync(c, `__attribute__((used,section("__DATA_CONST,__asar_integrity"),aligned(1))) static const unsigned char integrity[66] = {${[...bytes].join(',')}}; int main(void) {return 0;}`);
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    execFileSync('/usr/bin/xcrun', ['clang', c, '-o', binary]); fs.copyFileSync(binary, executable);
    plist(path.join(framework, 'Versions/A/Resources/Info.plist'), { CFBundleExecutable: frameworkName, CFBundleIdentifier: 'dev.agentrtl.fixture-framework', CFBundlePackageType: 'FMWK' });
    fs.symlinkSync('A', path.join(framework, 'Versions/Current'));
    for (const entry of [frameworkName, 'Resources']) fs.symlinkSync(`Versions/Current/${entry}`, path.join(framework, entry));
    for (const target of [framework, app]) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', target], { stdio: 'pipe' });
    return { app, archive, executable, version };
}
