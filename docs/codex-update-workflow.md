# Codex update workflow

Start when the user reports a new Codex version or requests a Codex compatibility check. For requests without an app name, follow [app selection](app-update-workflow.md).

1. Read `AGENTS.md`, [release instructions](updates.md), the previous compatibility report and configuration. Preserve existing changes and work on a `codex/` branch. Record the actual bundle/ASAR version, build, path and identity, Agent RTL version, macOS and architecture; the CLI version is not the target.
2. Match the target against the official feed and changelog. Distinguish patch removal after an update, structural changes, compatibility allowlist restrictions and download failures. Do not claim compatibility for an unchecked version; record missing files or intermediate versions.
3. Compare main/preload, Electron APIs, HTML/CSP, actual message/composer/queue/question DOM, CSS, detached windows, integrity and signing against the baseline. Preserve original app logic, download safeguards, signing and rollback. Codex requires active integrity checks.
4. Fix issues and run regression checks. Include only the checked version in `supportedAppVersions`. Shared payload changes require userscript regeneration and T3 regression checks.
5. Run `npm test`, `test:language`, `test:gui`, `test:codex-browser`, `test:codex-content`, `test:design`, `test:message-directions` and `test:fonts`. Content/design checks must use the target's actual CSS and an adapted DOM fixture. Fixtures do not establish real-app acceptance. Record skipped checks and reasons.
6. Run `build:gui` with `ARTL_LOCAL_CANDIDATE=1` and an explicit output path, then `test:installer` and `test:events` against that same Setup. Record version, base commit, full diff including new files, source/ZIP hashes, signing and agreement between packaged runtime and source. Disable the candidate's download feed.
7. Do not close or replace the original app yourself. Deliver the exact Setup and [manual checklist](#user-manual-test-checklist); the user performs Launch.
8. Write `docs/compatibility/<version>.md` with the cause, evidence, fixes, automated results, candidate identity, manual results and limitations. Exclude private data. A substantive change after acceptance requires a new candidate and relevant checks.

## User manual test checklist

Record pass, fail or untested with evidence for each item. General acceptance does not confirm every detailed item.

- Record baseline app behavior, sign-in and permissions. Cancelling before Launch must leave the app unchanged.
- Have the user run the specified Setup, prepare and Launch. Confirm the same app/version opens with exactly one ready panel.
- Check Persian, English and mixed text with numbers, paths and links; typing/sending, Shift+2, streaming, queues, questions and buttons.
- Check code/terminal rendering and code copy, all three toggles, independent response direction, a new font, text size and line spacing.
- Check light/dark themes, four accents, narrow and detached windows. Settings must persist after `Cmd+Q` and reopening.
- Cancel Remove RTL using Keep RTL. With user confirmation, actual removal must reopen the same app without RTL, preserve Downloads and allow the same candidate to be installed again.
- Match `gui-status.json` with phase complete and job/app/version/time against `renderer-ready.json`, signing and integrity. Default Codex state: `~/Library/Application Support/Agent RTL/`; record custom paths. If removal deleted state, keep the human report separate from active-installation evidence.
- Removal must restore the original version of the same app. Never restore an old backup over a newer app update. Explicitly list untested architectures and scenarios.

## Publishing

Manual acceptance and explicit GitHub authorization are separate requirements. After both, follow the [release steps](updates.md); record authorization, commit and untested items. Prereleases use `--prerelease --latest=false`. Test actual GitHub download, verification and updating separately from local installation. A CI-rebuilt/signed package needs independent hashes and checks.
