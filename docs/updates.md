# Build, test and release

Development requires Node.js as specified in `package.json`. Setup requires macOS, Xcode Command Line Tools and a portable Node runtime with its license. Set `ARTL_PORTABLE_NODE` and, if needed, `ARTL_NODE_LICENSE`; the Node runtime bundled with Codex is detected automatically when available.

```sh
npm ci
npm run build:userscript
npm test
npm run test:language
npm run test:gui
ARTL_LOCAL_CANDIDATE=1 npm run build:gui
npm run test:installer
npm run test:events
```

For T3, build and run installer/event tests with `ARTL_TARGET=t3` and `ARTL_GUI_OUTPUT` set to the absolute path of `dist/Agent RTL T3 Setup.app`. Run GUI/font tests with `ARTL_TEST_TARGET=t3`. The default Codex output is `dist/Agent RTL Setup.app`. Local candidates built with `ARTL_LOCAL_CANDIDATE=1` disable the download feed so tests exercise the exact packaged runtime.

Browser tests require `ARTL_PLAYWRIGHT_MODULE` (the absolute path to `playwright/index.mjs`) and optionally `ARTL_CHROMIUM_EXECUTABLE`. Run `test:codex-content` and `test:design` with `ARTL_USE_CODEX_CSS=1` and a DOM fixture adapted to the target version. `test:t3-design` reads the installed app's CSS and current source payload; `ARTL_T3_ASAR` selects a separate archive. `test:codex-native` runs only a prepared staging copy and requires its manifest.

`npm run clean` deletes reproducible `dist/` output and the compiled helper, preserving source, dependencies and app state. Preserve required candidate evidence outside `dist/` first.

## Installation and compatibility

The [app update workflow](app-update-workflow.md) governs diagnosis and acceptance. Preserve original main/preload files. Staging, full exit after the user's Launch, transactional replacement, signing/integrity checks and rollback are required. launchd performs bounded checks on file changes/login without a permanent process. Removing RTL also removes event registration.

Checked versions and the public key are in `bin/release-config.json`. `feedUrl` belongs to Codex; `t3FeedUrl` belongs to T3. Packages and manifests are independent; T3 does not use the official Codex feed. Accept downloads only from allowed hosts after Ed25519 signature, size and SHA-256 verification.

## Publishing

1. Record manual acceptance and the user's explicit publishing authorization. Keep the private key outside the repository.
2. Synchronize version, lockfile, compatibility lists, feeds, links and userscript. Commit/push and require passing CI for the same commit. Use `npm pack --dry-run` to inspect package contents.
3. Build each app's separate Setup without `ARTL_LOCAL_CANDIDATE`. Check signing, version and agreement between runtime and source, then ZIP it.
4. Sign the manifest with `npm run release:manifest -- --artifact <zip> --repo <owner/repo> --platform darwin-arm64 --tag <tag> --output <json>` and the `ARTL_RELEASE_PRIVATE_KEY_FILE` and `ARTL_RELEASE_PUBLIC_KEY` environment variables. For T3 use `--target t3` and `agent-rtl-t3-release.json`; for Codex use `agent-rtl-release.json`.
5. Publish both ZIPs/manifests for the exact commit with `gh release create ... --prerelease --latest=false --notes-file docs/release-notes.md`. The prerelease channel is not latest. A notarized production release uses the manually dispatched signing/notarization workflow with Developer ID and Apple secrets; the current production workflow builds Codex only.
6. Download published files again and check signatures, hashes, versions and targets. Separately record the user's installation and Launch of the actual GitHub package against the relevant app's acceptance checklist.

In-app summaries and release descriptions must be English. Use `--notes docs/release-notes-codex.json` for Codex and `--notes docs/release-notes-t3.json` for T3. Update these files alongside `docs/release-notes.md` for each release. `--notes <json>` accepts up to three strings of 120 characters each without line breaks. Summaries appear before download, which requires a separate click. Older manifests without summaries remain supported.

Repository version numbering starts at `1.0.0`. The initial `v1.0.0` release used `--latest`; later prereleases use `--prerelease --latest=false`. Packages are ad hoc signed and not notarized. Users of earlier numbering schemes must download the new Setup manually; the updater does not treat a lower version number as an update.
