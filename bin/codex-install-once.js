#!/usr/bin/env node
import fs from 'node:fs';
import { installJobPaths, runInstallJob } from './lib/codex-after-quit.js';

const jobPath = process.argv[process.argv.indexOf('--job') + 1];
if (!jobPath || jobPath !== installJobPaths().job) throw new Error('Invalid Codex installation job path.');
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
if (job.paths.job !== jobPath || job.paths.status !== installJobPaths().status) throw new Error('Invalid Codex installation status path.');
// The launchd job is already loaded and marked LaunchOnlyOnce. Removing its
// source file prevents any registration at subsequent logins.
if (job.paths.plist === installJobPaths().plist) fs.rmSync(job.paths.plist, { force: true });
const abort = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => abort.abort());
try { await runInstallJob(job, { signal: abort.signal }); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
    fs.rmSync(jobPath, { force: true });
    if (job.paths.plist === installJobPaths().plist) fs.rmSync(job.paths.plist, { force: true });
}
