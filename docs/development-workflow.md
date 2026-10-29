# Private development and public promotion

The agent manages development, tests, commits, builds, signing, uploads and feeds. The user only checks the update in each installed app's panel, selects Launch and reports acceptance. The agent never closes or replaces an installed app itself.

## Development

Work on local `develop`, with upstream `development/develop` at the private `amirmahdinezhad/rasta-beta` repository. `origin` remains the public `amirmahdinezhad/rasta` repository. Keep implementation commits private until the user accepts their candidate. The public repository is a stable distribution target.

Before pushing, run `npm run test:language` and relevant tests. Push to `development develop`. Follow the `Private development Beta` Actions run until it completes. A failed run is unfinished work: diagnose it, correct it and push a new candidate without asking the user to run scripts or download installers.

The private workflow builds and tests both apps, publishes them with `--prerelease --latest=false`, downloads and verifies both ZIPs, and only then updates the private `beta` release feeds. Each workflow run receives a numeric `1.1.<run-number>` package version so Refresh can distinguish candidates. The source package version is stamped into the build before signing; the source commit and final version are recorded in `candidate.json`. Existing app logic, vendor integrity settings, signing, download verification and rollback remain active.

The private repository's `ARTL_RELEASE_PRIVATE_KEY_BASE64` Actions secret contains the existing feed signing key. Never place the key or GitHub credentials in source, public workflows, release metadata or installers. The existing GitHub owner authentication gates private feed and artifact access. Stable updates remain available without GitHub authentication.

The user starts the panel update. The tray-and-arrow button is labeled Check for updates (previously Refresh); it displays Checking for updates… beside the installed version during an explicit check. Record these observations for Codex and T3 separately: closed-panel update dot, Check for updates offering the candidate, upgrade completing from the panel, the candidate version displayed and normal app behavior. Waiting for Launch is preparation, not completed installation. Existing settings and backups stay in their per-app directories.

## Promotion after explicit acceptance

The agent records acceptance in a local JSON file, naming `version`, `sourceCommit`, `githubPublicationAuthorized: true`, and `targets.codex` / `targets.t3`. Each target includes the tested artifact's `sha256` and explicit `true` values for `closedPanelDot`, `refreshOffersVersion`, `panelUpgradeComplete`, `versionDisplayed` and `appWorking`. Record only observations the user actually confirmed. An overall statement must not silently fill missing checklist details.

With an accepted private candidate and explicit public authorization, the agent runs `node tools/promote-development.mjs v<version> <acceptance-file>` with `ARTL_RELEASE_PRIVATE_KEY_FILE` pointing to the existing local signing key. The user does not run this command.

Promotion validates the candidate's signed feeds and exact ZIP hashes, requires both manual records, fast-forwards public `main` to the exact tested source commit and publishes those same ZIP bytes. It never rebuilds installers and never includes newer untested development commits. If public history has diverged, resolve it privately, build and test a new candidate; do not force-push public history.

Only after independently downloading and verifying the public packages does promotion advance Latest and the stable feed aliases. Keep previous installer ZIPs for rollback. Record post-publication panel checks separately from private Beta acceptance. Returning the owner panel's channel to Stable checks the production path without reinstalling an app.

## Failure and retry

A failed build or verification leaves the private Beta pointer unchanged. A push alone does not mean an update is ready. Inspect the workflow result and confirm both private feeds offer the new version before notifying the user. For interrupted publication or promotion, inspect GitHub releases and the local provenance before retrying; immutable candidate tags and existing promotion directories intentionally prevent silent overwrite.
